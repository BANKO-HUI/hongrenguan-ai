import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScrollRailMetrics, scrollLeftFromRailPointer } from '../src/scrollRail.js';

test('custom image rail maps content overflow to a bounded draggable thumb', () => {
  const start = computeScrollRailMetrics({
    clientWidth: 300,
    scrollWidth: 900,
    scrollLeft: 0,
    trackWidth: 240,
  });
  assert.deepEqual(start, {
    scrollable: true,
    maxScroll: 600,
    currentScroll: 0,
    thumbWidth: 80,
    thumbLeft: 0,
  });

  const end = computeScrollRailMetrics({
    clientWidth: 300,
    scrollWidth: 900,
    scrollLeft: 600,
    trackWidth: 240,
  });
  assert.equal(end.thumbLeft, 160);
});

test('custom image rail pointer dragging reaches both scroll boundaries', () => {
  const base = {
    trackLeft: 100,
    trackWidth: 240,
    thumbWidth: 80,
    grabOffset: 40,
    maxScroll: 600,
  };
  assert.equal(scrollLeftFromRailPointer({ ...base, clientX: 100 }), 0);
  assert.equal(scrollLeftFromRailPointer({ ...base, clientX: 340 }), 600);
  assert.equal(scrollLeftFromRailPointer({ ...base, clientX: 220 }), 300);
});

test('custom image rail stays disabled when content fits the viewport', () => {
  const metrics = computeScrollRailMetrics({
    clientWidth: 400,
    scrollWidth: 320,
    scrollLeft: 20,
    trackWidth: 200,
  });
  assert.equal(metrics.scrollable, false);
  assert.equal(metrics.maxScroll, 0);
  assert.equal(metrics.thumbWidth, 200);
  assert.equal(metrics.thumbLeft, 0);
});
