import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  composeRegionalRestyle,
  prepareRegionalRestyle,
  regionalRestyleBounds,
  regionalRestyleEnabled,
} from '../server/regional-restyle.js';

const pixelAt = async (input, x, y) => {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 4)];
};

test('regional restyle crops context and keeps unselected and locked pixels unchanged', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bomi-regional-restyle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.png');
  await sharp({
    create: { width: 1000, height: 800, channels: 4, background: '#cc2211' },
  })
    .png()
    .toFile(source);
  const annotations = [
    {
      id: 'adjust-detail',
      type: 'circle',
      mode: 'adjust',
      color: '#ef4444',
      colorName: '红色',
      label: '调整图案',
      strokeWidth: 12,
      points: [
        { x: 0.35, y: 0.3 },
        { x: 0.65, y: 0.7 },
      ],
    },
    {
      id: 'lock-center',
      type: 'circle',
      mode: 'lock',
      color: '#22c55e',
      colorName: '绿色',
      label: '保持徽标',
      strokeWidth: 8,
      points: [
        { x: 0.47, y: 0.44 },
        { x: 0.53, y: 0.56 },
      ],
    },
  ];
  assert.equal(regionalRestyleEnabled(annotations), true);
  assert.equal(regionalRestyleEnabled(annotations, 'white'), false);
  const bounds = regionalRestyleBounds(annotations, 1000, 800);
  assert.ok(bounds.width < 1000);
  assert.ok(bounds.height < 800);

  const prepared = await prepareRegionalRestyle({ source, annotations, directory });
  const generated = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: '#1166dd' },
  })
    .png()
    .toBuffer();
  const result = await composeRegionalRestyle({ generated, prepared });

  assert.deepEqual(await pixelAt(result.composite, 10, 10), [204, 34, 17, 255]);
  assert.deepEqual(await pixelAt(result.composite, 500, 400), [204, 34, 17, 255]);
  const adjusted = await pixelAt(result.composite, 400, 400);
  assert.ok(adjusted[2] > adjusted[0]);
  assert.equal((await pixelAt(result.layer, 10, 10))[3], 0);
  assert.equal((await pixelAt(result.layer, 500, 400))[3], 0);
  assert.ok((await pixelAt(result.layer, 400, 400))[3] > 0);
});
