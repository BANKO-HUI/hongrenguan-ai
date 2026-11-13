import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
    '../desktop/main.js',
    '../electron-builder.yml',
  ].map(read);
  assert.ok(files.every((source) => source.includes('红人馆AI')));
  assert.ok(files.every((source) => !source.includes('Bomi智绘')));

  const builder = files.at(-1);
  assert.match(builder, /productName: 红人馆AI/);
  assert.match(builder, /artifactName: Hongrenguan-AI-/);
  assert.equal(existsSync(new URL('../public/assets/hongrenguan-icon.png', import.meta.url)), true);
  assert.match(files[1], /\/assets\/hongrenguan-icon\.png/);
});

test('the application shell exposes only restyle and finished-image workspaces', () => {
  const app = read('../src/App.jsx');
  for (const removed of ['Chat模式', '系列工作台', '爆款裂变', '趋势资料库', '素材库', '新建项目'])
    assert.doesNotMatch(app, new RegExp(removed));
  assert.doesNotMatch(app, /ChatWorkspace|LibraryWorkspace/);
  assert.match(app, /id: 'restyle'.*label: '改款中心'/);
  assert.match(app, /id: 'white'.*label: '成片管理'/);
  assert.match(app, /添加图片项目/);
  assert.doesNotMatch(app, /StartupScreen|LoginScreen/);
});

test('restyle tasks always use complete-image results without layer controls', () => {
  const design = read('../src/DesignWorkspace.jsx');
  assert.doesNotMatch(design, /LookLayerPanel|setLayerMode|updateLookLayers|mergeLookLayers/);
  assert.match(design, /layerMode: false/);
  assert.match(design, /标注区域作为精准调整指引/);
});

test('image projects open restyle directly and freehand uses the finest default brush', () => {
  const app = read('../src/App.jsx');
  const design = read('../src/DesignWorkspace.jsx');
  assert.match(app, /const selectProject = \(id\) => \{[\s\S]*setStep\('restyle'\)/);
  assert.match(app, /if \(created\[0\]\)[\s\S]*setStep\('restyle'\)/);
  assert.match(design, /const \[tool, setTool\] = useState\('brush'\)/);
  assert.match(design, /const \[brushSize, setBrushSize\] = useState\(2\)/);
  assert.match(design, /\['极细', 2\]/);
  assert.match(
    design,
    /const drawingId = drawing\.current\.id;[\s\S]*annotation\.id !== drawingId/,
  );
  assert.doesNotMatch(design, /annotation\.id !== drawing\.current\.id/);
});
