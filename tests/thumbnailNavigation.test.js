import test from 'node:test';
import assert from 'node:assert/strict';
import { nextThumbnailIndex } from '../src/thumbnailNavigation.js';

test('thumbnail arrows switch selection and wrap at both ends', () => {
  assert.equal(nextThumbnailIndex(5, 0, 'ArrowRight'), 1);
  assert.equal(nextThumbnailIndex(5, 4, 'ArrowRight'), 0);
  assert.equal(nextThumbnailIndex(5, 0, 'ArrowLeft'), 4);
  assert.equal(nextThumbnailIndex(5, 3, 'ArrowLeft'), 2);
});

test('thumbnail navigation supports first focus plus Home and End', () => {
  assert.equal(nextThumbnailIndex(5, -1, 'ArrowRight'), 0);
  assert.equal(nextThumbnailIndex(5, -1, 'ArrowLeft'), 4);
  assert.equal(nextThumbnailIndex(5, 2, 'Home'), 0);
  assert.equal(nextThumbnailIndex(5, 2, 'End'), 4);
  assert.equal(nextThumbnailIndex(0, 0, 'ArrowRight'), -1);
});
