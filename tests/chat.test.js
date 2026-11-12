import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/http.js';
import { inferChatAction } from '../server/chat-actions.js';
import { fixture, prepared } from './helpers.js';

test('Chat recognizes executable series requests and follow-up commands', () => {
  assert.deepEqual(
    inferChatAction([{ role: 'user', content: '根据流行趋势生成两个春夏街头风的男女组合款' }]),
    {
      type: 'series',
      count: 2,
      instruction: '根据流行趋势生成两个春夏街头风的男女组合款',
    },
  );
  assert.deepEqual(
    inferChatAction([
      { role: 'user', content: '帮我生成两款跑山轻运动系列' },
      { role: 'assistant', content: '请添加参考图。' },
      { role: 'user', content: '直接调用已有的模特和 Logo' },
    ]),
    {
      type: 'series',
      count: 2,
      instruction: '帮我生成两款跑山轻运动系列；直接调用已有的模特和 Logo',
    },
  );
  assert.equal(inferChatAction([{ role: 'user', content: '为什么没有生成图片' }]).type, 'none');
  assert.equal(inferChatAction([{ role: 'user', content: '继续未完成任务' }]).type, 'resume');
  assert.equal(
    inferChatAction([
      { role: 'user', content: '生成三款复古礼服' },
      { role: 'user', content: '用已有模特和 Logo 生成 2 款春夏街头组合，不用参考图' },
    ]).instruction,
    '用已有模特和 Logo 生成 2 款春夏街头组合，不用参考图',
  );
});

test('Chat actions start a counted series and resume the referenced failed task', async (t) => {
  const { workbench } = fixture(t);
  const project = await prepared(workbench, 6);
  const controls = [];
  const executor = {
    snapshot: () => ({ ready: true, imageGeneration: true }),
    control(action, value, taskId) {
      controls.push({ action, value, taskId });
      return this.snapshot();
    },
  };
  const server = createApp(workbench, { agentKey: 'chat-action-key', executor }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const headers = { 'X-Badmark-Token': token, 'Content-Type': 'application/json' };

  const generated = await fetch(`${base}/api/chat/actions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: project.id,
      messages: [
        { role: 'user', content: '用已有模特和 Logo 生成 2 款春夏街头男女组合款，不用参考图' },
      ],
    }),
  });
  assert.equal(generated.status, 201);
  const generatedBody = await generated.json();
  assert.equal(generatedBody.handled, true);
  assert.equal(generatedBody.action, 'series');
  assert.equal(generatedBody.task.channel, 'chat');
  assert.equal(generatedBody.task.total, 2);
  assert.match(generatedBody.task.instruction, /春夏街头男女组合款/);
  assert.deepEqual(controls[0], {
    action: 'start-task',
    value: null,
    taskId: generatedBody.task.id,
  });

  workbench.taskAction(generatedBody.task.id, 'fail', '临时服务异常');
  const resumed = await fetch(`${base}/api/chat/actions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: project.id,
      messages: [
        { role: 'assistant', content: '任务失败', taskId: generatedBody.task.id },
        { role: 'user', content: '继续未完成任务' },
      ],
    }),
  });
  assert.equal(resumed.status, 200);
  const resumedBody = await resumed.json();
  assert.equal(resumedBody.action, 'resume');
  assert.equal(resumedBody.task.id, generatedBody.task.id);
  assert.equal(resumedBody.task.status, 'pending');
  assert.equal(controls[1].taskId, generatedBody.task.id);
});

test('Chat endpoint sends bounded workbench context to the local AI runner', async (t) => {
  const { workbench } = fixture(t);
  const calls = [];
  const server = createApp(workbench, {
    agentKey: 'chat-test-key',
    executor: {
      snapshot: () => ({ ready: true, model: 'quality-model', recommendedModel: 'fast-model' }),
    },
    chat: async (input) => {
      calls.push(input);
      return { reply: '已读取当前项目和任务状态。' };
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/api/session`);
  const token = (await session.json()).token;
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '查看待处理任务' }] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: '已读取当前项目和任务状态。' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /当前工作台上下文/);
  assert.match(calls[0].prompt, /查看待处理任务/);
  assert.doesNotMatch(calls[0].prompt, /Codex/i);
  assert.equal(calls[0].model, 'fast-model');
  assert.equal(workbench.publicState().memory.entries.length, 0);
});

test('Chat captures only explicit memory and includes it in later context', async (t) => {
  const { workbench } = fixture(t);
  const project = workbench.createProject({ name: 'Memory collection' });
  const calls = [];
  const server = createApp(workbench, {
    agentKey: 'chat-memory-key',
    executor: { ready: true, model: 'test-model' },
    chat: async (input) => {
      calls.push(input);
      return { reply: '已记住这条品牌规则。' };
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      messages: [{ role: 'user', content: '记住：Logo 优先使用小面积同色刺绣' }],
    }),
  });
  assert.equal(response.status, 200);
  const memory = workbench.publicState().memory.entries[0];
  assert.equal(memory.projectId, project.id);
  assert.equal(memory.source, 'chat-explicit');
  assert.match(calls[0].prompt, /longTermMemory/);
  assert.match(calls[0].prompt, /Logo 优先使用小面积同色刺绣/);
  assert.match(calls[0].prompt, /capturedThisTurn/);
});

test('Chat endpoint rejects invalid or unauthenticated messages', async (t) => {
  const { workbench } = fixture(t);
  const server = createApp(workbench, {
    agentKey: 'chat-test-key',
    executor: { ready: true },
    chat: async () => ({ reply: '不应调用' }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (
      await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }),
      })
    ).status,
    401,
  );
  const session = await fetch(`${base}/api/session`);
  const token = (await session.json()).token;
  assert.equal(
    (
      await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'X-Badmark-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      })
    ).status,
    400,
  );
});

test('account login endpoint returns only the authorization URL and refreshes executor state', async (t) => {
  const { workbench } = fixture(t);
  let finishLogin;
  let checks = 0;
  let loginState = 'pending';
  const completion = new Promise((resolve) => (finishLogin = resolve));
  completion.then(() => (loginState = 'succeeded'));
  const server = createApp(workbench, {
    agentKey: 'login-test-key',
    executor: {
      check: async () => {
        checks++;
        return { ready: true };
      },
    },
    login: async () => ({
      authUrl: 'https://auth.openai.com/authorize?client=badmark',
      loginId: 'login-1',
      completion,
    }),
    loginStatus: () => ({ state: loginState, loginId: 'login-1', error: null }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/api/session`);
  const token = (await session.json()).token;
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-Badmark-Token': token },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authUrl: 'https://auth.openai.com/authorize?client=badmark',
    loginId: 'login-1',
  });
  assert.equal(checks, 0);
  finishLogin({ success: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  const status = await fetch(`${base}/api/auth/status`, {
    headers: { 'X-Badmark-Token': token },
  });
  assert.equal((await status.json()).state, 'succeeded');
});

test('account login endpoint remains private and requires the local executor', async (t) => {
  const { workbench } = fixture(t);
  const server = createApp(workbench, { agentKey: 'login-test-key' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status, 401);
  const session = await fetch(`${base}/api/session`);
  const token = (await session.json()).token;
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'X-Badmark-Token': token },
      })
    ).status,
    503,
  );
});
