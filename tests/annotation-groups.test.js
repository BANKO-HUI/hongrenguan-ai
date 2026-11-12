import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupAnnotationsByColor,
  removeAnnotationGroup,
  updateAnnotationGroup,
} from '../src/annotationGroups.js';

const annotations = [
  { id: 'red-circle', color: '#EF4444', colorName: '红色', mode: 'adjust', label: '调整' },
  { id: 'red-brush', color: '#ef4444', colorName: '红色', mode: 'lock', label: '保持' },
  { id: 'green', color: '#22a06b', colorName: '绿色', mode: 'adjust', label: '换色' },
];

test('annotation instructions merge regions with the same color', () => {
  const groups = groupAnnotationsByColor(annotations);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].ids, ['red-circle', 'red-brush']);
  assert.deepEqual(groups[0].modes, ['adjust', 'lock']);
  assert.equal(groups[0].label, '调整');
});

test('editing or deleting a color group applies to every matching region', () => {
  const updated = updateAnnotationGroup(annotations, '#ef4444', '统一修改红色区域');
  assert.deepEqual(
    updated.filter((item) => item.color.toLowerCase() === '#ef4444').map((item) => item.label),
    ['统一修改红色区域', '统一修改红色区域'],
  );
  assert.equal(updated.find((item) => item.id === 'green').label, '换色');
  assert.deepEqual(
    removeAnnotationGroup(updated, '#ef4444').map((item) => item.id),
    ['green'],
  );
});
