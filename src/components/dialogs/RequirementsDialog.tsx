import { useState } from 'react';
import type { Requirements } from '../../types';
import { ModalDialog } from './ModalDialog';
import styles from '../../App.module.css';

interface RequirementsDialogProps {
  requirements: Requirements;
  onSave: (requirements: Requirements) => void;
  onClose: () => void;
}

export function RequirementsDialog({ requirements, onSave, onClose }: RequirementsDialogProps) {
  const [draft, setDraft] = useState({ ...requirements });
  const [tab, setTab] = useState<'style' | 'background'>('style');

  return <ModalDialog title="校润要求" wide onClose={onClose} onSubmit={() => { onSave(draft); onClose(); }}>
    <div className={styles.tabs} role="tablist" aria-label="校润要求" onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = tab === 'style' ? 'background' : 'style';
        setTab(next);
        document.getElementById(`${next}-tab`)?.focus();
      }
    }}>
      <button type="button" role="tab" id="style-tab" tabIndex={tab === 'style' ? 0 : -1} aria-controls="style-panel" aria-selected={tab === 'style'} className={tab === 'style' ? styles.activeTab : ''} onClick={() => setTab('style')}>风格要求</button>
      <button type="button" role="tab" id="background-tab" tabIndex={tab === 'background' ? 0 : -1} aria-controls="background-panel" aria-selected={tab === 'background'} className={tab === 'background' ? styles.activeTab : ''} onClick={() => setTab('background')}>剧情背景</button>
    </div>
    <div role="tabpanel" id="style-panel" aria-labelledby="style-tab" hidden={tab !== 'style'}><p className={styles.tabDescription}>填写语言方向、语气、称谓和术语要求。</p><textarea autoFocus aria-label="风格要求" className={styles.requirementsEditor} value={draft.style} onChange={(event) => setDraft({ ...draft, style: event.target.value })} placeholder="例如：原文为日语，译文为英语；保留人物口吻。" /></div>
    <div role="tabpanel" id="background-panel" aria-labelledby="background-tab" hidden={tab !== 'background'}><p className={styles.tabDescription}>选填人物关系、场景和当前情节，帮助判断指代与语境。</p><textarea aria-label="剧情背景" className={styles.requirementsEditor} value={draft.background} onChange={(event) => setDraft({ ...draft, background: event.target.value })} /></div>
    <p className={styles.formNote}>继续检查时可选择沿用原要求，或按新要求重新检查。人工成果保留。</p>
  </ModalDialog>;
}
