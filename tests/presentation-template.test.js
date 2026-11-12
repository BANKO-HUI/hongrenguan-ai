import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import test from 'node:test';
import assert from 'node:assert/strict';

const templatePath = new URL(
  '../master-kit/presentation-templates/BadMark-trend-analysis-template-v1.pptx',
  import.meta.url,
);

test('trend analysis PowerPoint template contains the complete 14-slide workflow', async () => {
  assert.equal(existsSync(templatePath), true, 'PPT template should exist');
  const archive = unzipSync(new Uint8Array(await readFile(templatePath)));
  const slides = Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 14);

  const text = slides
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name) => strFromU8(archive[name]))
    .join('\n');

  for (const heading of [
    '项目定位',
    '色彩系统',
    '廓形与比例',
    '面料与质感',
    '视觉证据索引',
    '系列生成指令',
    '生成前检查',
  ]) {
    assert.match(text, new RegExp(heading));
  }
});
