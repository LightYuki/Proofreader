import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { visibleTranslation, type ReaderTarget, type SearchField, type TextMatch } from '../search';
import { Icon } from '../../../components/Icon';
import { hasUnconfirmedDraft, needsReview } from '../../../core/review';
import type { BatchState, LinePair, ReviewItem } from '../../../types';
import { batchStatusLabels, lineNumber, reviewStatusLabels } from './presentation';
import styles from '../../../App.module.css';

interface BilingualReaderProps {
  documentId: string;
  entries: LinePair[];
  reviews: Record<number, ReviewItem>;
  batches: BatchState[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  navigation?: ReactNode;
  matches?: TextMatch[];
  activeMatchId?: string;
  target?: ReaderTarget;
}

export function BilingualReader({ documentId, entries, reviews, batches, selectedIndex, onSelect, navigation, matches, activeMatchId, target }: BilingualReaderProps) {
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const registerRow = useCallback((index: number, node: HTMLElement | null) => {
    if (node) rowRefs.current.set(index, node);
    else rowRefs.current.delete(index);
  }, []);
  const batchLabels = useMemo(() => {
    const labels: string[] = [];
    for (const batch of batches) {
      for (let index = batch.coreStart; index < batch.coreEnd; index += 1) labels[index] = batchStatusLabels[batch.status];
    }
    return labels;
  }, [batches]);

  useEffect(() => { rowRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex, documentId]);
  useEffect(() => {
    if (!target) return;
    const row = rowRefs.current.get(target.index);
    const match = target.matchId ? row?.querySelector<HTMLElement>(`[data-search-hit="${target.matchId}"]`) : null;
    (match ?? row)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [target, documentId]);
  const rowMatches = useMemo(() => {
    const map = new Map<number, TextMatch[]>();
    for (const match of matches ?? []) { const group = map.get(match.index) ?? []; group.push(match); map.set(match.index, group); }
    return map;
  }, [matches]);

  return <section className={styles.reader} aria-label="双语正文">
    {navigation}
    <div className={styles.readerHeading}><span>正文<span className={styles.readerCount}>{entries.length} 条</span></span></div>
    <div className={styles.columnHeading}><span>#</span><span>原文</span><span>译文</span></div>
    <div className={styles.rows}>
      {!entries.length && <div className={styles.readerEmpty}><h2>文件为空</h2><p>原文和译文均为空数组。</p></div>}
      {entries.map(line => <DialogueRow key={line.index} line={line} review={reviews[line.index]} batchLabel={batchLabels[line.index]} selected={selectedIndex === line.index} onSelect={onSelect} registerRow={registerRow} matches={rowMatches.get(line.index)} activeMatchId={activeMatchId} />)}
    </div>
  </section>;
}

interface DialogueRowProps {
  line: LinePair;
  review?: ReviewItem;
  batchLabel?: string;
  selected: boolean;
  onSelect: (index: number) => void;
  registerRow: (index: number, node: HTMLElement | null) => void;
  matches?: TextMatch[];
  activeMatchId?: string;
}

const DialogueRow = memo(function DialogueRow({ line, review, batchLabel, selected, onSelect, registerRow, matches, activeMatchId }: DialogueRowProps) {
  const draftChanged = review ? hasUnconfirmedDraft(review) : false;
  const stateLabel = review ? draftChanged ? '待确认' : reviewStatusLabels[review.status] : batchLabel;
  const visibleState = review || batchLabel !== batchStatusLabels.complete ? stateLabel : '';
  const currentTranslation = visibleTranslation(line, review);
  function highlight(text: string, field: SearchField) {
    const pieces: ReactNode[] = []; let end = 0;
    for (const match of matches ?? []) {
      if (match.field !== field) continue;
      pieces.push(text.slice(end, match.start), <mark key={match.id} data-search-hit={match.id} className={match.id === activeMatchId ? styles.activeMatch : styles.searchMatch}>{text.slice(match.start, match.end)}</mark>);
      end = match.end;
    }
    return pieces.length ? [...pieces, text.slice(end)] : text;
  }
  const attach = useCallback((node: HTMLElement | null) => registerRow(line.index, node), [line.index, registerRow]);

  return <article ref={attach} data-context-row={line.index} className={`${styles.row} ${selected ? styles.selectedRow : ''}`} aria-label={`第 ${line.index + 1} 条${stateLabel ? `，${stateLabel}` : ''}`} onClick={() => onSelect(line.index)}>
    <div className={styles.lineNumber}><button aria-label={`选择第 ${line.index + 1} 条`} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(line.index)}>{lineNumber(line.index)}</button>{visibleState && <span className={`${styles.lineState} ${review && needsReview(review) ? styles.pending : review?.status === 'accepted' ? styles.accepted : ''}`} title={stateLabel}>{review?.status === 'accepted' && !draftChanged ? <Icon name="check" /> : visibleState}</span>}</div>
    <div className={styles.sourceText}><div className={styles.speaker}>{highlight(line.sourceName || '旁白', 'sourceName')}</div><p lang="">{line.source ? highlight(line.source, 'source') : <span className={styles.blankText}>空文本</span>}</p></div>
    <div className={styles.targetText}><div className={styles.speaker}>{highlight(line.targetName || '旁白', 'targetName')}</div><p lang="">{currentTranslation ? highlight(currentTranslation, 'translation') : <span className={styles.blankText}>空文本</span>}</p></div>
  </article>;
});
