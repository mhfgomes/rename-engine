import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { evaluateCustomRuleExpression, getCompiledExpressionCacheSize } from './custom-rule.js';

const baseContext = {
  currentName: 'My File.txt',
  currentStem: 'My File',
  extension: 'txt',
  originalName: 'My File.txt',
  originalStem: 'My File',
  originalExtension: 'txt',
  parent: '/tmp',
  sourcePath: '/tmp/My File.txt',
  isDirectory: false,
  index: 2,
  zeroIndex: 1,
  total: 5,
};

describe('evaluateCustomRuleExpression', () => {
  it('evaluates helper calls and context identifiers', () => {
    expect(
      evaluateCustomRuleExpression('snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))', baseContext),
    ).toBe('my_file_002.txt');
  });

  it('supports conditionals and boolean helpers', () => {
    expect(
      evaluateCustomRuleExpression('when(index > 1, "batch", "single") + "_" + lower(currentStem)', baseContext),
    ).toBe('batch_my file');
  });

  it('rejects unknown helpers and non-text results', () => {
    expect(() => evaluateCustomRuleExpression('unknown(originalStem)', baseContext)).toThrow(
      /Unknown helper/,
    );
    expect(() => evaluateCustomRuleExpression('len(currentStem)', baseContext)).toThrow(
      /must return text/,
    );
  });

  it('reports invalid regular expressions in regexReplace', () => {
    expect(() =>
      evaluateCustomRuleExpression('regexReplace(currentStem, "[", "-")', baseContext),
    ).toThrow(/regexReplace failed/);
  });

  it('passes the extension without a leading dot, matching the engine', () => {
    expect(evaluateCustomRuleExpression('extension', baseContext)).toBe('txt');
    expect(evaluateCustomRuleExpression('currentStem + ext(extension)', baseContext)).toBe('My File.txt');
  });

  it('caps pad width and text length', () => {
    expect(evaluateCustomRuleExpression('pad(index, 255)', baseContext)).toHaveLength(255);
    expect(() => evaluateCustomRuleExpression('pad(index, 256)', baseContext)).toThrow(/between 0 and 255/);
    expect(() => evaluateCustomRuleExpression('pad(index, 10000000000)', baseContext)).toThrow(/between 0 and 255/);
    expect(() =>
      evaluateCustomRuleExpression(
        'replaceAll(replaceAll(replaceAll(pad("", 255, "a"), "a", pad("", 255, "a")), "a", "aa"), "a", "aa")',
        baseContext,
      ),
    ).toThrow(/longer than 4096 characters/);
  });

  it('does not resolve identifiers or helpers through Object.prototype', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(() => evaluateCustomRuleExpression(name, baseContext)).toThrow(/Unknown value/);
      expect(() => evaluateCustomRuleExpression(`${name}(currentStem)`, baseContext)).toThrow(/Unknown helper/);
    }
  });

  it('keeps the compiled expression cache bounded', () => {
    for (let index = 0; index < 500; index += 1) {
      evaluateCustomRuleExpression(`currentStem + "${index}"`, baseContext);
    }
    expect(getCompiledExpressionCacheSize()).toBeLessThanOrEqual(100);
  });

  it('limits regexReplace pattern length', () => {
    expect(() =>
      evaluateCustomRuleExpression(`regexReplace(currentStem, "${'a'.repeat(1001)}", "-")`, baseContext),
    ).toThrow(/longer than 1000 characters/);
  });

  it('uses the supplied path flavour for basename and dirname', () => {
    const context = { ...baseContext, sourcePath: 'C:\\Data\\My File.txt' };
    expect(evaluateCustomRuleExpression('basename(sourcePath)', context, { pathApi: path.win32 })).toBe('My File.txt');
    expect(evaluateCustomRuleExpression('dirname(sourcePath)', context, { pathApi: path.win32 })).toBe('C:\\Data');
  });
});
