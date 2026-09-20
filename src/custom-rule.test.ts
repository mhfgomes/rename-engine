import { describe, expect, it } from 'vitest';
import { evaluateCustomRuleExpression } from './custom-rule.js';

const baseContext = {
  currentName: 'My File.txt',
  currentStem: 'My File',
  extension: '.txt',
  originalName: 'My File.txt',
  originalStem: 'My File',
  originalExtension: '.txt',
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
});
