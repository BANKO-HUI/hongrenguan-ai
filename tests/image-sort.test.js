import test from 'node:test';
import assert from 'node:assert/strict';
import { sortImages } from '../src/imageSort.js';

test('image sorting uses actual image creation time, including newly adjusted images', () => {
  const looks = [
    { id: 'a', title: 'LOOK 2', slot: 2, scene: 'new', createdAt: '2025-01-01' },
    { id: 'b', title: 'LOOK 10', slot: 10, scene: 'old', createdAt: '2026-01-01' },
  ];
  const assets = { new: { createdAt: '2026-10-30' }, old: { createdAt: '2026-10-20' } };
  assert.deepEqual(
    sortImages(looks, 'newest', assets).map((x) => x.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    sortImages(looks, 'oldest', assets).map((x) => x.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    sortImages([...looks].reverse(), 'name', assets).map((x) => x.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    looks.map((x) => x.id),
    ['a', 'b'],
  );
});

test('material images, missing dates and tied slots sort deterministically', () => {
  const items = [
    { id: 'old', assetId: 'old' },
    { id: 'new', assetId: 'new' },
  ];
  assert.equal(sortImages(items, 'newest', { new: { createdAt: '2026-10-30' } })[0].id, 'new');
  assert.deepEqual(
    sortImages([{ slot: 1 }, { slot: 2 }]).map((x) => x.slot),
    [2, 1],
  );
  assert.deepEqual(sortImages([]), []);
});
