# Public API reference

[Documentation home](../README.md) · [Rules](rules.md) · [Expressions](custom-expressions.md) · [Planning](planning.md)

This reference covers the exports of v0.2.0. All runtime APIs are synchronous. TypeScript types are included in the package.

## Import surfaces

| Package entry | Runtime exports | Type exports |
| --- | --- | --- |
| `@fastrenamer/rename-engine` | `generatePreview`, `applyRulesToName`, `splitName`, `normalizePathKey`, four limit constants, and all five sorting functions below | All shared types, `NameParts`, `GeneratePreviewOptions`, `ApplyRulesContext`, `SortablePathItem`, `SortItemsOptions` |
| `@fastrenamer/rename-engine/sort` | `compareCodePoints`, `compareNatural`, `compareAlphabetic`, `compareItemsBySortMode`, `sortItemsByMode` | `SortablePathItem`, `SortItemsOptions` |
| `@fastrenamer/rename-engine/types` | No meaningful runtime values | All types declared in `src/types.ts`, listed below |

```ts
import { generatePreview, MAX_NAME_LENGTH, type RenameRule } from '@fastrenamer/rename-engine';
import { sortItemsByMode, type SortItemsOptions } from '@fastrenamer/rename-engine/sort';
import type { PreviewResult } from '@fastrenamer/rename-engine/types';
```

There are no supported `custom-rule`, `path-key`, or `limits` subpath exports. `evaluateCustomRuleExpression`, `EvaluateCustomRuleOptions`, `getCompiledExpressionCacheSize`, `PathApi`, `getPathApi`, `normalizeFsPath`, `isCaseInsensitive`, and `isNormalizationInsensitive` are internal, even though some are exported between source modules.

## `generatePreview(options): PreviewResult`

```ts
interface GeneratePreviewOptions {
  items: ResolvedRenameItem[];
  rules: RenameRule[];
  platform: PlatformTarget;
  sortMode: SortMode;
  existingPathExists?: (candidatePath: string) => boolean;
}
```

| Option | Meaning |
| --- | --- |
| `items` | Caller-resolved batch. The engine does not discover or filter items. |
| `rules` | Ordered rule list. Disabled rules are skipped. |
| `platform` | Target name validation, path syntax, case matching, and Unicode matching. Required. |
| `sortMode` | Requested base ordering; ancestors are additionally placed before descendants. Required. |
| `existingPathExists` | Optional synchronous external occupancy check, cached by target key for this call. |

Returns a new result with rows in final sort order and a summary. It does not mutate the input array or perform filesystem operations. Empty input returns empty rows, zero counts, and `blocked: false`.

Rule application failures become `invalid` rows; the proposed name is the name immediately before the failing rule and later rules do not run for that item. Invalid rule configuration does not throw from this function. Malformed structural inputs, sorting/path failures, and callback exceptions can still throw. Input is a typed contract, not a runtime schema validator.

See [planning](planning.md) for conflict priority, normalization, and diagnostic strings, and the [guide](guide.md) for examples.

### `ResolvedRenameItem`

```ts
interface ResolvedRenameItem {
  sourcePath: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}
```

Provide consistent absolute paths and a basename without a directory prefix. `isDirectory` controls extension splitting and extension rules; no filesystem stat is performed.

### `PreviewResult`, `PreviewRow`, and `PreviewSummary`

`PreviewResult` is `{ rows: PreviewRow[]; summary: PreviewSummary }`.

| `PreviewRow` field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Key of the normalized source path. Duplicate keys receive collision-free `#n` suffixes beginning at 2. An identifier, not necessarily an executable path. |
| `sourcePath` | `string` | Original caller-supplied source spelling; not rewritten to normalized filesystem syntax. |
| `nextPath` | `string` | Computed normalized final path under renamed ancestors. |
| `originalName` | `string` | Caller-supplied `name`. |
| `proposedName` | `string` | Transformed basename, including extension for files. |
| `directoryPath` | `string` | Caller-supplied `parentPath`. |
| `finalDirectoryPath` | `string` | Resolved final directory based on the source path's directory and batch ancestor targets. |
| `pathContext` | `string` | Target relative to normalized input `parentPath`, or `proposedName` if that relative value is empty. Can contain `..` after ancestor moves. |
| `isDirectory` | `boolean` | Input item kind. |
| `changed` | `boolean` | Normalized original path differs exactly from `nextPath`, including case/Unicode spelling. Independent of status. |
| `status` | `'ok' \| 'conflict' \| 'invalid' \| 'unchanged'` | Final status; precedence is invalid, conflict, changed/ok, unchanged. |
| `reasons` | `string[]` | Validation, rule, conflict, or advisory messages. May be empty for unchanged rows and nonempty for ok rows. |

| `PreviewSummary` field | Type | Meaning |
| --- | --- | --- |
| `total` | `number` | Number of rows, including duplicate sources. |
| `changed` | `number` | Rows with `changed: true`, including blocked rows. |
| `ok` | `number` | Rows with status ok. |
| `conflict` | `number` | Rows with status conflict. |
| `invalid` | `number` | Rows with status invalid. |
| `unchanged` | `number` | Rows with status unchanged. |
| `blocked` | `boolean` | At least one conflict or invalid row. |

Status counts sum to `total`. `changed` is a separate count and need not equal `ok`.

## `applyRulesToName(originalName, isDirectory, rules, context, now?): string`

```ts
interface ApplyRulesContext {
  index: number;
  total: number;
  originalName: string;
  parentPath: string;
  sourcePath?: string;
  platform?: PlatformTarget;
}
```

Applies enabled rules in order, returning the joined stem/extension. The positional `originalName` argument is the actual original name used by rules; provide the same value in `context.originalName` for consistency (the current implementation does not read that context field).

| Context field | Meaning |
| --- | --- |
| `index` | Zero-based batch index for sequences and expression `zeroIndex`. |
| `total` | Batch size for reverse sequences and custom `total`. |
| `originalName` | Required contract field; see note above. |
| `parentPath` | Parent path for template parent tokens and expression `parent`. |
| `sourcePath` | Custom `sourcePath`; defaults to joining `parentPath` and positional `originalName`. |
| `platform` | Optional target path syntax for parent tokens and path helpers; omission uses host `node:path`. |

`now` is a `Date`, defaulting to a new current date. Date/time rendering uses local time. The function does not sort, validate final names, calculate paths, or detect conflicts. It throws on rule failures; error messages are wrapped as described in [diagnostics](planning.md#diagnostics).

## `splitName(name: string, isDirectory: boolean): NameParts`

```ts
interface NameParts { stem: string; extension: string }
```

Directories always have `{ stem: name, extension: '' }`. Files split at the last dot only when that dot is beyond index zero. Extensions exclude the leading dot.

| Input (file) | Stem | Extension |
| --- | --- | --- |
| `archive.tar.gz` | `archive.tar` | `gz` |
| `.gitignore` | `.gitignore` | empty |
| `.config.json` | `.config` | `json` |
| `report.` | `report` | empty |
| `report` | `report` | empty |

Joining a trailing-dot file loses that dot, so an empty rule list can still change `report.` into `report`. A custom rule returns a whole name and splits it again; `new_name` replaces only the current stem.

## `normalizePathKey(candidatePath: string, platform: PlatformTarget): string`

Comparison helper: NFC-normalizes only on `darwin`; lowercases using `toLowerCase()` on `darwin` and `win32`; leaves `linux` unchanged. Does not normalize separators, relative segments, or trailing slashes. Normalize filesystem syntax before using it for an external path index.

```ts
normalizePathKey('/d/A.txt', 'darwin'); // '/d/a.txt'
normalizePathKey('/d/A.txt', 'linux');  // '/d/A.txt'
```

Keys are the engine's platform model, not a query of actual filesystem case/normalization settings.

## Sorting functions

```ts
interface SortablePathItem {
  sourcePath?: string;
  path?: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}
interface SortItemsOptions { platform?: PlatformTarget }
```

At least one nonempty `sourcePath` or `path` is required. `sourcePath` takes precedence via nullish coalescing; an empty `sourcePath` does not fall back to `path` and throws. The error is `Sortable item is missing both sourcePath and path.`

| Function | Signature and behavior |
| --- | --- |
| `compareCodePoints` | `(left: string, right: string): number`; Unicode code point ordering, returns -1/0/1. |
| `compareNatural` | `(left: string, right: string): number`; fixed `en`, numeric collation, base sensitivity, then code point tie-break. |
| `compareAlphabetic` | `(left: string, right: string): number`; fixed `en`, nonnumeric collation, base sensitivity, then code point tie-break. |
| `compareItemsBySortMode` | `(left: SortablePathItem, right: SortablePathItem, sortMode: SortMode): number`; base ordering only, without ancestor adjustment. |
| `sortItemsByMode` | `<T extends SortablePathItem>(items: T[], sortMode: SortMode, options?: SortItemsOptions): T[]`; new sorted array, original object references, then ancestor directories before descendants. |

Treat comparator results by sign, not exact magnitude (except `compareCodePoints`). Natural ordering places `file2` before `file10`; alphabetic ordering places `file10` before `file2`.

`SortItemsOptions.platform` affects ancestry matching, not collation. With it omitted, path segments are compared exactly and both `/` and `\` are separators. With `linux`/`darwin`, only `/` separates segments; with `win32`, both do. Segment matching follows platform keys when provided. The sorting helper skips empty and `.` segments but does not resolve `..` like a full path normalizer.

### `SortMode` and `PlatformTarget`

```ts
type PlatformTarget = 'darwin' | 'win32' | 'linux';
type SortMode = 'natural_path' | 'alphabetic_path' | 'name_only' | 'folder_then_name';
```

| Sort mode | Base comparison priority |
| --- | --- |
| `natural_path` | Full path, naturally |
| `alphabetic_path` | Full path, alphabetically |
| `name_only` | Name, parent path, full path; all naturally |
| `folder_then_name` | Parent path, name, full path; all naturally |

Remaining ties compare full path, name, and parent path by code point, then directories before files. Indistinguishable items can still compare equal. Hierarchy adjustment occurs only in `sortItemsByMode`, used by `generatePreview`.

## Constants

| Export | Value | Meaning |
| --- | --- | --- |
| `MAX_NAME_LENGTH` | `255` | Final basename limit, bytes on POSIX or UTF-16 units on Windows. |
| `MAX_PAD_WIDTH` | `255` | Numeric sequence/custom helper padding cap. |
| `MAX_REGEX_PATTERN_LENGTH` | `1000` | User regex pattern `.length` cap. |
| `MAX_CUSTOM_RULE_TEXT_LENGTH` | `4096` | Custom helper-result and concatenation `.length` cap. |

These are runtime numbers and can be imported from the root. They are not global limits on all rules, templates, expression sources, or batches.

## Rule type exports

`BaseRule` is `{ id: string; enabled: boolean; label?: string }`. `RenameRule` is the discriminated union of `NewNameRule`, `CustomRule`, `FindReplaceRule`, `PrefixSuffixRule`, `CaseTransformRule`, `TrimTextRule`, `RemoveTextRule`, `SequenceInsertRule`, `LetterSequenceInsertRule`, `DateTimeRule`, and `ExtensionHandlingRule`.

Every variant's full fields and behavior are in the [rule reference](rules.md). `id` and `label` are caller metadata, not ordering keys; a trimmed label is used in generic rule error messages.

## Shared application contracts

The following types are also exported by the root and `/types`. They define Fast Renamer application data; the engine does not implement the corresponding picker, directory listing, filtering, persistence, execute, or undo operations. Timestamp fields are plain strings with no enforced format, and numeric identifiers are not allocated by the engine.

### Source selection

```ts
interface SourceSelection {
  path: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}
interface DirectoryListing {
  sourcePath: string;
  directChildren: number;
  recursiveChildren: number;
  items: SourceSelection[];
}
type SourceMode =
  | 'picked_folders' | 'picked_files'
  | 'top_level_folders' | 'subfolders'
  | 'top_level_files' | 'files_recursive';
interface PickSourcesRequest { mode: SourceMode }
```

The mode names describe application selection strategies; they do not trigger traversal in this module. To adapt a `SourceSelection` to `ResolvedRenameItem`, map `path` to `sourcePath` and retain the other fields.

### Application preview and execution

```ts
interface PreviewRequest {
  sourcePaths: string[];
  sourceMode: SourceMode;
  fileNamePattern: string;
  sortMode: SortMode;
  rules: RenameRule[];
  platform: PlatformTarget;
}
interface ExecuteRenameBatchRequest extends PreviewRequest {}
interface ExecuteRenameBatchResult extends PreviewResult {
  batchId: number | null;
  renamedCount: number;
  blocked: boolean;
  errors: string[];
}
interface RenameBatchRecord {
  sourcePath: string;
  targetPath: string;
  isDirectory: boolean;
}
```

`PreviewRequest` is not `GeneratePreviewOptions`: the caller must resolve its source paths/mode/pattern into `items`. `fileNamePattern` has no parser in this package. Execution results add an application batch id, actual rename count, execution blocking flag, and errors to the preview; they are not returned by `generatePreview`.

### Undo

```ts
interface UndoRenameBatchRequest { batchId: number }
interface UndoRenameBatchResult {
  batchId: number;
  restoredCount: number;
  success: boolean;
  errors: string[];
}
```

The application owns the batch record and restoration logic. The planner provides no inverse-plan generator or undo implementation.

### Presets and history

```ts
interface Preset {
  id: number;
  name: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  rules: RenameRule[];
}
interface HistoryEntry {
  id: number;
  createdAt: string;
  renamedCount: number;
  sourceRoots: string[];
  rules: RenameRule[];
  previewSummary: PreviewSummary;
  canUndo: boolean;
  undoState: 'ready' | 'archived' | 'overlap' | 'missing' | 'occupied';
  undoReason?: string;
}
```

The application determines undo eligibility and these state values. Storing a preset or history entry does not cause any planner behavior by itself.
