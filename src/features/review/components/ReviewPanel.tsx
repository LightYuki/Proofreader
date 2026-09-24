import { diffWordsWithSpace } from 'diff';
import { Icon } from '../../../components/Icon';
import type { BatchState, LinePair, ReviewItem } from '../../../types';
import { hasUnconfirmedDraft } from '../../../core/review';
import { lineNumber } from './presentation';
import { ReviewStatus } from './ReviewStatus';
import styles from '../../../App.module.css';

interface ReviewPanelProps {
  line?: LinePair;
  review?: ReviewItem;
  batchStatus?: BatchState['status'];
  batchError?: string;
  roundId?: string;
  canAccept: boolean;
  onDraftChange: (text: string) => void;
  onAccept: () => void;
  onIgnore: () => void;
  onReset: () => void;
}

export function ReviewPanel({ line, review, batchStatus, batchError, roundId, canAccept, onDraftChange, onAccept, onIgnore, onReset }: ReviewPanelProps) {
  const draft = review?.draft ?? line?.translation ?? '';
  const acceptedDraftChanged = review ? hasUnconfirmedDraft(review) : false;
  const oldSuggestion = review && roundId && review.roundId !== roundId && review.reason !== '手动编辑';

  return <aside className={styles.reviewPanel} aria-label="审阅">
    <div className={styles.panelHeading}>
      <strong>审阅</strong>
      {line && <div className={styles.reviewHeadingState}>
        <span className={styles.miniState}>#{lineNumber(line.index)}</span>
        <ReviewStatus key={line.index} review={review} batchStatus={batchStatus} />
      </div>}
    </div>
    {line ? <>
      <div className={styles.reviewContent}>
        <section className={styles.reviewSection}><h2>原译文</h2><p className={styles.originalTranslation} data-context-copy="original" tabIndex={0}>{line.translation || '（空文本）'}</p></section>
        {draft !== line.translation && <section className={styles.reviewSection}><h2>修改对照<span className={styles.diffLegend}><del>删除</del> <ins>新增</ins></span></h2><p className={styles.diff} data-context-copy="diff" tabIndex={0}>{diffWordsWithSpace(line.translation, draft).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</p></section>}
        <section className={styles.reviewSection}>
          <label htmlFor="translation-draft">{review ? '修改译文' : '手动修改'}</label>
          <textarea id="translation-draft" className={styles.draftEditor} value={draft} spellCheck={false} onChange={event => onDraftChange(event.target.value)} placeholder="输入译文…" />
          {acceptedDraftChanged && <p className={styles.draftHint}>草稿有新修改，点击“更新修改”后生效。</p>}
        </section>
        {review ? <>
          <section className={styles.reviewSection}><h2>修改理由</h2>{oldSuggestion && <p className={styles.draftHint}>{review.roundId ? '此建议来自较早轮次，人工修改和决定已保留。' : '此建议来自旧记录，未记录当时的检查要求。'}</p>}<p className={styles.reason} data-context-copy="reason" tabIndex={0}>{review.reason}</p></section>
          {review.evidence && <section className={styles.reviewSection}><h2>上下文依据</h2><blockquote className={styles.evidence} data-context-copy="evidence" tabIndex={0}>{review.evidence}</blockquote></section>}
        </> : <p className={styles.noSuggestion}>{batchStatus === 'complete' ? '本批检查完成，未发现本条需要修改的问题。' : batchStatus === 'running' ? '本批正在检查…' : batchStatus === 'failed' ? '本批检查失败，不能据此判断是否需要修改。' : batchStatus === 'pending' ? '本条尚未完成检查，可继续检查。' : '尚未开始检查，也可以直接手动修改。'}</p>}
        {batchStatus === 'failed' && <details className={styles.batchFailure}><summary>本批检查失败 · 查看原因</summary><p>{batchError || '未返回错误详情，请重试失败批次。'}</p></details>}
      </div>
      <div className={styles.reviewActions}>
        <button className={styles.primary} disabled={!canAccept} onClick={onAccept} title="Ctrl+Enter"><Icon name="check" />{review?.status === 'accepted' ? acceptedDraftChanged ? '更新修改' : '已采用' : '采用'}</button>
        <button disabled={!review || review.status === 'ignored'} onClick={onIgnore}>{review?.status === 'ignored' ? '已保留原译' : '保留原译'}</button>
        <div className={styles.reviewRecovery}>{review && review.status !== 'pending' && <button className={styles.textButton} onClick={onReset}>恢复待审</button>}</div>
      </div>
    </> : <p className={styles.smallEmpty}>选择一条台词</p>}
  </aside>;
}
