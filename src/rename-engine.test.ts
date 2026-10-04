import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRulesToName, generatePreview, normalizePathKey } from './rename-engine.js';
import type { PlatformTarget, RenameRule, ResolvedRenameItem } from './types.js';

function fileItem(parentPath: string, name: string, isDirectory = false): ResolvedRenameItem {
  return { sourcePath: `${parentPath}/${name}`, name, parentPath, isDirectory };
}

function previewOne(
  name: string,
  rules: RenameRule[],
  platform: PlatformTarget = 'linux',
  isDirectory = false,
) {
  return generatePreview({
    items: [fileItem('/d', name, isDirectory)],
    rules,
    platform,
    sortMode: 'natural_path',
  }).rows[0];
}

const renameTo = (expression: string): RenameRule => ({
  id: 'custom',
  type: 'custom_rule',
  enabled: true,
  expression,
});

describe('applyRulesToName', () => {
  it('applies ordered transforms without mutating the extension', () => {
    const rules: RenameRule[] = [
      {
        id: 'trim',
        type: 'trim_text',
        enabled: true,
        mode: 'collapse_spaces',
      },
      {
        id: 'case',
        type: 'case_transform',
        enabled: true,
        mode: 'snake',
      },
      {
        id: 'ext',
        type: 'extension_handling',
        enabled: true,
        mode: 'lowercase',
        replacement: '',
      },
    ];

    expect(
      applyRulesToName('  Final Report 2026.TXT  ', false, rules, {
        index: 0,
        total: 1,
        originalName: '  Final Report 2026.TXT  ',
        parentPath: '/tmp',
      }),
    ).toBe(
      'final_report_2026.txt  ',
    );
  });

  it('renders new-name templates with sequence and original stem tokens', () => {
    const rules: RenameRule[] = [
      {
        id: 'new-name',
        type: 'new_name',
        enabled: true,
        template: 'name_{seq_num:0001}_{original_stem}',
      },
    ];

    expect(
      applyRulesToName('Report Final.txt', false, rules, {
        index: 1,
        total: 3,
        originalName: 'Report Final.txt',
        parentPath: '/tmp/Clients',
      }),
    ).toBe('name_0002_Report Final.txt');
  });

  it('renders new-name template sequences in reverse order', () => {
    const rules: RenameRule[] = [
      {
        id: 'new-name',
        type: 'new_name',
        enabled: true,
        template: 'name_{seq_num:0001}',
        reverseSequence: true,
      },
    ];

    expect(
      applyRulesToName('Report Final.txt', false, rules, {
        index: 0,
        total: 3,
        originalName: 'Report Final.txt',
        parentPath: '/tmp/Clients',
      }),
    ).toBe('name_0003.txt');
    expect(
      applyRulesToName('Report Final.txt', false, rules, {
        index: 2,
        total: 3,
        originalName: 'Report Final.txt',
        parentPath: '/tmp/Clients',
      }),
    ).toBe('name_0001.txt');
  });

  it('renders new-name template letter sequences in forward and reverse order', () => {
    const rules: RenameRule[] = [
      {
        id: 'new-name',
        type: 'new_name',
        enabled: true,
        template: 'name_{seq_letter}_{seq_letter_rev}_{seq_letter:lower}_{seq_letter_rev:lower}',
      },
    ];

    expect(
      applyRulesToName('Report Final.txt', false, rules, {
        index: 0,
        total: 3,
        originalName: 'Report Final.txt',
        parentPath: '/tmp/Clients',
      }),
    ).toBe('name_A_C_a_c.txt');
    expect(
      applyRulesToName('Report Final.txt', false, rules, {
        index: 2,
        total: 3,
        originalName: 'Report Final.txt',
        parentPath: '/tmp/Clients',
      }),
    ).toBe('name_C_A_c_a.txt');
  });

  it('inserts spreadsheet-style letter sequences', () => {
    const rules: RenameRule[] = [
      {
        id: 'letters',
        type: 'letter_sequence_insert',
        enabled: true,
        position: 'prefix',
        start: 26,
        step: 1,
        casing: 'upper',
        separator: '_',
      },
    ];

    expect(
      applyRulesToName('Report.txt', false, rules, {
        index: 0,
        total: 3,
        originalName: 'Report.txt',
        parentPath: '/tmp',
      }),
    ).toBe('Z_Report.txt');
    expect(
      applyRulesToName('Report.txt', false, rules, {
        index: 1,
        total: 3,
        originalName: 'Report.txt',
        parentPath: '/tmp',
      }),
    ).toBe('AA_Report.txt');
  });

  it('evaluates custom rules against the current naming context', () => {
    const rules: RenameRule[] = [
      {
        id: 'custom',
        type: 'custom_rule',
        enabled: true,
        expression: 'snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))',
      },
    ];

    expect(
      applyRulesToName('Quarterly Report.TXT', false, rules, {
        index: 1,
        total: 3,
        originalName: 'Quarterly Report.TXT',
        parentPath: '/tmp/Clients',
        sourcePath: '/tmp/Clients/Quarterly Report.TXT',
      }),
    ).toBe('quarterly_report_002.txt');
  });
});

describe('generatePreview', () => {
  it('uses natural sort order for sequence numbering', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/file10.txt',
          name: 'file10.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file2.txt',
          name: 'file2.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file1.txt',
          name: 'file1.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'seq',
          type: 'sequence_insert',
          enabled: true,
          position: 'prefix',
          start: 1,
          step: 1,
          padWidth: 0,
          separator: '_',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.proposedName)).toEqual([
      '1_file1.txt',
      '2_file2.txt',
      '3_file10.txt',
    ]);
  });

  it('uses sorted preview order for reverse new-name sequence numbering', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/file10.txt',
          name: 'file10.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file2.txt',
          name: 'file2.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file1.txt',
          name: 'file1.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'new-name',
          type: 'new_name',
          enabled: true,
          template: 'name_{seq_num:0001}',
          reverseSequence: true,
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.proposedName)).toEqual([
      'name_0003.txt',
      'name_0002.txt',
      'name_0001.txt',
    ]);
  });

  it('uses sorted preview order for new-name letter sequence tokens', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/file10.txt',
          name: 'file10.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file2.txt',
          name: 'file2.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file1.txt',
          name: 'file1.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'new-name',
          type: 'new_name',
          enabled: true,
          template: 'name_{seq_letter}_{seq_letter_rev}',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.proposedName)).toEqual([
      'name_A_C.txt',
      'name_B_B.txt',
      'name_C_A.txt',
    ]);
  });

  it('uses alphabetic path sort order for sequence numbering', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/file2.txt',
          name: 'file2.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/file10.txt',
          name: 'file10.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'alphabetic_path',
      rules: [
        {
          id: 'seq',
          type: 'sequence_insert',
          enabled: true,
          position: 'prefix',
          start: 1,
          step: 1,
          padWidth: 0,
          separator: '_',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.proposedName)).toEqual([
      '1_file10.txt',
      '2_file2.txt',
    ]);
  });

  it('sorts by file name before parent path in name-only mode', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/zeta/report-2.txt',
          name: 'report-2.txt',
          parentPath: '/tmp/zeta',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/alpha/report-10.txt',
          name: 'report-10.txt',
          parentPath: '/tmp/alpha',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/alpha/report-2.txt',
          name: 'report-2.txt',
          parentPath: '/tmp/alpha',
          isDirectory: false,
        },
      ],
      sortMode: 'name_only',
      rules: [],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.sourcePath)).toEqual([
      '/tmp/alpha/report-2.txt',
      '/tmp/zeta/report-2.txt',
      '/tmp/alpha/report-10.txt',
    ]);
  });

  it('groups rows by folder before name in folder-then-name mode', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/beta/file-2.txt',
          name: 'file-2.txt',
          parentPath: '/tmp/beta',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/alpha/file-9.txt',
          name: 'file-9.txt',
          parentPath: '/tmp/alpha',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/alpha/file-10.txt',
          name: 'file-10.txt',
          parentPath: '/tmp/alpha',
          isDirectory: false,
        },
      ],
      sortMode: 'folder_then_name',
      rules: [],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.sourcePath)).toEqual([
      '/tmp/alpha/file-9.txt',
      '/tmp/alpha/file-10.txt',
      '/tmp/beta/file-2.txt',
    ]);
  });

  it('keeps ancestor directories ahead of descendants in name-only mode', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/Parent Folder/child.txt',
          name: 'child.txt',
          parentPath: '/tmp/Parent Folder',
          isDirectory: false,
        },
        {
          sourcePath: '/tmp/Parent Folder',
          name: 'Parent Folder',
          parentPath: '/tmp',
          isDirectory: true,
        },
      ],
      sortMode: 'name_only',
      rules: [
        {
          id: 'case',
          type: 'case_transform',
          enabled: true,
          mode: 'snake',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.sourcePath)).toEqual([
      '/tmp/Parent Folder',
      '/tmp/Parent Folder/child.txt',
    ]);
    expect(preview.rows[1].finalDirectoryPath).toBe('/tmp/parent_folder');
  });

  it('resolves nested child targets under renamed parent directories', () => {
    const root = path.join(os.tmpdir(), 'fast-renamer-preview');
    const items: ResolvedRenameItem[] = [
      {
        sourcePath: path.join(root, 'Parent Folder'),
        name: 'Parent Folder',
        parentPath: root,
        isDirectory: true,
      },
      {
        sourcePath: path.join(root, 'Parent Folder', 'Quarterly Report.TXT'),
        name: 'Quarterly Report.TXT',
        parentPath: path.join(root, 'Parent Folder'),
        isDirectory: false,
      },
    ];

    const rules: RenameRule[] = [
      {
        id: 'case',
        type: 'case_transform',
        enabled: true,
        mode: 'snake',
      },
      {
        id: 'ext',
        type: 'extension_handling',
        enabled: true,
        mode: 'lowercase',
        replacement: '',
      },
    ];

    const preview = generatePreview({
      items,
      sortMode: 'natural_path',
      rules,
      platform: 'linux',
      existingPathExists: () => false,
    });

    const parentRow = preview.rows.find((row) => row.originalName === 'Parent Folder');
    const childRow = preview.rows.find((row) => row.originalName === 'Quarterly Report.TXT');

    expect(parentRow?.nextPath).toBe(path.join(root, 'parent_folder'));
    expect(childRow?.finalDirectoryPath).toBe(path.join(root, 'parent_folder'));
    expect(childRow?.nextPath).toBe(path.join(root, 'parent_folder', 'quarterly_report.txt'));
  });

  it('flags duplicate destinations as conflicts', () => {
    const items: ResolvedRenameItem[] = [
      {
        sourcePath: '/tmp/alpha.txt',
        name: 'alpha.txt',
        parentPath: '/tmp',
        isDirectory: false,
      },
      {
        sourcePath: '/tmp/beta.txt',
        name: 'beta.txt',
        parentPath: '/tmp',
        isDirectory: false,
      },
    ];

    const preview = generatePreview({
      items,
      sortMode: 'natural_path',
      rules: [
        {
          id: 'replace',
          type: 'find_replace',
          enabled: true,
          find: 'alpha',
          replace: 'shared',
          matchCase: true,
          useRegex: false,
          replaceAll: false,
        },
        {
          id: 'replace-2',
          type: 'find_replace',
          enabled: true,
          find: 'beta',
          replace: 'shared',
          matchCase: true,
          useRegex: false,
          replaceAll: false,
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows.map((row) => row.status)).toEqual(['conflict', 'conflict']);
    expect(preview.summary.conflict).toBe(2);
    expect(preview.summary.blocked).toBe(true);
  });

  it('marks custom rule failures as row-level invalid results', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/alpha.txt',
          name: 'alpha.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'custom',
          type: 'custom_rule',
          enabled: true,
          expression: 'missingHelper(originalStem)',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].reasons.join(' ')).toContain('Custom rule failed');
    expect(preview.rows[0].reasons.join(' ')).toContain('missingHelper');
    expect(preview.summary.invalid).toBe(1);
    expect(preview.summary.blocked).toBe(true);
  });

  it('distinguishes suffix from before-extension positioning', () => {
    const item: ResolvedRenameItem = {
      sourcePath: '/tmp/report.txt',
      name: 'report.txt',
      parentPath: '/tmp',
      isDirectory: false,
    };

    const suffixPreview = generatePreview({
      items: [item],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'suffix',
          type: 'sequence_insert',
          enabled: true,
          position: 'suffix',
          start: 1,
          step: 1,
          padWidth: 0,
          separator: '_',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    const beforeExtensionPreview = generatePreview({
      items: [item],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'before-extension',
          type: 'sequence_insert',
          enabled: true,
          position: 'before_extension',
          start: 1,
          step: 1,
          padWidth: 0,
          separator: '_',
        },
      ],
      platform: 'linux',
      existingPathExists: () => false,
    });

    expect(suffixPreview.rows[0].proposedName).toBe('report.txt_1');
    expect(beforeExtensionPreview.rows[0].proposedName).toBe('report_1.txt');
  });

  it('marks case-only renames as ok with staging guidance on macOS', () => {
    const preview = generatePreview({
      items: [
        {
          sourcePath: '/tmp/Report.txt',
          name: 'Report.txt',
          parentPath: '/tmp',
          isDirectory: false,
        },
      ],
      sortMode: 'natural_path',
      rules: [
        {
          id: 'lower',
          type: 'case_transform',
          enabled: true,
          mode: 'lower',
        },
      ],
      platform: 'darwin',
      existingPathExists: () => true,
    });

    expect(preview.rows[0].status).toBe('ok');
    expect(preview.rows[0].reasons.join(' ')).toContain('Case-only rename');
  });

  it('treats NFC and NFD spellings as the same path on every platform', () => {
    const nfd = 'e\u0301.txt';
    const nfc = '\u00e9.txt';
    expect(normalizePathKey(`/d/${nfd}`, 'linux')).toBe(normalizePathKey(`/d/${nfc}`, 'linux'));

    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const preview = generatePreview({
        items: [fileItem('/d', nfd), fileItem('/d', 'x.txt')],
        rules: [renameTo(`when(originalStem == "x", "${nfc}", currentName)`)],
        platform,
        sortMode: 'natural_path',
      });
      expect(preview.rows.map((row) => row.status)).toEqual(['conflict', 'conflict']);
    }
  });

  it('reports duplicate source paths as conflicts instead of merging them', () => {
    const preview = generatePreview({
      items: [fileItem('/d', 'A.txt'), fileItem('/d', 'a.txt')],
      rules: [],
      platform: 'darwin',
      sortMode: 'natural_path',
    });

    expect(preview.summary.total).toBe(2);
    expect(preview.summary.conflict).toBe(2);
    expect(new Set(preview.rows.map((row) => row.id)).size).toBe(2);
    expect(preview.rows[0].reasons).toContain('Another item in the batch has the same source path.');

    const linuxPreview = generatePreview({
      items: [fileItem('/d', 'A.txt'), fileItem('/d', 'a.txt')],
      rules: [],
      platform: 'linux',
      sortMode: 'natural_path',
    });
    expect(linuxPreview.summary.unchanged).toBe(2);
    expect(linuxPreview.summary.blocked).toBe(false);
  });

  it('turns rule configuration errors into invalid rows instead of throwing', () => {
    const invalidRegex = previewOne('alpha.txt', [
      {
        id: 'regex',
        type: 'find_replace',
        enabled: true,
        find: '[',
        replace: '-',
        matchCase: false,
        useRegex: true,
        replaceAll: true,
      },
    ]);
    expect(invalidRegex.status).toBe('invalid');
    expect(invalidRegex.reasons.join(' ')).toMatch(/find_replace.*failed/);
    expect(invalidRegex.proposedName).toBe('alpha.txt');

    const hugePad = previewOne('alpha.txt', [
      {
        id: 'seq',
        type: 'sequence_insert',
        enabled: true,
        position: 'prefix',
        start: 1,
        step: 1,
        padWidth: 1e10,
        separator: '_',
      },
    ]);
    expect(hugePad.status).toBe('invalid');
    expect(hugePad.reasons.join(' ')).toContain('Pad width');

    const infiniteLetters = previewOne('alpha.txt', [
      {
        id: 'letters',
        type: 'letter_sequence_insert',
        enabled: true,
        position: 'prefix',
        start: Number.POSITIVE_INFINITY,
        step: 1,
        casing: 'upper',
        separator: '_',
      },
    ]);
    expect(infiniteLetters.status).toBe('invalid');
  });

  it('caps sequence pad width', () => {
    const rule = (padWidth: number): RenameRule => ({
      id: 'seq',
      type: 'sequence_insert',
      enabled: true,
      position: 'prefix',
      start: 1,
      step: 1,
      padWidth,
      separator: '',
    });
    expect(previewOne('a.txt', [rule(256)]).status).toBe('invalid');
    expect(previewOne('a.txt', [rule(5)]).proposedName).toBe('00001a.txt');
  });

  it('rejects patterns longer than the regex length limit', () => {
    const row = previewOne('alpha.txt', [
      {
        id: 'regex',
        type: 'find_replace',
        enabled: true,
        find: 'a'.repeat(1001),
        replace: '-',
        matchCase: false,
        useRegex: true,
        replaceAll: true,
      },
    ]);
    expect(row.status).toBe('invalid');
    expect(row.reasons.join(' ')).toContain('longer than 1000 characters');
  });

  it('validates Windows reserved device names from the first dot', () => {
    for (const name of ['CON.tar.gz', 'nul .txt', 'COM0.txt', 'lpt0', 'COM\u00b9.txt', 'LPT\u00b3', 'CONIN$', 'conout$.log']) {
      expect(previewOne(name, [], 'win32').reasons).toContain('Name is reserved on Windows.');
    }
    expect(previewOne('AUX.d', [], 'win32', true).reasons).toContain('Name is reserved on Windows.');
    expect(previewOne('console.txt', [], 'win32').reasons).toEqual([]);
    expect(previewOne('CON.tar.gz', [], 'linux').reasons).toEqual([]);
  });

  it('rejects control characters on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const row = previewOne('a.txt', [{ id: 'p', type: 'prefix_suffix', enabled: true, prefix: '\u0007', suffix: '' }], platform);
      expect(row.status).toBe('invalid');
      expect(row.reasons).toContain('Name contains control characters.');
    }
  });

  it('enforces name length limits per platform', () => {
    const suffix = (value: string): RenameRule => ({
      id: 's',
      type: 'prefix_suffix',
      enabled: true,
      prefix: '',
      suffix: value,
    });
    // 128 two-byte characters + ".txt" = 260 UTF-8 bytes but only 132 UTF-16 units.
    const wide = '\u00e9'.repeat(128);
    expect(previewOne('a.txt', [suffix(wide)], 'linux').reasons).toContain('Name is longer than 255 bytes.');
    expect(previewOne('a.txt', [suffix(wide)], 'darwin').status).toBe('invalid');
    expect(previewOne('a.txt', [suffix(wide)], 'win32').status).toBe('ok');
    expect(previewOne('a.txt', [suffix('b'.repeat(251))], 'win32').reasons).toContain(
      'Name is longer than 255 characters.',
    );
    expect(previewOne('a.txt', [suffix('b'.repeat(250))], 'linux').status).toBe('ok');
  });

  it('keeps match offsets correct for case-insensitive literal replacement', () => {
    const rule = (replaceAll: boolean): RenameRule => ({
      id: 'replace',
      type: 'find_replace',
      enabled: true,
      find: 'a',
      replace: '-',
      matchCase: false,
      useRegex: false,
      replaceAll,
    });
    expect(previewOne('\u0130xab.txt', [rule(false)]).proposedName).toBe('\u0130x-b.txt');
    expect(previewOne('\u0130xAbA.txt', [rule(true)]).proposedName).toBe('\u0130x-b-.txt');
    expect(
      previewOne('cost.txt', [
        { id: 'r', type: 'find_replace', enabled: true, find: 'COST', replace: '$&$1', matchCase: false, useRegex: false, replaceAll: true },
      ]).proposedName,
    ).toBe('$&$1.txt');
  });

  it('pads the absolute value of negative sequence numbers', () => {
    const preview = generatePreview({
      items: [fileItem('/d', 'a.txt'), fileItem('/d', 'b.txt'), fileItem('/d', 'c.txt')],
      rules: [
        {
          id: 'seq',
          type: 'sequence_insert',
          enabled: true,
          position: 'prefix',
          start: 0,
          step: -1,
          padWidth: 3,
          separator: '_',
        },
      ],
      platform: 'linux',
      sortMode: 'natural_path',
    });
    expect(preview.rows.map((row) => row.proposedName)).toEqual(['000_a.txt', '-001_b.txt', '-002_c.txt']);
  });

  it('does not report non-normalized source paths as renames', () => {
    const preview = generatePreview({
      items: [
        { sourcePath: '/d//a.txt', name: 'a.txt', parentPath: '/d', isDirectory: false },
        { sourcePath: '/d/./sub/', name: 'sub', parentPath: '/d/', isDirectory: true },
      ],
      rules: [],
      platform: 'linux',
      sortMode: 'natural_path',
    });
    expect(preview.rows.map((row) => row.status)).toEqual(['unchanged', 'unchanged']);
    expect(preview.summary.changed).toBe(0);
  });

  it('marks a rule that empties the stem as invalid', () => {
    const row = previewOne('abc.txt', [
      { id: 'remove', type: 'remove_text', enabled: true, text: 'abc', matchCase: true },
    ]);
    expect(row.proposedName).toBe('.txt');
    expect(row.status).toBe('invalid');
    expect(row.reasons.join(' ')).toContain('Name is empty');

    expect(previewOne('.bashrc', []).status).toBe('unchanged');
  });

  it('uses the path flavour of the target platform', () => {
    const preview = generatePreview({
      items: [
        { sourcePath: 'C:\\Data\\Parent', name: 'Parent', parentPath: 'C:\\Data', isDirectory: true },
        { sourcePath: 'C:\\Data\\Parent\\Report.txt', name: 'Report.txt', parentPath: 'C:\\Data\\Parent', isDirectory: false },
      ],
      rules: [
        { id: 'lower', type: 'case_transform', enabled: true, mode: 'snake' },
        renameTo('currentStem + "_" + parent + ext(extension)'),
      ],
      platform: 'win32',
      sortMode: 'natural_path',
    });

    expect(preview.rows.map((row) => row.nextPath)).toEqual([
      'C:\\Data\\parent_Data',
      'C:\\Data\\parent_Data\\report_Parent.txt',
    ]);
    expect(preview.rows[1].finalDirectoryPath).toBe('C:\\Data\\parent_Data');

    const posix = generatePreview({
      items: [{ sourcePath: '/d/a\\b.txt', name: 'a\\b.txt', parentPath: '/d', isDirectory: false }],
      rules: [renameTo('basename(sourcePath)')],
      platform: 'linux',
      sortMode: 'natural_path',
    });
    expect(posix.rows[0].nextPath).toBe('/d/a\\b.txt');
    expect(posix.rows[0].status).toBe('unchanged');
  });
});
