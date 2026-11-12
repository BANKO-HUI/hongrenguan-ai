import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGenerationSlots,
  findVisibleGenerationTask,
  mergePreviewBySource,
} from '../src/generationSlots.js';

test('generation slots exist immediately and completed images fill their original slot', () => {
  const slots = buildGenerationSlots({
    status: 'running',
    total: 4,
    results: [
      { slot: 3, assetId: 'asset-three' },
      { slot: 1, assetId: 'asset-one' },
    ],
  });

  assert.deepEqual(
    slots.map(({ slot, assetId, state }) => ({ slot, assetId, state })),
    [
      { slot: 1, assetId: 'asset-one', state: 'ready' },
      { slot: 2, assetId: null, state: 'generating' },
      { slot: 3, assetId: 'asset-three', state: 'ready' },
      { slot: 4, assetId: null, state: 'generating' },
    ],
  );
});

test('unfinished generation slots expose paused and failed states without changing order', () => {
  assert.deepEqual(
    buildGenerationSlots({ status: 'paused', total: 2, results: [] }).map(({ slot, state }) => [
      slot,
      state,
    ]),
    [
      [1, 'paused'],
      [2, 'paused'],
    ],
  );
  assert.deepEqual(
    buildGenerationSlots({
      status: 'failed',
      total: 3,
      results: [{ slot: 2, assetId: 'kept-result' }],
    }).map(({ slot, state }) => [slot, state]),
    [
      [1, 'failed'],
      [2, 'ready'],
      [3, 'failed'],
    ],
  );
});

test('active generation wins and the latest failed task keeps its unfinished slots visible', () => {
  const tasks = [
    { id: 'old-failed', projectId: 'project-1', kind: 'series', status: 'failed' },
    { id: 'active', projectId: 'project-1', kind: 'series', status: 'running' },
  ];
  assert.equal(findVisibleGenerationTask(tasks, 'project-1', 'series')?.id, 'active');
  assert.equal(findVisibleGenerationTask([tasks[0]], 'project-1', 'series')?.id, 'old-failed');
  assert.equal(
    findVisibleGenerationTask(
      [{ id: 'done', projectId: 'project-1', kind: 'series', status: 'completed' }],
      'project-1',
      'series',
    ),
    null,
  );
  assert.equal(
    findVisibleGenerationTask(
      [
        { id: 'new-success', projectId: 'project-1', kind: 'series', status: 'completed' },
        { id: 'stale-failure', projectId: 'project-1', kind: 'series', status: 'failed' },
      ],
      'project-1',
      'series',
    ),
    null,
  );
});

test('duplicate preview sources retain result slot metadata for selection', () => {
  const current = mergePreviewBySource([], {
    src: '/assets/result.png',
    assetId: 'result',
    title: '当前主图',
    kind: 'current',
  });
  const merged = mergePreviewBySource(current, {
    src: '/assets/result.png',
    assetId: 'result',
    title: '改款结果',
    label: '改款结果',
    slot: 1,
  });

  assert.deepEqual(merged, [
    {
      src: '/assets/result.png',
      assetId: 'result',
      title: '改款结果',
      kind: 'current',
      label: '改款结果',
      slot: 1,
    },
  ]);
});
