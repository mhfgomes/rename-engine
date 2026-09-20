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

The root export contains the complete API. `@fastrenamer/rename-engine/sort` and `@fastrenamer/rename-engine/types` are also available for narrower imports.

## Development

From this directory, the package can be developed on its own with npm (Bun also works):

```sh
npm install
npm run check
```

Build output is written to `dist/` and is what consumers receive.
