import { describe, expect, it } from 'vitest';
import { generatePreview } from './rename-engine.js';
import type { PlatformTarget, RenameRule, ResolvedRenameItem } from './types.js';

function fileItem(parentPath: string, name: string, isDirectory = false): ResolvedRenameItem {
  return { sourcePath: `${parentPath}/${name}`, name, parentPath, isDirectory };
}

function previewOne(name: string, rules: RenameRule[], platform: PlatformTarget = 'linux') {
  return generatePreview({ items: [fileItem('/d', name)], rules, platform, sortMode: 'natural_path' }).rows[0];
}

const renameTo = (expression: string): RenameRule => ({
  id: 'custom', type: 'custom_rule', enabled: true, expression,
});

describe('trailing-dot filenames', () => {
  it.each(['report.', 'report..', '.config.'])('preserves %s with empty, disabled, and keep rules', (name) => {
    const ruleSets: RenameRule[][] = [[],
      [{ id: 'disabled', type: 'new_name', enabled: false, template: 'other' }],
      [{ id: 'keep', type: 'extension_handling', enabled: true, mode: 'keep', replacement: '' }],
    ];
    for (const platform of ['linux', 'darwin'] as const) {
      for (const rules of ruleSets) {
        expect(previewOne(name, rules, platform)).toMatchObject({
          proposedName: name, nextPath: `/d/${name}`, changed: false, status: 'unchanged',
        });
      }
    }
  });

  it('validates Windows trailing dots instead of silently removing them', () => {
    const row = previewOne('report.', [], 'win32');
    expect(row.proposedName).toBe('report.');
    expect(row.status).toBe('invalid');
    expect(row.reasons).toContain('Windows names cannot end with a space or period.');
  });

  it('preserves full names returned by custom rules and still removes actual extensions', () => {
    expect(previewOne('old.txt', [renameTo('"report."')]).proposedName).toBe('report.');
    expect(previewOne('report.txt', [{ id: 'remove', type: 'extension_handling', enabled: true, mode: 'remove', replacement: '' }]).proposedName).toBe('report');
  });
});
