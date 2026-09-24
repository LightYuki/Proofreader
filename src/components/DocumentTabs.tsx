import { useEffect, useRef } from 'react';
import type { StoredSession } from '../types';
import { acceptedChanges } from '../core/review';
import { filename } from '../features/review/components/presentation';
import { Icon } from './Icon';
import styles from '../App.module.css';

interface DocumentTabsProps {
  sessions: StoredSession[];
  activeId: string | null;
  activeDirty: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function DocumentTabs({ sessions, activeId, activeDirty, disabled, onSelect, onClose }: DocumentTabsProps) {
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => { tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId]);
  const normalized = (path: string) => path.replaceAll('\\', '/').toLowerCase();
  const suffix = (path: string, others: string[]) => {
    const parts = path.replaceAll('\\', '/').split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const candidate = parts.slice(-depth).join('/');
      if (others.every(other => normalized(other).split('/').slice(-depth).join('/') !== candidate.toLowerCase())) return candidate;
    }
    return path;
  };
  if (!sessions.length) return null;
  return <div ref={tabs} className={styles.documentTabs} role="tablist" aria-label="打开的文件">
    {sessions.map((session, index) => {
      const active = session.id === activeId;
      const dirty = active ? activeDirty : JSON.stringify(acceptedChanges(session.reviews)) !== session.savedFingerprint;
      const peers = sessions.filter(other => other.id !== session.id && filename(other.targetPath).toLowerCase() === filename(session.targetPath).toLowerCase());
      const sameTarget = peers.filter(other => normalized(other.targetPath) === normalized(session.targetPath));
      const parent = (path: string) => path.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
      const distinction = sameTarget.length ? `原文 ${suffix(session.sourcePath, sameTarget.map(other => other.sourcePath))}`
        : peers.length ? suffix(parent(session.targetPath), peers.map(other => parent(other.targetPath))) : '';
      return <div className={`${styles.documentTab} ${active ? styles.currentDocumentTab : ''}`} key={session.id} data-context-tab={session.id}>
        <button type="button" role="tab" id={`document-tab-${session.id}`} aria-selected={active} tabIndex={active || !activeId ? 0 : -1} disabled={disabled} title={`原文：${session.sourcePath}\n译文：${session.targetPath}`} onClick={() => onSelect(session.id)} onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = sessions[(index + (event.key === 'ArrowRight' ? 1 : -1) + sessions.length) % sessions.length];
          onSelect(next.id);
          requestAnimationFrame(() => document.getElementById(`document-tab-${next.id}`)?.focus());
        }}><span className={styles.documentTabLabel}><span>{filename(session.targetPath)}</span>{distinction && <span className={styles.tabDisambiguation}>{distinction}</span>}</span>{dirty && <span className={styles.unsavedDot} aria-label="有未保存到 JSON 的修改" />}</button>
        <button type="button" className={styles.tabClose} disabled={disabled} aria-label={`关闭 ${filename(session.targetPath)}`} title="关闭标签，保留工作记录" onClick={() => onClose(session.id)}><Icon name="close" /></button>
      </div>;
    })}
  </div>;
}
