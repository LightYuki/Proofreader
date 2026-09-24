import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../Icon';
import styles from '../../App.module.css';

interface ModalDialogProps {
  title: string;
  description?: string;
  wide?: boolean;
  submitting?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  hideCancel?: boolean;
  error?: string | null;
  footerActions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}

export function ModalDialog({ title, description, wide, submitting, submitDisabled, submitLabel = '保存', hideCancel, error, footerActions, children, onClose, onSubmit }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('input:not([readonly]):not(:disabled), textarea:not(:disabled)')?.focus();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} className={`${styles.dialog} ${wide ? styles.requirementsDialog : ''}`} aria-labelledby="modal-title" onCancel={(event) => {
    event.preventDefault();
    if (!submitting) onClose();
  }}>
    <div className={styles.modalHeader}>
      <div><h1 id="modal-title">{title}</h1>{description && <p>{description}</p>}</div>
      <button type="button" className={styles.iconButton} aria-label="关闭" disabled={submitting} onClick={onClose}><Icon name="close" /></button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); if (!submitting && !submitDisabled) onSubmit(); }}>
      <div className={styles.modalBody}>{children}{error && <p className={styles.formError} role="alert">{error}</p>}</div>
      <div className={styles.modalFooter}>
        {!hideCancel && <button type="button" disabled={submitting} onClick={onClose}>取消</button>}
        {footerActions}
        <button type="submit" className={styles.primary} disabled={submitting || submitDisabled}>{submitting ? '处理中…' : submitLabel}</button>
      </div>
    </form>
  </dialog>;
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
