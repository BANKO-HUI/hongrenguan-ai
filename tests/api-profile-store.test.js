import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiProfileStore, OPENAI_API_BASE_URL } from '../server/api-profile-store.js';
import { OPENAI_ANALYSIS_MODEL, OPENAI_IMAGE_MODEL } from '../shared/openai-defaults.js';

test('API profiles persist separately with owner-only permissions and never expose keys', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-api-profiles-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ApiProfileStore(directory);
  const saved = store.create({
    name: '视觉分析服务',
    baseUrl: 'https://analysis.example.com/chat/completions',
    apiKey: 'private-analysis-key',
    analysisModel: 'vision-model',
    enabled: true,
    roles: { analysis: true, image: false },
  });

  assert.equal(saved.baseUrl, 'https://analysis.example.com');
  assert.equal(saved.keyStored, true);
  assert.equal('apiKey' in saved, false);
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /private-analysis-key/);
  const filename = path.join(directory, 'api-providers.json');
  assert.match(readFileSync(filename, 'utf8'), /private-analysis-key/);
  assert.equal(statSync(filename).mode & 0o777, 0o600);

  const restored = new ApiProfileStore(directory);
  assert.equal(restored.snapshot()[0].name, '视觉分析服务');
  assert.equal(restored.compose().analysisApiKey, 'private-analysis-key');
});

test('API profiles assign analysis and image roles independently and retain hidden keys on edit', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-api-roles-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ApiProfileStore(directory);
  const analysis = store.create({
    name: '分析',
    baseUrl: 'https://analysis.example.com/v1',
    apiKey: 'analysis-secret',
    analysisModel: 'vision-model',
    enabled: true,
    roles: { analysis: true, image: false },
  });
  const image = store.create({
    name: '生图',
    baseUrl: 'https://image.example.com/v1',
    apiKey: 'image-secret',
    imageModel: 'image-model',
    enabled: true,
    roles: { analysis: false, image: true },
  });
  const composed = store.compose();
  assert.equal(composed.analysisApiKey, 'analysis-secret');
  assert.equal(composed.imageApiKey, 'image-secret');
  assert.equal(composed.analysisModel, 'vision-model');
  assert.equal(composed.imageModel, 'image-model');
  assert.equal(composed.imageSize, null);
  assert.equal('imageSize' in store.snapshot().find((profile) => profile.id === image.id), false);

  store.update(analysis.id, { name: '分析更新', apiKey: '' });
  assert.equal(store.compose().analysisApiKey, 'analysis-secret');
  store.update(image.id, { roles: { analysis: true, image: true }, analysisModel: 'image-vision' });
  const profiles = store.snapshot();
  assert.equal(profiles.find((profile) => profile.id === analysis.id).roles.analysis, false);
  assert.deepEqual(profiles.find((profile) => profile.id === image.id).roles, {
    analysis: true,
    image: true,
  });
});

test('API profiles assign suitable saved services when switching with all roles disabled', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-api-default-roles-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ApiProfileStore(directory);
  const analysis = store.create({
    name: '分析',
    baseUrl: 'https://analysis.example.com/v1',
    apiKey: 'analysis-secret',
    analysisModel: 'vision-model',
    enabled: true,
    roles: { analysis: false, image: false },
  });
  const image = store.create({
    name: '生图',
    baseUrl: 'https://image.example.com/v1',
    apiKey: 'image-secret',
    imageModel: 'image-model',
    enabled: true,
    roles: { analysis: false, image: false },
  });

  const active = store.activateDefaults();
  assert.equal(active.analysis.id, analysis.id);
  assert.equal(active.image.id, image.id);
  assert.deepEqual(
    store.snapshot().map((profile) => profile.roles),
    [
      { analysis: true, image: false },
      { analysis: false, image: true },
    ],
  );

  const restored = new ApiProfileStore(directory);
  assert.equal(restored.active().analysis.id, analysis.id);
  assert.equal(restored.active().image.id, image.id);
});

test('API profiles reassign both roles after one active service is closed', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-api-role-fallback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ApiProfileStore(directory);
  const fallback = store.create({
    name: '备用 API',
    baseUrl: 'https://fallback.example.com/v1',
    apiKey: 'fallback-secret',
    analysisModel: 'fallback-vision',
    imageModel: 'fallback-image',
    enabled: true,
    roles: { analysis: true, image: true },
  });
  const primary = store.create({
    name: '主 API',
    baseUrl: 'https://primary.example.com/v1',
    apiKey: 'primary-secret',
    analysisModel: 'primary-vision',
    imageModel: 'primary-image',
    enabled: true,
    roles: { analysis: true, image: true },
  });

  assert.equal(store.active().analysis.id, primary.id);
  store.update(primary.id, { enabled: false });
  const active = store.activateDefaults();
  assert.equal(active.analysis.id, fallback.id);
  assert.equal(active.image.id, fallback.id);
  assert.deepEqual(store.snapshot().find((profile) => profile.id === fallback.id).roles, {
    analysis: true,
    image: true,
  });
});

test('OpenAI profiles use the official endpoint and preserve dedicated routing metadata', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-openai-profile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ApiProfileStore(directory);
  const saved = store.create({
    providerType: 'openai',
    name: 'OpenAI API',
    baseUrl: 'https://example.com/not-used',
    apiKey: 'openai-secret',
    analysisModel: OPENAI_ANALYSIS_MODEL,
    imageModel: OPENAI_IMAGE_MODEL,
    enabled: true,
    roles: { analysis: true, image: true },
  });

  assert.equal(saved.providerType, 'openai');
  assert.equal(saved.baseUrl, OPENAI_API_BASE_URL);
  const composed = store.compose();
  assert.equal(composed.analysisProviderType, 'openai');
  assert.equal(composed.imageProviderType, 'openai');
  assert.equal(composed.analysisBaseUrl, OPENAI_API_BASE_URL);
  assert.equal(composed.imageBaseUrl, OPENAI_API_BASE_URL);
  assert.equal(composed.analysisModel, OPENAI_ANALYSIS_MODEL);
  assert.equal(composed.imageModel, OPENAI_IMAGE_MODEL);
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /openai-secret/);
});

test('legacy OpenAI presets migrate to current documented model defaults', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-openai-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'api-providers.json');
  writeFileSync(
    filename,
    JSON.stringify({
      version: 1,
      profiles: [
        {
          id: 'legacy-openai',
          providerType: 'openai',
          name: 'OpenAI API',
          baseUrl: OPENAI_API_BASE_URL,
          apiKey: 'preserved-key',
          analysisModel: 'gpt-6-luna',
          imageModel: 'gpt-image-2.5-flare',
          enabled: true,
          roles: { analysis: true, image: true },
        },
      ],
    }),
    { mode: 0o600 },
  );

  const store = new ApiProfileStore(directory);
  const [profile] = store.snapshot();
  assert.equal(profile.analysisModel, OPENAI_ANALYSIS_MODEL);
  assert.equal(profile.imageModel, OPENAI_IMAGE_MODEL);
  assert.equal(store.compose().analysisApiKey, 'preserved-key');
  assert.doesNotMatch(JSON.stringify(profile), /preserved-key/);
});
