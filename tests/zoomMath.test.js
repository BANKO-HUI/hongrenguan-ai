import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, zoomOffsetAtPoint } from '../src/zoomMath.js';

test('cursor anchored zoom keeps the pointed image coordinate stationary', () => {
  const pointer = { x: 240, y: -120 };
  const first = zoomOffsetAtPoint({
    currentZoom: 1,
    nextZoom: 1.25,
    offset: { x: 0, y: 0 },
    pointer,
  });
  const second = zoomOffsetAtPoint({
    currentZoom: 1.25,
    nextZoom: 1.5,
    offset: first,
    pointer,
  });

  assert.deepEqual(first, { x: -60, y: 30 });
  assert.deepEqual(second, { x: -120, y: 60 });
  assert.deepEqual(
    {
      x: (pointer.x - first.x) / 1.25,
      y: (pointer.y - first.y) / 1.25,
    },
    {
      x: (pointer.x - second.x) / 1.5,
      y: (pointer.y - second.y) / 1.5,
    },
  );
});

test('zoom clamps to the supported range and recenters at 100 percent', () => {
  assert.equal(clampZoom(0.5), 1);
  assert.equal(clampZoom(5), 4);
  assert.deepEqual(
    zoomOffsetAtPoint({
      currentZoom: 1.25,
      nextZoom: 1,
      offset: { x: -30, y: 20 },
      pointer: { x: 100, y: 100 },
    }),
    { x: 0, y: 0 },
  );
});
