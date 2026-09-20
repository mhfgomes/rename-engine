import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRulesToName, generatePreview } from './rename-engine.js';
import type { RenameRule, ResolvedRenameItem } from './types.js';

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
});
