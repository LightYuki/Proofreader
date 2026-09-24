import { useState } from 'react';
import type { StoredSession } from '../../types';
import { RecentFiles } from '../RecentFiles';
import { ModalDialog } from './ModalDialog';
import styles from '../../App.module.css';

interface RecentFilesDialogProps {
  sessions: StoredSession[];
  openIds: string[];
  error: string | null;
  busy: boolean;
  onOpen: (id: string) => Promise<boolean>;
  onHide: (id: string) => Promise<void>;
  onClose: () => void;
}

export function RecentFilesDialog({ sessions, openIds, error, busy, onOpen, onHide, onClose }: RecentFilesDialogProps) {
  const [opening, setOpening] = useState(false);
  return <ModalDialog title="最近打开" description="选择文件继续校润；隐藏记录仍保留审阅进度。" submitLabel="关闭" hideCancel submitting={opening || busy} error={error} onClose={onClose} onSubmit={onClose}>
    {sessions.length ? <RecentFiles sessions={sessions} openIds={openIds} disabled={opening || busy} onOpen={id => {
      setOpening(true);
      void onOpen(id).then(opened => { if (opened) onClose(); else setOpening(false); });
    }} onHide={onHide} /> : <p className={styles.formNote}>暂无最近打开的文件。可通过“打开…”选择文件，隐藏记录的审阅进度仍可恢复。</p>}
  </ModalDialog>;
}
