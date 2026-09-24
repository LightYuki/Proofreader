import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { acceptedChanges, buildWindows, mergeSuggestions, needsReview, parseSuggestions, undoReviewDecision, type ReviewUndoEntry } from '../../core/review';
import { chooseJsonFile, chooseOutputPath, confirmDiscard, desktop, errorMessage, isDesktop } from '../../services/desktop';
import type { BatchState, CheckRound, DocumentSession, ModelSettings, ModelSettingsInput, Requirements, ReviewItem, StoredSession, WorkspaceState } from '../../types';
import { DEFAULT_REQUIREMENTS, readRequirements, REQUIREMENTS_STORAGE_KEY, REVIEW_HISTORY_LIMIT } from '../../config/review';
import { activateSession, captureSession, closeSessionTab, emptyWorkspace, findSession, hideRecentSession, readWorkspace, restoreSession, serializedWriter, updateSession } from '../workspace/state';

type Reviews = Record<number, ReviewItem>;
const fingerprint = (reviews: Reviews) => JSON.stringify(acceptedChanges(reviews));
const AUTOSAVE_DELAY = 400;

function loadRequirements(): Requirements {
  try {
    const parsed = readRequirements(JSON.parse(localStorage.getItem(REQUIREMENTS_STORAGE_KEY) || 'null'));
    if (parsed) return parsed;
  } catch { /* Invalid local preferences use safe defaults. */ }
  return DEFAULT_REQUIREMENTS;
}

export function useWorkbench() {
  const [document, setDocument] = useState<DocumentSession | null>(null);
  const documentRef = useRef<DocumentSession | null>(null);
  const [reviews, setReviews] = useState<Reviews>({});
  const reviewsRef = useRef<Reviews>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedRef = useRef(0);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [settingsState, setSettingsState] = useState<'loading' | 'ready' | 'error'>(isDesktop() ? 'loading' : 'ready');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const settingsGeneration = useRef(0);
  const [round, setRound] = useState<CheckRound | undefined>();
  const roundRef = useRef<CheckRound | undefined>(undefined);
  const [roundChoice, setRoundChoice] = useState<{ documentId: string; intent: 'start' | 'retry'; canContinue: boolean; modelChanged: boolean } | null>(null);
  const [requirements, setRequirements] = useState<Requirements>(loadRequirements);
  const requirementsRef = useRef(requirements);
  const [batches, setBatches] = useState<BatchState[]>([]);
  const batchesRef = useRef<BatchState[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const outputRef = useRef<string | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState('[]');
  const savedRef = useRef('[]');
  const [notice, setNotice] = useState(isDesktop() ? '' : '浏览器预览；请在桌面应用中打开文件。');
  const [error, setError] = useState<string | null>(null);
  const history = useRef<ReviewUndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const job = useRef({ generation: 0, requestId: null as string | null, running: false });
  const mounted = useRef(true);
  const [workspace, setWorkspace] = useState<WorkspaceState>(emptyWorkspace);
  const workspaceRef = useRef(workspace);
  const [workspaceReady, setWorkspaceReady] = useState(!isDesktop());
  const workspaceReadyRef = useRef(!isDesktop());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const fileOperation = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeWorkspace = useRef(serializedWriter(desktop.saveWorkspace));
  const loadGeneration = useRef(0);
  const changeVersion = useRef(0);
  const writeSequence = useRef(0);
  const [saveRevision, setSaveRevision] = useState(0);
  const [progressSaveStatus, setProgressSaveStatus] = useState<'pending' | 'saving' | 'saved' | 'error'>('saved');
  const dirty = fingerprint(reviews) !== savedFingerprint;

  const markWorkspaceDirty = useCallback(() => {
    setSaveRevision(++changeVersion.current);
    setProgressSaveStatus('pending');
  }, []);

  const replaceReviews = useCallback((next: Reviews) => {
    reviewsRef.current = next;
    setReviews(next);
    markWorkspaceDirty();
  }, [markWorkspaceDirty]);
  const replaceBatches = useCallback((next: BatchState[]) => {
    batchesRef.current = next;
    setBatches(next);
    markWorkspaceDirty();
  }, [markWorkspaceDirty]);
  const markBatch = useCallback((id: number, patch: Partial<BatchState>) => {
    replaceBatches(batchesRef.current.map(batch => batch.id === id ? { ...batch, ...patch } : batch));
  }, [replaceBatches]);

  const replaceWorkspace = useCallback((next: WorkspaceState, changed = true) => {
    workspaceRef.current = next;
    setWorkspace(next);
    if (changed) markWorkspaceDirty();
  }, [markWorkspaceDirty]);

  const snapshotWorkspace = useCallback(() => {
    const doc = documentRef.current;
    const current = workspaceRef.current;
    const id = current.activeId;
    if (!doc || !id) return current;
    return updateSession(current, captureSession(doc, id, {
      reviews: reviewsRef.current,
      batches: batchesRef.current,
      requirements: requirementsRef.current,
      selectedIndex: selectedRef.current,
      outputPath: outputRef.current,
      savedFingerprint: savedRef.current,
      hiddenFromRecents: current.sessions.find(value => value.id === id)?.hiddenFromRecents,
      round: roundRef.current,
    }, current.sessions.find(value => value.id === id)?.lastOpened ?? Date.now()));
  }, []);

  const persistWorkspace = useCallback(async (next: WorkspaceState) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
    if (!workspaceReadyRef.current) throw new Error('工作记录尚未读取完成，请重试读取后再操作。');
    replaceWorkspace(next, false);
    const revision = changeVersion.current;
    const sequence = ++writeSequence.current;
    setProgressSaveStatus('saving');
    try {
      await writeWorkspace.current(next);
      if (mounted.current && sequence === writeSequence.current) {
        setWorkspaceError(null);
        setProgressSaveStatus(revision === changeVersion.current ? 'saved' : 'pending');
      }
    } catch (err) {
      if (mounted.current && sequence === writeSequence.current) {
        setWorkspaceError(`无法保存工作记录：${errorMessage(err)}`);
        setProgressSaveStatus('error');
      }
      throw err;
    }
  }, [replaceWorkspace]);

  const flushWorkspace = useCallback(() => persistWorkspace(snapshotWorkspace()), [persistWorkspace, snapshotWorkspace]);

  const applySession = useCallback((doc: DocumentSession, session: StoredSession) => {
    documentRef.current = doc; setDocument(doc);
    roundRef.current = session.round; setRound(session.round); setRoundChoice(null);
    // Old records cannot prove that a proposal was never edited; protect them
    // when activating the session, without rewriting unrelated stored records.
    replaceReviews(Object.fromEntries(Object.entries(session.reviews).map(([key, review]) => [key, { ...review, manualEdited: review.manualEdited ?? true }])));
    replaceBatches(session.batches);
    selectedRef.current = session.selectedIndex; setSelectedIndex(session.selectedIndex);
    requirementsRef.current = session.requirements; setRequirements(session.requirements);
    outputRef.current = session.outputPath; setOutputPath(session.outputPath);
    savedRef.current = session.savedFingerprint; setSavedFingerprint(session.savedFingerprint);
    history.current = []; setCanUndo(false);
  }, [replaceReviews, replaceBatches]);

  const clearActiveSession = useCallback(() => {
    documentRef.current = null; setDocument(null);
    roundRef.current = undefined; setRound(undefined); setRoundChoice(null);
    replaceReviews({}); replaceBatches([]);
    selectedRef.current = 0; setSelectedIndex(0);
    outputRef.current = null; setOutputPath(null);
    savedRef.current = '[]'; setSavedFingerprint('[]');
    requirementsRef.current = loadRequirements(); setRequirements(requirementsRef.current);
    history.current = []; setCanUndo(false);
  }, [replaceReviews, replaceBatches]);

  const stopChecking = useCallback(() => {
    const requestId = job.current.requestId;
    job.current = { generation: job.current.generation + 1, requestId: null, running: false };
    if (requestId) void desktop.cancelRequest(requestId).catch(() => { /* Generation guard rejects late results. */ });
    replaceBatches(batchesRef.current.map(batch => batch.status === 'running' ? { ...batch, status: 'pending' } : batch));
    setBusy(false);
    setNotice('检查已停止，可继续。');
  }, [replaceBatches]);

  const retryLoadWorkspace = useCallback(async () => {
    if (!isDesktop()) return;
    if (workspaceReadyRef.current) {
      try { await flushWorkspace(); } catch { /* The persistence error remains visible. */ }
      return;
    }
    const generation = ++loadGeneration.current;
    fileOperation.current = true; setLoading(true);
    try {
      const loaded = readWorkspace(await desktop.loadWorkspace());
      if (!mounted.current || generation !== loadGeneration.current) return;
      replaceWorkspace(loaded);
      workspaceReadyRef.current = true; setWorkspaceReady(true); setWorkspaceError(null);
      const previous = loaded.sessions.find(session => session.id === loaded.activeId);
      if (previous) {
        try {
          const doc = await desktop.openDocuments(previous.sourcePath, previous.targetPath);
          if (!mounted.current || generation !== loadGeneration.current) return;
          const restored = restoreSession(doc, previous, loadRequirements());
          applySession(doc, restored.session);
          replaceWorkspace(activateSession(loaded, restored.session));
          setNotice(restored.changed ? '文件内容已更改，已重新载入；原审阅进度已重置。' : '已恢复上次的工作。');
        } catch (err) {
          if (mounted.current && generation === loadGeneration.current) setError(`无法恢复文件：${errorMessage(err)}`);
        }
      }
    } catch (err) {
      if (mounted.current && generation === loadGeneration.current) setWorkspaceError(`无法读取工作记录：${errorMessage(err)}`);
    } finally {
      if (mounted.current && generation === loadGeneration.current) { fileOperation.current = false; setLoading(false); }
    }
  }, [flushWorkspace, replaceWorkspace, applySession]);

  const resetWorkspace = async (): Promise<boolean> => {
    if (!isDesktop() || fileOperation.current || workspaceReadyRef.current || !workspaceError) return false;
    fileOperation.current = true; setLoading(true);
    try {
      if (!await confirmDiscard('将备份原工作记录并重新开始。JSON 文件不会改变。继续？')) return false;
      const restored = readWorkspace(await desktop.resetWorkspace());
      replaceWorkspace(restored);
      clearActiveSession();
      workspaceReadyRef.current = true; setWorkspaceReady(true);
      setWorkspaceError(null); setError(null);
      setNotice('原工作记录已备份，可以重新打开文件。');
      return true;
    } catch (err) {
      setWorkspaceError(`无法重置工作记录：${errorMessage(err)}`);
      return false;
    } finally { fileOperation.current = false; setLoading(false); }
  };

  const reloadSettings = useCallback(async (): Promise<ModelSettings | null> => {
    if (!isDesktop()) return null;
    const generation = ++settingsGeneration.current;
    setSettingsState('loading');
    try {
      const value = await desktop.getSettings();
      if (mounted.current && generation === settingsGeneration.current) {
        setSettings(value); setSettingsState('ready'); setSettingsError(null);
      }
      return value;
    } catch (err) {
      if (mounted.current && generation === settingsGeneration.current) {
        setSettingsState('error'); setSettingsError(errorMessage(err));
      }
      return null;
    }
  }, []);

  const resetSettings = async () => {
    if (job.current.running || fileOperation.current || !isDesktop()) return null;
    if (!await confirmDiscard('将备份原模型设置并重新填写。不会删除审阅进度，旧密钥不会自动用于新配置。继续？')) return null;
    setSettingsState('loading');
    try {
      const value = await desktop.resetSettings();
      ++settingsGeneration.current;
      setSettings(value); setSettingsState('ready'); setSettingsError(null);
      return value;
    } catch (err) { setSettingsState('error'); setSettingsError(errorMessage(err)); return null; }
  };

  useEffect(() => {
    mounted.current = true;
    if (isDesktop()) {
      void reloadSettings();
      void retryLoadWorkspace();
    }
    return () => { mounted.current = false; loadGeneration.current += 1; settingsGeneration.current += 1; };
  }, [retryLoadWorkspace, reloadSettings]);

  useEffect(() => {
    if (!isDesktop() || !workspaceReady) return;
    autosaveTimer.current = setTimeout(() => {
      // File operations persist their own snapshot. Resume autosave once loading ends.
      if (!fileOperation.current) void flushWorkspace().catch(() => { /* Error is shown separately from JSON saving. */ });
    }, AUTOSAVE_DELAY);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); autosaveTimer.current = null; };
  }, [saveRevision, workspaceReady, loading, flushWorkspace]);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let allowClose = false;
    let confirming = false;
    void getCurrentWindow().onCloseRequested(async event => {
      if (allowClose) return;
      if (!workspaceReadyRef.current && !documentRef.current) return;
      event.preventDefault();
      if (confirming) return;
      if (fileOperation.current) { setNotice('正在处理文件，请稍后关闭。'); return; }
      confirming = true;
      fileOperation.current = true; setLoading(true);
      try {
        if (job.current.running) stopChecking();
        try {
          await flushWorkspace();
        } catch (err) {
          if (!disposed) setError(errorMessage(err));
          const confirmed = await confirmDiscard('工作记录保存失败。关闭后，本次未保存的审阅进度和草稿将丢失。JSON 文件不会改变。仍要关闭？');
          if (!confirmed) return;
        }
        allowClose = true;
        await getCurrentWindow().close();
      } catch (err) { allowClose = false; if (!disposed) setError(errorMessage(err)); }
      finally { confirming = false; fileOperation.current = false; if (!disposed) setLoading(false); }
    }).then(cleanup => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(err => setError(errorMessage(err)));
    return () => { disposed = true; unlisten?.(); };
  }, [stopChecking, flushWorkspace]);

  const chooseFile = async (title: string) => {
    try { return await chooseJsonFile(title); }
    catch (err) { setError(errorMessage(err)); return null; }
  };

  const openDocuments = async (sourcePath: string, targetPath: string): Promise<boolean> => {
    if (fileOperation.current) return false;
    if (!workspaceReadyRef.current) { setError('请先重新读取工作记录。'); return false; }
    if (!isDesktop()) { setError('请通过桌面程序打开文件。'); return false; }
    fileOperation.current = true; setLoading(true);
    try {
      if (job.current.running) stopChecking();
      await flushWorkspace();
      const result = await desktop.openDocuments(sourcePath, targetPath);
      const previous = findSession(workspaceRef.current, result);
      const restored = restoreSession(result, previous, loadRequirements());
      applySession(result, restored.session);
      const next = activateSession(workspaceRef.current, restored.session);
      replaceWorkspace(next);
      setError(null);
      setNotice(restored.changed ? '文件内容已更改，已重新载入；原审阅进度已重置。'
        : previous ? '已恢复审阅进度。' : `已打开 ${result.entries.length} 条台词。`);
      try { await persistWorkspace(next); } catch { /* The file is open; failed autosave stays visible. */ }
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
    finally { fileOperation.current = false; setLoading(false); }
  };

  const switchSession = async (id: string): Promise<boolean> => {
    if (workspaceRef.current.activeId === id && documentRef.current) return true;
    const previous = workspaceRef.current.sessions.find(session => session.id === id);
    if (!previous) return false;
    return openDocuments(previous.sourcePath, previous.targetPath);
  };

  const closeSession = async (id: string): Promise<boolean> => {
    if (fileOperation.current || !workspaceReadyRef.current || !workspaceRef.current.openIds.includes(id)) return false;
    fileOperation.current = true; setLoading(true);
    try {
      const closingActive = workspaceRef.current.activeId === id;
      if (closingActive && job.current.running) stopChecking();
      await flushWorkspace();
      let next = closeSessionTab(snapshotWorkspace(), id);
      if (closingActive) {
        const previous = next.sessions.find(session => session.id === next.activeId);
        if (previous) {
          // Opening must succeed before the active tab is removed. The backend
          // also keeps the current document intact when reading the next fails.
          const doc = await desktop.openDocuments(previous.sourcePath, previous.targetPath);
          const restored = restoreSession(doc, previous, loadRequirements());
          applySession(doc, restored.session);
          next = activateSession(next, restored.session);
          setNotice(restored.changed ? '文件内容已更改，已重新载入；原审阅进度已重置。' : '已恢复审阅进度。');
        } else {
          clearActiveSession(); setNotice('');
        }
      }
      markWorkspaceDirty();
      await persistWorkspace(next);
      setError(null);
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
    finally { fileOperation.current = false; setLoading(false); }
  };

  const hideRecent = async (id: string) => {
    const previous = workspaceRef.current.sessions.find(session => session.id === id);
    if (fileOperation.current || !workspaceReadyRef.current || !previous || previous.hiddenFromRecents || workspaceRef.current.openIds.includes(id)) return;
    fileOperation.current = true; setLoading(true);
    try {
      markWorkspaceDirty();
      await persistWorkspace(hideRecentSession(snapshotWorkspace(), id));
      setNotice('已从最近列表隐藏，审阅进度保留。'); setError(null);
    } catch (err) {
      // Roll back only visibility; a running batch may have added newer results.
      const current = snapshotWorkspace();
      replaceWorkspace({ ...current, sessions: current.sessions.map(session => session.id === id ? { ...session, hiddenFromRecents: previous.hiddenFromRecents } : session) });
      setError(`无法隐藏最近记录：${errorMessage(err)}`);
    } finally { fileOperation.current = false; setLoading(false); }
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice('已复制。'); }
    catch (err) { setError(`无法复制到剪贴板：${errorMessage(err)}`); }
  };

  const saveDocument = async (saveAs = false) => {
    const doc = documentRef.current;
    if (!doc || fileOperation.current) return;
    fileOperation.current = true;
    try {
      setLoading(true);
      const defaultPath = outputRef.current ?? doc.targetPath.replace(/\.json$/i, '') + '.proofread.json';
      const path = !saveAs && outputRef.current ? outputRef.current : await chooseOutputPath(defaultPath);
      if (!path) return;
      const changes = acceptedChanges(reviewsRef.current);
      const written = await desktop.saveDocument(doc.id, path, changes);
      if (documentRef.current?.id !== doc.id) return;
      outputRef.current = written; setOutputPath(written);
      savedRef.current = JSON.stringify(changes); setSavedFingerprint(savedRef.current);
      markWorkspaceDirty();
      const pending = Object.values(reviewsRef.current).filter(needsReview).length;
      setNotice(`已保存 ${changes.length} 处修改${pending ? `，另有 ${pending} 条待确认` : ''}。`);
      setError(null);
      try { await flushWorkspace(); } catch { /* JSON was saved; report cache failure separately. */ }
    } catch (err) { setError(errorMessage(err)); }
    finally { fileOperation.current = false; setLoading(false); }
  };

  const saveModelSettings = async (input: ModelSettingsInput) => {
    if (!isDesktop()) { setError('请在桌面程序中保存模型设置。'); return false; }
    if (job.current.running) { setError('请先停止检查，再修改模型连接。'); return false; }
    try {
      const value = await desktop.saveSettings(input);
      setSettings(value); setSettingsState('ready'); setSettingsError(null); setError(null); setNotice('模型设置已保存。');
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
  };

  const testConnection = async (input: ModelSettingsInput) => {
    if (!isDesktop()) throw new Error('请在桌面程序中测试模型连接。');
    return desktop.testConnection(input);
  };

  const saveRequirements = (value: Requirements) => {
    if (fileOperation.current) return;
    requirementsRef.current = value; setRequirements(value);
    markWorkspaceDirty();
    try { localStorage.setItem(REQUIREMENTS_STORAGE_KEY, JSON.stringify(value)); }
    catch { setError('本次要求已应用，但无法保存到本机偏好设置。'); }
    setNotice('校润要求已保存。');
  };

  const runBatches = async (todo: BatchState[], currentRound: CheckRound) => {
    const doc = documentRef.current;
    if (!doc || job.current.running || fileOperation.current || !todo.length) return;
    if (!isDesktop()) { setError('请在桌面程序中运行检查。'); return; }
    const generation = job.current.generation + 1;
    job.current = { generation, running: true, requestId: null };
    const snapshot = { ...currentRound.requirements };
    setBusy(true); setError(null);
    for (const batch of todo) {
      if (generation !== job.current.generation || !mounted.current) break;
      const requestId = crypto.randomUUID();
      job.current.requestId = requestId;
      markBatch(batch.id, { status: 'running', error: undefined });
      setNotice(`正在检查第 ${batch.coreStart + 1}–${batch.coreEnd} 条。`);
      try {
        const content = await desktop.checkBatch({ requestId, documentId: doc.id, coreStart: batch.coreStart, coreEnd: batch.coreEnd, contextStart: batch.contextStart, contextEnd: batch.contextEnd, requirements: snapshot });
        if (generation !== job.current.generation || documentRef.current?.id !== doc.id || !mounted.current) break;
        const suggestions = parseSuggestions(content, batch, doc.entries);
        const previous = reviewsRef.current;
        const merged = mergeSuggestions(previous, suggestions, batch);
        for (const suggestion of suggestions) {
          if (merged[suggestion.index] && merged[suggestion.index] !== previous[suggestion.index]) {
            merged[suggestion.index].roundId = currentRound.id;
            merged[suggestion.index].manualEdited = false;
          }
        }
        replaceReviews(merged);
        markBatch(batch.id, { status: 'complete', error: undefined });
      } catch (err) {
        if (generation !== job.current.generation || !mounted.current) break;
        markBatch(batch.id, { status: 'failed', error: errorMessage(err) });
      }
    }
    if (generation !== job.current.generation || !mounted.current) return;
    job.current.running = false; job.current.requestId = null; setBusy(false);
    const failed = batchesRef.current.filter(batch => batch.status === 'failed').length;
    const completed = batchesRef.current.filter(batch => batch.status === 'complete').length;
    setNotice(failed ? `完成 ${completed} 批，${failed} 批失败。` : '检查完成。');
    if (failed) setError(batchesRef.current.find(batch => batch.status === 'failed')?.error ?? '部分批次失败，请重试。');
  };

  const requestChecking = async (intent: 'start' | 'retry', resolution?: 'continue' | 'restart', expectedDocumentId?: string) => {
    const doc = documentRef.current;
    if (!doc || job.current.running || fileOperation.current) return;
    if (expectedDocumentId && expectedDocumentId !== doc.id) { setRoundChoice(null); return; }
    if (!doc.entries.length) { setNotice('文件为空，无需发起模型请求。'); return; }
    const previous = roundRef.current;
    let todo = batchesRef.current.filter(batch => batch.status === (intent === 'retry' ? 'failed' : 'pending'));
    const requirementsChanged = previous && (previous.requirements.style !== requirementsRef.current.style || previous.requirements.background !== requirementsRef.current.background);
    if (intent === 'retry' && !todo.length && resolution !== 'restart') return;
    if (resolution === 'continue' && (!previous || !todo.length)) return;
    fileOperation.current = true; setLoading(true);
    let currentRound: CheckRound | undefined;
    try {
      if (!isDesktop()) throw new Error('请在桌面程序中运行检查。');
      const validated = await desktop.validateSettings();
      setSettings(validated); setSettingsState('ready'); setSettingsError(null);
      // Keep only the service origin in progress; URL queries can carry secrets.
      const service = new URL(validated.baseUrl);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(service.href));
      const connectionFingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const modelChanged = Boolean(previous && (previous.model !== validated.model
        || (previous.connectionFingerprint ? previous.connectionFingerprint !== connectionFingerprint : previous.baseUrl !== validated.baseUrl)));
      if (todo.length && (!previous || requirementsChanged || modelChanged) && !resolution) {
        setRoundChoice({ documentId: doc.id, intent, canContinue: Boolean(previous), modelChanged });
        return;
      }
      setRoundChoice(null);
      const restarting = resolution === 'restart' || !todo.length;
      currentRound = !restarting && previous && !modelChanged ? previous : {
        id: crypto.randomUUID(), requirements: { ...(!restarting && previous ? previous.requirements : requirementsRef.current) },
        baseUrl: service.origin, connectionFingerprint, model: validated.model,
      };
      if (restarting) {
        todo = buildWindows(doc.entries.length).map(batch => ({ ...batch, status: 'pending' }));
        replaceBatches(todo);
      }
      roundRef.current = currentRound; setRound(currentRound); markWorkspaceDirty();
      await flushWorkspace();
    } catch (err) { setRoundChoice(null); setError(errorMessage(err)); currentRound = undefined; }
    finally { fileOperation.current = false; setLoading(false); }
    if (currentRound) await runBatches(todo, currentRound);
  };
  const startChecking = () => requestChecking('start');
  const retryFailed = () => requestChecking('retry');
  const chooseRound = (resolution: 'continue' | 'restart') => roundChoice
    ? requestChecking(roundChoice.intent, resolution, roundChoice.documentId) : Promise.resolve();

  const getItem = (index: number): ReviewItem | null => {
    const line = documentRef.current?.entries[index];
    if (!line) return null;
    return reviewsRef.current[index] ?? { index, proposed: line.translation, draft: line.translation, reason: '手动编辑', status: 'pending', manualEdited: true };
  };
  const updateDraft = (index: number, text: string) => {
    if (fileOperation.current) return;
    const item = getItem(index); if (!item) return;
    if (item.draft === text) return;
    // Track typing explicitly: a replacement model proposal is not a manual edit.
    history.current = history.current.map(action => action.index === index ? { ...action, draftAfterDecision: text } : action);
    replaceReviews({ ...reviewsRef.current, [index]: { ...item, draft: text, manualEdited: true, status: item.status === 'ignored' ? 'pending' : item.status } });
  };
  const changeDecision = (index: number, action: 'accept' | 'ignore' | 'reset') => {
    if (fileOperation.current) return;
    const item = getItem(index); if (!item) return;
    history.current = [...history.current.slice(-(REVIEW_HISTORY_LIMIT - 1)), { index, previous: reviewsRef.current[index] }]; setCanUndo(true);
    const next: ReviewItem = action === 'accept' ? { ...item, status: 'accepted', acceptedText: item.draft }
      : { ...item, status: action === 'ignore' ? 'ignored' : 'pending', acceptedText: undefined, manualEdited: true };
    replaceReviews({ ...reviewsRef.current, [index]: next });
    setNotice(action === 'accept' ? '已采用。' : action === 'ignore' ? '已保留原译。' : '已恢复待审。');
  };
  const undoReview = () => {
    if (fileOperation.current) return;
    const action = history.current.pop();
    if (action) {
      replaceReviews(undoReviewDecision(reviewsRef.current, action));
      setCanUndo(history.current.length > 0); setNotice('已撤销。');
    }
  };
  const selectIndex = useCallback((index: number) => {
    if (fileOperation.current) return;
    if (documentRef.current && index >= 0 && index < documentRef.current.entries.length) {
      if (selectedRef.current === index) return;
      selectedRef.current = index; setSelectedIndex(index);
      markWorkspaceDirty();
    }
  }, [markWorkspaceDirty]);
  const navigateIssue = (direction: 1 | -1) => {
    const indices = Object.values(reviewsRef.current).filter(needsReview).map(item => item.index).sort((a, b) => a - b);
    if (!indices.length) return;
    const index = direction > 0 ? indices.find(value => value > selectedIndex) ?? indices[0]
      : [...indices].reverse().find(value => value < selectedIndex) ?? indices[indices.length - 1];
    selectIndex(index);
  };

  const openSessions = workspace.openIds.map(id => workspace.sessions.find(session => session.id === id)).filter((session): session is StoredSession => Boolean(session));
  const recentSessions = workspace.sessions.filter(session => !session.hiddenFromRecents).sort((a, b) => b.lastOpened - a.lastOpened);

  return { document, reviews, selectedIndex, settings, settingsState, settingsError, reloadSettings, resetSettings,
    round, roundChoice, chooseRound, cancelRoundChoice: () => setRoundChoice(null), progressSaveStatus,
    requirements, batches, busy, loading, dirty, outputPath, notice, error,
    openSessions, recentSessions, activeSessionId: workspace.activeId, workspaceReady, workspaceError, retryLoadWorkspace, resetWorkspace, switchSession, closeSession, hideRecent, copyText,
    clearError: () => setError(null), selectIndex, chooseFile, openDocuments, saveDocument, saveModelSettings, testConnection,
    saveRequirements, startChecking, retryFailed, stopChecking, updateDraft, accept: (index: number) => changeDecision(index, 'accept'),
    ignore: (index: number) => changeDecision(index, 'ignore'), resetReview: (index: number) => changeDecision(index, 'reset'), undoReview, canUndo, navigateIssue };
}
