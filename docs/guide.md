# Getting started and integration

[Documentation home](../README.md) · [API](api.md) · [Rules](rules.md) · [Planning](planning.md)

## What the engine does

The engine converts caller-resolved file/directory items and ordered rules into a preview. It computes names, target paths, validation diagnostics, and conflict/status summaries. It has no filesystem dependency in its planning logic: the only existence information comes from an optional synchronous callback.

The caller supplies file selection, directory traversal, filtering, permissions, filesystem access, execution, storage, and undo. Exported application request/result types describe these surrounding responsibilities; there are no corresponding execution or history functions in this package.

## Preparing input

Each `ResolvedRenameItem` contains:

```ts
const item = {
  sourcePath: '/photos/My Photo.JPG',
  parentPath: '/photos',
  name: 'My Photo.JPG',
  isDirectory: false,
};
```

Use consistent values: `name` should be the basename of `sourcePath`, and `parentPath` its directory. `sourcePath` drives ancestry and final target resolution; `parentPath` drives naming context such as `{parent}`. The engine trusts these fields rather than reconstructing or validating the item schema.

Use absolute paths in the target platform's syntax. Relative paths are not resolved against a working directory by the planner. Do not include filesystem roots as rename items, and provide well-formed acyclic directory relationships. Structural input errors are outside the row-level rule-error guarantee.

For Windows paths in JavaScript/TypeScript, escape backslashes or use `String.raw`:

```ts
const windowsItem = {
  sourcePath: String.raw`C:\Photos\My Photo.JPG`,
  parentPath: String.raw`C:\Photos`,
  name: 'My Photo.JPG',
  isDirectory: false,
};
```

Choose `platform` for the filesystem being targeted, independently of the host running the planner. There is no automatic platform detection in `generatePreview`.

## Ordered rules and natural numbering

```ts
import { generatePreview, type RenameRule } from '@fastrenamer/rename-engine';

const rules: RenameRule[] = [
  { id: 'case', type: 'case_transform', enabled: true, mode: 'snake' },
  {
    id: 'sequence', type: 'sequence_insert', enabled: true,
    position: 'prefix', start: 1, step: 1, padWidth: 3, separator: '_',
  },
  {
    id: 'extension', type: 'extension_handling', enabled: true,
    mode: 'lowercase', replacement: '',
  },
];

const preview = generatePreview({
  items: ['Photo 10.JPG', 'Photo 2.JPG'].map((name) => ({
    sourcePath: `/photos/${name}`, parentPath: '/photos', name, isDirectory: false,
  })),
  rules,
  platform: 'linux',
  sortMode: 'natural_path',
});

console.log(preview.rows.map((row) => row.proposedName));
// ['001_photo_2.jpg', '002_photo_10.jpg']
```

Indices are global across the sorted batch, including directories, unchanged items, invalid items, and conflicts. They do not restart per directory or rule. Changing the sort mode or adding items can change sequence-based targets.

## Detecting occupied destinations

The callback receives the final target path after ancestor renames. It must return a boolean synchronously. You can use a precomputed set or synchronous filesystem access:

```ts
import { existsSync } from 'node:fs';
import { generatePreview } from '@fastrenamer/rename-engine';

const preview = generatePreview({
  items: [{
    sourcePath: '/docs/Draft.txt', parentPath: '/docs',
    name: 'Draft.txt', isDirectory: false,
  }],
  rules: [{ id: 'name', type: 'new_name', enabled: true, template: 'Final' }],
  platform: 'linux',
  sortMode: 'natural_path',
  existingPathExists: existsSync,
});

if (preview.summary.blocked) {
  console.log(preview.rows.filter((row) => row.status === 'invalid' || row.status === 'conflict'));
}
```

`existsSync` checks the host filesystem using its own semantics. For another machine or target platform, gather an appropriate destination snapshot instead. For a key-based snapshot, normalize filesystem syntax before calling `normalizePathKey`; that helper only handles case/Unicode comparison, not redundant separators or `.`/`..` segments.

Existence results are cached per target key within one preview. The callback is only invoked for changed rows without prior validation failures. A thrown callback error propagates from `generatePreview`; it is not a rule error. An async function is not a valid callback.

An existing target matching a batch source key is considered available to the batch. This permits swaps and chains, but requires a safe executor. The preview does not test whether that executor can complete the plan or whether the filesystem changed after the check.

## Renaming nested directories

```ts
import { generatePreview } from '@fastrenamer/rename-engine';

const preview = generatePreview({
  items: [
    { sourcePath: '/work/album', parentPath: '/work', name: 'album', isDirectory: true },
    { sourcePath: '/work/album/photo.txt', parentPath: '/work/album', name: 'photo.txt', isDirectory: false },
  ],
  rules: [{ id: 'upper', type: 'case_transform', enabled: true, mode: 'upper' }],
  platform: 'linux',
  sortMode: 'name_only',
});

console.log(preview.rows.map((row) => row.nextPath));
// ['/work/ALBUM', '/work/ALBUM/PHOTO.txt']
```

The directory appears before its descendant even if the requested sort mode would otherwise put the child first. A child can have `changed: true` solely because its ancestor moves. Intermediate directories not supplied as rows retain their names while inheriting renamed ancestors.

Every supplied row receives the same rules. To condition on item kind, use a custom expression such as `isDirectory ? upper(currentName) : currentName`.

## Transforming one name

Use `applyRulesToName` for a string transformation without sorting, validation, or conflict checks:

```ts
import { applyRulesToName } from '@fastrenamer/rename-engine';

const result = applyRulesToName(
  'Report.TXT', false,
  [{ id: 'name', type: 'new_name', enabled: true, template: '{date}_{seq:001}_{original}' }],
  { index: 0, total: 1, originalName: 'Report.TXT', parentPath: '/docs', platform: 'linux' },
  new Date(2026, 9, 7, 9, 5, 3),
);
// result === '2026-10-07_001_Report.TXT'
```

The fifth parameter lets you freeze local date/time for repeatable transformations. `generatePreview` has no injectable clock; it captures one `Date` for the whole call. Catch exceptions from `applyRulesToName` when rules can fail. Its output may still be invalid as a filesystem name.

## Running untrusted rules in a worker

The regex engine can backtrack for an unbounded time. A timeout on the same thread, including `Promise.race`, cannot interrupt a synchronous preview. Evaluate in a worker that the caller can terminate.

This Node ESM example uses two files. Functions cannot be transferred through `workerData`, so collect occupied paths first or perform existence checks inside the worker.

`preview-worker.mjs`:

```js
import { parentPort, workerData } from 'node:worker_threads';
import { generatePreview } from '@fastrenamer/rename-engine';

try {
  parentPort.postMessage({ result: generatePreview(workerData) });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
```

`preview-client.mjs`:

```js
import { Worker } from 'node:worker_threads';

export function previewWithTimeout(options, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./preview-worker.mjs', import.meta.url), {
      workerData: options,
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Preview timed out.')), timeoutMs);
    worker.once('message', (message) => {
      if (message.error !== undefined) finish(new Error(message.error));
      else finish(null, message.result);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`Preview worker exited before returning a result (${code}).`));
    });
  });
}
```

Choose timeout and batch-size policies for your application. The exported limits do not constrain all template sizes, expression nesting, batch size, or total execution time.

## Passing a plan to an executor

1. Gather consistent inputs and any external existence snapshot.
2. Generate the preview and present names, full paths, statuses, and reasons.
3. Refuse execution when `summary.blocked` is true. An empty or entirely unchanged batch is unblocked but has no work.
4. Revalidate filesystem state immediately before execution, including permissions and source identity.
5. Implement staging for swaps, chains, and case-only renames. A sequence of direct `rename(sourcePath, nextPath)` calls is not a general batch executor.
6. Account for ancestor moves when locating children during execution. Preview order is a presentation/numbering order, not a complete execution schedule.
7. Store actual successful operations and handle partial failures before enabling undo.

The engine does not guarantee atomicity, reserve targets, resolve symlinks, test cross-device moves, check permissions, or enforce full-path limits. The `ok` diagnostic about safe case-only staging describes behavior expected from the surrounding application; no staging occurs in this package.
