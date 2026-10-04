import path from 'node:path';
import type { PlatformTarget } from './types.js';

export function isCaseInsensitive(platform: PlatformTarget | undefined) {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Builds a comparison key for a path or name. Keys are NFC-normalized on every platform so
 * canonically equivalent spellings (for example NFD and NFC `é`) compare equal, and are
 * lowercased with locale-independent rules on case-insensitive platforms.
 */
export function normalizePathKey(candidatePath: string, platform: PlatformTarget) {
  const normalized = candidatePath.normalize('NFC');
  return isCaseInsensitive(platform) ? normalized.toLowerCase() : normalized;
}

export function getPathApi(platform: PlatformTarget | undefined) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * Normalizes redundant separators and `.` segments and drops trailing separators (except for
 * filesystem roots) using the path flavour of the target platform.
 */
export function normalizeFsPath(candidatePath: string, platform: PlatformTarget) {
  const pathApi = getPathApi(platform);
  const normalized = pathApi.normalize(candidatePath);
  const root = pathApi.parse(normalized).root;
  if (normalized.length <= root.length) {
    return normalized;
  }

  let end = normalized.length;
  while (end > root.length && normalized[end - 1] === pathApi.sep) {
    end -= 1;
  }
  return normalized.slice(0, end);
}
