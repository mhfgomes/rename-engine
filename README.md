# @fastrenamer/rename-engine

The reusable planning engine behind Fast Renamer. It applies ordered rename rules, sorts input paths, validates names for a target platform, and detects destination conflicts without touching the filesystem.

## Documentation

- [Getting started and integration](docs/guide.md): input preparation, working examples, external conflicts, nested directories, workers, and execution responsibilities.
- [Public API reference](docs/api.md): every public function, constant, interface, and shared application contract.
- [Rename rules](docs/rules.md): all eleven rule types, every option, template tokens, sequences, dates, and extension behavior.
- [Custom expression language](docs/custom-expressions.md): values, operators, every helper, escaping, errors, and limits.
- [Planning and platform behavior](docs/planning.md): sorting, path keys, row statuses, validation, conflicts, diagnostics, and v0.2.0 migration notes.
- [Development](docs/development.md): source layout, checks, packaging, and documentation maintenance.

## Install

```sh
npm install @fastrenamer/rename-engine
```

Node.js 20 or newer is supported. The package is ESM-only and has no runtime dependencies. Use ESM `import`, or dynamic `import()` from CommonJS. The implementation uses `node:path`; a browser integration needs an appropriate bundler/polyfill and is not a standalone browser build.

## Quick start

```ts
import { generatePreview, type RenameRule } from '@fastrenamer/rename-engine';

const rules: RenameRule[] = [
  { id: 'normalize', type: 'case_transform', enabled: true, mode: 'kebab' },
];

const preview = generatePreview({
  items: [{
    sourcePath: '/documents/Quarterly Report.pdf',
    parentPath: '/documents',
    name: 'Quarterly Report.pdf',
    isDirectory: false,
  }],
  rules,
  sortMode: 'natural_path',
  platform: 'linux',
});

console.log(preview.rows[0].nextPath); // /documents/quarterly-report.pdf
console.log(preview.rows[0].status);   // ok
console.log(preview.summary.blocked); // false
```

`generatePreview` is synchronous. Pass `existingPathExists` to detect occupied destinations outside the batch; without it, only conflicts inside the supplied batch are detected. The engine never executes a rename, discovers files, persists presets, or performs undo. An unblocked preview is a plan, not a filesystem transaction.

The root export contains the complete public API. `@fastrenamer/rename-engine/sort` and `@fastrenamer/rename-engine/types` provide narrower imports. The custom evaluator is an internal implementation detail; use a `custom_rule` through the public planner or `applyRulesToName`.

## v0.2.0 behavior at a glance

- Rules run in array order, skipping disabled rules. Most transform the stem while preserving the extension.
- Sorting uses fixed `en` collation and code point tie-breaks, followed by ancestor-directory ordering. Sequence indices refer to this final batch order.
- Targets follow renamed ancestor directories, including through intermediate directories absent from the input.
- Path keys lowercase on `darwin` and `win32`, and NFC-normalize only on `darwin`. The engine models these platforms as case-insensitive; it does not inspect volume settings.
- Rule failures become `invalid` rows in a preview. `applyRulesToName` throws instead.
- Selected filesystem roots are invalid and retain their paths; their children are still planned normally. Numeric and letter sequence values must be finite and within ±`Number.MAX_SAFE_INTEGER`.
- Duplicate source paths remain separate `conflict` rows with unique ids.
- Final names are limited to 255 UTF-8 bytes on POSIX targets or 255 UTF-16 code units on Windows. Windows device names, reserved characters, trailing periods/spaces, and control characters are checked.

## Limits and untrusted rules

| Export | Value | Scope |
| --- | --- | --- |
| `MAX_NAME_LENGTH` | 255 | Final name: UTF-8 bytes on POSIX, UTF-16 units on Windows |
| `MAX_PAD_WIDTH` | 255 | Numeric sequence padding and custom `pad()` |
| `MAX_REGEX_PATTERN_LENGTH` | 1000 | Regex-mode `find_replace` and custom `regexReplace()` patterns |
| `MAX_CUSTOM_RULE_TEXT_LENGTH` | 4096 | Custom helper results and concatenations |

Regex length limits cannot prevent catastrophic backtracking. Run user-controlled rules in a worker and enforce a timeout; see the [integration guide](docs/guide.md#running-untrusted-rules-in-a-worker). The custom language also has no overall expression-size or nesting-depth limit. The text limit is not a general memory or runtime bound.

## Development

```sh
npm ci
npm run check
```

Build output goes to `dist/`. See [development and packaging](docs/development.md) for the check pipeline and package contents. Licensed under [MIT](LICENSE).
