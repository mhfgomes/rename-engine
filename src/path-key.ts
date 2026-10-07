import path from 'node:path';
import type { PlatformTarget } from './types.js';

// Keep published declarations independent of @types/node. Only expose the
// operations the engine needs, while using Node's implementation at runtime.
export interface PathApi {
  basename(path: string, suffix?: string): string;
  dirname(path: string): string;
  join(...paths: string[]): string;
  normalize(path: string): string;
  parse(path: string): { root: string };
  relative(from: string, to: string): string;
  sep: string;
}

export function isCaseInsensitive(platform: PlatformTarget | undefined) {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Whether the platform's default filesystem treats canonically equivalent Unicode spellings
 * (for example NFD and NFC `é`) as the same name. APFS and HFS+ do; ext4/btrfs on Linux and
 * NTFS on Windows store them as distinct entries.
 */
export function isNormalizationInsensitive(platform: PlatformTarget | undefined) {
  return platform === 'darwin';
}

/**
 * Builds a comparison key for a path or name. Keys are NFC-normalized on `darwin`, where
 * canonically equivalent spellings name the same file, and keep their exact code points elsewhere
 * so distinct entries are never merged. They are lowercased with locale-independent rules on
 * case-insensitive platforms.
 */
export function normalizePathKey(candidatePath: string, platform: PlatformTarget) {
  const normalized = isNormalizationInsensitive(platform)
    ? candidatePath.normalize('NFC')
    : candidatePath;
  return isCaseInsensitive(platform) ? normalized.toLowerCase() : normalized;
}

export function getPathApi(platform: PlatformTarget | undefined): PathApi {
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
