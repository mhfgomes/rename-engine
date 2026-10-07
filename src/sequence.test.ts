import { spawnSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { describe, expect, it } from 'vitest';
import type { RenameRule, ResolvedRenameItem } from './types.js';
import { computeSequenceValue, formatLetterSequence } from './sequence.js';

// Inputs that used to spin forever are evaluated in a child process with a hard timeout, so a
// regression fails the test instead of hanging the whole suite. The child loads the TypeScript
// sources directly using Node's built-in type stripping.
const CHILD_TIMEOUT_MS = 5000;
const canRunTypeScriptChild =
  Boolean((process.features as { typescript?: unknown }).typescript) &&
  typeof (nodeModule as { registerHooks?: unknown }).registerHooks === 'function';

const CHILD_SOURCE = `
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { moduleUrl, exportName, args } = JSON.parse(process.env.CHILD_CALL, (_key, value) =>
  value !== null && typeof value === 'object' && '$number' in value ? Number(value.$number) : value,
);
const mod = await import(moduleUrl);
let result;
try {
  result = { value: mod[exportName](...args) };
} catch (error) {
  result = { error: error instanceof Error ? error.message : String(error) };
}
process.stdout.write(JSON.stringify(result));
`;

function callInChild(moduleFile: string, exportName: string, args: unknown[]) {
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', CHILD_SOURCE], {
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      CHILD_CALL: JSON.stringify({
        moduleUrl: new URL(moduleFile, import.meta.url).href,
        exportName,
        args,
      }, (_key, value) =>
        typeof value === 'number' && !Number.isFinite(value) ? { $number: String(value) } : value,
      ),
    },
  });

  expect(child.signal, `child did not finish within ${CHILD_TIMEOUT_MS} ms`).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as { value?: unknown; error?: string };
}

const files: ResolvedRenameItem[] = ['a', 'b', 'c'].map((name) => ({
  sourcePath: `/d/${name}`,
  parentPath: '/d',
  name,
  isDirectory: false,
}));

const overflowingLetters: RenameRule = {
  id: 'letters',
  type: 'letter_sequence_insert',
  enabled: true,
  position: 'prefix',
  start: 1,
  step: 1e308,
  casing: 'upper',
  separator: '_',
};

const overflowingNumbers: RenameRule = {
  id: 'numbers',
  type: 'sequence_insert',
  enabled: true,
  position: 'prefix',
  start: 1,
  step: 1e308,
  padWidth: 0,
  separator: '_',
};

describe('computeSequenceValue', () => {
  it('returns start + index * step', () => {
    expect(computeSequenceValue(1, 1, 0)).toBe(1);
    expect(computeSequenceValue(10, -3, 4)).toBe(-2);
    expect(computeSequenceValue(Number.MAX_SAFE_INTEGER, 0, 5)).toBe(Number.MAX_SAFE_INTEGER);
    expect(computeSequenceValue(-Number.MAX_SAFE_INTEGER, 0, 5)).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('rejects non-finite inputs and computed values outside the safe integer range', () => {
    expect(() => computeSequenceValue(Number.NaN, 1, 0)).toThrow(/finite/);
    expect(() => computeSequenceValue(1, Number.POSITIVE_INFINITY, 0)).toThrow(/finite/);
    expect(() => computeSequenceValue(1, 1e308, 2)).toThrow(/outside the supported range/);
    expect(() => computeSequenceValue(1, -1e308, 2)).toThrow(/outside the supported range/);
    expect(() => computeSequenceValue(1, 1e308, 1)).toThrow(/outside the supported range/);
    expect(() => computeSequenceValue(Number.MAX_SAFE_INTEGER, 1, 1)).toThrow(/outside the supported range/);
  });
});

describe('formatLetterSequence', () => {
  it('formats in-range values', () => {
    expect(formatLetterSequence(1, 'upper')).toBe('A');
    expect(formatLetterSequence(26, 'upper')).toBe('Z');
    expect(formatLetterSequence(27, 'lower')).toBe('aa');
    expect(formatLetterSequence(702, 'upper')).toBe('ZZ');
    expect(formatLetterSequence(2.9, 'upper')).toBe('B');
    expect(formatLetterSequence(0, 'upper')).toBe('A');
    expect(formatLetterSequence(-1e308, 'upper')).toBe('A');
    expect(formatLetterSequence(Number.MAX_SAFE_INTEGER, 'upper')).toHaveLength(12);
  });

  it.skipIf(!canRunTypeScriptChild)(
    'throws instead of looping for non-finite or unsafe values (child process, hard timeout)',
    { timeout: 5 * CHILD_TIMEOUT_MS },
    () => {
      const cases: [number, RegExp][] = [
        [Number.POSITIVE_INFINITY, /finite/],
        [Number.NEGATIVE_INFINITY, /finite/],
        [Number.NaN, /finite/],
        [1e308, /must not exceed/],
        [Number.MAX_SAFE_INTEGER + 2, /must not exceed/],
      ];
      for (const [value, message] of cases) {
        expect(callInChild('./sequence.ts', 'formatLetterSequence', [value, 'upper']).error).toMatch(message);
      }
    },
  );
});

describe.skipIf(!canRunTypeScriptChild)('overflowing sequence rules (child process, hard timeout)', () => {
  it('marks letter-sequence rows invalid instead of hanging', { timeout: 2 * CHILD_TIMEOUT_MS }, () => {
    const result = callInChild('./rename-engine.ts', 'generatePreview', [
      { items: files, rules: [overflowingLetters], platform: 'linux', sortMode: 'natural_path' },
    ]);
    expect(result.error).toBeUndefined();
    const preview = result.value as {
      rows: { status: string; proposedName: string; reasons: string[] }[];
      summary: { blocked: boolean };
    };
    expect(preview.rows.map((row) => row.status)).toEqual(['ok', 'invalid', 'invalid']);
    expect(preview.rows[0].proposedName).toBe('A_a');
    expect(preview.rows[2].reasons.join(' ')).toMatch(/letter_sequence_insert.*outside the supported range/);
    expect(preview.summary.blocked).toBe(true);
  });

  it('makes applyRulesToName throw instead of hanging', { timeout: 2 * CHILD_TIMEOUT_MS }, () => {
    const result = callInChild('./rename-engine.ts', 'applyRulesToName', [
      'c',
      false,
      [overflowingLetters],
      { index: 2, total: 3, originalName: 'c', parentPath: '/d' },
    ]);
    expect(result.error).toMatch(/outside the supported range/);
  });

  it('marks numeric-sequence rows invalid when the computed value overflows', { timeout: 2 * CHILD_TIMEOUT_MS }, () => {
    const result = callInChild('./rename-engine.ts', 'generatePreview', [
      { items: files, rules: [overflowingNumbers], platform: 'linux', sortMode: 'natural_path' },
    ]);
    const preview = result.value as {
      rows: { status: string; proposedName: string; nextPath: string; reasons: string[] }[];
      summary: { blocked: boolean };
    };
    expect(preview.rows.map((row) => row.status)).toEqual(['ok', 'invalid', 'invalid']);
    expect(preview.rows.some((row) => /Infinity|e\+/.test(row.nextPath))).toBe(false);
    expect(preview.rows[1].reasons.join(' ')).toMatch(/sequence_insert.*outside the supported range/);
    expect(preview.summary.blocked).toBe(true);
  });
});
