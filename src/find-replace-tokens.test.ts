import { describe, expect, it } from 'vitest';
import { applyRulesToName } from './index.js';
import type { RenameRule } from './index.js';

const rule: Extract<RenameRule, { type: 'find_replace' }> = {
  id: 'replace', type: 'find_replace', enabled: true,
  find: 'photo', replace: '{seq_num:0001}', matchCase: true, useRegex: false, replaceAll: true,
};
const context = { index: 1, total: 3, originalName: 'photo.TXT', parentPath: '/pictures', platform: 'linux' as const };
const now = new Date(2026, 9, 29, 11, 18, 35);
function rename(overrides: Partial<typeof rule> = {}, name = 'photo.TXT', earlier: RenameRule[] = []) {
  return applyRulesToName(name, false, [...earlier, { ...rule, ...overrides }], { ...context, originalName: name }, now);
}

describe('Find / Replace template tokens', () => {
  it('expands every quick-insert token with the batch and current rule context', () => {
    expect(rename({ find: 'pre_photo', replace: '{seq_num:0001}_{seq_letter}_{seq_letter_rev}_{original_stem}_{current_stem}_{parent}_{date}_{time}' }, 'photo.TXT', [
      { id: 'prefix', type: 'prefix_suffix', enabled: true, prefix: 'pre_', suffix: '' },
    ])).toBe('0002_B_B_photo_pre_photo_pictures_2026-10-29_111835.TXT');
  });
  it('uses one sequence value per item, including repeated matches', () => {
    expect(rename({}, 'photo_photo.TXT')).toBe('0002_0002.TXT');
    expect(rename({ replaceAll: false }, 'photo_photo.TXT')).toBe('0002_photo.TXT');
    expect(rename({ matchCase: false }, 'PHOTO_photo.TXT')).toBe('0002_0002.TXT');
  });
  it('preserves regex captures and literal dollar replacements', () => {
    expect(rename({ find: '(photo)', useRegex: true, replace: '$1_{seq_num:01}' })).toBe('photo_02.TXT');
    expect(rename({ replace: '$1_{seq_num:01}' })).toBe('$1_02.TXT');
  });
  it('preserves unknown tokens and leaves unmatched names alone', () => {
    expect(rename({ replace: '{unknown}' })).toBe('{unknown}.TXT');
    expect(rename({ find: 'missing' })).toBe('photo.TXT');
  });
});

describe('Find template tokens', () => {
  it.each([false, true])('renumbers a batch with sequences in both fields (regex: %s)', (useRegex) => {
    const names = ['E25.jpg', 'E26.jpg', 'E27.jpg'];
    expect(names.map((name, index) => applyRulesToName(name, false, [{
      ...rule, find: 'E{seq_num:25}', replace: 'E{seq_num:01}', useRegex,
    }], { ...context, index, total: names.length, originalName: name }, now)))
      .toEqual(['E01.jpg', 'E02.jpg', 'E03.jpg']);
  });

  it.each([false, true])('honors match count and case options for expanded searches (matchCase: %s)', (matchCase) => {
    expect(rename({ find: 'E{seq_num:25}', replace: 'E{seq_num:01}', matchCase }, 'E26_e26.TXT'))
      .toBe(matchCase ? 'E02_e26.TXT' : 'E02_E02.TXT');
    expect(rename({ find: 'E{seq_num:25}', replace: 'E{seq_num:01}', matchCase, replaceAll: false }, 'E26_E26.TXT'))
      .toBe('E02_E26.TXT');
  });

  it('uses earlier rules, original context and the approved clock for Find tokens', () => {
    expect(rename({ find: '{current_stem}', replace: 'matched' }, 'photo.TXT', [
      { id: 'prefix', type: 'prefix_suffix', enabled: true, prefix: 'pre_', suffix: '' },
    ])).toBe('matched.TXT');
    expect(rename({ find: '{original_stem}', replace: 'matched' }, 'photo.TXT')).toBe('matched.TXT');
    expect(rename({ find: '{date}_{time}_{parent}_{seq_letter}_{seq_letter_rev}', replace: 'matched' },
      '2026-10-29_111835_pictures_B_B.TXT')).toBe('matched.TXT');
  });

  it('keeps unknown tokens literal and ignores empty expanded searches', () => {
    expect(rename({ find: '{unknown}', replace: 'matched' }, '{unknown}.TXT')).toBe('matched.TXT');
    expect(rename({ find: '{current_stem}', replace: 'matched' }, '')).toBe('');
  });
});
