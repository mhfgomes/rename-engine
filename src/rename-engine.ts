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
import { MAX_NAME_LENGTH, MAX_PAD_WIDTH, MAX_REGEX_PATTERN_LENGTH } from './limits.js';
import { getPathApi, isCaseInsensitive, normalizeFsPath, normalizePathKey } from './path-key.js';
import { computeSequenceValue, formatLetterSequence } from './sequence.js';
import { sortItemsByMode } from './sort.js';

export { normalizePathKey } from './path-key.js';
export * from './limits.js';

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
  /** Selects the path flavour used for `{parent}` and custom-rule paths. Defaults to the host. */
  platform?: PlatformTarget;
}

// Windows treats these device names as reserved regardless of extension, e.g. `CON.tar.gz`
// and `nul .txt`. Superscript digits are matched by Windows for COM/LPT as well.
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'conin$',
  'conout$',
  ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '\u00b9', '\u00b2', '\u00b3'].flatMap((suffix) => [
    `com${suffix}`,
    `lpt${suffix}`,
  ]),
]);

function normalizeNameKey(name: string, platform: PlatformTarget) {
  return normalizePathKey(name, platform);
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

function parseLetterSequenceCasing(argument?: string): 'upper' | 'lower' {
  const normalizedArgument = argument?.toLowerCase();
  return normalizedArgument === 'lower' || normalizedArgument === 'a' ? 'lower' : 'upper';
}

function resolvePathApi(platform: PlatformTarget | undefined) {
  return platform ? getPathApi(platform) : path;
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
  const parentName = resolvePathApi(context.platform).basename(context.parentPath);
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

function describeRule(rule: RenameRule) {
  const label = rule.label?.trim();
  return `Rule "${label || rule.type}"`;
}

function compileUserRegExp(pattern: string, flags: string) {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`Regular expression is longer than ${MAX_REGEX_PATTERN_LENGTH} characters.`);
  }

  return new RegExp(pattern, flags);
}

function resolvePadWidth(padWidth: number | undefined) {
  const width = padWidth ?? 0;
  if (!Number.isFinite(width) || width > MAX_PAD_WIDTH) {
    throw new Error(`Pad width must be a number no greater than ${MAX_PAD_WIDTH}.`);
  }

  return Math.max(0, Math.floor(width));
}

function formatPaddedNumber(value: number, padWidth: number) {
  const digits = String(Math.abs(value)).padStart(padWidth, '0');
  return value < 0 ? `-${digits}` : digits;
}

function applyRule(
  rule: RenameRule,
  parts: NameParts,
  originalName: string,
  isDirectory: boolean,
  context: ApplyRulesContext,
  now: Date,
): NameParts {
  switch (rule.type) {
    case 'new_name':
      return {
        stem: renderNewNameTemplate(
          rule.template,
          parts,
          originalName,
          isDirectory,
          context,
          now,
          rule.reverseSequence,
        ),
        extension: parts.extension,
      };
    case 'custom_rule': {
      try {
        const pathApi = resolvePathApi(context.platform);
        const originalParts = splitName(originalName, isDirectory);
        const nextName = evaluateCustomRuleExpression(
          rule.expression,
          {
            currentName: joinName(parts, isDirectory),
            currentStem: parts.stem,
            extension: parts.extension,
            originalName,
            originalStem: originalParts.stem,
            originalExtension: originalParts.extension,
            parent: pathApi.basename(context.parentPath),
            sourcePath: context.sourcePath ?? pathApi.join(context.parentPath, originalName),
            isDirectory,
            index: context.index + 1,
            zeroIndex: context.index,
            total: context.total,
          },
          { pathApi },
        );
        return splitName(nextName, isDirectory);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Custom rule failed.';
        throw new RenameRuleExecutionError(`Custom rule failed: ${message}`, joinName(parts, isDirectory));
      }
    }
    case 'find_replace': {
      if (!rule.find) {
        return parts;
      }

      if (rule.useRegex) {
        const flags = `${rule.matchCase ? '' : 'i'}${rule.replaceAll ? 'g' : ''}`;
        const expression = compileUserRegExp(rule.find, flags);
        return { ...parts, stem: parts.stem.replace(expression, rule.replace) };
      }

      // Literal replacement: a function replacer keeps `$` sequences in `replace` verbatim.
      if (rule.matchCase) {
        const stem = rule.replaceAll
          ? parts.stem.replaceAll(rule.find, () => rule.replace)
          : parts.stem.replace(rule.find, () => rule.replace);
        return { ...parts, stem };
      }

      // Case-insensitive matching runs on the original string so match offsets stay valid even
      // when lowercasing changes string length (for example `İ`).
      const expression = new RegExp(escapeRegExp(rule.find), rule.replaceAll ? 'giu' : 'iu');
      return { ...parts, stem: parts.stem.replace(expression, () => rule.replace) };
    }
    case 'prefix_suffix':
      return { ...parts, stem: `${rule.prefix}${parts.stem}${rule.suffix}` };
    case 'case_transform':
      return { ...parts, stem: applyCaseTransform(parts.stem, rule.mode) };
    case 'trim_text':
      switch (rule.mode) {
        case 'trim':
          return { ...parts, stem: parts.stem.trim() };
        case 'trim_start':
          return { ...parts, stem: parts.stem.trimStart() };
        case 'trim_end':
          return { ...parts, stem: parts.stem.trimEnd() };
        case 'collapse_spaces':
          return { ...parts, stem: parts.stem.replace(/\s+/g, ' ').trim() };
        case 'remove_spaces':
          return { ...parts, stem: parts.stem.replace(/\s+/g, '') };
        case 'remove_dashes':
          return { ...parts, stem: parts.stem.replace(/-/g, '') };
        case 'remove_underscores':
          return { ...parts, stem: parts.stem.replace(/_/g, '') };
      }
      return parts;
    case 'remove_text': {
      if (!rule.text) {
        return parts;
      }
      const expression = new RegExp(escapeRegExp(rule.text), rule.matchCase ? 'gu' : 'giu');
      return { ...parts, stem: parts.stem.replace(expression, '') };
    }
    case 'sequence_insert': {
      const padWidth = resolvePadWidth(rule.padWidth);
      const rawNumber = computeSequenceValue(rule.start, rule.step, context.index);
      const sequence = formatPaddedNumber(rawNumber, padWidth);
      return applyTokenAtPosition(parts, isDirectory, rule.position, sequence, rule.separator);
    }
    case 'letter_sequence_insert': {
      const rawNumber = computeSequenceValue(rule.start, rule.step, context.index);
      const sequence = formatLetterSequence(rawNumber, rule.casing);
      return applyTokenAtPosition(parts, isDirectory, rule.position, sequence, rule.separator);
    }
    case 'date_time': {
      const token = formatDateToken(now, rule.format);
      return applyTokenAtPosition(parts, isDirectory, rule.position, token, rule.separator);
    }
    case 'extension_handling':
      if (isDirectory) {
        return parts;
      }
      switch (rule.mode) {
        case 'keep':
          return parts;
        case 'lowercase':
          return { ...parts, extension: parts.extension.toLowerCase() };
        case 'uppercase':
          return { ...parts, extension: parts.extension.toUpperCase() };
        case 'replace':
          return { ...parts, extension: rule.replacement.replace(/^\./, '') };
        case 'remove':
          return { ...parts, extension: '' };
      }
      return parts;
  }

  return parts;
}

function applyRulesToParts(
  originalName: string,
  isDirectory: boolean,
  rules: RenameRule[],
  context: ApplyRulesContext,
  now: Date,
) {
  let parts = splitName(originalName, isDirectory);

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    try {
      parts = applyRule(rule, parts, originalName, isDirectory, context, now);
    } catch (error) {
      if (error instanceof RenameRuleExecutionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error.';
      throw new RenameRuleExecutionError(
        `${describeRule(rule)} failed: ${message}`,
        joinName(parts, isDirectory),
      );
    }
  }

  return parts;
}

/**
 * Applies the enabled rules in order. Throws when a rule cannot be applied (for example an
 * invalid regular expression); `generatePreview` reports such failures as invalid rows instead.
 */
export function applyRulesToName(
  originalName: string,
  isDirectory: boolean,
  rules: RenameRule[],
  context: ApplyRulesContext,
  now = new Date(),
) {
  return joinName(applyRulesToParts(originalName, isDirectory, rules, context, now), isDirectory);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const utf8Encoder = new TextEncoder();

function validateName(name: string, platform: PlatformTarget) {
  const issues: string[] = [];
  if (!name.trim()) {
    issues.push('Name is empty.');
  }
  if (name.includes('/')) {
    issues.push('Name contains unsupported path characters.');
  }
  if (/[\x00-\x1f]/.test(name)) {
    issues.push('Name contains control characters.');
  }

  if (platform === 'win32') {
    if (/[<>:"\\|?*]/.test(name)) {
      issues.push('Name contains Windows-reserved characters.');
    }
    if (/[. ]$/.test(name)) {
      issues.push('Windows names cannot end with a space or period.');
    }
    // Windows ignores everything from the first dot and trailing spaces when matching device names.
    const deviceName = name.split('.')[0].replace(/ +$/, '').toLowerCase();
    if (WINDOWS_RESERVED_NAMES.has(deviceName)) {
      issues.push('Name is reserved on Windows.');
    }
    if (name.length > MAX_NAME_LENGTH) {
      issues.push(`Name is longer than ${MAX_NAME_LENGTH} characters.`);
    }
  } else if (utf8Encoder.encode(name).length > MAX_NAME_LENGTH) {
    issues.push(`Name is longer than ${MAX_NAME_LENGTH} bytes.`);
  }

  if (name === '.' || name === '..') {
    issues.push('Dot-only names are not allowed.');
  }

  return issues;
}

interface PlannedItem {
  item: ResolvedRenameItem;
  sourcePath: string;
  parentPath: string;
  sourceKey: string;
  /** The source is a filesystem root (`/`, `C:\`, a UNC share root); it can never be renamed. */
  isRoot: boolean;
  proposedName: string;
  reasons: string[];
}

export function generatePreview(options: GeneratePreviewOptions): PreviewResult {
  const { items, rules, platform, sortMode, existingPathExists } = options;
  const pathApi = getPathApi(platform);
  const now = new Date();
  const existingCache = new Map<string, boolean>();
  const invalidIds = new Set<string>();
  const conflictIds = new Set<string>();

  const orderedItems = sortItemsByMode(items, sortMode, { platform });

  // Phase 1: compute every proposed name. Target paths are resolved afterwards so that a child
  // never depends on whether its parent row happened to be processed first.
  const plannedItems = orderedItems.map((item, index): PlannedItem => {
    const sourcePath = normalizeFsPath(item.sourcePath, platform);
    const parentPath = normalizeFsPath(item.parentPath, platform);
    const reasons: string[] = [];
    let proposedName = item.name;

    // A root is its own parent, so it has no name to change and no directory to move into.
    // Reject it up front: ownership resolution below would otherwise recurse into itself.
    if (pathApi.dirname(sourcePath) === sourcePath) {
      return {
        item,
        sourcePath,
        parentPath,
        sourceKey: normalizePathKey(sourcePath, platform),
        isRoot: true,
        proposedName,
        reasons: ['A filesystem root cannot be renamed.'],
      };
    }

    try {
      const parts = applyRulesToParts(
        item.name,
        item.isDirectory,
        rules,
        {
          index,
          total: orderedItems.length,
          originalName: item.name,
          parentPath: item.parentPath,
          sourcePath: item.sourcePath,
          platform,
        },
        now,
      );
      proposedName = joinName(parts, item.isDirectory);
      if (
        !item.isDirectory &&
        parts.extension &&
        !parts.stem.trim() &&
        splitName(item.name, false).stem.trim()
      ) {
        reasons.push('Name is empty; only the extension would remain.');
      }
    } catch (error) {
      if (error instanceof RenameRuleExecutionError) {
        proposedName = error.currentName;
        reasons.push(error.message);
      } else {
        reasons.push(`Rename rules failed: ${error instanceof Error ? error.message : 'Unknown error.'}`);
      }
    }

    for (const issue of validateName(proposedName, platform)) {
      if (!reasons.includes(issue)) {
        reasons.push(issue);
      }
    }

    return {
      item,
      sourcePath,
      parentPath,
      sourceKey: normalizePathKey(sourcePath, platform),
      isRoot: false,
      proposedName,
      reasons,
    };
  });

  const ownerByKey = new Map<string, PlannedItem>();
  const sourceKeyCounts = new Map<string, number>();
  for (const planned of plannedItems) {
    sourceKeyCounts.set(planned.sourceKey, (sourceKeyCounts.get(planned.sourceKey) ?? 0) + 1);
    if (!ownerByKey.has(planned.sourceKey)) {
      ownerByKey.set(planned.sourceKey, planned);
    }
  }

  // Phase 2: resolve targets from the parent rows' computed targets.
  const targetCache = new Map<PlannedItem, string>();
  const directoryCache = new Map<string, string>();

  const resolveDirectoryPath = (directoryPath: string): string => {
    const directoryKey = normalizePathKey(directoryPath, platform);
    const cached = directoryCache.get(directoryKey);
    if (cached !== undefined) {
      return cached;
    }

    let resolved: string;
    const owner = ownerByKey.get(directoryKey);
    if (owner?.item.isDirectory && !owner.isRoot) {
      resolved = resolveTargetPath(owner);
    } else {
      const parentPath = pathApi.dirname(directoryPath);
      if (parentPath === directoryPath) {
        resolved = directoryPath;
      } else {
        const resolvedParentPath = resolveDirectoryPath(parentPath);
        resolved =
          resolvedParentPath === parentPath
            ? directoryPath
            : pathApi.join(resolvedParentPath, pathApi.basename(directoryPath));
      }
    }

    directoryCache.set(directoryKey, resolved);
    return resolved;
  };

  const resolveFinalDirectoryPath = (planned: PlannedItem) =>
    resolveDirectoryPath(pathApi.dirname(planned.sourcePath));

  const resolveTargetPath = (planned: PlannedItem): string => {
    const cached = targetCache.get(planned);
    if (cached !== undefined) {
      return cached;
    }

    const nextPath = planned.isRoot
      ? planned.sourcePath
      : pathApi.join(resolveFinalDirectoryPath(planned), planned.proposedName);
    targetCache.set(planned, nextPath);
    return nextPath;
  };

  // Every distinct source key is reserved as the id of its first row, so a suffixed id for a
  // duplicate can never collide with a real source such as `/d/a#2`.
  const allocatedIds = new Set<string>(sourceKeyCounts.keys());
  const nextSuffixByKey = new Map<string, number>();
  const allocateRowId = (sourceKey: string) => {
    if (!nextSuffixByKey.has(sourceKey)) {
      nextSuffixByKey.set(sourceKey, 2);
      return sourceKey;
    }

    let suffix = nextSuffixByKey.get(sourceKey) as number;
    while (allocatedIds.has(`${sourceKey}#${suffix}`)) {
      suffix += 1;
    }
    const rowId = `${sourceKey}#${suffix}`;
    allocatedIds.add(rowId);
    nextSuffixByKey.set(sourceKey, suffix + 1);
    return rowId;
  };

  const rows = plannedItems.map((planned): PreviewRow => {
    const { item, sourcePath, parentPath, sourceKey, proposedName, reasons } = planned;
    const rowId = allocateRowId(sourceKey);

    const finalDirectoryPath = resolveFinalDirectoryPath(planned);
    const nextPath = resolveTargetPath(planned);
    if (reasons.length > 0) {
      invalidIds.add(rowId);
    }

    if ((sourceKeyCounts.get(sourceKey) ?? 0) > 1) {
      conflictIds.add(rowId);
      reasons.push('Another item in the batch has the same source path.');
    }

    return {
      id: rowId,
      sourcePath: item.sourcePath,
      nextPath,
      originalName: item.name,
      proposedName,
      directoryPath: item.parentPath,
      finalDirectoryPath,
      pathContext: pathApi.relative(parentPath, nextPath) || proposedName,
      isDirectory: item.isDirectory,
      changed: sourcePath !== nextPath,
      status: 'unchanged',
      reasons,
    };
  });

  // Rows that share a source path are already reported above; count distinct sources only.
  const destinationSources = new Map<string, Set<string>>();
  plannedItems.forEach((planned, index) => {
    const nextKey = normalizePathKey(rows[index].nextPath, platform);
    const sources = destinationSources.get(nextKey) ?? new Set<string>();
    sources.add(planned.sourceKey);
    destinationSources.set(nextKey, sources);
  });

  for (const row of rows) {
    const nextKey = normalizePathKey(row.nextPath, platform);

    if (invalidIds.has(row.id)) {
      continue;
    }

    if ((destinationSources.get(nextKey)?.size ?? 0) > 1) {
      conflictIds.add(row.id);
      row.reasons.push('Another item in the batch resolves to the same final path.');
    }

    if (row.changed && existingPathExists) {
      let exists = existingCache.get(nextKey);
      if (exists === undefined) {
        exists = existingPathExists(row.nextPath);
        existingCache.set(nextKey, exists);
      }

      if (exists && !ownerByKey.has(nextKey)) {
        conflictIds.add(row.id);
        row.reasons.push('Target path already exists outside the current batch.');
      }
    }

    if (
      !conflictIds.has(row.id) &&
      row.changed &&
      isCaseInsensitive(platform) &&
      normalizeNameKey(row.originalName, platform) === normalizeNameKey(row.proposedName, platform)
    ) {
      row.reasons.push('Case-only rename will be staged safely during execution.');
    }
  }

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
