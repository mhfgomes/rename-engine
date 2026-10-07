import { normalizePathKey } from './path-key.js';
import type { PlatformTarget, SortMode } from './types.js';

// A fixed locale keeps ordering identical across machines regardless of the host locale.
const naturalCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

const alphabeticCollator = new Intl.Collator('en', {
  numeric: false,
  sensitivity: 'base',
});

export interface SortablePathItem {
  sourcePath?: string;
  path?: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}

export interface SortItemsOptions {
  /**
   * Target platform used to detect ancestor directories. Segments are compared with
   * `normalizePathKey`, so ancestry is case-insensitive on darwin and win32 and
   * normalization-insensitive only on darwin. When omitted, segments are compared exactly and
   * both `/` and `\` are treated as separators.
   */
  platform?: PlatformTarget;
}

function getItemPath(item: SortablePathItem) {
  const candidatePath = item.sourcePath ?? item.path;
  if (!candidatePath) {
    throw new Error('Sortable item is missing both sourcePath and path.');
  }

  return candidatePath;
}

function splitPathSegments(candidatePath: string, platform: PlatformTarget | undefined) {
  const separators = platform === undefined || platform === 'win32' ? /[\\/]+/ : /\/+/;
  return candidatePath
    .split(separators)
    .filter((segment) => segment !== '' && segment !== '.');
}

function getAncestryKey(candidatePath: string, platform: PlatformTarget | undefined) {
  const segments = splitPathSegments(candidatePath, platform);
  return segments.map((segment) => (platform ? normalizePathKey(segment, platform) : segment));
}

/** Compares two strings by Unicode code point. Used as the final, deterministic tie-break. */
export function compareCodePoints(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex) as number;
    const rightCodePoint = right.codePointAt(rightIndex) as number;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }

  if (leftIndex < left.length) {
    return 1;
  }
  if (rightIndex < right.length) {
    return -1;
  }
  return 0;
}

export function compareNatural(left: string, right: string) {
  return naturalCollator.compare(left, right) || compareCodePoints(left, right);
}

export function compareAlphabetic(left: string, right: string) {
  return alphabeticCollator.compare(left, right) || compareCodePoints(left, right);
}

/**
 * Total-order comparator for a sort mode. It does not encode hierarchy; use `sortItemsByMode`
 * to additionally guarantee that ancestor directories come before their descendants.
 */
export function compareItemsBySortMode(
  left: SortablePathItem,
  right: SortablePathItem,
  sortMode: SortMode,
) {
  const leftPath = getItemPath(left);
  const rightPath = getItemPath(right);

  let result: number;
  switch (sortMode) {
    case 'alphabetic_path':
      result = compareAlphabetic(leftPath, rightPath);
      break;
    case 'name_only':
      result =
        compareNatural(left.name, right.name) ||
        compareNatural(left.parentPath, right.parentPath) ||
        compareNatural(leftPath, rightPath);
      break;
    case 'folder_then_name':
      result =
        compareNatural(left.parentPath, right.parentPath) ||
        compareNatural(left.name, right.name) ||
        compareNatural(leftPath, rightPath);
      break;
    case 'natural_path':
    default:
      result = compareNatural(leftPath, rightPath);
      break;
  }

  return (
    result ||
    compareCodePoints(leftPath, rightPath) ||
    compareCodePoints(left.name, right.name) ||
    compareCodePoints(left.parentPath, right.parentPath) ||
    Number(right.isDirectory) - Number(left.isDirectory)
  );
}

/**
 * Sorts items with a deterministic total order, then moves every item that sits below a
 * directory in the same list after that directory. Directories keep their sorted position;
 * descendants that sorted ahead of their ancestor are emitted right after it.
 */
export function sortItemsByMode<T extends SortablePathItem>(
  items: T[],
  sortMode: SortMode,
  options: SortItemsOptions = {},
) {
  const { platform } = options;
  const sorted = [...items].sort((left, right) => compareItemsBySortMode(left, right, sortMode));

  const segmentsByItem = new Map<T, string[]>();
  const directoryIndexByKey = new Map<string, number>();
  sorted.forEach((item, index) => {
    const segments = getAncestryKey(getItemPath(item), platform);
    segmentsByItem.set(item, segments);
    if (item.isDirectory) {
      const key = segments.join('/');
      if (!directoryIndexByKey.has(key)) {
        directoryIndexByKey.set(key, index);
      }
    }
  });

  const findNearestAncestorIndex = (item: T) => {
    const segments = segmentsByItem.get(item) as string[];
    for (let length = segments.length - 1; length > 0; length -= 1) {
      const ancestorIndex = directoryIndexByKey.get(segments.slice(0, length).join('/'));
      if (ancestorIndex !== undefined) {
        return ancestorIndex;
      }
    }
    return undefined;
  };

  const emitted = new Array<boolean>(sorted.length).fill(false);
  const deferred = new Map<number, number[]>();
  const result: T[] = [];

  const emit = (index: number) => {
    const stack = [index];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      emitted[current] = true;
      result.push(sorted[current]);
      const children = deferred.get(current);
      if (children) {
        deferred.delete(current);
        for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
          stack.push(children[childIndex]);
        }
      }
    }
  };

  sorted.forEach((item, index) => {
    const ancestorIndex = findNearestAncestorIndex(item);
    if (ancestorIndex !== undefined && ancestorIndex !== index && !emitted[ancestorIndex]) {
      const pending = deferred.get(ancestorIndex) ?? [];
      pending.push(index);
      deferred.set(ancestorIndex, pending);
      return;
    }
    emit(index);
  });

  return result;
}
