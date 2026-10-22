import { describe, expect, it } from 'vitest';
import { applyRulesToName, generatePreview } from './rename-engine.js';
import type { ResolvedRenameItem } from './types.js';

function fileItem(parentPath: string, name: string, isDirectory = false): ResolvedRenameItem {
  return { sourcePath: `${parentPath}/${name}`, name, parentPath, isDirectory };
}

describe('template numeric sequence bounds', () => {
  it.each(['seq', 'seq_num'])('rejects unsafe %s starts and overflow as invalid rows', (token) => {
    const options = { items: [fileItem('/d', 'a'), fileItem('/d', 'b')], platform: 'linux' as const, sortMode: 'natural_path' as const };
    const unsafe = generatePreview({ ...options, rules: [{ id: 'seq', type: 'new_name', enabled: true, template: `{${token}:9007199254740992}` }] });
    expect(unsafe.rows.map((row) => row.status)).toEqual(['invalid', 'invalid']);
    const boundary = generatePreview({ ...options, rules: [{ id: 'seq', type: 'new_name', enabled: true, template: `{${token}:9007199254740991}` }] });
    expect(boundary.rows[0]).toMatchObject({ proposedName: '9007199254740991', status: 'ok' });
    expect(boundary.rows[1].status).toBe('invalid');
    expect(boundary.rows[1].reasons.join()).toContain('outside the supported range');
    expect(boundary.summary.blocked).toBe(true);
  });

  it('throws for nonfinite template starts in the single-name API', () => {
    expect(() => applyRulesToName('a', false, [{ id: 'seq', type: 'new_name', enabled: true, template: `{seq:${'9'.repeat(310)}}` }], { index: 0, total: 1, originalName: 'a', parentPath: '/d' })).toThrow('finite');
  });

  it('keeps reverse numbering and leading-zero padding', () => {
    const preview = generatePreview({ items: [fileItem('/d', 'a'), fileItem('/d', 'b')], platform: 'linux', sortMode: 'natural_path', rules: [{ id: 'seq', type: 'new_name', enabled: true, template: '{seq:009}', reverseSequence: true }] });
    expect(preview.rows.map((row) => row.proposedName)).toEqual(['010', '009']);
  });
});
