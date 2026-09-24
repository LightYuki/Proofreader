import { describe, expect, it } from 'vitest';
import type { LinePair, ReviewItem, Suggestion } from '../types';
import { acceptedChanges, buildWindows, mergeSuggestions, needsReview, parseSuggestions, undoReviewDecision } from './review';

const entries: LinePair[] = Array.from({ length: 100 }, (_, index) => ({
  index,
  source: `源文 ${index}`,
  translation: `Translation ${index}`,
}));
const middleWindow = buildWindows(100)[1];
const issue = (index: number, proposed = `Corrected ${index}`): Suggestion => ({
  index,
  proposed,
  reason: '否定关系与源文不符。',
});
const review = (index: number, overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  ...issue(index),
  draft: `Corrected ${index}`,
  status: 'pending',
  ...overrides,
});
const response = (issues: unknown[]) => JSON.stringify({ issues });

describe('buildWindows', () => {
  it.each([0, 1, 29, 30, 31, 60, 61, 100])('covers every line once for %i entries', (count) => {
    const windows = buildWindows(count);
    expect(windows).toHaveLength(Math.ceil(count / 30));
    const covered: number[] = [];
    windows.forEach((window, batch) => {
      expect(window.id).toBe(batch);
      expect(window.coreStart).toBe(batch * 30);
      expect(window.coreEnd).toBe(Math.min(batch * 30 + 30, count));
      expect(window.contextStart).toBe(Math.max(window.coreStart - 15, 0));
      expect(window.contextEnd).toBe(Math.min(window.coreEnd + 15, count));
      expect(window.contextEnd - window.contextStart).toBeLessThanOrEqual(60);
      expect(window.contextStart).toBeGreaterThanOrEqual(0);
      expect(window.contextEnd).toBeLessThanOrEqual(count);
      for (let index = window.coreStart; index < window.coreEnd; index += 1) covered.push(index);
    });
    expect(covered).toEqual(Array.from({ length: count }, (_, index) => index));
  });

  it('truncates the final one-line batch without borrowing from its core', () => {
    expect(buildWindows(61)[2]).toEqual({
      id: 2, coreStart: 60, coreEnd: 61, contextStart: 45, contextEnd: 61,
    });
  });

  it.each([-1, 0.5, NaN, Infinity])('rejects invalid counts (%s)', (count) => {
    expect(() => buildWindows(count)).toThrow();
  });
});

describe('parseSuggestions', () => {
  it('maps out-of-order results by original index and keeps optional evidence', () => {
    const expected = [issue(30), { ...issue(59), evidence: '第 58 条明确人物指代。' }];
    expect(parseSuggestions(response([...expected].reverse()), middleWindow, entries)).toEqual(expected);
  });

  it('accepts fenced JSON and a genuine empty result', () => {
    expect(parseSuggestions('```json\n{"issues": []}\n```', middleWindow, entries)).toEqual([]);
    expect(parseSuggestions('{"issues": []}', middleWindow, entries)).toEqual([]);
  });

  it('ignores valid context and non-core suggestions including the end-exclusive boundary', () => {
    const issues = [issue(15), issue(29), issue(30), issue(59), issue(60), issue(74), issue(99)];
    expect(parseSuggestions(response(issues), middleWindow, entries)).toEqual([issue(30), issue(59)]);
  });

  it('deduplicates identical entries and ignores proposals equal to the imported translation', () => {
    const issues = [issue(31), issue(31), issue(32, entries[32].translation)];
    expect(parseSuggestions(response(issues), middleWindow, entries)).toEqual([issue(31)]);
  });

  it.each([
    '', 'No issues found.', '[]', '{}', 'null', '{"issues": null}', '{"issues": {}}',
    'Some prose\n{"issues": []}',
    response([null]),
    response([{ ...issue(30), index: '30' }]),
    response([{ ...issue(30), index: 30.5 }]),
    response([issue(-1)]),
    response([issue(100)]),
    response([{ index: 30, proposed: 'Fixed' }]),
    response([{ ...issue(30), proposed: null }]),
    response([{ ...issue(30), reason: '  ' }]),
    response([{ ...issue(30), evidence: [29] }]),
    response([issue(30), issue(30, 'Conflicting correction')]),
    response([issue(30), { ...issue(30), reason: 'Different interpretation' }]),
  ])('fails malformed output rather than reporting success: %s', (content) => {
    expect(() => parseSuggestions(content, middleWindow, entries)).toThrow();
  });

  it('fails malformed suggestions even when they target context', () => {
    expect(() => parseSuggestions(response([{ index: 29 }]), middleWindow, entries)).toThrow();
  });
});

describe('mergeSuggestions', () => {
  it('replaces untouched pending results, removes stale ones, and preserves other batches', () => {
    const current = { 2: review(2), 30: review(30), 31: review(31) };
    const suggestions = [issue(30, 'New correction'), issue(40)];
    const next = mergeSuggestions(current, suggestions, middleWindow);
    expect(next[2]).toBe(current[2]);
    expect(next[30].draft).toBe('New correction');
    expect(next[31]).toBeUndefined();
    expect(next[40]).toEqual(review(40));
    expect(current[30].draft).toBe('Corrected 30');
  });

  it('preserves accepted, ignored, and manually edited pending items across retries', () => {
    const current = {
      30: review(30, { status: 'accepted', draft: 'Later draft', acceptedText: 'Approved manually' }),
      31: review(31, { status: 'ignored' }),
      32: review(32, { draft: 'Unfinished manual draft' }),
      33: review(33),
    };
    const suggestions = [30, 31, 32, 33].map((index) => issue(index, 'New model proposal'));
    const next = mergeSuggestions(current, suggestions, middleWindow);
    expect(next[30]).toBe(current[30]);
    expect(next[31]).toBe(current[31]);
    expect(next[32]).toBe(current[32]);
    expect(next[33].draft).toBe('New model proposal');
    const emptyRetry = mergeSuggestions(next, [], middleWindow);
    expect(Object.keys(emptyRetry)).toEqual(['30', '31', '32']);
  });

  it('is stable on repeated results and does not apply suggestions outside the batch', () => {
    const suggestions = [issue(29), issue(30), issue(60)];
    const first = mergeSuggestions({}, suggestions, middleWindow);
    expect(Object.keys(first)).toEqual(['30']);
    expect(mergeSuggestions(first, suggestions, middleWindow)).toEqual(first);
  });
});

describe('review queue', () => {
  it('returns a changed accepted draft to the queue while preserving the confirmed output', () => {
    const items = [
      review(1, { status: 'accepted', acceptedText: 'Confirmed text', draft: 'New draft' }),
      review(2, { status: 'ignored' }),
      review(3),
      review(4, { status: 'accepted', acceptedText: 'Done', draft: 'Done' }),
    ];
    expect(items.filter(needsReview).map(item => item.index)).toEqual([1, 3]);
    expect(acceptedChanges({ 1: items[0] })).toEqual([{ index: 1, message: 'Confirmed text' }]);

    const confirmed = { ...items[0], acceptedText: items[0].draft };
    expect(needsReview(confirmed)).toBe(false);
    expect(acceptedChanges({ 1: confirmed })).toEqual([{ index: 1, message: 'New draft' }]);
  });

  it('treats an intentionally emptied draft as pending and clears it when reverted', () => {
    const edited = review(1, { status: 'accepted', acceptedText: 'Confirmed text', draft: '' });
    expect(needsReview(edited)).toBe(true);
    expect(needsReview({ ...edited, draft: edited.acceptedText! })).toBe(false);
  });
});

describe('acceptedChanges', () => {
  it('exports only accepted drafts in original document order', () => {
    const reviews = {
      61: review(61, { status: 'accepted', draft: '保留换行\n{name} and \\c[2]' }),
      30: review(30, { status: 'pending', draft: 'Unconfirmed edit' }),
      8: review(8, { status: 'ignored' }),
      3: review(3, { status: 'accepted', draft: 'Final text' }),
    };
    expect(acceptedChanges(reviews)).toEqual([
      { index: 3, message: 'Final text' },
      { index: 61, message: '保留换行\n{name} and \\c[2]' },
    ]);
    expect(acceptedChanges({})).toEqual([]);
  });

  it('keeps later unconfirmed edits out of the saved accepted result', () => {
    expect(acceptedChanges({
      1: review(1, { status: 'accepted', acceptedText: 'Confirmed correction', draft: 'Later edit' }),
    })).toEqual([{ index: 1, message: 'Confirmed correction' }]);
  });
});

describe('undoReviewDecision', () => {
  it('undoes acceptance while retaining a draft typed after the decision', () => {
    const previous = review(1);
    const current = {
      1: review(1, { status: 'accepted', acceptedText: previous.draft, draft: 'New manual draft' }),
      40: review(40),
    };
    const restored = undoReviewDecision(current, { index: 1, previous, draftAfterDecision: 'New manual draft' });
    expect(restored[1]).toEqual({ ...previous, draft: 'New manual draft' });
    expect(acceptedChanges(restored)).toEqual([]);
    expect(restored[40]).toBe(current[40]);
    expect(current[1].status).toBe('accepted');
  });

  it('restores a prior accepted decision without exporting later unconfirmed edits', () => {
    const previous = review(1, { status: 'accepted', acceptedText: 'Confirmed text', draft: 'Confirmed text' });
    const current = { 1: review(1, { status: 'ignored', draft: 'Later draft' }) };
    const restored = undoReviewDecision(current, { index: 1, previous, draftAfterDecision: 'Later draft' });
    expect(restored[1].draft).toBe('Later draft');
    expect(restored[1].status).toBe('accepted');
    expect(acceptedChanges(restored)).toEqual([{ index: 1, message: 'Confirmed text' }]);
  });

  it('retains an intentionally emptied draft', () => {
    const previous = review(1);
    const restored = undoReviewDecision({ 1: review(1, { status: 'ignored', draft: '' }) }, {
      index: 1, previous, draftAfterDecision: '',
    });
    expect(restored[1].draft).toBe('');
    expect(restored[1].status).toBe('pending');
  });

  it('restores the exact prior item when only a newer model result arrived', () => {
    const previous = review(1, { status: 'ignored' });
    const current = { 1: review(1, { proposed: 'New proposal', draft: 'New proposal' }) };
    expect(undoReviewDecision(current, { index: 1, previous })[1]).toBe(previous);
  });

  it('removes newly created review items unless a later manual draft needs preserving', () => {
    const current = { 1: review(1, { status: 'accepted', acceptedText: 'Confirmed text' }) };
    expect(undoReviewDecision(current, { index: 1 })).toEqual({});
    const restored = undoReviewDecision(current, { index: 1, draftAfterDecision: 'Keep this draft' });
    expect(restored[1].draft).toBe('Keep this draft');
    expect(restored[1].status).toBe('pending');
    expect(acceptedChanges(restored)).toEqual([]);
  });
});
