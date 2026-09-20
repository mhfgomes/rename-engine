import assert from 'node:assert/strict';
import {
  applyRulesToName,
  generatePreview,
} from '@fastrenamer/rename-engine';
import { sortItemsByMode } from '@fastrenamer/rename-engine/sort';

const renamed = applyRulesToName(
  'Hello World.TXT',
  false,
  [{ id: 'case', type: 'case_transform', enabled: true, mode: 'snake' }],
  {
    index: 0,
    total: 1,
    originalName: 'Hello World.TXT',
    parentPath: '/tmp',
  },
);

assert.equal(renamed, 'hello_world.TXT');
assert.deepEqual(
  generatePreview({
    items: [],
    rules: [],
    platform: 'linux',
    sortMode: 'natural_path',
  }).rows,
  [],
);
assert.deepEqual(sortItemsByMode([], 'natural_path'), []);
