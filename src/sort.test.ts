import { describe, expect, it } from 'vitest';
import { generatePreview } from './rename-engine.js';
import { compareItemsBySortMode, compareNatural, sortItemsByMode } from './sort.js';
import type { PreviewRow, RenameRule, ResolvedRenameItem, SortMode } from './types.js';

function item(sourcePath: string, isDirectory = false): ResolvedRenameItem {
  const lastSlash = sourcePath.lastIndexOf('/');
  return {
    sourcePath,
    name: sourcePath.slice(lastSlash + 1),
    parentPath: sourcePath.slice(0, lastSlash) || '/',
    isDirectory,
  };
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffle<T>(values: T[], random: () => number) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) {
    return [values];
  }
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
  );
}

const SORT_MODES: SortMode[] = ['natural_path', 'alphabetic_path', 'name_only', 'folder_then_name'];

const renameRules: RenameRule[] = [
  { id: 'upper', type: 'case_transform', enabled: true, mode: 'upper' },
  {
    id: 'seq',
    type: 'sequence_insert',
    enabled: true,
    position: 'prefix',
    start: 1,
    step: 1,
    padWidth: 2,
    separator: '_',
  },
];

function assertChildrenLiveUnderParentTargets(rows: PreviewRow[]) {
  const directoryRows = new Map(rows.filter((row) => row.isDirectory).map((row) => [row.sourcePath, row]));
  for (const row of rows) {
    const parentSource = row.sourcePath.slice(0, row.sourcePath.lastIndexOf('/'));
    const parentRow = directoryRows.get(parentSource);
    if (parentRow) {
      expect(row.finalDirectoryPath).toBe(parentRow.nextPath);
      expect(row.nextPath.startsWith(`${parentRow.nextPath}/`)).toBe(true);
    }
  }
}

describe('sortItemsByMode', () => {
  it('produces the same order and targets for every input order (reviewer case)', () => {
    const items = [item('/p/z', true), item('/p/z/a.txt'), item('/q/m.txt')];

    for (const sortMode of SORT_MODES) {
      const baseline = generatePreview({ items, rules: renameRules, platform: 'linux', sortMode });
      for (const ordering of permutations(items)) {
        const preview = generatePreview({ items: ordering, rules: renameRules, platform: 'linux', sortMode });
        expect(preview).toEqual(baseline);
        assertChildrenLiveUnderParentTargets(preview.rows);
      }
      const sourceOrder = baseline.rows.map((row) => row.sourcePath);
      expect(sourceOrder.indexOf('/p/z')).toBeLessThan(sourceOrder.indexOf('/p/z/a.txt'));
    }
  });

  it('is input-order independent and parent-first for shuffled nested trees', () => {
    const items = [
      item('/root/b', true),
      item('/root/b/a.txt'),
      item('/root/b/Z.txt'),
      item('/root/b/c', true),
      item('/root/b/c/0.txt'),
      item('/root/b/c/a', true),
      item('/root/b/c/a/file10.txt'),
      item('/root/b/c/a/file2.txt'),
      item('/root/A.txt'),
      item('/root/a.txt'),
      item('/root/z', true),
      item('/root/z/y', true),
      item('/root/z/y/b.txt'),
      item('/other/m.txt'),
      item('/root/é.txt'),
    ];
    const random = createRandom(0xc0ffee);

    for (const sortMode of SORT_MODES) {
      const baseline = generatePreview({ items, rules: renameRules, platform: 'linux', sortMode });
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const shuffled = shuffle(items, random);
        expect(sortItemsByMode(shuffled, sortMode)).toEqual(sortItemsByMode(items, sortMode));
        const preview = generatePreview({ items: shuffled, rules: renameRules, platform: 'linux', sortMode });
        expect(preview).toEqual(baseline);
        assertChildrenLiveUnderParentTargets(preview.rows);

        const order = preview.rows.map((row) => row.sourcePath);
        for (const row of preview.rows) {
          for (const ancestor of preview.rows) {
            if (ancestor.isDirectory && row.sourcePath.startsWith(`${ancestor.sourcePath}/`)) {
              expect(order.indexOf(ancestor.sourcePath)).toBeLessThan(order.indexOf(row.sourcePath));
            }
          }
        }
      }
    }
  });

  it('uses a total-order comparator with a code point tie-break', () => {
    const upper = item('/d/A.txt');
    const lower = item('/d/a.txt');
    for (const sortMode of SORT_MODES) {
      expect(compareItemsBySortMode(upper, lower, sortMode)).toBeLessThan(0);
      expect(compareItemsBySortMode(lower, upper, sortMode)).toBeGreaterThan(0);
      expect(compareItemsBySortMode(lower, lower, sortMode)).toBe(0);
    }
    expect(compareNatural('a', 'A')).toBe(-compareNatural('A', 'a'));
    expect(compareNatural('a', 'A')).not.toBe(0);
    expect(compareNatural('file2', 'file10')).toBeLessThan(0);
  });
});
