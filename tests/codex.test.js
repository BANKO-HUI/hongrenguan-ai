import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { disposeCodexAppServer, inspectCodex, runCodex, startCodexLogin } from '../server/codex.js';

function runtime(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-cli-test-'));
  const binary = path.join(directory, 'codex-fixture');
  const starts = path.join(directory, 'starts');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(starts)}, 'start\\n');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') return send({ id: request.id, result: {} });
  if (request.method === 'initialized') return;
  if (request.method === 'thread/start') {
    return send({ id: request.id, result: { thread: { id: '11111111-1111-1111-1111-111111111111' } } });
  }
  if (request.method === 'turn/interrupt') return send({ id: request.id, result: {} });
  if (request.method !== 'turn/start') return send({ id: request.id, result: {} });
  const prompt = request.params.input.find(item => item.type === 'text').text;
  const turn = { id: '22222222-2222-2222-2222-222222222222', status: 'inProgress' };
  send({ id: request.id, result: { turn } });
  if (prompt === 'hang') return;
  if (prompt === 'failure') {
    send({ method: 'error', params: { threadId: request.params.threadId, turnId: turn.id, willRetry: false, error: { message: 'Test quota error' } } });
    send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { ...turn, status: 'failed', error: { message: 'Test quota error' } } } });
    return;
  }
  if (prompt === 'generated-image-path') {
    const savedPath = ${JSON.stringify(path.join(directory, 'generated.png'))};
    fs.writeFileSync(savedPath, 'generated');
    send({ method: 'item/completed', params: { threadId: request.params.threadId, turnId: turn.id, item: { type: 'imageGeneration', status: 'completed', savedPath, failure: null } } });
    send({ method: 'item/completed', params: { threadId: request.params.threadId, turnId: turn.id, item: { type: 'agentMessage', text: JSON.stringify({ error: '图像生成工具未返回可访问的结果。', image: null }) } } });
    send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { ...turn, status: 'completed' } } });
    return;
  }
  const result = { error: '', sandbox: 'read-only', apiKey: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY), disabled: args.filter((a,i)=>args[i-1]==='--disable'), images: request.params.input.filter(item => item.type === 'localImage').map(item => item.path), configs: args.filter((a,i)=>args[i-1]==='-c') };
  send({ method: 'item/completed', params: { threadId: request.params.threadId, turnId: turn.id, item: { type: 'agentMessage', text: JSON.stringify(result) } } });
  send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { ...turn, status: 'completed' } } });
});
`,
    { mode: 0o700 },
  );
  const saved = process.env.BADMARK_CODEX_BIN;
  process.env.BADMARK_CODEX_BIN = binary;
  t.after(() => {
    disposeCodexAppServer();
    if (saved === undefined) delete process.env.BADMARK_CODEX_BIN;
    else process.env.BADMARK_CODEX_BIN = saved;
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, schema: { type: 'object' }, starts };
}

function appServerRuntime(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-app-server-test-'));
  const binary = path.join(directory, 'codex-app-server-fixture');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === 1) send({ id: 1, result: {} });
  else if (request.method === 'account/read') send({ id: request.id, result: { account: { type: 'chatgpt', email: 'designer@example.com', planType: 'plus' } } });
  else if (request.method === 'modelProvider/capabilities/read') send({ id: request.id, result: { imageGeneration: true } });
  else if (request.method === 'config/read') send({ id: request.id, result: { config: { model: 'fixture-model' } } });
  else if (request.method === 'model/list') send({ id: request.id, result: { data: [{ id: 'fixture-model', displayName: 'Fixture', description: 'Fixture model', hidden: false, isDefault: true }] } });
  else if (request.method === 'account/login/start') {
    send({ id: request.id, result: { type: 'chatgpt', authUrl: 'https://auth.openai.com/authorize?fixture=1', loginId: 'fixture-login' } });
    setTimeout(() => send({ method: 'account/login/completed', params: { loginId: 'fixture-login', success: true } }), 20);
  }
});
`,
    { mode: 0o700 },
  );
  const saved = process.env.BADMARK_CODEX_BIN;
  process.env.BADMARK_CODEX_BIN = binary;
  t.after(() => {
    if (saved === undefined) delete process.env.BADMARK_CODEX_BIN;
    else process.env.BADMARK_CODEX_BIN = saved;
    rmSync(directory, { recursive: true, force: true });
  });
}

function signedOutAppServerRuntime(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-signed-out-test-'));
  const binary = path.join(directory, 'codex-signed-out-fixture');
  const protectedRequestMarker = path.join(directory, 'protected-requested');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === 1) send({ id: 1, result: {} });
  else if (request.method === 'account/read') send({ id: request.id, result: { account: null } });
  else if (request.method !== 'initialized') fs.writeFileSync(${JSON.stringify(protectedRequestMarker)}, request.method);
});
`,
    { mode: 0o700 },
  );
  const saved = process.env.BADMARK_CODEX_BIN;
  process.env.BADMARK_CODEX_BIN = binary;
  t.after(() => {
    if (saved === undefined) delete process.env.BADMARK_CODEX_BIN;
    else process.env.BADMARK_CODEX_BIN = saved;
    rmSync(directory, { recursive: true, force: true });
  });
  return protectedRequestMarker;
}

test('persistent app-server transport uses read-only structured execution and strips API billing credentials', async (t) => {
  const args = runtime(t);
  const reference = path.join(args.directory, 'reference.png');
  writeFileSync(reference, 'test');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-value-not-a-real-key';
  t.after(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });
  const result = await runCodex({ ...args, prompt: 'success', images: [reference] });
  assert.equal(result.sandbox, 'read-only');
  assert.equal(result.apiKey, false);
  assert.ok(result.disabled.includes('plugins'));
  assert.ok(result.disabled.includes('shell_tool'));
  assert.deepEqual(result.images, [reference]);
  assert.ok(result.configs.includes('model_reasoning_effort="low"'));
  assert.equal(result.threadId, '11111111-1111-1111-1111-111111111111');
  await runCodex({ ...args, prompt: 'success again', images: [reference] });
  assert.equal(readFileSync(args.starts, 'utf8').trim().split('\n').length, 1);
});

test('app-server transport recovers the authoritative saved image path from generation events', async (t) => {
  const args = runtime(t);
  const result = await runCodex({
    ...args,
    prompt: 'generated-image-path',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        image: {
          anyOf: [
            {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                review: { type: 'string' },
              },
            },
            { type: 'null' },
          ],
        },
      },
    },
  });
  assert.equal(result.error, '');
  assert.equal(result.image.filePath, path.join(args.directory, 'generated.png'));
  assert.match(result.image.review, /生图完成事件/);
});

test('app-server transport reports provider failure instead of accepting stale output', async (t) => {
  const args = runtime(t);
  await assert.rejects(runCodex({ ...args, prompt: 'failure' }), /Test quota error/);
});

test('app-server transport abort and timeout terminate unattended execution', async (t) => {
  const args = runtime(t);
  const controller = new AbortController();
  const promise = runCodex({ ...args, prompt: 'hang', signal: controller.signal });
  setTimeout(() => controller.abort(), 120);
  await assert.rejects(promise, /结束/);
  await assert.rejects(runCodex({ ...args, prompt: 'hang', timeout: 120 }), /超时/);
});

test('app-server inspection exposes only safe account metadata', async (t) => {
  appServerRuntime(t);
  const result = await inspectCodex();
  assert.equal(result.ready, true);
  assert.equal(result.authRequired, false);
  assert.deepEqual(result.account, { email: 'designer@example.com', planType: 'plus' });
  assert.equal(result.imageGeneration, true);
  assert.equal(result.model, 'fixture-model');
});

test('signed-out inspection requests login before protected AI capabilities', async (t) => {
  const protectedRequestMarker = signedOutAppServerRuntime(t);
  const result = await inspectCodex();
  assert.deepEqual(result, {
    ready: false,
    authRequired: true,
    account: null,
    imageGeneration: false,
    model: null,
    models: [],
    message: '尚未登录红人馆AI账号，请先完成授权。',
  });
  assert.equal(existsSync(protectedRequestMarker), false);
});

test('app-server login returns an approved authorization URL and completion signal', async (t) => {
  appServerRuntime(t);
  const login = await startCodexLogin();
  assert.equal(login.loginId, 'fixture-login');
  assert.equal(login.authUrl, 'https://auth.openai.com/authorize?fixture=1');
  await login.completion;
});
