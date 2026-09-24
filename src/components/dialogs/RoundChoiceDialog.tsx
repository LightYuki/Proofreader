import { useEffect, useRef } from 'react';
import type { CheckRound } from '../../types';
import { ModalDialog } from './ModalDialog';
import styles from '../../App.module.css';

interface RoundChoiceDialogProps {
  opener: HTMLElement | null;
  round?: CheckRound;
  intent: 'start' | 'retry';
  canContinue: boolean;
  modelChanged: boolean;
  onChoose: (resolution: 'continue' | 'restart') => void;
  onClose: () => void;
}

export function RoundChoiceDialog({ opener: initialOpener, round, intent, canContinue, modelChanged, onChoose, onClose }: RoundChoiceDialogProps) {
  const opener = useRef(initialOpener);
  useEffect(() => () => { requestAnimationFrame(() => {
    if (document.querySelector('dialog[open]')) return;
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }); }, []);
  return <ModalDialog title="选择检查方式" description={round ? '校润要求或模型连接已改变' : '旧工作记录没有保存检查时的要求'}
    submitLabel="按当前要求重新检查" onSubmit={() => onChoose('restart')} onClose={onClose}
    footerActions={canContinue && <button type="button" onClick={() => onChoose('continue')}>按原要求{intent === 'retry' ? '重试失败批次' : '继续'}</button>}>
    <p className={styles.roundExplanation}>{canContinue
      ? `按原要求${intent === 'retry' ? '重试失败批次' : '继续剩余批次'}会保留已完成的检查；当前编辑的要求仍会保留。重新检查则使用当前要求检查全文。`
      : '无法确定旧批次使用的要求，请按当前要求开始新一轮检查。'}</p>
    {modelChanged && <p className={styles.formNote}>模型连接已改变，两种方式都会使用当前连接，并记录新的结果来源。</p>}
    <p className={styles.formNote}>人工草稿、已采用和保留原译的决定都会保留。未经处理的旧模型建议只在对应批次成功后更新。</p>
    {round && <details className={styles.roundDetails}><summary>查看原要求与模型</summary>
      <p>{round.model} · {round.baseUrl}</p>
      <strong>风格要求</strong><p>{round.requirements.style || '未填写'}</p>
      <strong>背景信息</strong><p>{round.requirements.background || '未填写'}</p>
    </details>}
  </ModalDialog>;
}
