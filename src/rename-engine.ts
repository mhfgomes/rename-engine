import path from 'node:path';
import type {
  CaseTransformRule,
  PlatformTarget,
  PreviewResult,
  PreviewRow,
  RenameRule,
  ResolvedRenameItem,
  SortMode,
} from './types.js';
import { evaluateCustomRuleExpression } from './custom-rule.js';
import { sortItemsByMode } from './sort.js';

export interface NameParts {
  stem: string;
  extension: string;
}

export interface GeneratePreviewOptions {
  items: ResolvedRenameItem[];
  rules: RenameRule[];
  platform: PlatformTarget;
  sortMode: SortMode;
  existingPathExists?: (candidatePath: string) => boolean;
}

export interface ApplyRulesContext {
  index: number;
  total: number;
  originalName: string;
  parentPath: string;
  sourcePath?: string;
}

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function isCaseInsensitive(platform: PlatformTarget) {
  return platform === 'darwin' || platform === 'win32';
}

export function normalizePathKey(candidatePath: string, platform: PlatformTarget) {
  return isCaseInsensitive(platform) ? candidatePath.toLocaleLowerCase() : candidatePath;
}

function normalizeNameKey(name: string, platform: PlatformTarget) {
  return isCaseInsensitive(platform) ? name.toLocaleLowerCase() : name;
}

export function splitName(name: string, isDirectory: boolean): NameParts {
  if (isDirectory) {
    return { stem: name, extension: '' };
  }

  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) {
    return { stem: name, extension: '' };
  }

  return {
    stem: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1),
  };
}

function joinName(parts: NameParts, isDirectory: boolean) {
  if (isDirectory || !parts.extension) {
    return parts.stem;
  }

  return `${parts.stem}.${parts.extension}`;
}

class RenameRuleExecutionError extends Error {
  currentName: string;

  constructor(message: string, currentName: string) {
    super(message);
    this.name = 'RenameRuleExecutionError';
    this.currentName = currentName;
  }
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/g)
    .filter(Boolean);
}

function applyCaseTransform(value: string, mode: CaseTransformRule['mode']) {
  switch (mode) {
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'title':
      return titleCase(value);
    case 'sentence': {
      const lower = value.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    case 'camel': {
      const segments = words(value).map((segment) => segment.toLowerCase());
      return segments
        .map((segment, index) =>
          index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
        )
        .join('');
    }
    case 'pascal':
      return words(value)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join('');
    case 'kebab':
      return words(value)
        .map((segment) => segment.toLowerCase())
        .join('-');
    case 'snake':
      return words(value)
        .map((segment) => segment.toLowerCase())
        .join('_');
  }

  return value;
}

function formatDateToken(now: Date, format: string) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return format
    .replaceAll('YYYY', String(now.getFullYear()))
    .replaceAll('MM', pad(now.getMonth() + 1))
    .replaceAll('DD', pad(now.getDate()))
    .replaceAll('HH', pad(now.getHours()))
    .replaceAll('mm', pad(now.getMinutes()))
    .replaceAll('ss', pad(now.getSeconds()));
}

function applyTokenAtPosition(
  parts: NameParts,
  isDirectory: boolean,
  position: 'prefix' | 'suffix' | 'before_extension',
  token: string,
  separator: string,
) {
  const decoratedSuffix = separator ? `${separator}${token}` : token;
  const decoratedPrefix = separator ? `${token}${separator}` : token;

  if (position === 'prefix') {
    return splitName(`${decoratedPrefix}${joinName(parts, isDirectory)}`, isDirectory);
  }

  if (position === 'before_extension') {
    return {
      stem: `${parts.stem}${decoratedSuffix}`,
      extension: parts.extension,
    };
  }

  return splitName(`${joinName(parts, isDirectory)}${decoratedSuffix}`, isDirectory);
}

function formatSequenceToken(index: number, argument?: string) {
  if (!argument || !/^\d+$/.test(argument)) {
    return String(index + 1);
  }

  const start = Number(argument);
  const nextValue = start + index;
  const padWidth = argument.length > 1 || argument.startsWith('0') ? argument.length : 0;
  return padWidth > 0 ? String(nextValue).padStart(padWidth, '0') : String(nextValue);
}

function formatLetterSequence(value: number, casing: 'upper' | 'lower') {
  const alphabetStart = casing === 'upper' ? 65 : 97;
  const normalizedValue = Math.max(1, Math.floor(value));
  let remaining = normalizedValue;
  let sequence = '';

  while (remaining > 0) {
    remaining -= 1;
    sequence = String.fromCharCode(alphabetStart + (remaining % 26)) + sequence;
    remaining = Math.floor(remaining / 26);
  }

  return sequence;
}

function parseLetterSequenceCasing(argument?: string): 'upper' | 'lower' {
  const normalizedArgument = argument?.toLowerCase();
  return normalizedArgument === 'lower' || normalizedArgument === 'a' ? 'lower' : 'upper';
}

function renderNewNameTemplate(
  template: string,
  currentParts: NameParts,
  originalName: string,
  isDirectory: boolean,
  context: ApplyRulesContext,
  now: Date,
  reverseSequence = false,
) {
  const originalParts = splitName(originalName, isDirectory);
  const parentName = path.basename(context.parentPath);
  const sequenceIndex = reverseSequence ? Math.max(0, context.total - context.index - 1) : context.index;
  const letterSequenceValue = context.index + 1;
  const reverseLetterSequenceValue = Math.max(1, context.total - context.index);

  return template.replaceAll(/\{([a-z_]+)(?::([^}]+))?\}/gi, (token, rawKey: string, rawArg?: string) => {
    const key = rawKey.toLowerCase();
    switch (key) {
      case 'current':
      case 'current_stem':
        return currentParts.stem;
      case 'original':
      case 'original_stem':
        return originalParts.stem;
      case 'parent':
      case 'parent_name':
        return parentName;
      case 'seq':
      case 'seq_num':
        return formatSequenceToken(sequenceIndex, rawArg);
      case 'seq_letter':
      case 'letter_seq':
        return formatLetterSequence(letterSequenceValue, parseLetterSequenceCasing(rawArg));
      case 'seq_letter_rev':
      case 'seq_letter_reverse':
      case 'reverse_seq_letter':
      case 'reverse_letter_seq':
        return formatLetterSequence(reverseLetterSequenceValue, parseLetterSequenceCasing(rawArg));
      case 'date':
        return formatDateToken(now, rawArg || 'YYYY-MM-DD');
      case 'time':
        return formatDateToken(now, rawArg || 'HHmmss');
      default:
        return token;
    }
  });
}

export function applyRulesToName(
  originalName: string,
  isDirectory: boolean,
  rules: RenameRule[],
  context: ApplyRulesContext,
  now = new Date(),
) {
  let parts = splitName(originalName, isDirectory);

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    switch (rule.type) {
      case 'new_name':
        parts.stem = renderNewNameTemplate(
          rule.template,
          parts,
          originalName,
          isDirectory,
          context,
          now,
          rule.reverseSequence,
        );
        break;
      case 'custom_rule': {
        try {
          const originalParts = splitName(originalName, isDirectory);
          const nextName = evaluateCustomRuleExpression(rule.expression, {
            currentName: joinName(parts, isDirectory),
            currentStem: parts.stem,
            extension: parts.extension,
            originalName,
            originalStem: originalParts.stem,
            originalExtension: originalParts.extension,
            parent: path.basename(context.parentPath),
            sourcePath: context.sourcePath ?? path.join(context.parentPath, originalName),
            isDirectory,
            index: context.index + 1,
            zeroIndex: context.index,
            total: context.total,
          });
          parts = splitName(nextName, isDirectory);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Custom rule failed.';
          throw new RenameRuleExecutionError(`Custom rule failed: ${message}`, joinName(parts, isDirectory));
        }
        break;
      }
      case 'find_replace': {
        if (!rule.find) {
          break;
        }

        if (rule.useRegex) {
          const flags = `${rule.matchCase ? '' : 'i'}${rule.replaceAll ? 'g' : ''}`;
          const expression = new RegExp(rule.find, flags);
          parts.stem = parts.stem.replace(expression, rule.replace);
        } else {
          const haystack = rule.matchCase ? parts.stem : parts.stem.toLocaleLowerCase();
          const needle = rule.matchCase ? rule.find : rule.find.toLocaleLowerCase();

          if (!needle) {
            break;
          }

          if (rule.replaceAll) {
            let offset = 0;
            let nextStem = '';
            while (true) {
              const matchIndex = haystack.indexOf(needle, offset);
              if (matchIndex === -1) {
                nextStem += parts.stem.slice(offset);
                break;
              }

              nextStem += parts.stem.slice(offset, matchIndex) + rule.replace;
              offset = matchIndex + needle.length;
            }
            parts.stem = nextStem;
          } else {
            const matchIndex = haystack.indexOf(needle);
            if (matchIndex !== -1) {
              parts.stem =
                parts.stem.slice(0, matchIndex) +
                rule.replace +
                parts.stem.slice(matchIndex + needle.length);
            }
          }
        }
        break;
      }
      case 'prefix_suffix':
        parts.stem = `${rule.prefix}${parts.stem}${rule.suffix}`;
        break;
      case 'case_transform':
        parts.stem = applyCaseTransform(parts.stem, rule.mode);
        break;
      case 'trim_text':
        switch (rule.mode) {
          case 'trim':
            parts.stem = parts.stem.trim();
            break;
          case 'trim_start':
            parts.stem = parts.stem.trimStart();
            break;
          case 'trim_end':
            parts.stem = parts.stem.trimEnd();
            break;
          case 'collapse_spaces':
            parts.stem = parts.stem.replace(/\s+/g, ' ').trim();
            break;
          case 'remove_spaces':
            parts.stem = parts.stem.replace(/\s+/g, '');
            break;
          case 'remove_dashes':
            parts.stem = parts.stem.replace(/-/g, '');
            break;
          case 'remove_underscores':
            parts.stem = parts.stem.replace(/_/g, '');
            break;
        }
        break;
      case 'remove_text': {
        if (!rule.text) {
          break;
        }
        const expression = new RegExp(escapeRegExp(rule.text), rule.matchCase ? 'g' : 'gi');
        parts.stem = parts.stem.replace(expression, '');
        break;
      }
      case 'sequence_insert': {
        const rawNumber = rule.start + context.index * rule.step;
        const sequence = String(rawNumber).padStart(rule.padWidth, '0');
        parts = applyTokenAtPosition(parts, isDirectory, rule.position, sequence, rule.separator);
        break;
      }
      case 'letter_sequence_insert': {
        const rawNumber = rule.start + context.index * rule.step;
        const sequence = formatLetterSequence(rawNumber, rule.casing);
        parts = applyTokenAtPosition(parts, isDirectory, rule.position, sequence, rule.separator);
        break;
      }
      case 'date_time': {
        const token = formatDateToken(now, rule.format);
        parts = applyTokenAtPosition(parts, isDirectory, rule.position, token, rule.separator);
        break;
      }
      case 'extension_handling':
        if (isDirectory) {
          break;
        }
        switch (rule.mode) {
          case 'keep':
            break;
          case 'lowercase':
            parts.extension = parts.extension.toLowerCase();
            break;
          case 'uppercase':
            parts.extension = parts.extension.toUpperCase();
            break;
          case 'replace':
            parts.extension = rule.replacement.replace(/^\./, '');
            break;
          case 'remove':
            parts.extension = '';
            break;
        }
        break;
    }
  }

  return joinName(parts, isDirectory);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateName(name: string, platform: PlatformTarget, isDirectory: boolean) {
  const issues: string[] = [];
  if (!name.trim()) {
    issues.push('Name is empty.');
  }
  if (name.includes('/') || name.includes('\0')) {
    issues.push('Name contains unsupported path characters.');
  }

  if (platform === 'win32') {
    if (/[<>:"\\|?*]/.test(name)) {
      issues.push('Name contains Windows-reserved characters.');
    }
    if (/[. ]$/.test(name)) {
      issues.push('Windows names cannot end with a space or period.');
    }
    const basename = isDirectory ? name : splitName(name, false).stem;
    if (WINDOWS_RESERVED_NAMES.has(basename.toLowerCase())) {
      issues.push('Name is reserved on Windows.');
    }
  }

  if (name === '.' || name === '..') {
    issues.push('Dot-only names are not allowed.');
  }

  return issues;
}

export function generatePreview(options: GeneratePreviewOptions): PreviewResult {
  const { items, rules, platform, sortMode, existingPathExists } = options;
  const rowMap = new Map<string, PreviewRow>();
  const sourceKeys = new Set<string>();
  const existingCache = new Map<string, boolean>();
  const resolvedDirectoryCache = new Map<string, string>();
  const invalidIds = new Set<string>();
  const conflictIds = new Set<string>();

  const orderedItems = sortItemsByMode(items, sortMode);

  for (const item of orderedItems) {
    const sourceKey = normalizePathKey(item.sourcePath, platform);
    sourceKeys.add(sourceKey);
  }

  const resolveDirectoryPath = (directoryPath: string): string => {
    const directoryKey = normalizePathKey(directoryPath, platform);
    const cached = resolvedDirectoryCache.get(directoryKey);
    if (cached) {
      return cached;
    }

    const directoryRow = rowMap.get(directoryKey);
    if (directoryRow) {
      resolvedDirectoryCache.set(directoryKey, directoryRow.nextPath);
      return directoryRow.nextPath;
    }

    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) {
      resolvedDirectoryCache.set(directoryKey, directoryPath);
      return directoryPath;
    }

    const resolvedParentPath = resolveDirectoryPath(parentPath);
    const resolved =
      resolvedParentPath === parentPath
        ? directoryPath
        : path.join(resolvedParentPath, path.basename(directoryPath));
    resolvedDirectoryCache.set(directoryKey, resolved);
    return resolved;
  };

  const resolveFinalDirectoryPath = (item: ResolvedRenameItem): string => {
    return resolveDirectoryPath(item.parentPath);
  };

  orderedItems.forEach((item, index) => {
    let proposedName = item.name;
    const executionReasons: string[] = [];

    try {
      proposedName = applyRulesToName(item.name, item.isDirectory, rules, {
        index,
        total: orderedItems.length,
        originalName: item.name,
        parentPath: item.parentPath,
        sourcePath: item.sourcePath,
      });
    } catch (error) {
      if (error instanceof RenameRuleExecutionError) {
        proposedName = error.currentName;
        executionReasons.push(error.message);
      } else {
        throw error;
      }
    }

    const finalDirectoryPath = resolveFinalDirectoryPath(item);
    const nextPath = path.join(finalDirectoryPath, proposedName);
    const changed = item.sourcePath !== nextPath;
    const reasons = [...executionReasons, ...validateName(proposedName, platform, item.isDirectory)];
    const rowId = normalizePathKey(item.sourcePath, platform);
    if (reasons.length > 0) {
      invalidIds.add(rowId);
    }

    const row: PreviewRow = {
      id: rowId,
      sourcePath: item.sourcePath,
      nextPath,
      originalName: item.name,
      proposedName,
      directoryPath: item.parentPath,
      finalDirectoryPath,
      pathContext: path.relative(item.parentPath, nextPath) || proposedName,
      isDirectory: item.isDirectory,
      changed,
      status: 'unchanged',
      reasons,
    };

    rowMap.set(row.id, row);
  });

  const destinationMap = new Map<string, PreviewRow[]>();
  for (const row of rowMap.values()) {
    const nextKey = normalizePathKey(row.nextPath, platform);
    const rows = destinationMap.get(nextKey) ?? [];
    rows.push(row);
    destinationMap.set(nextKey, rows);
  }

  for (const row of rowMap.values()) {
    const nextKey = normalizePathKey(row.nextPath, platform);
    const destinationRows = destinationMap.get(nextKey) ?? [];

    if (invalidIds.has(row.id)) {
      continue;
    }

    if (destinationRows.length > 1) {
      conflictIds.add(row.id);
      row.reasons.push('Another item in the batch resolves to the same final path.');
    }

    if (row.changed && existingPathExists) {
      let exists = existingCache.get(nextKey);
      if (exists === undefined) {
        exists = existingPathExists(row.nextPath);
        existingCache.set(nextKey, exists);
      }

      if (exists && !sourceKeys.has(nextKey)) {
        conflictIds.add(row.id);
        row.reasons.push('Target path already exists outside the current batch.');
      }
    }

    if (
      !invalidIds.has(row.id) &&
      !conflictIds.has(row.id) &&
      row.changed &&
      isCaseInsensitive(platform) &&
      normalizeNameKey(row.originalName, platform) === normalizeNameKey(row.proposedName, platform)
    ) {
      row.reasons.push('Case-only rename will be staged safely during execution.');
    }
  }

  const rows = [...rowMap.values()];
  for (const row of rows) {
    row.status = invalidIds.has(row.id)
      ? 'invalid'
      : conflictIds.has(row.id)
        ? 'conflict'
        : row.changed
          ? 'ok'
          : 'unchanged';
  }

  const summary = {
    total: rows.length,
    changed: rows.filter((row) => row.changed).length,
    ok: rows.filter((row) => row.status === 'ok').length,
    conflict: rows.filter((row) => row.status === 'conflict').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    unchanged: rows.filter((row) => row.status === 'unchanged').length,
    blocked: rows.some((row) => row.status === 'conflict' || row.status === 'invalid'),
  };

  return { rows, summary };
}
