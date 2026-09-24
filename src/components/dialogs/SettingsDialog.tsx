import { useEffect, useRef, useState } from 'react';
import type { ModelSettings, ModelSettingsInput } from '../../types';
import { ModelPicker } from '../ModelPicker';
import { ModalDialog, messageOf } from './ModalDialog';
import styles from '../../App.module.css';

interface SettingsDialogProps {
  settings: ModelSettings | null;
  error: string | null;
  loadState: 'loading' | 'ready' | 'error';
  loadError: string | null;
  onReload: () => Promise<ModelSettings | null>;
  onReset: () => Promise<ModelSettings | null>;
  onSave: (settings: ModelSettingsInput) => Promise<boolean>;
  onTest: (settings: ModelSettingsInput) => Promise<string>;
  onListModels: (settings: ModelSettingsInput) => Promise<string[]>;
  onClose: () => void;
}

function sameOrigin(first: string, second: string) {
  try { return new URL(first.trim()).origin === new URL(second.trim()).origin; }
  catch { return false; }
}

export function SettingsDialog({ settings, error, loadState, loadError, onReload, onReset, onSave, onTest, onListModels, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<ModelSettingsInput>({ baseUrl: settings?.baseUrl ?? '', model: settings?.model ?? '' });
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [listing, setListing] = useState({ busy: false, text: '', failed: false });
  const [test, setTest] = useState({ busy: false, text: '', success: false });
  const testId = useRef(0);
  const listId = useRef(0);
  const mounted = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (settings && !edited.current) setDraft({ baseUrl: settings.baseUrl, model: settings.model });
  }, [settings]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; testId.current += 1; listId.current += 1; };
  }, []);

  function changeSetting(field: keyof ModelSettingsInput, value: string) {
    edited.current = true;
    testId.current += 1;
    setDraft(previous => ({ ...previous, [field]: value }));
    setTest({ busy: false, text: '', success: false });
    setLocalError('');
    if (field !== 'model') {
      listId.current += 1; setModels([]); setListing({ busy: false, text: '', failed: false });
    }
  }

  async function recover(reset: boolean) {
    setSubmitting(true); setLocalError('');
    try {
      const value = await (reset ? onReset() : onReload());
      if (value && mounted.current && (reset || !edited.current)) {
        edited.current = false;
        setDraft({ baseUrl: value.baseUrl, model: value.model });
        setModels([]); setTest({ busy: false, text: '', success: false });
        setListing({ busy: false, text: '', failed: false });
      }
    } catch (failure) { if (mounted.current) setLocalError(messageOf(failure)); }
    finally { if (mounted.current) setSubmitting(false); }
  }

  async function fetchModels() {
    const requestId = ++listId.current;
    setListing({ busy: true, text: '', failed: false });
    try {
      const result = await onListModels(draft);
      if (mounted.current && requestId === listId.current) {
        setModels(result);
        setListing({ busy: false, text: result.length ? `${result.length} 个模型，可输入名称筛选。` : '未返回模型，可手动填写名称。', failed: false });
      }
    } catch (failure) {
      if (mounted.current && requestId === listId.current) {
        setModels([]); setListing({ busy: false, text: `${messageOf(failure)}；也可手动填写模型名称。`, failed: true });
      }
    }
  }

  async function testConnection() {
    const requestId = ++testId.current;
    setTest({ busy: true, text: '连接中…', success: false });
    try {
      const result = await onTest(draft);
      if (mounted.current && requestId === testId.current) setTest({ busy: false, text: result, success: true });
    } catch (failure) {
      if (mounted.current && requestId === testId.current) setTest({ busy: false, text: messageOf(failure), success: false });
    }
  }

  async function saveSettings() {
    setSubmitting(true); setLocalError('');
    try { if (await onSave(draft) && mounted.current) onClose(); }
    catch (failure) { if (mounted.current) setLocalError(messageOf(failure)); }
    finally { if (mounted.current) setSubmitting(false); }
  }

  const incomplete = !draft.baseUrl.trim() || !draft.model.trim();
  const keepingKey = settings?.hasApiKey && draft.apiKey === undefined && sameOrigin(draft.baseUrl, settings.baseUrl);
  const unknownKey = Boolean(settings?.credentialError && draft.apiKey === undefined && sameOrigin(draft.baseUrl, settings.baseUrl));
  const unavailable = loadState !== 'ready';
  return <ModalDialog title="设置" description="模型服务 · OpenAI 兼容接口" submitting={submitting} submitDisabled={incomplete || unavailable || unknownKey} error={localError || error} onClose={onClose} onSubmit={() => void saveSettings()}>
    {loadState === 'loading' && <p className={styles.tabDescription} role="status">正在读取设置…</p>}
    {loadState === 'error' && <div className={styles.settingsRecovery} role="alert"><p>{loadError || '无法读取模型设置。'}</p><div className={styles.recoveryActions}><button type="button" disabled={submitting} onClick={() => void recover(false)}>重试读取</button><button type="button" disabled={submitting} onClick={() => void recover(true)}>备份并重新填写</button></div></div>}
    {settings?.credentialError && <div className={styles.settingsRecovery} role="alert"><p>已读取地址和模型，但无法读取已保存的密钥：{settings.credentialError}</p><p>可重试读取、输入新密钥，或明确选择不使用密钥。</p><button type="button" disabled={submitting || unavailable} onClick={() => void recover(false)}>重试读取密钥</button></div>}
    <div className={styles.formField}><label htmlFor="base-url">Base URL</label><input id="base-url" autoFocus disabled={submitting} value={draft.baseUrl} onChange={event => changeSetting('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" required autoComplete="off" spellCheck={false} /></div>
    <div className={styles.formField}>
      <label htmlFor="api-key">API Key <span className={styles.fieldOptional}>选填</span></label>
      <div className={styles.keyInput}><input id="api-key" type="password" disabled={submitting} value={draft.apiKey ?? ''} onChange={event => changeSetting('apiKey', event.target.value)} placeholder={unknownKey ? '已保存密钥暂不可读' : keepingKey ? '已保存密钥，输入以更换' : '本地服务可留空'} autoComplete="new-password" spellCheck={false} />{(keepingKey || draft.apiKey || unknownKey) && <button type="button" disabled={submitting} onClick={() => changeSetting('apiKey', '')}>不使用密钥</button>}</div>
      <span>{unknownKey ? '密钥状态未知，请选择如何连接。' : keepingKey ? '继续使用已保存的密钥。' : '不发送 API Key。'}</span>
    </div>
    <div className={styles.formField}>
      <label htmlFor="model-name">模型<button type="button" className={styles.inlineAction} disabled={submitting || unavailable || unknownKey || listing.busy || !draft.baseUrl.trim()} onClick={() => void fetchModels()}>{listing.busy ? '获取中…' : models.length ? '刷新列表' : '获取模型'}</button></label>
      <ModelPicker value={draft.model} models={models} disabled={submitting} onChange={value => changeSetting('model', value)} />
      <span role="status" className={listing.failed ? styles.modelFetchError : undefined}>{listing.text || '从服务获取列表，或直接填写模型名称。'}</span>
    </div>
    <div className={styles.connectionTest}><button type="button" disabled={submitting || unavailable || unknownKey || test.busy || incomplete} onClick={() => void testConnection()}>{test.busy ? '测试中…' : '测试连接'}</button><p role="status" className={test.success ? styles.connectionSuccess : test.text && !test.busy ? styles.connectionError : ''}>{test.text || '使用当前模型发送一次简短请求。'}</p></div>
  </ModalDialog>;
}
