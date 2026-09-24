import { describe, expect, it } from 'vitest';
import { readRequirements } from './review';

describe('saved proofreading requirements', () => {
  it('keeps written language guidance and removes legacy language metadata', () => {
    const old = { targetLanguage: 'JP', style: '原文为日语，译文为法语。', background: '校门前' };
    expect(readRequirements(old)).toEqual({ style: old.style, background: old.background });
    expect(old.targetLanguage).toBe('JP');
  });

  it('accepts empty requirements without selecting a language', () => {
    expect(readRequirements({ style: '', background: '' })).toEqual({ style: '', background: '' });
  });

  it.each([null, [], 'EN', {}, { style: 3, background: '' }, { style: '', background: null }])('rejects malformed preferences: %j', (value) => {
    expect(readRequirements(value)).toBeNull();
  });
});
