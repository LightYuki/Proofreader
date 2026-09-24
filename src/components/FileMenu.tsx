import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { PopupMenu } from './PopupMenu';
import styles from '../App.module.css';

interface FileMenuProps {
  canOpen: boolean;
  canSave: boolean;
  canClose: boolean;
  onRecent: (opener: HTMLButtonElement | null) => void;
  onCloseFile: () => void;
  onOpen: (opener: HTMLButtonElement | null) => void;
  onSave: (saveAs?: boolean) => void;
}

export function FileMenu({ canOpen, canSave, canClose, onOpen, onSave, onRecent, onCloseFile }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!canOpen && !canSave && !canClose) setOpen(false); }, [canOpen, canSave, canClose]);

  return <div className={styles.menuAnchor}>
    <button ref={buttonRef} className={styles.menuButton} aria-haspopup="menu" aria-expanded={open} aria-controls="file-menu"
      onClick={() => { setFocusLast(false); setOpen(!open); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setFocusLast(event.key === 'ArrowUp'); setOpen(true);
        }
      }}>文件<span className={styles.chevron} aria-hidden="true">⌄</span></button>
    {open && buttonRef.current && <PopupMenu id="file-menu" label="文件" anchor={buttonRef.current} focusLast={focusLast} onClose={() => setOpen(false)} items={[
      { id: 'open', label: '打开…', shortcut: 'Ctrl+O', icon: <Icon name="open" />, disabled: !canOpen, onSelect: () => onOpen(buttonRef.current) },
      { id: 'recent', label: '最近打开…', disabled: !canOpen, onSelect: () => onRecent(buttonRef.current) },
      { id: 'save', label: '保存', shortcut: 'Ctrl+S', icon: <Icon name="save" />, separatorBefore: true, disabled: !canSave, onSelect: () => onSave() },
      { id: 'save-as', label: '另存为…', disabled: !canSave, onSelect: () => onSave(true) },
      { id: 'close', label: '关闭当前文件', shortcut: 'Ctrl+W', separatorBefore: true, disabled: !canClose, onSelect: onCloseFile },
    ]} />}
  </div>;
}
