import { describe, expect, it } from 'vitest';
import { generatePreview } from './rename-engine.js';
import { sortItemsByMode } from './sort.js';
import type { ResolvedRenameItem } from './types.js';

describe('normalized ancestry', () => {
  it.each(['linux', 'darwin', 'win32'] as const)('orders normalized ancestors before descendants on %s', (platform) => {
    const windows = platform === 'win32';
    const parent = windows ? 'C:\\p\\z' : '/p/z';
    const child = windows ? 'C:\\p\\tmp\\..\\z\\a' : '/p/tmp/../z/a';
    const items: ResolvedRenameItem[] = [
      { sourcePath: parent, parentPath: windows ? 'C:\\p' : '/p', name: 'z', isDirectory: true },
      { sourcePath: child, parentPath: windows ? 'C:\\p\\tmp\\..\\z' : '/p/tmp/../z', name: 'a', isDirectory: false },
    ];
    expect(sortItemsByMode(items, 'name_only', { platform }).map((row) => row.sourcePath)).toEqual([parent, child]);
    const preview = generatePreview({
      items, rules: [{ id: 'seq', type: 'new_name', enabled: true, template: '{seq}' }],
      platform, sortMode: 'name_only',
    });
    expect(preview.rows.map((row) => row.proposedName)).toEqual(['1', '2']);
    expect(preview.rows[1].finalDirectoryPath).toBe(preview.rows[0].nextPath);
  });
});
