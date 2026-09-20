import type { SortMode } from './types.js';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const alphabeticCollator = new Intl.Collator(undefined, {
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

function getItemPath(item: SortablePathItem) {
  const candidatePath = item.sourcePath ?? item.path;
  if (!candidatePath) {
    throw new Error('Sortable item is missing both sourcePath and path.');
  }

  return candidatePath;
}

function splitPathSegments(candidatePath: string) {
  return candidatePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function isAncestorDirectory(left: SortablePathItem, right: SortablePathItem) {
  if (!left.isDirectory) {
    return false;
  }

  const leftSegments = splitPathSegments(getItemPath(left));
  const rightSegments = splitPathSegments(getItemPath(right));
  if (leftSegments.length >= rightSegments.length) {
    return false;
  }

  return leftSegments.every((segment, index) => segment === rightSegments[index]);
}

function compareHierarchy(left: SortablePathItem, right: SortablePathItem) {
  if (isAncestorDirectory(left, right)) {
    return -1;
  }

  if (isAncestorDirectory(right, left)) {
    return 1;
  }

  return 0;
}

export function compareNatural(left: string, right: string) {
  return naturalCollator.compare(left, right);
}

export function compareAlphabetic(left: string, right: string) {
  return alphabeticCollator.compare(left, right);
}

export function compareItemsBySortMode(
  left: SortablePathItem,
  right: SortablePathItem,
  sortMode: SortMode,
) {
  const hierarchyResult = compareHierarchy(left, right);
  if (hierarchyResult !== 0) {
    return hierarchyResult;
  }

  const leftPath = getItemPath(left);
  const rightPath = getItemPath(right);

  switch (sortMode) {
    case 'alphabetic_path':
      return compareAlphabetic(leftPath, rightPath);
    case 'name_only':
      return (
        compareNatural(left.name, right.name) ||
        compareNatural(left.parentPath, right.parentPath) ||
        compareNatural(leftPath, rightPath)
      );
    case 'folder_then_name':
      return (
        compareNatural(left.parentPath, right.parentPath) ||
        compareNatural(left.name, right.name) ||
        compareNatural(leftPath, rightPath)
      );
    case 'natural_path':
    default:
      return compareNatural(leftPath, rightPath);
  }
}

export function sortItemsByMode<T extends SortablePathItem>(items: T[], sortMode: SortMode) {
  return [...items].sort((left, right) => compareItemsBySortMode(left, right, sortMode));
}
