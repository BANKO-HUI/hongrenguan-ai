import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { Executor, readGeneratedImage, representativeReportPages } from '../server/executor.js';
import { ApiProfileStore } from '../server/api-profile-store.js';
import { removeTemporaryDirectory } from '../server/temporary.js';
import { fixture, prepared, pdf, png, sampleAnalysis, series } from './helpers.js';

const inspect = async () => ({
  ready: true,
  imageGeneration: true,
  model: 'test-model',
  models: [
    {
      id: 'test-model',
      displayName: 'Test Model',
      description: 'Primary test model',
      isDefault: true,
    },
    {
      id: 'alternate-model',
      displayName: 'Alternate Model',
      description: 'Alternate test model',
      isDefault: false,
    },
  ],
  message: 'Test executor',
});
const resultImage = await sharp({
  create: { width: 512, height: 768, channels: 3, background: '#345678' },
})
  .png()
  .toBuffer();
const until = async (predicate) => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Executor did not reach expected state');
};
function worker(t, w, run, extra = {}) {
  const e = new Executor(w, {
    inspect,
    run,
    readImage: () => resultImage,
    interval: 5,
    paused: false,
    ...extra,
  });
  t.after(() => e.stop());
  e.start();
  return e;
}

test('executor keeps first launch on account setup when inspection fails', async (t) => {
  const { workbench: w } = fixture(t);
  const e = new Executor(w, {
    inspect: async () => {
      throw new Error('fixture runtime unavailable');
    },
  });
  t.after(() => e.stop());
  assert.equal(e.snapshot().checking, true);
  assert.equal(e.snapshot().authRequired, true);
  const status = await e.check();
  assert.equal(status.ready, false);
  assert.equal(status.checking, false);
  assert.equal(status.authRequired, true);
  assert.match(status.message, /fixture runtime unavailable/);
});

test('executor distinguishes a later AI outage from a signed-out account', async (t) => {
  const { workbench: w } = fixture(t);
  let available = true;
  const e = new Executor(w, {
    inspect: async () => {
      if (!available) throw new Error('fixture network unavailable');
      return {
        ...(await inspect()),
        authRequired: false,
        account: { email: 'designer@example.com', planType: 'plus' },
      };
    },
  });
  t.after(() => e.stop());
  assert.equal((await e.check()).ready, true);
  available = false;
  const status = await e.check();
  assert.equal(status.ready, false);
  assert.equal(status.authRequired, false);
  assert.deepEqual(status.account, { email: 'designer@example.com', planType: 'plus' });
});

test('usage-limit failures block later image tasks while analysis remains available', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 1);
  const second = await prepared(w, 1);
  const firstTask = w.createTask(first.id, { kind: 'series' });
  const secondTask = w.createTask(second.id, { kind: 'series' });
  let imageCalls = 0;
  const e = worker(
    t,
    w,
    async ({ schema }) => {
      if (schema.properties.analysis) return { analysis: sampleAnalysis };
      imageCalls++;
      throw new Error('图像生成服务已达到使用额度上限（429 usage_limit_reached）');
    },
    { taskConcurrency: 1 },
  );

  await until(
    () => w.store.state.tasks.find((task) => task.id === firstTask.id).status === 'failed',
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  const blocked = e.snapshot();
  assert.equal(blocked.ready, true);
  assert.equal(blocked.imageGeneration, false);
  assert.equal(blocked.imageIssue.code, 'usage-limit');
  assert.equal(blocked.imageIssue.providerMode, 'account');
  assert.match(blocked.message, /帐号生图额度已达到上限/);
  assert.equal(w.store.state.tasks.find((task) => task.id === secondTask.id).status, 'pending');
  assert.equal(imageCalls, 1);
  assert.throws(() => e.control('start-task', null, secondTask.id), /帐号生图额度已达到上限/);

  const uploaded = await w.uploadTrend(await png('orange'), 'quota-analysis.png');
  await until(
    () => w.store.state.tasks.find((task) => task.id === uploaded.task.id).status === 'completed',
  );
  assert.equal(imageCalls, 1);
});

test('unavailable analysis models stop queued generation before image work starts', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 1);
  const second = await prepared(w, 1);
  const firstTask = w.createTask(first.id, { kind: 'series' });
  const secondTask = w.createTask(second.id, { kind: 'series' });
  let calls = 0;
  const e = new Executor(w, {
    inspect,
    run: async () => {
      calls++;
      throw new Error(
        'Current group CodexReverse has no available channels for model gpt-image-2.5-all under billing mode pay-as-you-go',
      );
    },
    interval: 5,
    paused: false,
    taskConcurrency: 1,
  });
  e.providerMode = 'third-party';
  t.after(() => e.stop());
  e.start();

  await until(
    () => w.store.state.tasks.find((task) => task.id === firstTask.id).status === 'failed',
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  const blocked = e.snapshot();
  assert.equal(blocked.ready, false);
  assert.equal(blocked.authRequired, false);
  assert.equal(blocked.imageGeneration, false);
  assert.equal(blocked.providerIssue.code, 'analysis-model-unavailable');
  assert.match(blocked.message, /任务尚未进入生图阶段/);
  assert.equal(w.store.state.tasks.find((task) => task.id === secondTask.id).status, 'pending');
  assert.equal(calls, 1);

  e.control('pause');
  const recovered = await e.check();
  assert.equal(recovered.ready, true);
  assert.equal(recovered.providerIssue, undefined);
});

test('executor falls back from a hidden configured model to the available fast model', async (t) => {
  const { workbench: w } = fixture(t);
  const e = new Executor(w, {
    inspect: async () => ({
      ready: true,
      imageGeneration: true,
      model: 'hidden-mini',
      models: [
        { id: 'hidden-mini', displayName: 'Hidden', hidden: true, isDefault: false },
        { id: 'gpt-6-astra', displayName: 'Astra', hidden: false, isDefault: true },
        { id: 'gpt-5.6-luna', displayName: 'Luna', hidden: false, isDefault: false },
      ],
      message: 'Test executor',
    }),
  });
  t.after(() => e.stop());
  const status = await e.check();
  assert.equal(status.model, 'gpt-5.6-luna');
  assert.ok(status.models.every((model) => !model.hidden));
});

test('executor prefers the latest fast model and persists performance settings', async (t) => {
  const { workbench: w } = fixture(t);
  const inspectModels = async () => ({
    ready: true,
    imageGeneration: true,
    model: 'gpt-5.6-sol',
    models: [
      { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', isDefault: true },
      { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', isDefault: false },
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', isDefault: false },
      { id: 'gpt-5.6-luna', displayName: 'GPT-5.6-Luna', isDefault: false },
    ],
    message: 'Test executor',
  });
  const first = new Executor(w, { inspect: inspectModels });
  t.after(() => first.stop());
  const initial = await first.check();
  assert.equal(initial.model, 'gpt-6-luna');
  assert.equal(initial.recommendedModel, 'gpt-6-luna');
  first.control('model', 'gpt-5.6-sol');
  first.control('concurrency', 3);
  first.control('task-concurrency', 2);

  const restored = new Executor(w, { inspect: inspectModels });
  t.after(() => restored.stop());
  const status = await restored.check();
  assert.equal(status.model, 'gpt-5.6-sol');
  assert.equal(restored.snapshot().concurrency, 3);
  assert.equal(restored.snapshot().taskConcurrency, 2);
  assert.deepEqual(w.store.state.executorSettings, {
    version: 2,
    model: 'gpt-5.6-sol',
    concurrency: 3,
    taskConcurrency: 2,
    smartConcurrency: true,
  });
});

test('smart concurrency has no configured ceiling and backs off on service pressure', async (t) => {
  const { workbench: w } = fixture(t);
  const e = new Executor(w, {
    inspect,
    smartConcurrency: true,
    smartSuccessTarget: 2,
    smartTaskSuccessTarget: 1,
    smartCooldownMs: 5,
  });
  t.after(() => e.stop());
  e.providerMode = 'third-party';
  e.concurrency = 3;
  e.taskConcurrency = 3;

  e.recordSmartImageSuccess();
  e.recordSmartImageSuccess();
  assert.equal(e.snapshot().concurrency, 4);

  e.recordSmartFailure(new Error('OpenAI request failed: UND_ERR_SOCKET'));
  const reduced = e.snapshot();
  assert.equal(reduced.concurrency, 2);
  assert.equal(reduced.taskConcurrency, 2);
  assert.equal(reduced.smartConcurrency.state, 'recovering');

  await new Promise((resolve) => setTimeout(resolve, 10));
  e.recordSmartImageSuccess();
  e.recordSmartImageSuccess();
  e.recordSmartTaskSuccess();
  const recovered = e.snapshot();
  assert.equal(recovered.concurrency, 3);
  assert.equal(recovered.taskConcurrency, 3);

  e.providerMode = 'account';
  e.reconcileSmartLimits();
  e.recordSmartImageSuccess();
  e.recordSmartImageSuccess();
  assert.equal(e.snapshot().concurrency, 4);
  assert.equal(e.snapshot().smartConcurrency.image.max, null);
  assert.equal(e.snapshot().smartConcurrency.tasks.max, null);
  assert.equal(e.snapshot().smartConcurrency.unlimited, true);

  e.control('concurrency', 12);
  e.control('task-concurrency', 8);
  assert.equal(e.snapshot().concurrency, 12);
  assert.equal(e.snapshot().taskConcurrency, 8);
});

test('executor switches to a session-only third-party provider without persisting credentials', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const calls = [];
  const thirdParty = {
    config: null,
    configure(input) {
      this.config = { ...input, hasApiKey: true, sessionOnly: true };
      return {
        mode: 'third-party',
        baseUrl: input.baseUrl,
        textModel: input.textModel,
        imageModel: input.imageModel,
        imageGeneration: true,
        imageSize: input.imageSize,
        hasApiKey: true,
        sessionOnly: true,
      };
    },
    snapshot() {
      return this.config
        ? {
            mode: 'third-party',
            baseUrl: this.config.baseUrl,
            textModel: this.config.textModel,
            imageModel: this.config.imageModel,
            imageGeneration: true,
            imageSize: this.config.imageSize,
            hasApiKey: true,
            sessionOnly: true,
          }
        : { mode: 'third-party', hasApiKey: false, sessionOnly: true };
    },
    async inspect() {
      return {
        ready: true,
        authRequired: false,
        account: null,
        imageGeneration: true,
        model: this.config.textModel,
        models: [{ id: this.config.textModel, displayName: this.config.textModel }],
        message: 'Third-party fixture ready',
      };
    },
    async run(input) {
      calls.push(input);
      return { reply: '已通过第三方接口返回' };
    },
    setTextModel(value) {
      this.config.textModel = value;
    },
  };
  const executor = new Executor(w, { thirdParty });
  t.after(() => executor.stop());
  const status = await executor.configureProvider({
    mode: 'third-party',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'never-persist-this-secret',
    textModel: 'compatible-text-model',
    imageModel: 'compatible-image-model',
    imageGeneration: true,
    imageSize: '1024x1536',
  });
  assert.equal(status.ready, true);
  assert.equal(status.authRequired, false);
  assert.equal(executor.snapshot().provider.mode, 'third-party');
  assert.doesNotMatch(JSON.stringify(executor.snapshot()), /never-persist-this-secret/);
  assert.deepEqual(await executor.runRequest({ prompt: 'hello' }), {
    reply: '已通过第三方接口返回',
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(
    readFileSync(path.join(directory, 'state.json'), 'utf8'),
    /never-persist-this-secret/,
  );
  assert.doesNotMatch(
    readFileSync(path.join(directory, 'state.json'), 'utf8'),
    /api\.example\.com/,
  );
  assert.doesNotMatch(
    readFileSync(path.join(directory, 'state.json'), 'utf8'),
    /compatible-text-model/,
  );
});

test('executor switches to saved APIs even when their roles were previously disabled', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const apiProfiles = new ApiProfileStore(directory);
  const analysis = apiProfiles.create({
    name: '分析',
    baseUrl: 'https://analysis.example.com/v1',
    apiKey: 'analysis-secret',
    analysisModel: 'vision-model',
    enabled: true,
    roles: { analysis: false, image: false },
  });
  const image = apiProfiles.create({
    name: '生图',
    baseUrl: 'https://image.example.com/v1',
    apiKey: 'image-secret',
    imageModel: 'image-model',
    enabled: true,
    roles: { analysis: false, image: false },
  });
  const thirdParty = {
    config: null,
    configure(input) {
      this.config = input;
      return {
        mode: 'third-party',
        textModel: input.analysisModel,
        imageModel: input.imageModel,
        imageGeneration: input.imageGeneration,
      };
    },
    snapshot() {
      return {
        mode: 'third-party',
        textModel: this.config?.analysisModel || '',
        imageModel: this.config?.imageModel || '',
        imageGeneration: this.config?.imageGeneration ?? false,
      };
    },
    async inspect() {
      return {
        ready: true,
        authRequired: false,
        account: null,
        imageGeneration: this.config.imageGeneration,
        model: this.config.analysisModel,
        models: [{ id: this.config.analysisModel, displayName: this.config.analysisModel }],
        message: 'Saved API ready',
      };
    },
    setTextModel(value) {
      this.config.analysisModel = value;
    },
  };
  const executor = new Executor(w, { apiProfiles, thirdParty });
  t.after(() => executor.stop());

  const status = await executor.configureProvider({ mode: 'third-party' });
  assert.equal(status.ready, true);
  assert.equal(executor.snapshot().provider.mode, 'third-party');
  assert.equal(executor.snapshot().provider.persistent, true);
  assert.deepEqual(executor.snapshot().provider.activeProfiles, {
    analysis: analysis.id,
    image: image.id,
  });
});

test('closing one saved API stays in API mode and only closing all APIs returns to account mode', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const apiProfiles = new ApiProfileStore(directory);
  const fallback = apiProfiles.create({
    name: '备用 API',
    baseUrl: 'https://fallback.example.com/v1',
    apiKey: 'fallback-secret',
    analysisModel: 'fallback-vision',
    imageModel: 'fallback-image',
    enabled: true,
    roles: { analysis: true, image: true },
  });
  const primary = apiProfiles.create({
    name: '主 API',
    baseUrl: 'https://primary.example.com/v1',
    apiKey: 'primary-secret',
    analysisModel: 'primary-vision',
    imageModel: 'primary-image',
    enabled: true,
    roles: { analysis: true, image: true },
  });
  const thirdParty = {
    config: null,
    configure(input) {
      this.config = input;
      return this.snapshot();
    },
    snapshot() {
      return {
        mode: 'third-party',
        textModel: this.config?.analysisModel || '',
        imageModel: this.config?.imageModel || '',
        imageGeneration: Boolean(this.config?.imageGeneration),
      };
    },
    async inspect() {
      return {
        ready: true,
        authRequired: false,
        account: null,
        imageGeneration: Boolean(this.config?.imageGeneration),
        model: this.config?.analysisModel || null,
        models: this.config?.analysisModel
          ? [{ id: this.config.analysisModel, displayName: this.config.analysisModel }]
          : [],
        message: 'Saved API ready',
      };
    },
    setTextModel(value) {
      this.config.analysisModel = value;
    },
  };
  const executor = new Executor(w, {
    apiProfiles,
    thirdParty,
    inspect: async () => ({
      ready: true,
      authRequired: false,
      account: { email: 'designer@example.com', planType: 'plus' },
      imageGeneration: true,
      model: 'account-model',
      models: [{ id: 'account-model', displayName: 'Account model' }],
      message: 'Account ready',
    }),
  });
  t.after(() => executor.stop());

  await executor.updateProviderProfile(primary.id, { enabled: false });
  assert.equal(executor.snapshot().providerMode, 'third-party');
  assert.deepEqual(executor.snapshot().provider.activeProfiles, {
    analysis: fallback.id,
    image: fallback.id,
  });

  await executor.updateProviderProfile(fallback.id, { enabled: false });
  assert.equal(executor.snapshot().providerMode, 'account');
  assert.equal(executor.snapshot().provider.mode, 'account');
});

test('expired API keys explain why Chat and tasks are unavailable', async (t) => {
  const { workbench: w } = fixture(t);
  const executor = new Executor(w, {
    inspect: async () => {
      throw new Error('Your API key has expired. Create a new API key to continue.');
    },
  });
  executor.providerMode = 'third-party';
  t.after(() => executor.stop());

  const status = await executor.check();
  assert.equal(status.ready, false);
  assert.match(status.message, /API Key 已过期/);
  assert.match(status.message, /Chat 和任务均无法执行/);
});

test('executor restores saved API profiles without exposing credentials to public state', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const provider = () => ({
    config: null,
    configure(input) {
      this.config = {
        textModel: input.analysisModel,
        imageModel: input.imageModel,
        imageGeneration: input.imageGeneration,
      };
      return this.snapshot();
    },
    snapshot() {
      return {
        mode: 'third-party',
        textModel: this.config?.textModel || '',
        imageModel: this.config?.imageModel || '',
        imageGeneration: this.config?.imageGeneration ?? false,
        sessionOnly: true,
      };
    },
    async inspect() {
      return {
        ready: true,
        authRequired: false,
        account: null,
        imageGeneration: this.config.imageGeneration,
        model: this.config.textModel,
        models: [{ id: this.config.textModel, displayName: this.config.textModel }],
        message: 'Saved API ready',
      };
    },
    setTextModel(value) {
      this.config.textModel = value;
    },
  });
  const first = new Executor(w, { thirdParty: provider() });
  t.after(() => first.stop());
  const status = await first.createProviderProfile({
    name: '主 API',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'persisted-secret-key',
    analysisModel: 'vision-model',
    imageModel: 'image-model',
    enabled: true,
    roles: { analysis: true, image: true },
  });
  assert.equal(status.ready, true);
  assert.equal(first.snapshot().provider.persistent, true);
  assert.equal(first.snapshot().provider.profiles[0].keyStored, true);
  assert.doesNotMatch(JSON.stringify(first.snapshot()), /persisted-secret-key/);
  assert.doesNotMatch(
    readFileSync(path.join(directory, 'state.json'), 'utf8'),
    /persisted-secret-key/,
  );
  assert.match(
    readFileSync(path.join(directory, 'api-providers.json'), 'utf8'),
    /persisted-secret-key/,
  );

  const restored = new Executor(w, { thirdParty: provider() });
  t.after(() => restored.stop());
  assert.equal(restored.snapshot().providerMode, 'third-party');
  assert.equal(restored.snapshot().authRequired, false);
  assert.equal((await restored.check()).ready, true);
});

test('UI-created analysis executes without agent submission and renders real report pages', async (t) => {
  const { workbench: w } = fixture(t);
  const p = w.createProject({ name: 'Auto report' });
  await w.upload(p.id, 'report', pdf(), 'trend.pdf');
  const task = w.createTask(p.id, { kind: 'analysis' });
  let calls = 0;
  worker(t, w, async ({ prompt, schema, signal, images }) => {
    calls++;
    assert.match(prompt, /report-page-1.png/);
    assert.match(prompt, /Trail clothing/);
    assert.match(prompt, /attached rendered page images/);
    assert.match(prompt, /Attachment page map/);
    assert.doesNotMatch(prompt, /view_image/);
    assert.equal(images.length, 1);
    assert.match(images[0], /report-page-1.png$/);
    assert.ok(schema.properties.analysis);
    assert.deepEqual(
      schema.properties.analysis.anyOf[0].properties.evidence.items.required.sort(),
      ['note', 'page', 'sourceKind'],
    );
    assert.equal(signal.aborted, false);
    return { analysis: sampleAnalysis };
  });
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(calls, 1);
  assert.equal(w.store.state.projects[0].analysis.taskId, task.id);
});

test('long trend reports attach representative pages from cover to final page', () => {
  const pages = Array.from({ length: 19 }, (_, index) => ({
    page: index + 1,
    path: `/tmp/report-page-${index + 1}.png`,
  }));

  assert.deepEqual(
    representativeReportPages(pages).map((item) => item.page),
    [1, 6, 10, 15, 19],
  );
  assert.deepEqual(
    representativeReportPages(pages.slice(0, 3)).map((item) => item.page),
    [1, 2, 3],
  );
});

test('executor requires an explicit start and pause preserves the current task', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  const task = w.createTask(p.id, { kind: 'series' });
  let started = false,
    aborted = false;
  const e = new Executor(w, {
    inspect,
    interval: 5,
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        started = true;
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('paused'));
          },
          { once: true },
        );
      }),
  });
  t.after(() => e.stop());
  e.start();
  await e.check();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(w.store.state.tasks[0].status, 'pending');
  assert.equal(e.snapshot().paused, true);
  assert.equal(e.snapshot().concurrency, 3);
  e.control('model', 'alternate-model');
  e.control('concurrency', 3);
  assert.equal(e.snapshot().concurrency, 3);
  assert.equal(e.snapshot().model, 'alternate-model');
  e.control('resume');
  await until(() => w.store.state.tasks[0].status === 'running');
  await until(() => started);
  assert.throws(() => e.control('model', 'test-model'), /暂停/);
  assert.throws(() => e.control('concurrency', 1), /暂停/);
  e.control('pause');
  await until(() => aborted);
  assert.equal(w.store.state.tasks[0].id, task.id);
  assert.equal(w.store.state.tasks[0].status, 'paused');
  assert.equal(w.store.state.tasks[0].results.length, 0);
});

test('series generation runs three independent image slots concurrently by default', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 3);
  w.createTask(p.id, { kind: 'series' });
  const plan = [1, 2, 3].map((slot) => ({
    slot,
    title: `Look ${slot}`,
    prompt: `Design ${slot}`,
    designNotes: `Distinct details ${slot}`,
  }));
  const images = await Promise.all(
    ['green', 'yellow', 'purple'].map((color) =>
      sharp({
        create: { width: 512, height: 768, channels: 3, background: color },
      })
        .png()
        .toBuffer(),
    ),
  );
  let active = 0;
  let peak = 0;
  worker(
    t,
    w,
    async ({ schema, prompt, images }) => {
      if (schema.properties.plan) {
        assert.match(prompt, /exact number of subjects/);
        assert.match(prompt, /masculine-presenting reference subject in menswear/);
        assert.match(prompt, /feminine-presenting reference subject in womenswear/);
        assert.match(prompt, /coordinated couple looks/);
        assert.match(prompt, /coordinated series looks/);
        assert.ok(images.length >= 3 && images.length <= 5);
        assert.ok(images.every((filename) => path.isAbsolute(filename)));
        return { plan };
      }
      const slot = Number(prompt.match(/"slot":(\d+)/)?.[1]);
      assert.ok(slot >= 1 && slot <= 3);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--;
      return { image: { filePath: `slot-${slot}`, review: 'Validated test image' } };
    },
    { readImage: (filename) => images[Number(filename.replace('slot-', '')) - 1] },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(peak, 3);
  assert.equal(w.store.state.projects[0].looks.length, 3);
});

test('executor runs different projects and trend analysis concurrently', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 1);
  const second = await prepared(w, 1);
  w.createTask(first.id, { kind: 'series' });
  w.createTask(second.id, { kind: 'series' });
  const trend = await w.uploadTrend(pdf(), 'parallel-trend.pdf');
  let active = 0;
  let peak = 0;
  worker(
    t,
    w,
    async ({ schema }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active--;
      if (schema.properties.analysis) return { analysis: sampleAnalysis };
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Parallel look',
            prompt: 'Independent collection',
            designNotes: 'Parallel execution',
          },
          image: { filePath: 'parallel-result', review: 'Ready' },
        },
      };
    },
    { taskConcurrency: 3, readImage: () => resultImage },
  );
  await until(() => w.store.state.tasks.slice(0, 3).every((task) => task.status === 'completed'));
  assert.equal(peak, 3);
  assert.equal(
    w.publicState().trendLibrary.items.find((item) => item.id === trend.item.id).status,
    'ready',
  );
  assert.equal(
    w
      .publicState()
      .projects.filter((project) => [first.id, second.id].includes(project.id))
      .every((project) => project.looks.length === 1),
    true,
  );
});

test('multiple series share the global image concurrency limit', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 3);
  const second = await prepared(w, 3);
  w.createTask(first.id, { kind: 'series' });
  w.createTask(second.id, { kind: 'series' });
  const plan = [1, 2, 3].map((slot) => ({
    slot,
    title: `Shared slot ${slot}`,
    prompt: `Shared design ${slot}`,
    designNotes: `Global concurrency ${slot}`,
  }));
  const images = await Promise.all(
    ['#112233', '#223344', '#334455', '#445566', '#556677', '#667788'].map((background) =>
      sharp({ create: { width: 512, height: 768, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  );
  let activeImages = 0;
  let peakImages = 0;
  let imageNumber = 0;
  worker(
    t,
    w,
    async ({ schema }) => {
      if (schema.properties.plan) return { plan };
      const current = imageNumber++;
      activeImages++;
      peakImages = Math.max(peakImages, activeImages);
      await new Promise((resolve) => setTimeout(resolve, 35));
      activeImages--;
      return { image: { filePath: `shared-${current}`, review: 'Ready' } };
    },
    {
      concurrency: 2,
      taskConcurrency: 2,
      readImage: (filename) => images[Number(filename.replace('shared-', ''))],
    },
  );
  await until(() => w.store.state.tasks.slice(0, 2).every((task) => task.status === 'completed'));
  assert.equal(peakImages, 2);
  assert.equal(w.store.state.projects.find((project) => project.id === first.id).looks.length, 3);
  assert.equal(w.store.state.projects.find((project) => project.id === second.id).looks.length, 3);
});

test('one task can start, pause and restart while the global queue remains paused', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 1);
  const second = await prepared(w, 1);
  const firstTask = w.createTask(first.id, { kind: 'series' });
  const secondTask = w.createTask(second.id, { kind: 'series' });
  let starts = 0;
  const executor = new Executor(w, {
    inspect,
    interval: 5,
    paused: true,
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        starts++;
        signal.addEventListener('abort', () => reject(new Error('controlled stop')), {
          once: true,
        });
      }),
  });
  t.after(() => executor.stop());
  executor.start();
  await executor.check();
  executor.control('start-task', null, firstTask.id);
  await until(
    () => w.store.state.tasks.find((task) => task.id === firstTask.id).status === 'running',
  );
  await until(() => starts >= 1);
  assert.equal(w.store.state.tasks.find((task) => task.id === secondTask.id).status, 'pending');
  executor.control('pause-task', null, firstTask.id);
  await until(
    () => w.store.state.tasks.find((task) => task.id === firstTask.id).status === 'paused',
  );
  executor.control('start-task', null, firstTask.id);
  await until(() => starts >= 2);
  executor.control('restart-task', null, firstTask.id);
  await until(() => starts >= 3);
  executor.control('pause-task', null, firstTask.id);
  assert.equal(executor.snapshot().paused, true);
  assert.equal(w.store.state.tasks.find((task) => task.id === secondTask.id).status, 'pending');
});

test('multiple tasks can be started independently while the global queue stays paused', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 1);
  const second = await prepared(w, 1);
  const firstTask = w.createTask(first.id, { kind: 'series' });
  const secondTask = w.createTask(second.id, { kind: 'series' });
  let active = 0;
  let peak = 0;
  const executor = new Executor(w, {
    inspect,
    interval: 5,
    paused: true,
    run: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--;
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Parallel manual start',
            prompt: 'Independent task',
            designNotes: 'Run at the same time',
          },
          image: { filePath: 'manual-parallel', review: 'Ready' },
        },
      };
    },
    readImage: () => resultImage,
  });
  t.after(() => executor.stop());
  executor.start();
  await executor.check();
  executor.control('start-task', null, firstTask.id);
  executor.control('start-task', null, secondTask.id);
  await until(() =>
    w.store.state.tasks
      .filter((task) => [firstTask.id, secondTask.id].includes(task.id))
      .every((task) => task.status === 'completed'),
  );
  assert.equal(peak, 2);
  assert.equal(executor.snapshot().paused, true);
});

test('bestseller variation can use a frozen finished look as its source', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 1);
  await series(w, project.id, ['green']);
  const source = w.publicState().projects.find((item) => item.id === project.id).looks[0];
  const task = w.createTask(project.id, {
    kind: 'viral',
    lookIds: [source.id],
    count: 1,
    instruction: '保持核心结构，沿趋势调整面料和配色。',
  });
  let calls = 0;
  worker(t, w, async ({ prompt, images, schema }) => {
    calls++;
    assert.match(prompt, /selected bestseller/);
    assert.match(prompt, new RegExp(`scene:${source.id}`));
    assert.ok(images.length >= 1 && images.length <= 5);
    assert.ok(schema.properties.result);
    return {
      result: {
        plan: {
          slot: 1,
          title: 'Controlled variation',
          prompt: 'Preserve signature structure',
          designNotes: 'Fabric and palette variation',
        },
        image: { filePath: 'viral-look-result', review: 'Ready' },
      },
    };
  });
  await until(() => w.store.state.tasks.find((item) => item.id === task.id).status === 'completed');
  const looks = w.publicState().projects.find((item) => item.id === project.id).looks;
  assert.equal(calls, 1);
  assert.equal(looks.length, 2);
  assert.equal(looks[0].scene, source.scene);
  assert.equal(looks[1].originKind, 'viral');
});

test('stalled execution is automatically reclaimed and continued', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 1);
  const task = w.createTask(project.id, { kind: 'series' });
  let starts = 0;
  const executor = worker(
    t,
    w,
    ({ signal }) =>
      new Promise((_resolve, reject) => {
        starts++;
        signal.addEventListener('abort', () => reject(new Error('stalled run reclaimed')), {
          once: true,
        });
      }),
    { stalledAfter: 30 },
  );
  await until(() => starts >= 2);
  assert.ok(w.store.state.tasks.find((candidate) => candidate.id === task.id).attempts >= 2);
  executor.control('pause-task', null, task.id);
});

test('a one-look series combines planning and generation into one low-latency call', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  const background = await w.uploadMaterial('custom', await png('green'), 'forest-background.png');
  const current = w.publicState().projects.find((project) => project.id === p.id);
  w.updateProject(p.id, {
    backgroundRefId: background.id,
    expectedRevision: current.revision,
  });
  w.createTask(p.id, {
    kind: 'series',
    channel: 'chat',
    instruction: '生成春夏街头情侣款，并使用当前项目已有参考素材。',
  });
  let calls = 0;
  worker(
    t,
    w,
    async ({ schema, prompt, images }) => {
      calls++;
      assert.ok(schema.properties.result);
      assert.match(prompt, /exactly ONE native image_gen\.imagegen call/);
      assert.match(
        prompt,
        /high-priority cast, identity, anatomy, and wardrobe-category constraint/,
      );
      assert.match(prompt, /height-to-body ratio/);
      assert.match(prompt, /masculine-presenting reference subject in menswear/);
      assert.match(prompt, /feminine-presenting reference subject in womenswear/);
      assert.match(prompt, /preserve the exact number of people/);
      assert.match(prompt, /coordinated couple looks/);
      assert.match(prompt, /coordinated series looks/);
      assert.match(prompt, /Never drop, add, merge, duplicate, or swap subjects/);
      assert.match(prompt, /verify the subject count, cast identity, body proportions/);
      assert.match(prompt, /real background, never a white-background product image/);
      assert.match(prompt, /designated background reference as the primary environment/);
      assert.match(prompt, /"background":/);
      assert.match(prompt, /Chat 追加要求：生成春夏街头情侣款/);
      assert.ok(images.length >= 3);
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Fast single look',
            prompt: 'Coordinated trail outfit',
            designNotes: 'Lightweight layered construction',
          },
          image: { filePath: 'single-result', review: 'Ready for user review' },
        },
      };
    },
    { readImage: () => resultImage },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(calls, 1);
  assert.equal(w.store.state.tasks[0].plan.length, 1);
  assert.equal(w.store.state.projects[0].looks[0].title, 'Fast single look');
});

test('series generation creates a trend-matched model and scene when optional references are absent', async (t) => {
  const { workbench: w } = fixture(t);
  const uploaded = await w.uploadTrend(await png('green'), 'direction.png');
  const claim = w.claim(uploaded.task.id).claim;
  w.submitAnalysis(uploaded.task.id, claim, sampleAnalysis);
  w.complete(uploaded.task.id, claim);
  const project = w.createProject({ name: 'Reference-free collection', lookCount: 1 });
  w.updateProject(project.id, {
    trendRefs: [{ trendId: uploaded.item.id, role: 'primary' }],
    expectedRevision: project.revision,
  });
  w.createTask(project.id, { kind: 'series' });
  worker(
    t,
    w,
    async ({ prompt }) => {
      assert.match(prompt, /No model reference is supplied/);
      assert.match(prompt, /model cast, appearance, body type, subject count/);
      assert.match(prompt, /menswear, womenswear, or unisex wardrobe category/);
      assert.match(prompt, /Create an environment that matches the collection theme and outfit/);
      assert.match(prompt, /No Logo reference is supplied, so no Logo is required/);
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Trend-matched look',
            prompt: 'Theme-led outfit and setting',
            designNotes: 'No optional references required',
          },
          image: { filePath: 'reference-free-result', review: 'Ready' },
        },
      };
    },
    { readImage: () => resultImage },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(w.store.state.projects[0].looks[0].title, 'Trend-matched look');
});

test('single-look generation downsizes references and retries transient image service errors', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  const largeModel = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: '#ad7668' },
  })
    .png()
    .toBuffer();
  await w.upload(p.id, 'model', largeModel, 'large-model.png');
  w.confirm(p.id);
  w.createTask(p.id, { kind: 'series' });
  let calls = 0;
  let referenceDimensions;
  worker(
    t,
    w,
    async ({ images }) => {
      calls++;
      referenceDimensions = await sharp(images[0]).metadata();
      if (calls === 1) throw new Error('image_gen.imagegen returned 500 Internal Server Error');
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Recovered look',
            prompt: 'Fast coordinated outfit',
            designNotes: 'Recovered after a transient provider error',
          },
          image: { filePath: 'recovered-result', review: 'Ready' },
        },
      };
    },
    { readImage: () => resultImage, imageRetries: 2, retryDelay: 1 },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(calls, 2);
  assert.ok(referenceDimensions.width <= 1536);
  assert.ok(referenceDimensions.height <= 1536);
  assert.equal(w.store.state.projects[0].looks[0].title, 'Recovered look');
});

test('task scratch directories stay in workspace data and cleanup errors cannot fail generation', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  w.createTask(p.id, { kind: 'series' });
  let scratchDirectory;
  const cleanupCalls = [];
  worker(
    t,
    w,
    async ({ directory }) => {
      scratchDirectory = directory;
      return {
        result: {
          plan: {
            slot: 1,
            title: 'Windows-safe look',
            prompt: 'Workspace-local task scratch',
            designNotes: 'Cleanup is best effort',
          },
          image: { filePath: 'windows-safe-result', review: 'Ready' },
        },
      };
    },
    {
      readImage: () => resultImage,
      cleanupJobDirectory: async (directory) => {
        cleanupCalls.push(directory);
        return false;
      },
    },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  const jobRoot = path.join(w.store.directory, 'jobs') + path.sep;
  assert.ok(scratchDirectory.startsWith(jobRoot));
  assert.deepEqual(cleanupCalls, [path.dirname(scratchDirectory)]);
});

test('temporary cleanup retries Windows EPERM and succeeds without surfacing the lock', async () => {
  let attempts = 0;
  const waits = [];
  const removed = await removeTemporaryDirectory('C:\\workspace\\jobs\\job-test', {
    remove: async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    },
    wait: async (milliseconds) => waits.push(milliseconds),
    retryDelays: [0, 10, 20],
    warn: null,
    scheduleDeferred: false,
  });
  assert.equal(removed, true);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 20]);
});

test('a persistent Windows directory lock is deferred instead of failing the task', async () => {
  let attempts = 0;
  const warnings = [];
  const removed = await removeTemporaryDirectory('C:\\workspace\\jobs\\job-locked', {
    remove: async () => {
      attempts++;
      throw Object.assign(new Error('still locked'), { code: 'EPERM' });
    },
    wait: async () => {},
    retryDelays: [0, 10, 20],
    warn: (message) => warnings.push(message),
    scheduleDeferred: false,
  });
  assert.equal(removed, false);
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /EPERM/);
});

test('regional restyle renders annotations, keeps named references and caps image inputs', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'Regional restyle' });
  const uploaded = await w.uploadRefinementReferences(
    project.id,
    await Promise.all(
      ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white'].map(async (color, index) => ({
        buffer: await sharp({
          create: { width: 96, height: 128, channels: 3, background: color },
        })
          .png()
          .toBuffer(),
        filename: `reference-${index}.png`,
      })),
    ),
  );
  w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: uploaded.assets[0].id,
    referenceAssetIds: uploaded.assets.slice(1).map((asset) => asset.id),
    referenceLabels: ['面料', '配色', '配饰', '搭配', '场景', '图案'],
    annotations: [
      {
        id: 'red-pattern',
        type: 'circle',
        mode: 'adjust',
        color: '#ef4444',
        colorName: '红色',
        label: '替换图案',
        strokeWidth: 16,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.4 },
        ],
      },
      {
        id: 'locked-body',
        type: 'brush',
        mode: 'lock',
        color: '#123456',
        colorName: '自定义色 #123456',
        label: '保持主体',
        strokeWidth: 72,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.8 },
        ],
      },
    ],
    instruction: '参考 @面料 调整外套，锁定主体保持不变。',
    background: 'white',
  });
  let received = false;
  worker(t, w, async ({ images, prompt }) => {
    received = true;
    assert.equal(images.length, 5);
    assert.match(prompt, /user-selected colors/);
    assert.match(prompt, /"colorName":"红色"/);
    assert.match(prompt, /"color":"#123456"/);
    assert.match(prompt, /every lock region must remain unchanged regardless of its color/);
    assert.match(prompt, /pure white/);
    assert.match(prompt, /reference:面料/);
    assert.match(prompt, /保持主体/);
    const annotation = await sharp(images[1]).metadata();
    assert.equal(annotation.width, 96);
    assert.equal(annotation.height, 128);
    return { image: { filePath: 'restyled-result', review: 'Regional changes applied' } };
  });
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.equal(received, true);
  assert.equal(w.store.state.projects[0].looks.length, 1);
  assert.equal(w.store.state.projects[0].looks[0].versions.length, 1);
});

test('regional restyle generates a crop and publishes a masked layer at original dimensions', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'Executor regional layer' });
  const source = await sharp({
    create: { width: 640, height: 800, channels: 4, background: '#cc2211' },
  })
    .png()
    .toBuffer();
  const uploaded = await w.uploadRefinementReferences(project.id, [
    { buffer: source, filename: 'source.png' },
  ]);
  w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: uploaded.assets[0].id,
    annotations: [
      {
        id: 'adjust-pocket',
        type: 'circle',
        mode: 'adjust',
        color: '#ef4444',
        colorName: '红色',
        label: '调整口袋',
        strokeWidth: 12,
        points: [
          { x: 0.35, y: 0.35 },
          { x: 0.65, y: 0.65 },
        ],
      },
    ],
    instruction: '只调整红色区域的口袋。',
  });
  let cropDimensions;
  worker(
    t,
    w,
    async ({ images, prompt }) => {
      cropDimensions = await sharp(images[0]).metadata();
      assert.match(prompt, /cropped screenshot/);
      assert.match(prompt, /separate transparent layer/);
      return { image: { filePath: 'regional-layer-result', review: 'Pocket adjusted' } };
    },
    { readImage: () => resultImage },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.ok(cropDimensions.width <= 640);
  assert.ok(cropDimensions.height < 800);
  const task = w.store.state.tasks[0];
  assert.ok(task.results[0].editLayer.assetId);
  const look = w.store.state.projects[0].looks[0];
  assert.equal(look.editLayer.assetId, task.results[0].editLayer.assetId);
  const metadata = await sharp(w.assetPath(look.scene)).metadata();
  assert.deepEqual([metadata.width, metadata.height], [640, 800]);
  const outside = await sharp(w.assetPath(look.scene))
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual([...outside], [204, 34, 17]);
});

test('traditional restyle keeps annotations as guidance without creating a local layer', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'Traditional annotated restyle' });
  const source = await sharp({
    create: { width: 640, height: 800, channels: 4, background: '#cc2211' },
  })
    .png()
    .toBuffer();
  const uploaded = await w.uploadRefinementReferences(project.id, [
    { buffer: source, filename: 'source.png' },
  ]);
  w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: uploaded.assets[0].id,
    layerMode: false,
    annotations: [
      {
        id: 'adjust-pocket',
        type: 'circle',
        mode: 'adjust',
        color: '#ef4444',
        colorName: '红色',
        label: '调整口袋',
        strokeWidth: 6,
        points: [
          { x: 0.35, y: 0.35 },
          { x: 0.65, y: 0.65 },
        ],
      },
    ],
    instruction: '按红色标注调整口袋，但输出完整图片。',
  });
  let inputDimensions;
  worker(
    t,
    w,
    async ({ images, prompt }) => {
      inputDimensions = await sharp(images[0]).metadata();
      assert.doesNotMatch(prompt, /cropped screenshot/);
      assert.doesNotMatch(prompt, /separate transparent layer/);
      assert.equal(images.length, 2);
      return { image: { filePath: 'traditional-result', review: 'Full image adjusted' } };
    },
    { readImage: () => resultImage },
  );
  await until(() => w.store.state.tasks[0].status === 'completed');
  assert.deepEqual([inputDimensions.width, inputDimensions.height], [640, 800]);
  const task = w.store.state.tasks[0];
  assert.equal(task.layerMode, false);
  assert.equal(task.results[0].editLayer, undefined);
  assert.equal(w.store.state.projects[0].looks[0].editLayers.length, 0);
});

test('series planning, images, partial failure, and retry only generate remaining slots', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 2);
  const task = w.createTask(p.id, { kind: 'series' });
  const plan = [1, 2].map((slot) => ({
    slot,
    title: `Look ${slot}`,
    prompt: `Design ${slot}`,
    designNotes: 'Ripstop',
  }));
  let calls = 0;
  const first = worker(
    t,
    w,
    async ({ schema }) => {
      calls++;
      if (schema.properties.plan) return { plan };
      if (calls === 3) throw new Error('Simulated connection failure');
      return { image: { filePath: 'test-image', review: 'Test-only fixture' } };
    },
    { readImage: () => (calls === 2 ? resultImage : Buffer.from(resultImage)) },
  );
  await until(() => w.store.state.tasks[0].status === 'failed');
  assert.equal(w.store.state.tasks[0].results.length, 1);
  // Supply another genuine fixture for slot 2 so the duplicate guard remains exercised.
  const other = await sharp(resultImage).negate().png().toBuffer();
  const e = new Executor(w, {
    inspect,
    readImage: () => other,
    run: async ({ schema }) => {
      assert.ok(schema.properties.image, 'Saved plans are not regenerated');
      return { image: { filePath: 'second', review: 'Test-only fixture' } };
    },
    interval: 5,
    paused: false,
  });
  // Stop the first executor before starting the next one, just like service restart.
  await first.stop();
  const old = w.store.state.tasks[0];
  assert.equal(old.id, task.id);
  w.taskAction(task.id, 'retry');
  e.status = await inspect();
  e.tick();
  await e.inflight;
  assert.equal(w.store.state.tasks[0].status, 'completed');
  assert.equal(w.store.state.projects[0].looks.length, 2);
  assert.equal(calls, 3);
});

test('cancel aborts execution and prevents late completion; retry starts a fresh claim', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  await series(w, p.id, ['green']);
  const look = w.store.state.projects[0].looks[0];
  const task = w.createTask(p.id, { kind: 'white', lookIds: [look.id] });
  let cancelled = false;
  worker(
    t,
    w,
    ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            resolve({ image: { filePath: 'late', review: '' } });
          },
          { once: true },
        );
      }),
  );
  await until(() => w.store.state.tasks[0].status === 'running');
  // Wait until reference preparation and provider invocation have finished.
  await new Promise((r) => setTimeout(r, 40));
  w.taskAction(task.id, 'cancel');
  await until(() => cancelled);
  assert.equal(w.store.state.tasks[0].status, 'cancelled');
  assert.equal(w.store.state.tasks[0].results.length, 0);
  assert.equal(w.store.state.projects[0].looks[0].white, null);
});

test('offline execution stays queued, reconnect resumes, and unsupported images fail honestly', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  const task = w.createTask(p.id, { kind: 'series' });
  let connected = false,
    calls = 0;
  const e = worker(
    t,
    w,
    async () => {
      calls++;
    },
    {
      inspect: async () => ({ ready: connected, imageGeneration: false, message: 'Not supported' }),
    },
  );
  await e.check();
  assert.equal(w.store.state.tasks[0].status, 'pending');
  connected = true;
  await e.check();
  await until(() => w.store.state.tasks[0].status === 'failed');
  assert.equal(calls, 0);
  assert.match(w.store.state.tasks[0].message, /不支持图像/);
  assert.equal(w.store.state.tasks[0].id, task.id);
});

test('analysis edits preserve evidence and history; report replacement does not invalidate model confirmation', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w);
  w.updateAnalysis(p.id, {
    expectedRevision: p.revision,
    analysis: { ...sampleAnalysis, theme: 'Refined direction' },
  });
  let current = w.store.state.projects[0];
  assert.equal(current.analysisHistory.length, 1);
  assert.equal(current.analysis.editedBy, 'user');
  assert.throws(
    () => w.updateAnalysis(p.id, { expectedRevision: p.revision, analysis: sampleAnalysis }),
    /已更新/,
  );
  assert.throws(
    () =>
      w.updateAnalysis(p.id, {
        expectedRevision: current.revision,
        analysis: { ...sampleAnalysis, evidence: [{ page: 1, note: 'Made up' }] },
      }),
    /依据不可改写/,
  );
  await w.upload(p.id, 'report', pdf(), 'replacement.pdf');
  current = w.store.state.projects[0];
  assert.equal(current.confirmed, true);
  assert.equal(current.analysis, null);
  assert.equal(current.analysisHistory.length, 2);
});

test('generated result reader rejects another session and symlinks outside generation root', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-generated-test-'));
  const old = process.env.CODEX_HOME;
  process.env.CODEX_HOME = directory;
  t.after(() => {
    if (old === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = old;
    rmSync(directory, { recursive: true, force: true });
  });
  const id = '11111111-1111-1111-1111-111111111111';
  const root = path.join(directory, 'generated_images', id);
  mkdirSync(root, { recursive: true });
  const valid = path.join(root, 'result.png');
  writeFileSync(valid, resultImage);
  assert.deepEqual(readGeneratedImage(valid, id), resultImage);
  const outside = path.join(directory, 'private.png');
  writeFileSync(outside, resultImage);
  symlinkSync(outside, path.join(root, 'escape.png'));
  assert.throws(() => readGeneratedImage(outside, id), /不属于/);
  assert.throws(() => readGeneratedImage(path.join(root, 'escape.png'), id), /不属于/);
  assert.throws(() => readGeneratedImage(valid, '../'), /可验证/);
});

test('unchanged decoded pixels cannot pass as a newly generated image after re-encoding', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  await series(w, p.id, ['green']);
  const look = w.store.state.projects[0].looks[0];
  const task = w.createTask(p.id, { kind: 'white', lookIds: [look.id] });
  const { claim } = w.claim(task.id);
  const reencoded = await sharp(w.assetPath(look.scene)).png({ compressionLevel: 0 }).toBuffer();
  await assert.rejects(w.submitImage(task.id, claim, 1, reencoded, 'not-new.png'), /完全相同/);
  assert.equal(w.store.state.tasks[0].results.length, 0);
  w.taskAction(task.id, 'cancel');
  assert.equal(w.publicState().tasks[0].canRetry, true);
  w.updateProject(p.id, { prompt: 'A changed brief' });
  assert.equal(w.publicState().tasks[0].canRetry, true);
});
