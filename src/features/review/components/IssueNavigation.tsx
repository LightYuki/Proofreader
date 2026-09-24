import { useEffect, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import type { BatchState, LinePair, ReviewItem } from '../../../types';
import { hasUnconfirmedDraft, needsReview } from '../../../core/review';
import { lineNumber, reviewStatusLabels } from './presentation';
import styles from '../../../App.module.css';

export type IssueFilter = 'all' | 'pending';

interface IssueNavigationProps {
  entries: LinePair[];
  reviews: ReviewItem[];
  batches: BatchState[];
  selectedIndex: number;
  filter: IssueFilter;
  onFilter: (filter: IssueFilter) => void;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function IssueNavigation({ entries, reviews, batches, selectedIndex, filter, onFilter, onSelect, onClose }: IssueNavigationProps) {
  const pendingCount = reviews.filter(needsReview).length;
  const visible = reviews.filter(item => filter === 'all' || needsReview(item));
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex, filter]);
  const failed = batches.filter(batch => batch.status === 'failed').length;
  const running = batches.some(batch => batch.status === 'running');
  const unfinished = batches.some(batch => batch.status === 'pending');
  const emptyText = !entries.length ? '文件为空' : running ? '检查中，暂时没有待审条目'
    : failed ? `当前没有${filter === 'pending' ? '待审条目' : '建议'}；${failed} 批检查失败，请重试`
    : unfinished ? '检查尚未完成，可继续检查'
    : !batches.length ? '尚未开始检查'
    : filter === 'pending' && reviews.length ? '现有条目已审阅完毕' : '检查完成，未发现需要修改的问题';

  return <aside className={styles.issueNavigation} id="issue-navigation" aria-label="问题列表">
    <div className={styles.panelHeading}><strong>问题</strong><button className={styles.iconButton} onClick={onClose} aria-label="收起问题列表"><Icon name="close" /></button></div>
    <div className={styles.issueFilters}><button className={filter === 'pending' ? styles.selectedFilter : ''} aria-pressed={filter === 'pending'} onClick={() => onFilter('pending')}>待审 {pendingCount}</button><button className={filter === 'all' ? styles.selectedFilter : ''} aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>全部 {reviews.length}</button></div>
    <div ref={list} className={styles.issueList}>{visible.length ? visible.map(review => <button key={review.index} className={`${styles.issueItem} ${review.index === selectedIndex ? styles.selectedIssue : ''}`} aria-current={review.index === selectedIndex ? 'true' : undefined} onClick={() => onSelect(review.index)}><div><span className={styles.issueLine}>#{lineNumber(review.index)}</span><span className={styles.miniState}>{hasUnconfirmedDraft(review) ? '草稿待确认' : reviewStatusLabels[review.status]}</span></div><p>{entries[review.index]?.source}</p><span className={styles.issueReason}>{review.reason}</span></button>) : <p className={styles.smallEmpty}>{emptyText}</p>}</div>
  </aside>;
}
