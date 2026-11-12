import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLabel } from '../src/api.js';
import { readFileSync } from 'node:fs';

test('public model labels omit the GPT brand while preserving the model identity', () => {
  assert.equal(modelLabel({ displayName: 'GPT-6.1-Sol', id: 'gpt-6.1-sol' }), '6.1-Sol');
  assert.equal(modelLabel({ id: 'gpt-5.6-luna' }), '5.6-luna');
  assert.equal(modelLabel({ displayName: 'Astra', id: 'gpt-6-astra' }), 'Astra');
});

test('visible application branding is consistently named Bomi智绘', () => {
  const files = [
    '../index.html',
    '../src/App.jsx',
    '../src/StartupScreen.jsx',
    '../src/ChatWorkspace.jsx',
    '../desktop/main.js',
    '../electron-builder.yml',
  ].map((relative) => readFileSync(new URL(relative, import.meta.url), 'utf8'));
  assert.ok(files.every((source) => source.includes('Bomi智绘')));
  assert.ok(files.every((source) => !source.includes('BadMark')));

  const builder = files.at(-1);
  assert.match(builder, /productName: Bomi智绘/);
  assert.match(builder, /artifactName: Bomi-Zhihui-/);
});
