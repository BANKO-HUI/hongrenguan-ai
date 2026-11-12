import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../server/http.js';
import { fixture, png, prepared, series } from './helpers.js';

test('HTTP auth, origin checks, upload persistence and private plugin boundary', async (t) => {
  const { workbench: w } = fixture(t);
  const server = createApp(w, { agentKey: 'agent-secret' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, options) => fetch(base + route, options);
  assert.equal((await call('/api/state')).status, 401);
  assert.equal((await call('/api/executor/check', { method: 'POST' })).status, 401);
  assert.equal(
    (await call('/api/session', { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  const rebindingStatus = await new Promise((resolve) => {
    const req = httpRequest(base + '/api/session', { headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end();
  });
  assert.equal(rebindingStatus, 403);
  const response = await call('/api/session');
  const { token } = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const headers = { 'X-Badmark-Token': token, 'Content-Type': 'application/json' };
  assert.equal((await call('/api/executor/check', { method: 'POST', headers })).status, 503);
  const created = await call('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'HTTP project' }),
  });
  assert.equal(created.status, 201);
  const p = await created.json();
  assert.equal((await call('/api/state', { headers: { Cookie: cookie } })).status, 200);
  const imageProjectsForm = new FormData();
  imageProjectsForm.append('files', new Blob([await png('red')]), 'jacket.png');
  imageProjectsForm.append('files', new Blob([await png('blue')]), 'coat.png');
  const imageProjectsResponse = await call('/api/image-projects', {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: imageProjectsForm,
  });
  assert.equal(imageProjectsResponse.status, 201);
  const imageProjects = await imageProjectsResponse.json();
  assert.deepEqual(
    imageProjects.map((project) => project.name),
    ['jacket', 'coat'],
  );
  assert.ok(imageProjects.every((project) => project.sourceAssetId));
  assert.equal(
    (
      await call('/api/projects', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  assert.equal((await call('/internal/tasks/missing', { headers })).status, 403);
  assert.equal(
    (
      await call('/api/projects/' + p.id, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ looks: [] }),
      })
    ).status,
    400,
  );
  const form = new FormData();
  form.append('file', new Blob([await png('red')]), 'model.png');
  const uploaded = await call(`/api/projects/${p.id}/assets/model`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: form,
  });
  assert.equal(uploaded.status, 200);
  const saved = await uploaded.json();
  const file = await call(`/api/files/${saved.assets.model}`, { headers: { Cookie: cookie } });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /image\/png/);
  const refineReferences = new FormData();
  refineReferences.append('files', new Blob([await png('orange')]), 'scene.png');
  refineReferences.append('files', new Blob([await png('purple')]), 'accessory.png');
  const referenceResponse = await call(`/api/projects/${p.id}/refine-references`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: refineReferences,
  });
  assert.equal(referenceResponse.status, 201);
  const referencePayload = await referenceResponse.json();
  assert.equal(referencePayload.assets.length, 2);
  assert.ok(referencePayload.assets.every((asset) => asset.mime === 'image/png'));
  const restyleResponse = await call(`/api/projects/${p.id}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'restyle',
      sourceAssetId: referencePayload.assets[0].id,
      referenceAssetIds: [referencePayload.assets[1].id],
      referenceLabels: ['配饰'],
      instruction: '参考 @配饰 调整细节',
      annotations: [
        {
          id: 'region',
          type: 'circle',
          mode: 'adjust',
          color: '#ff8a1f',
          label: '领口',
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.5, y: 0.5 },
          ],
        },
      ],
    }),
  });
  assert.equal(restyleResponse.status, 201);
  const restyleTask = await restyleResponse.json();
  assert.equal(restyleTask.kind, 'restyle');
  await call(`/api/tasks/${restyleTask.id}/cancel`, { method: 'POST', headers });
  const deletedTask = await call(`/api/tasks/${restyleTask.id}`, { method: 'DELETE', headers });
  assert.equal(deletedTask.status, 200);
  assert.equal((await deletedTask.json()).deleted, restyleTask.id);
  const trendForm = new FormData();
  trendForm.append('file', new Blob([await png('green')]), 'trend.webp');
  trendForm.append('group', '灵感图片');
  trendForm.append('tags', JSON.stringify(['机能', '绿色']));
  const trendResponse = await call('/api/library/trends', {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: trendForm,
  });
  assert.equal(trendResponse.status, 201);
  const trend = await trendResponse.json();
  assert.equal(trend.item.sourceType, 'image');
  assert.equal(trend.task.kind, 'analysis');
  const trendCover = await call(`/api/files/${trend.item.coverAssetId}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(trendCover.status, 200);
  assert.match(trendCover.headers.get('content-type'), /image\/png/);
  assert.equal(
    (await call(`/api/library/trends/${trend.item.id}`, { method: 'DELETE', headers })).status,
    409,
  );
  await call(`/api/library/trends/${trend.item.id}/archive`, { method: 'POST', headers });
  assert.equal(
    (await call(`/api/library/trends/${trend.item.id}`, { method: 'DELETE', headers })).status,
    409,
  );
  await call(`/api/tasks/${trend.task.id}/cancel`, { method: 'POST', headers });
  await call(`/api/library/trends/${trend.item.id}/restore`, { method: 'POST', headers });
  const reanalysisResponse = await call(`/api/library/trends/${trend.item.id}/analyze`, {
    method: 'POST',
    headers,
  });
  assert.equal(reanalysisResponse.status, 201);
  const reanalysis = await reanalysisResponse.json();
  assert.equal(reanalysis.status, 'pending');
  assert.equal(reanalysis.trendId, trend.item.id);
  await call(`/api/tasks/${reanalysis.id}/cancel`, { method: 'POST', headers });
  await call(`/api/library/trends/${trend.item.id}/archive`, { method: 'POST', headers });
  const deletedTrend = await call(`/api/library/trends/${trend.item.id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(deletedTrend.status, 200);
  assert.equal((await deletedTrend.json()).deleted, trend.item.id);
  const materialForm = new FormData();
  materialForm.append('file', new Blob([await png('blue')]), 'pattern.png');
  const materialResponse = await call('/api/library/materials/pattern', {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: materialForm,
  });
  assert.equal(materialResponse.status, 201);
  const material = await materialResponse.json();
  assert.equal(material.kind, 'pattern');
  const fabricForm = new FormData();
  fabricForm.append('file', new Blob([await png('yellow')]), 'fabric.png');
  const fabricResponse = await call('/api/library/materials/fabric', {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: fabricForm,
  });
  assert.equal(fabricResponse.status, 201);
  assert.equal((await fabricResponse.json()).kind, 'fabric');
  const materialFile = await call(`/api/files/${material.assetId}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(materialFile.status, 200);
  assert.match(materialFile.headers.get('content-type'), /image\/png/);
  const customForm = new FormData();
  customForm.append('file', new Blob([await png('orange')]), 'custom-reference.png');
  const customResponse = await call('/api/library/materials/custom', {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
    body: customForm,
  });
  assert.equal(customResponse.status, 201);
  assert.equal((await customResponse.json()).kind, 'custom');
  const croppedResponse = await call(`/api/library/materials/${material.id}/crop`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ aspect: '1:1', zoom: 1, x: 0, y: 0, expectedRevision: 0 }),
  });
  assert.equal(croppedResponse.status, 200);
  const cropped = await croppedResponse.json();
  const croppedFile = await call(`/api/files/${cropped.assetId}`, { headers: { Cookie: cookie } });
  const croppedMetadata = await sharp(Buffer.from(await croppedFile.arrayBuffer())).metadata();
  assert.equal(croppedMetadata.width, croppedMetadata.height);
  const resetResponse = await call(`/api/library/materials/${material.id}/reset-crop`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1 }),
  });
  assert.equal(resetResponse.status, 200);
  assert.equal((await resetResponse.json()).assetId, material.assetId);
  assert.equal(
    (
      await call(`/api/library/materials/${material.id}/archive`, {
        method: 'POST',
        headers,
      })
    ).status,
    200,
  );
  const generatedProject = await prepared(w, 1);
  const generated = await series(w, generatedProject.id, ['green']);
  assert.equal(
    (
      await call(`/api/projects/${generatedProject.id}/looks`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ lookIds: [generated.looks[0].id] }),
      })
    ).status,
    409,
  );
  const archivedLook = await call(`/api/projects/${generatedProject.id}/looks/archive`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ lookIds: [generated.looks[0].id] }),
  });
  assert.equal(archivedLook.status, 200);
  const deletedLook = await call(`/api/projects/${generatedProject.id}/looks`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ lookIds: [generated.looks[0].id] }),
  });
  assert.equal(deletedLook.status, 200);
  assert.equal(
    w.publicState().projects.find((item) => item.id === generatedProject.id).looks.length,
    0,
  );
  assert.equal(
    (await call('/api/state', { headers: { Authorization: 'Bearer agent-secret' } })).status,
    200,
  );
  const publicState = await (await call('/api/state', { headers })).json();
  assert.ok(!JSON.stringify(publicState).includes('relativePath'));
  assert.equal(
    (await call('/api/projects/' + p.id + '/export', { method: 'POST', headers, body: '{}' }))
      .status,
    400,
  );
});

test('HTTP forwards the independent task concurrency control', async (t) => {
  const { workbench: w } = fixture(t);
  const calls = [];
  const executor = {
    snapshot: () => ({ ready: true, taskConcurrency: 3 }),
    check: async () => ({ ready: true }),
    control(action, value, taskId) {
      calls.push({ action, value, taskId });
      return { ready: true, taskConcurrency: value };
    },
  };
  const server = createApp(w, { agentKey: 'agent-secret', executor }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/api/session`);
  const { token } = await session.json();
  const response = await fetch(`${base}/api/executor/control`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'task-concurrency', taskConcurrency: 2 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ action: 'task-concurrency', value: 2, taskId: undefined }]);
});

test('HTTP keeps split third-party provider configuration behind the local session', async (t) => {
  const { workbench: w } = fixture(t);
  const calls = [];
  const executor = {
    snapshot: () => ({ ready: true, provider: { mode: 'account' } }),
    async configureProvider(input) {
      calls.push(input);
      return {
        ready: true,
        providerMode: 'third-party',
        provider: {
          mode: 'third-party',
          topology: 'split',
          analysis: {
            baseUrl: input.analysisBaseUrl,
            model: input.analysisModel,
            hasApiKey: true,
          },
          image: {
            baseUrl: input.imageBaseUrl,
            model: input.imageModel,
            hasApiKey: true,
          },
          hasApiKey: true,
          sessionOnly: true,
        },
      };
    },
  };
  const server = createApp(w, { agentKey: 'provider-secret', executor }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = {
    mode: 'third-party',
    analysisBaseUrl: 'https://analysis.example.com/v1',
    analysisApiKey: 'private-analysis-key',
    analysisModel: 'vision-model',
    imageBaseUrl: 'https://image.example.com/v1',
    imageApiKey: 'private-image-key',
    imageModel: 'image-model',
  };
  assert.equal(
    (
      await fetch(`${base}/api/provider`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const response = await fetch(`${base}/api/provider`, {
    method: 'PUT',
    headers: { 'X-Badmark-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.provider.mode, 'third-party');
  assert.equal(payload.provider.analysis.baseUrl, 'https://analysis.example.com/v1');
  assert.equal(payload.provider.image.baseUrl, 'https://image.example.com/v1');
  assert.doesNotMatch(JSON.stringify(payload), /private-analysis-key|private-image-key/);
  assert.deepEqual(calls, [body]);
});

test('HTTP blocks new image tasks when generation quota is exhausted but permits analysis', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 1);
  const executor = {
    snapshot: () => ({
      ready: true,
      imageGeneration: false,
      message: '帐号生图额度已达到上限；请切换到可用 API。',
    }),
  };
  const server = createApp(w, { agentKey: 'quota-secret', executor }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/session`)).json();
  const headers = { 'X-Badmark-Token': token, 'Content-Type': 'application/json' };

  const blocked = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'series' }),
  });
  assert.equal(blocked.status, 503);
  assert.match((await blocked.json()).error, /帐号生图额度已达到上限/);

  const analysis = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'analysis' }),
  });
  assert.equal(analysis.status, 201);
});

test('HTTP protects saved API profile management and never echoes submitted keys', async (t) => {
  const { workbench: w } = fixture(t);
  const calls = [];
  const safeState = {
    ready: true,
    providerMode: 'third-party',
    provider: {
      mode: 'third-party',
      persistent: true,
      profiles: [{ id: 'profile-1', name: 'Saved API', keyStored: true }],
    },
  };
  const executor = {
    snapshot: () => safeState,
    async createProviderProfile(input) {
      calls.push(['create', input]);
      return safeState;
    },
    async updateProviderProfile(id, input) {
      calls.push(['update', id, input]);
      return safeState;
    },
    async deleteProviderProfile(id) {
      calls.push(['delete', id]);
      return safeState;
    },
  };
  const server = createApp(w, { agentKey: 'profile-secret', executor }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = {
    name: 'Saved API',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'never-echo-this-key',
    analysisModel: 'vision-model',
    roles: { analysis: true, image: false },
  };
  assert.equal(
    (
      await fetch(`${base}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const headers = { 'X-Badmark-Token': token, 'Content-Type': 'application/json' };
  const created = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(created.status, 201);
  assert.doesNotMatch(await created.text(), /never-echo-this-key/);
  assert.equal(
    (
      await fetch(`${base}/api/providers/profile-1`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled: false }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/providers/profile-1`, { method: 'DELETE', headers })).status,
    200,
  );
  assert.deepEqual(calls, [
    ['create', body],
    ['update', 'profile-1', { enabled: false }],
    ['delete', 'profile-1'],
  ]);
});

test('HTTP memory routes require a local session and preserve archive-before-delete safety', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'HTTP memory project' });
  const server = createApp(w, { agentKey: 'memory-agent' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = {
    title: '比例偏好',
    text: '上衣比例简洁利落，避免过长下摆。',
    scope: 'project',
    projectId: project.id,
    category: 'silhouette',
    polarity: 'positive',
  };
  assert.equal(
    (
      await fetch(`${base}/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const headers = { 'X-Badmark-Token': token, 'Content-Type': 'application/json' };
  const createdResponse = await fetch(`${base}/api/memory`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(createdResponse.status, 201);
  const memory = await createdResponse.json();
  assert.equal(
    (await fetch(`${base}/api/memory/${memory.id}`, { method: 'DELETE', headers })).status,
    409,
  );
  const archivedResponse = await fetch(`${base}/api/memory/${memory.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'archived', expectedRevision: memory.revision }),
  });
  assert.equal(archivedResponse.status, 200);
  assert.equal((await archivedResponse.json()).status, 'archived');
  assert.equal(
    (await fetch(`${base}/api/memory/${memory.id}`, { method: 'DELETE', headers })).status,
    200,
  );
  const disabled = await fetch(`${base}/api/memory/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).enabled, false);
});
