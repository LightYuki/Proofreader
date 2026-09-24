import type { AcceptedChange, BatchWindow, LinePair, ReviewItem, Suggestion } from '../types';
import { REVIEW_POLICY } from '../config/review';

/** All intervals are zero-based and end-exclusive. Context never crosses files. */
export function buildWindows(count: number): BatchWindow[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('条目数量必须是非负整数。');
  }

  const windows: BatchWindow[] = [];
  for (let coreStart = 0; coreStart < count; coreStart += REVIEW_POLICY.batchSize) {
    const coreEnd = Math.min(coreStart + REVIEW_POLICY.batchSize, count);
    windows.push({
      id: windows.length,
      coreStart,
      coreEnd,
      contextStart: Math.max(0, coreStart - REVIEW_POLICY.contextBefore),
      contextEnd: Math.min(count, coreEnd + REVIEW_POLICY.contextAfter),
    });
  }
  return windows;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inCore(index: number, window: BatchWindow): boolean {
  return index >= window.coreStart && index < window.coreEnd;
}

/** A malformed response is a failed batch, never a successful empty result. */
export function parseSuggestions(
  content: string,
  window: BatchWindow,
  entries: LinePair[],
): Suggestion[] {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  let payload: unknown;
  try {
    payload = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new Error('模型返回内容不是有效 JSON，请重试本批次。');
  }
  if (!isObject(payload) || !Array.isArray(payload.issues)) {
    throw new Error('模型返回结构无效：需要包含 issues 数组的对象。');
  }

  const suggestions = new Map<number, Suggestion>();
  for (const value of payload.issues) {
    if (
      !isObject(value) ||
      typeof value.index !== 'number' ||
      !Number.isSafeInteger(value.index) ||
      value.index < 0 ||
      value.index >= entries.length ||
      typeof value.proposed !== 'string' ||
      typeof value.reason !== 'string' ||
      value.reason.trim().length === 0 ||
      (value.evidence !== undefined && typeof value.evidence !== 'string')
    ) {
      throw new Error('模型建议格式无效：请检查条目索引、建议译文和修改理由。');
    }

    const suggestion: Suggestion = {
      index: value.index,
      proposed: value.proposed,
      reason: value.reason,
      ...(typeof value.evidence === 'string' ? { evidence: value.evidence } : {}),
    };
    const previous = suggestions.get(suggestion.index);
    if (
      previous &&
      (previous.proposed !== suggestion.proposed ||
        previous.reason !== suggestion.reason ||
        previous.evidence !== suggestion.evidence)
    ) {
      throw new Error(`模型为第 ${suggestion.index + 1} 条返回了互相冲突的建议，请重试本批次。`);
    }
    suggestions.set(suggestion.index, suggestion);
  }

  return [...suggestions.values()]
    .filter((item) => inCore(item.index, window) && item.proposed !== entries[item.index].translation)
    .sort((left, right) => left.index - right.index);
}

/** Retrying a batch may replace untouched suggestions, but never a user's work. */
export function mergeSuggestions(
  current: Record<number, ReviewItem>,
  suggestions: Suggestion[],
  window: BatchWindow,
): Record<number, ReviewItem> {
  const next = { ...current };
  for (const item of Object.values(current)) {
    if (inCore(item.index, window) && item.status === 'pending' && !item.manualEdited && item.draft === item.proposed) {
      delete next[item.index];
    }
  }
  for (const suggestion of suggestions) {
    if (inCore(suggestion.index, window) && !next[suggestion.index]) {
      next[suggestion.index] = { ...suggestion, draft: suggestion.proposed, status: 'pending' };
    }
  }
  return next;
}

export function hasUnconfirmedDraft(review: ReviewItem): boolean {
  return review.status === 'accepted' && review.draft !== (review.acceptedText ?? review.draft);
}

export function needsReview(review: ReviewItem): boolean {
  return review.status === 'pending' || hasUnconfirmedDraft(review);
}

export function acceptedChanges(reviews: Record<number, ReviewItem>): AcceptedChange[] {
  return Object.values(reviews)
    .filter((item) => item.status === 'accepted')
    .sort((left, right) => left.index - right.index)
    .map((item) => ({ index: item.index, message: item.acceptedText ?? item.draft }));
}

export interface ReviewUndoEntry {
  index: number;
  previous?: ReviewItem;
  draftAfterDecision?: string;
}

/** Undo the decision without undoing subsequent typing or other rows' results. */
export function undoReviewDecision(
  current: Record<number, ReviewItem>,
  action: ReviewUndoEntry,
): Record<number, ReviewItem> {
  const next = { ...current };
  if (action.previous) {
    next[action.index] = action.draftAfterDecision === undefined
      ? action.previous
      : { ...action.previous, draft: action.draftAfterDecision,
        ...(current[action.index]?.manualEdited === undefined ? {} : { manualEdited: true }),
        status: action.previous.status === 'ignored' ? 'pending' : action.previous.status };
  } else if (action.draftAfterDecision !== undefined && current[action.index]) {
    next[action.index] = {
      ...current[action.index],
      draft: action.draftAfterDecision,
      status: 'pending',
      acceptedText: undefined,
    };
  } else {
    delete next[action.index];
  }
  return next;
}
