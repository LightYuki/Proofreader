import { useEffect, useRef, useState } from 'react';
import { ModalDialog, messageOf } from './ModalDialog';
import styles from '../../App.module.css';

interface ImportDialogProps {
  error: string | null;
  onChooseFile: (title: string) => Promise<string | null>;
  onOpen: (sourcePath: string, targetPath: string) => Promise<boolean>;
  onClose: () => void;
  onOpened: () => void;
}

export function ImportDialog({ error, onChooseFile, onOpen, onClose, onOpened }: ImportDialogProps) {
  const [sourcePath, setSourcePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function chooseFile(which: 'source' | 'target') {
    setLocalError('');
    try {
      const result = await onChooseFile(which === 'source' ? '选择原文' : '选择译文');
      if (mounted.current && result) (which === 'source' ? setSourcePath : setTargetPath)(result);
    } catch (failure) {
      if (mounted.current) setLocalError(messageOf(failure));
    }
  }

  async function openFiles() {
    setSubmitting(true);
    setLocalError('');
    try {
      const opened = await onOpen(sourcePath, targetPath);
      if (mounted.current && opened) onOpened();
    } catch (failure) {
      if (mounted.current) setLocalError(messageOf(failure));
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return <ModalDialog title="打开文件" description="选择原文及对应译文。" submitting={submitting} submitDisabled={!sourcePath || !targetPath} submitLabel="打开" error={localError || error} onClose={onClose} onSubmit={() => void openFiles()}>
    <div className={styles.fileField}><label htmlFor="source-path">原文</label><div><input id="source-path" value={sourcePath} placeholder="选择原文 JSON" readOnly title={sourcePath} /><button type="button" autoFocus disabled={submitting} onClick={() => void chooseFile('source')}>浏览…</button></div></div>
    <div className={styles.fileField}><label htmlFor="target-path">译文</label><div><input id="target-path" value={targetPath} placeholder="选择译文 JSON" readOnly title={targetPath} /><button type="button" disabled={submitting} onClick={() => void chooseFile('target')}>浏览…</button></div></div>
  </ModalDialog>;
}
