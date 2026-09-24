import { useEffect, useMemo, useRef, useState } from 'react';
import { FileMenu } from './components/FileMenu';
import { DocumentTabs } from './components/DocumentTabs';
import { RecentFiles } from './components/RecentFiles';
import { RecentFilesDialog } from './components/dialogs/RecentFilesDialog';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/dialogs/ImportDialog';
import { RequirementsDialog } from './components/dialogs/RequirementsDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { RoundChoiceDialog } from './components/dialogs/RoundChoiceDialog';
import { ReaderNavigation, useReaderNavigation } from './components/ReaderNavigation';
import { REVIEW_POLICY } from './config/review';
import { BilingualReader } from './features/review/components/BilingualReader';
import { IssueNavigation, type IssueFilter } from './features/review/components/IssueNavigation';
import { ReviewPanel } from './features/review/components/ReviewPanel';
import { hasUnconfirmedDraft, needsReview } from './core/review';
import { useWorkbench } from './features/review/useWorkbench';
import styles from './App.module.css';
import { desktop } from './services/desktop';
import { WorkbenchContextMenu } from './components/WorkbenchContextMenu';

type ModalName = 'files' | 'requirements' | 'settings' | 'recent' | null;

export default function App() {
  const workbench = useWorkbench();
  const {
    document: session, reviews, selectedIndex, settings, requirements, batches,
    busy, loading, dirty, outputPath, notice, error, openSessions, recentSessions, activeSessionId, workspaceReady, workspaceError,
  } = workbench;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('pending');
  const [modal, setModal] = useState<ModalName>(null);
  const readerNavigation = useReaderNavigation(session, reviews, workbench.selectIndex);
  const openerRef = useRef<HTMLElement | null>(null);
  const entries = session?.entries ?? [];
  const currentLine = entries[selectedIndex];
  const currentReview = reviews[selectedIndex];
  const currentBatch = batches.find(batch => selectedIndex >= batch.coreStart && selectedIndex < batch.coreEnd);
  const reviewList = useMemo(() => Object.values(reviews).sort((a, b) => a.index - b.index), [reviews]);
  const pendingCount = reviewList.filter(needsReview).length;
  const acceptedCount = reviewList.filter(item => item.status === 'accepted').length;
  const completedCount = batches.filter(batch => batch.status === 'complete').length;
  const failedCount = batches.filter(batch => batch.status === 'failed').length;
  const runningBatch = batches.find(batch => batch.status === 'running');
  const draft = currentReview?.draft ?? currentLine?.translation ?? '';
  const canAccept = Boolean(currentLine && (currentReview?.status === 'accepted'
    ? hasUnconfirmedDraft(currentReview)
    : draft !== currentLine.translation || currentReview));
  const checkButtonLabel = batches.some(batch => batch.status === 'pending') ? '继续检查' : batches.length ? '重新检查' : '开始检查';
  const usingOriginalRequirements = workbench.round && (workbench.round.requirements.style !== requirements.style || workbench.round.requirements.background !== requirements.background);
  const progressSaveLabel = { pending: '进度待保存', saving: '进度保存中…', saved: '进度已保存', error: '进度保存失败' }[workbench.progressSaveStatus];

  function launchModal(name: Exclude<ModalName, null>, opener?: HTMLElement | null) {
    readerNavigation.close(false);
    openerRef.current = opener ?? document.activeElement as HTMLElement | null;
    workbench.clearError();
    setModal(name);
  }

  function closeModal() {
    setModal(null);
    requestAnimationFrame(() => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLButtonElement>('header button')?.focus();
    });
  }

  function beginChecking(retry = false) {
    openerRef.current = document.activeElement as HTMLElement | null;
    readerNavigation.close(false);
    void (retry ? workbench.retryFailed() : workbench.startChecking());
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (modal || workbench.roundChoice || event.isComposing || event.defaultPrevented || document.querySelector('[data-popup-menu]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (!loading && workspaceReady) launchModal('files');
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (activeSessionId && !loading) void workbench.closeSession(activeSessionId);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (session && !loading) void workbench.saveDocument();
      } else if ((event.ctrlKey || event.metaKey) && ['f', 'g'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (session && !loading) readerNavigation.open(event.key.toLowerCase() === 'f' ? 'find' : 'jump');
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (canAccept && !loading) workbench.accept(selectedIndex);
      } else if (event.key === 'F8') {
        event.preventDefault();
        if (!loading) workbench.navigateIssue(event.shiftKey ? -1 : 1);
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [modal, session, loading, canAccept, selectedIndex, workbench, activeSessionId, workspaceReady, readerNavigation]);

  return <div className={styles.app} data-menu-root>
    <header className={styles.header}>
      <nav className={styles.menubar} aria-label="应用菜单">
        <FileMenu canOpen={!loading && workspaceReady} canSave={Boolean(session) && !loading} canClose={Boolean(activeSessionId) && !loading} onOpen={opener => launchModal('files', opener)} onSave={saveAs => void workbench.saveDocument(saveAs)} onRecent={opener => launchModal('recent', opener)} onCloseFile={() => { if (activeSessionId) void workbench.closeSession(activeSessionId); }} />
        <button className={styles.menuButton} disabled={busy || loading || !workspaceReady} onClick={() => launchModal('requirements')}>校润要求</button>
        <button className={styles.menuButton} disabled={busy || loading} onClick={() => launchModal('settings')}>设置</button>
      </nav>
      <span className={styles.documentDirection}>原文 <span aria-hidden="true">→</span> 译文</span>
    </header>

    <DocumentTabs sessions={openSessions} activeId={activeSessionId} activeDirty={dirty} disabled={loading || !workspaceReady} onSelect={id => { void workbench.switchSession(id); }} onClose={id => { void workbench.closeSession(id); }} />

    <section className={styles.toolbar} aria-label="检查与审阅">
      {busy ? <button onClick={workbench.stopChecking}><Icon name="stop" />停止</button> : <button disabled={!entries.length || loading} onClick={() => beginChecking()}><Icon name="play" />{checkButtonLabel}</button>}
      {failedCount > 0 && <button disabled={busy || loading} onClick={() => beginChecking(true)}>重试失败批次 · {failedCount}</button>}
      <span className={styles.batchHint} title={`前 ${REVIEW_POLICY.contextBefore} 条 + 检查 ${REVIEW_POLICY.batchSize} 条 + 后 ${REVIEW_POLICY.contextAfter} 条；文件首尾自然截断`}>上下文 {REVIEW_POLICY.windowSize} / 检查 {REVIEW_POLICY.batchSize}</span>
      <span className={styles.spacer} />
      <button className={navigationOpen ? styles.activeButton : ''} aria-expanded={navigationOpen} aria-controls="issue-navigation" onClick={() => setNavigationOpen(!navigationOpen)} disabled={!entries.length}><Icon name="list" />问题<span className={styles.count}>{pendingCount}</span></button>
      <div className={styles.navigationButtons}>
        <button aria-label="上一待审问题 (Shift+F8)" title="上一待审问题 · Shift+F8" disabled={!pendingCount || loading} onClick={() => workbench.navigateIssue(-1)}><Icon name="left" /></button>
        <button aria-label="下一待审问题 (F8)" title="下一待审问题 · F8" disabled={!pendingCount || loading} onClick={() => workbench.navigateIssue(1)}><Icon name="right" /></button>
      </div>
      <span className={styles.toolbarDivider} />
      <button disabled={!session || loading} onClick={() => void workbench.saveDocument()} title="保存已采用的修改 · Ctrl+S"><Icon name="save" />保存</button>
    </section>

    {error && !modal && <div className={styles.errorBanner} role="alert"><span>{error}</span><button className={styles.iconButton} onClick={workbench.clearError} aria-label="关闭错误提示"><Icon name="close" /></button></div>}
    {workspaceError && <div className={styles.errorBanner} role="alert"><span>{workspaceError}</span><div className={styles.errorActions}><button disabled={loading} onClick={() => { void workbench.retryLoadWorkspace(); }}>重试</button>{!workspaceReady && <button disabled={loading} onClick={() => { void workbench.resetWorkspace(); }}>重新建立工作记录</button>}</div></div>}

    {!session ? <main className={styles.emptyWorkspace}>
      <h1>{workspaceReady ? '打开文件' : '恢复工作…'}</h1>
      <p>选择原文及对应译文</p>
      <button className={styles.primary} disabled={loading || !workspaceReady} onClick={() => launchModal('files')}><Icon name="open" />打开…</button>
      {recentSessions.length > 0 && <section className={styles.recentSection} aria-label="最近打开"><div className={styles.recentHeading}><h2>最近打开</h2><button className={styles.inlineAction} disabled={loading} onClick={() => launchModal('recent')}>全部记录…</button></div><RecentFiles sessions={recentSessions.slice(0, 5)} openIds={openSessions.map(item => item.id)} disabled={loading} onOpen={id => { void workbench.switchSession(id); }} /></section>}
    </main> : <main className={`${styles.workspace} ${navigationOpen ? styles.withNavigation : ''}`} inert={loading} aria-busy={loading}>
      {navigationOpen && <IssueNavigation key={session.id} entries={entries} reviews={reviewList} batches={batches} selectedIndex={selectedIndex} filter={issueFilter} onFilter={setIssueFilter} onSelect={workbench.selectIndex} onClose={() => setNavigationOpen(false)} />}
      <BilingualReader documentId={session.id} entries={entries} reviews={reviews} batches={batches} selectedIndex={selectedIndex} onSelect={workbench.selectIndex}
        navigation={readerNavigation.mode && <ReaderNavigation key={readerNavigation.mode} navigation={readerNavigation} count={entries.length} selectedIndex={selectedIndex} />}
        matches={readerNavigation.matches} activeMatchId={readerNavigation.activeId} target={readerNavigation.target} />
      <ReviewPanel line={currentLine} review={currentReview} batchStatus={currentBatch?.status} batchError={currentBatch?.error} roundId={workbench.round?.id} canAccept={canAccept} onDraftChange={text => workbench.updateDraft(selectedIndex, text)} onAccept={() => workbench.accept(selectedIndex)} onIgnore={() => workbench.ignore(selectedIndex)} onReset={() => workbench.resetReview(selectedIndex)} />
    </main>}

    <footer className={styles.statusbar}>
      <span className={styles.progressText} title={usingOriginalRequirements ? '本轮沿用原要求；当前编辑的要求会在选择重新检查后使用。' : undefined}>{loading ? '处理中…' : runningBatch ? `检查 ${runningBatch.coreStart + 1}–${runningBatch.coreEnd} 条 · ${runningBatch.id + 1}/${batches.length} 批` : batches.length ? `已完成 ${completedCount}/${batches.length} 批${failedCount ? ` · ${failedCount} 批失败` : ''}` : session ? `${entries.length} 条 · 等待检查` : '就绪'}{usingOriginalRequirements && ' · 沿用原要求'}</span>
      {session && <><span className={styles.statusSeparator} /><span className={dirty ? styles.dirtyStatus : ''} title={outputPath ?? '尚未保存 JSON'}>{dirty ? `${acceptedCount} 条已采用 · JSON 未保存` : outputPath ? 'JSON 已保存' : 'JSON 未保存'}</span><span className={styles.statusSeparator} /><span title="工作记录自动保存在本机；点击保存才会写入译文 JSON。">{progressSaveLabel}</span></>}
      <span className={styles.spacer} />
      <span className={styles.notice} role="status" title={notice}>{notice}</span>
      <button className={styles.undoButton} disabled={!workbench.canUndo || loading} onClick={workbench.undoReview} title="撤销上次审阅操作"><Icon name="undo" />撤销</button>
    </footer>

    {modal === 'files' && <ImportDialog error={error} onChooseFile={workbench.chooseFile} onOpen={workbench.openDocuments} onClose={closeModal} onOpened={() => { setNavigationOpen(false); closeModal(); }} />}
    {modal === 'requirements' && <RequirementsDialog requirements={requirements} onSave={workbench.saveRequirements} onClose={closeModal} />}
    {modal === 'settings' && <SettingsDialog settings={settings} error={error} loadState={workbench.settingsState} loadError={workbench.settingsError} onReload={workbench.reloadSettings} onReset={workbench.resetSettings} onSave={workbench.saveModelSettings} onTest={workbench.testConnection} onListModels={desktop.listModels} onClose={closeModal} />}
    {modal === 'recent' && <RecentFilesDialog sessions={recentSessions} openIds={openSessions.map(item => item.id)} busy={loading} error={error || workspaceError} onOpen={workbench.switchSession} onHide={workbench.hideRecent} onClose={closeModal} />}
    {workbench.roundChoice && <RoundChoiceDialog opener={openerRef.current} round={workbench.round} {...workbench.roundChoice} onChoose={choice => void workbench.chooseRound(choice)} onClose={workbench.cancelRoundChoice} />}
    <WorkbenchContextMenu workbench={workbench} modal={workbench.roundChoice ? 'round' : modal} onCloseRecent={closeModal} onNavigate={readerNavigation.open} />
  </div>;
}
