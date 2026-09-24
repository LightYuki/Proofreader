import type { StoredSession } from '../types';
import { filename } from '../features/review/components/presentation';
import { Icon } from './Icon';
import { restoreRemovedFocus } from './menuEvents';
import styles from '../App.module.css';

interface RecentFilesProps {
  sessions: StoredSession[];
  openIds?: string[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onHide?: (id: string) => void | Promise<void>;
}

export function RecentFiles({ sessions, openIds = [], disabled, onOpen, onHide }: RecentFilesProps) {
  return <ul className={styles.recentFiles}>
    {sessions.map(session => <li key={session.id} data-context-recent={session.id} aria-busy={disabled}>
      <button className={styles.recentFile} type="button" disabled={disabled} title={`原文：${session.sourcePath}\n译文：${session.targetPath}`} onClick={() => onOpen(session.id)}>
        <span className={styles.recentFileTitle}>{filename(session.targetPath)}{openIds.includes(session.id) && <span>已打开</span>}</span>
        <span className={styles.recentFilePath}>{session.targetPath}</span>
        <span className={styles.recentFileSource}>原文：{filename(session.sourcePath)}</span>
      </button>
      {onHide && !openIds.includes(session.id) && <button className={styles.iconButton} type="button" disabled={disabled} title="从最近列表隐藏，保留草稿和审阅进度" aria-label={`从最近列表隐藏 ${filename(session.targetPath)}，保留审阅进度`} onClick={async event => {
        const anchor = event.currentTarget;
        const host = anchor.closest('dialog[open]') ?? anchor.closest('[data-menu-root]');
        await onHide(session.id);
        restoreRemovedFocus(anchor, host);
      }}><Icon name="close" /></button>}
    </li>)}
  </ul>;
}
