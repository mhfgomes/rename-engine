// Smoke-tests the package exactly as consumers receive it: packs the package
// into a tarball, installs that tarball into a fresh throwaway project, and
// imports every public `exports` subpath from there. This catches mistakes in
// `files` / `exports` that resolving the package from this folder would hide.
//
// Set PACKAGE_TARBALL=/path/to/pkg.tgz to test a prebuilt tarball instead of
// running `npm pack` (used by CI to test on Node versions that cannot run the
// dev toolchain).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const packageName = repoManifest.name;
const expectedSubpaths = ['.', './sort', './types'];
const isWindows = process.platform === 'win32';

const tempDirs = [];
function makeTempDir(label) {
  const dir = mkdtempSync(path.join(tmpdir(), `rename-engine-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: isWindows,
    });
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    throw error;
  }
}

function packTarball() {
  if (process.env.PACKAGE_TARBALL) {
    const tarball = path.resolve(process.env.PACKAGE_TARBALL);
    assert.ok(existsSync(tarball), `PACKAGE_TARBALL does not exist: ${tarball}`);
    return tarball;
  }

  const packDir = makeTempDir('pack');
  run('npm', ['pack', '--silent', '--pack-destination', packDir], repoRoot);
  const tarballs = readdirSync(packDir).filter((file) => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, `expected exactly one tarball, found: ${tarballs.join(', ')}`);
  return path.join(packDir, tarballs[0]);
}

const consumerSource = `
import assert from 'node:assert/strict';
import * as root from '${packageName}';
import * as sort from '${packageName}/sort';
import * as types from '${packageName}/types';

const renamed = root.applyRulesToName(
  'Hello World.TXT',
  false,
  [{ id: 'case', type: 'case_transform', enabled: true, mode: 'snake' }],
  { index: 0, total: 1, originalName: 'Hello World.TXT', parentPath: '/tmp' },
);
assert.equal(renamed, 'hello_world.TXT');

assert.deepEqual(
  root.generatePreview({ items: [], rules: [], platform: 'linux', sortMode: 'natural_path' }).rows,
  [],
);

assert.equal(typeof sort.sortItemsByMode, 'function');
assert.equal(sort.sortItemsByMode, root.sortItemsByMode);
assert.deepEqual(sort.sortItemsByMode([], 'natural_path'), []);

// The ./types entry point is type-only at runtime but must still resolve.
assert.equal(typeof types, 'object');

console.log('runtime imports ok');
`;

const consumerTypesSource = `
import { generatePreview, type RenameRule } from '${packageName}';
import { sortItemsByMode, type SortablePathItem } from '${packageName}/sort';
import type { PreviewResult, SortMode } from '${packageName}/types';

const rules: RenameRule[] = [{ id: 'case', type: 'case_transform', enabled: true, mode: 'kebab' }];
const mode: SortMode = 'natural_path';
const items: SortablePathItem[] = [];
const sorted: SortablePathItem[] = sortItemsByMode(items, mode);
const preview: PreviewResult = generatePreview({ items: [], rules, platform: 'linux', sortMode: mode });
export { preview, sorted };
`;

function findTsc() {
  const bin = path.join(repoRoot, 'node_modules', '.bin', isWindows ? 'tsc.cmd' : 'tsc');
  return existsSync(bin) ? bin : undefined;
}

try {
  const tarball = packTarball();
  console.log(`Testing tarball ${tarball}`);

  const consumerDir = makeTempDir('consumer');
  writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'rename-engine-smoke-consumer', private: true, type: 'module' }, null, 2),
  );
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--no-package-lock', '--ignore-scripts', tarball],
    consumerDir,
  );

  const installedDir = path.join(consumerDir, 'node_modules', ...packageName.split('/'));
  const installedManifest = JSON.parse(readFileSync(path.join(installedDir, 'package.json'), 'utf8'));

  // Every expected subpath is exported, and every export target exists in the tarball.
  assert.deepEqual(Object.keys(installedManifest.exports).sort(), [...expectedSubpaths].sort());
  for (const [subpath, conditions] of Object.entries(installedManifest.exports)) {
    for (const [condition, target] of Object.entries(conditions)) {
      assert.ok(
        existsSync(path.join(installedDir, target)),
        `exports["${subpath}"].${condition} -> ${target} is missing from the published package`,
      );
    }
    assert.match(conditions.types ?? '', /\.d\.ts$/, `exports["${subpath}"] has no .d.ts "types" condition`);
  }
  for (const field of ['main', 'types']) {
    assert.ok(existsSync(path.join(installedDir, installedManifest[field])), `"${field}" target is missing`);
  }

  // Declaration maps would point at src/*.ts, which is not published.
  const publishedFiles = readdirSync(installedDir, { recursive: true }).map(String);
  const declarationMaps = publishedFiles.filter((file) => file.endsWith('.d.ts.map'));
  assert.deepEqual(declarationMaps, [], 'declaration maps should not be published');

  // Runtime: import every subpath from the consumer project.
  writeFileSync(path.join(consumerDir, 'smoke.mjs'), consumerSource);
  process.stdout.write(run(process.execPath, ['smoke.mjs'], consumerDir));

  // Types: resolve every subpath through the package's "types" conditions.
  const tsc = findTsc();
  if (tsc) {
    writeFileSync(path.join(consumerDir, 'smoke.ts'), consumerTypesSource);
    writeFileSync(
      path.join(consumerDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            types: [],
          },
          files: ['smoke.ts'],
        },
        null,
        2,
      ),
    );
    run(tsc, ['-p', 'tsconfig.json'], consumerDir);
    console.log('type imports ok');
  } else {
    console.log('TypeScript not installed; skipping type resolution check');
  }

  console.log('Package smoke test passed');
} finally {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}
