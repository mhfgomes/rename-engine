import { describe, expect, it } from 'vitest';
import { generatePreview } from './rename-engine.js';
import type { RenameRule, ResolvedRenameItem } from './types.js';

function fileItem(parentPath: string, name: string, isDirectory = false): ResolvedRenameItem {
  return { sourcePath: `${parentPath}/${name}`, name, parentPath, isDirectory };
}

const renameTo = (expression: string): RenameRule => ({
  id: 'custom', type: 'custom_rule', enabled: true, expression,
});

describe('occupancy carried by ancestor renames', () => {
  it.each([false, true])('detects unselected occupants through intermediate directories: %s', (intermediate) => {
    const parent = intermediate ? '/d/A/sub' : '/d/A';
    const existing = new Set(['/d/A', `${parent}/x.txt`, `${parent}/y.txt`]);
    const preview = generatePreview({
      items: [fileItem('/d', 'A', true), fileItem(parent, 'x.txt')],
      rules: [renameTo('isDirectory ? "B" : "y.txt"')],
      platform: 'linux', sortMode: 'natural_path',
      existingPathExists: (candidate) => existing.has(candidate),
    });
    expect(preview.rows.find((row) => !row.isDirectory)).toMatchObject({
      nextPath: intermediate ? '/d/B/sub/y.txt' : '/d/B/y.txt', status: 'conflict',
    });
    expect(preview.summary.blocked).toBe(true);
  });

  it('allows selected occupants to move away within a renamed directory', () => {
    const existing = new Set(['/d/A', '/d/A/x.txt', '/d/A/y.txt']);
    const preview = generatePreview({
      items: [fileItem('/d', 'A', true), fileItem('/d/A', 'x.txt'), fileItem('/d/A', 'y.txt')],
      rules: [renameTo('isDirectory ? "B" : originalName == "x.txt" ? "y.txt" : "z.txt"')],
      platform: 'linux', sortMode: 'natural_path',
      existingPathExists: (candidate) => existing.has(candidate),
    });
    expect(preview.summary).toMatchObject({ ok: 3, blocked: false });
  });

  it('checks the correct contents when sibling directories swap', () => {
    const existing = new Set(['/d/A', '/d/B', '/d/A/x.txt', '/d/B/y.txt']);
    const preview = generatePreview({
      items: [fileItem('/d', 'A', true), fileItem('/d', 'B', true), fileItem('/d/A', 'x.txt')],
      rules: [renameTo('isDirectory ? (originalName == "A" ? "B" : "A") : "y.txt"')],
      platform: 'linux', sortMode: 'natural_path',
      existingPathExists: (candidate) => existing.has(candidate),
    });
    expect(preview.rows.find((row) => !row.isDirectory)).toMatchObject({ nextPath: '/d/B/y.txt', status: 'ok' });
    expect(preview.summary.blocked).toBe(false);
  });
});
