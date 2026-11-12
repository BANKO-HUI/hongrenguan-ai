import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelLabel } from '../src/api.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('public model labels omit the GPT brand while preserving the model identity', () => {
  assert.equal(modelLabel({ displayName: 'GPT-6.1-Sol', id: 'gpt-6.1-sol' }), '6.1-Sol');
  assert.equal(modelLabel({ id: 'gpt-5.6-luna' }), '5.6-luna');
  assert.equal(modelLabel({ displayName: 'Astra', id: 'gpt-6-astra' }), 'Astra');
});

test('visible application branding is consistently named 红人馆AI', () => {
  const files = [
    '../index.html',
    '../src/App.jsx',
    '../src/StartupScreen.jsx',
    '../desktop/main.js',
    '../electron-builder.yml',
  ].map(read);
  assert.ok(files.every((source) => source.includes('红人馆AI')));
  assert.ok(files.every((source) => !source.includes('Bomi智绘')));

  const builder = files.at(-1);
  assert.match(builder, /productName: 红人馆AI/);
  assert.match(builder, /artifactName: Hongrenguan-AI-/);
});

test('the application shell exposes only restyle and finished-image workspaces', () => {
  const app = read('../src/App.jsx');
  for (const removed of ['Chat模式', '系列工作台', '爆款裂变', '趋势资料库', '素材库', '新建项目'])
    assert.doesNotMatch(app, new RegExp(removed));
  assert.doesNotMatch(app, /ChatWorkspace|LibraryWorkspace/);
  assert.match(app, /id: 'restyle'.*label: '改款中心'/);
  assert.match(app, /id: 'white'.*label: '成片管理'/);
});

test('restyle tasks always use complete-image results without layer controls', () => {
  const design = read('../src/DesignWorkspace.jsx');
  assert.doesNotMatch(design, /LookLayerPanel|setLayerMode|updateLookLayers|mergeLookLayers/);
  assert.match(design, /layerMode: false/);
  assert.match(design, /标注区域作为精准调整指引/);
});
