import type { LinePair, ReviewItem } from '../../types';

export type SearchField = 'source' | 'translation' | 'sourceName' | 'targetName';
export interface TextMatch { id: string; index: number; field: SearchField; start: number; end: number }
export interface ReaderTarget { index: number; matchId?: string; sequence: number }

export function visibleTranslation(line: LinePair, review?: ReviewItem) {
  return review?.status === 'accepted' ? review.acceptedText ?? review.draft : line.translation;
}

export function findText(entries: LinePair[], reviews: Record<number, ReviewItem>, query: string): TextMatch[] {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: TextMatch[] = [];
  for (const line of entries) {
    const fields: [SearchField, string][] = [['sourceName', line.sourceName || '旁白'], ['source', line.source],
      ['targetName', line.targetName || '旁白'], ['translation', visibleTranslation(line, reviews[line.index])]];
    for (const [field, text] of fields) {
      for (const result of text.matchAll(expression)) {
        matches.push({ id: `${line.index}-${field}-${result.index}`, index: line.index, field, start: result.index, end: result.index + result[0].length });
      }
    }
  }
  return matches;
}
