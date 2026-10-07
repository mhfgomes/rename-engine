# @fastrenamer/rename-engine

The reusable planning engine behind Fast Renamer. It applies ordered rename rules, sorts input paths, validates names for a target platform, and detects destination conflicts without touching the filesystem.

## Install

```sh
npm install @fastrenamer/rename-engine
```

Node.js 20 or newer is supported. The package is ESM-only and has no runtime dependencies.

## Example

```ts
import { generatePreview, type RenameRule } from '@fastrenamer/rename-engine';

const rules: RenameRule[] = [
  {
    id: 'normalize',
    type: 'case_transform',
    enabled: true,
    mode: 'kebab',
  },
];

const preview = generatePreview({
  items: [
    {
      sourcePath: '/documents/Quarterly Report.pdf',
      parentPath: '/documents',
      name: 'Quarterly Report.pdf',
      isDirectory: false,
    },
  ],
  rules,
  sortMode: 'natural_path',
  platform: 'linux',
  existingPathExists: (candidatePath) => candidatePath === '/documents/quarterly-report.pdf',
});

console.log(preview.rows[0]);
```

`generatePreview` is synchronous and filesystem-independent. Pass `existingPathExists` when the caller wants conflicts with paths outside the batch to be detected. The engine never executes a rename.

## Planning behavior

- **Deterministic ordering.** Items are sorted with a total order (fixed `en` collation, then a Unicode code point tie-break), so the same input set always yields the same order, sequence numbers, and targets regardless of input order or host locale. Ancestor directories are then placed before their descendants, and each child's target is resolved under its parent row's computed target.
- **Path keys.** `normalizePathKey` NFC-normalizes paths on `darwin` only and lowercases them on `darwin` and `win32`. These keys are used for row ids, source matching, ancestry, and conflict detection. On `darwin` NFC and NFD spellings of the same name collide, matching APFS/HFS+; on `linux` and `win32` they are distinct entries and stay distinct.
- **Path flavour.** Paths are joined and normalized with `path.win32` when `platform` is `'win32'` and with `path.posix` otherwise, independent of the host OS. Source paths such as `/d//a.txt` are normalized before comparison and are not reported as renames.
- **Row status.** `status` is one of `ok`, `conflict`, `invalid`, or `unchanged`; `reasons` explains every non-`ok` row. `generatePreview` never throws for bad rule configuration: an invalid regular expression, an out-of-range pad width, a sequence value that is not finite or exceeds `Number.MAX_SAFE_INTEGER` in magnitude (for example a huge `step`), or a failing custom rule makes the affected rows `invalid` with a reason such as `Rule "find_replace" failed: ...` or `Custom rule failed: ...`. (`applyRulesToName` still throws in these cases.) A selected filesystem root (`/`, `C:\`, a UNC share root) cannot be renamed; its row is `invalid` with the reason `A filesystem root cannot be renamed.`, and its selected children are still planned normally.
- **Duplicate sources.** Items whose source paths have the same key (for example `/d/A.txt` and `/d/a.txt` on `darwin`) are all kept and reported as `conflict` rows with the reason `Another item in the batch has the same source path.` The first row keeps the plain key as its `id`; later duplicates get the lowest free `#<n>` suffix (starting at `#2`) that isn't already another source's key, so ids stay unique.
- **Name validation.** Names are rejected when empty, when a rule removes the whole stem (`abc.txt` -> `.txt`), when they contain `/` or control characters (`U+0000`-`U+001F`), or when they are `.`/`..`. On `win32`, reserved characters, trailing spaces or periods, and reserved device names are rejected; device names are matched on the part before the first dot with trailing spaces removed (`CON.tar.gz`, `nul .txt`, `COM0`-`COM9`, `LPT0`-`LPT9`, `COM¹²³`, `LPT¹²³`, `CONIN$`, `CONOUT$`), for files and directories. Names may be at most 255 UTF-16 code units on `win32` and 255 UTF-8 bytes elsewhere.

### Limits

The following limits are exported as constants:

| Constant | Value | Applies to |
| --- | --- | --- |
| `MAX_NAME_LENGTH` | 255 | Final file or directory name |
| `MAX_PAD_WIDTH` | 255 | `sequence_insert.padWidth` and the custom-rule `pad()` width |
| `MAX_REGEX_PATTERN_LENGTH` | 1000 | `find_replace` patterns with `useRegex` and `regexReplace()` patterns |
| `MAX_CUSTOM_RULE_TEXT_LENGTH` | 4096 | Any text value produced while evaluating a custom rule |

### Untrusted rules

User-supplied regular expressions (`find_replace` with `useRegex`, and `regexReplace()` in custom rules) run on the JavaScript regex engine, which can backtrack catastrophically and cannot be interrupted synchronously. The pattern length limit does not prevent this. Callers that accept rules from users should run `generatePreview` off the main thread (for example in a `worker_threads` Worker or a Web Worker) and terminate it after a timeout.

The root export contains the complete API. `@fastrenamer/rename-engine/sort` and `@fastrenamer/rename-engine/types` are also available for narrower imports.

## Development

From this directory, the package can be developed on its own with npm (Bun also works):

```sh
npm install
npm run check
```

Build output is written to `dist/` and is what consumers receive.
