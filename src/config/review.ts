import policy from '../../shared/review-policy.json';
import type { Requirements } from '../types';

// One policy is consumed by the window generator, UI and Rust request boundary.
export const REVIEW_POLICY = Object.freeze({
  ...policy,
  windowSize: policy.contextBefore + policy.batchSize + policy.contextAfter,
});

export const DEFAULT_REQUIREMENTS: Requirements = {
  style: '对话自然、简洁，保留人物语气。只修改明显错译、漏译、指代和语法问题；不为换一种表达而改写。',
  background: '',
};

/** Keep user guidance from older records, discarding obsolete language metadata. */
export function readRequirements(value: unknown): Requirements | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  return typeof fields.style === 'string' && typeof fields.background === 'string'
    ? { style: fields.style, background: fields.background }
    : null;
}
export const REQUIREMENTS_STORAGE_KEY = 'proofread.requirements.v1';
export const REVIEW_HISTORY_LIMIT = 50;
