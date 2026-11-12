import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  normalizeCompatibleBaseUrl,
  OpenAICompatibleProvider,
} from '../server/openai-compatible.js';
import { OPENAI_ANALYSIS_MODEL, OPENAI_IMAGE_MODEL } from '../shared/openai-defaults.js';

const image = await sharp({
  create: { width: 512, height: 768, channels: 3, background: '#345678' },
})
  .png()
  .toBuffer();

test('long analysis and structured-output fallback use the full analysis deadline', async (t) => {
  for (const providerType of ['compatible', 'openai']) {
    const provider = new OpenAICompatibleProvider();
    t.after(() => provider.dispose());
    provider.configure({
      providerType,
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      textModel: 'vision-model',
      imageModel: 'image-model',
    });
    const calls = [];
    provider.json = async (route, options) => {
      calls.push({ route, ...options });
      if (calls.length === 1)
        throw Object.assign(new Error('json_schema unsupported'), { status: 400 });
      return providerType === 'openai'
        ? { output_text: '{"plan":[]}' }
        : { choices: [{ message: { content: '{"plan":[]}' } }] };
    };
    const schema = {
      type: 'object',
      properties: { plan: { type: 'array', items: { type: 'string' } } },
    };
    assert.deepEqual(await provider.completeJson({ prompt: '规划系列', schema }), { plan: [] });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.timeout === 300_000));
    if (providerType === 'compatible')
      assert.ok(
        JSON.parse(calls[1].body).messages.some((message) =>
          message.content.includes(JSON.stringify(schema)),
        ),
      );
  }
});

test('analysis deadlines and user cancellation still abort stalled requests', async (t) => {
  const provider = new OpenAICompatibleProvider({
    analysisTimeout: 30,
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      }),
  });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test',
    textModel: 'vision-model',
    imageModel: 'image-model',
  });
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(provider.completeJson({ prompt: 'test', schema: {} }), /超时/);
    const controller = new AbortController();
    const request = provider.completeJson({
      prompt: 'test',
      schema: {},
      signal: controller.signal,
    });
    controller.abort(new Error('用户暂停'));
    await assert.rejects(request, /用户暂停/);
  } finally {
    clearInterval(keepAlive);
  }
});

async function fixture(t) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    calls.push({
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body,
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'vision-model' }, { id: 'backup-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"reply":"结构化返回正常"}\n```' } }],
        }),
      );
      return;
    }
    if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') {
      res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-provider-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  return {
    calls,
    temporary,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  };
}

test('compatible provider validates secure base URLs and never exposes its key', async (t) => {
  assert.throws(() => normalizeCompatibleBaseUrl('http://api.example.com/v1'), /HTTPS/);
  assert.equal(
    normalizeCompatibleBaseUrl('https://api.example.com/v1/'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeCompatibleBaseUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeCompatibleBaseUrl('https://api.example.com/v1/models/'),
    'https://api.example.com/v1',
  );
  const { calls, temporary, baseUrl } = await fixture(t);
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  const snapshot = provider.configure({
    baseUrl,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
    imageGeneration: true,
    imageSize: '1024x1536',
  });
  assert.equal(snapshot.hasApiKey, true);
  assert.equal(snapshot.sessionOnly, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-secret-key/);
  const status = await provider.inspect();
  assert.equal(status.ready, true);
  assert.equal(status.model, 'vision-model');
  assert.ok(status.models.some((model) => model.id === 'backup-model'));
  assert.equal(calls[0].authorization, 'Bearer fixture-secret-key');
});

test('compatible provider discovers a missing v1 segment before probing the model', async (t) => {
  const { calls, temporary, baseUrl } = await fixture(t);
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl: new URL(baseUrl).origin,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
  });

  const status = await provider.inspect();

  assert.equal(status.ready, true);
  assert.equal(provider.snapshot().baseUrl, baseUrl);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/models', '/v1/models', '/v1/chat/completions', '/v1/images/generations'],
  );
});

test('compatible provider verifies chat when the service has no models endpoint', async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ url: req.url, body: Buffer.concat(chunks) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'address does not exist' } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-provider-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl: `${baseUrl}/chat/completions`,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
  });

  const status = await provider.inspect();

  assert.equal(status.ready, true);
  assert.match(status.message, /未提供模型列表/);
  assert.equal(provider.snapshot().baseUrl, baseUrl);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/v1/models', '/v1/chat/completions', '/v1/images/generations'],
  );
  assert.equal(JSON.parse(calls[1].body.toString('utf8')).model, 'vision-model');
});

test('compatible provider does not hide authentication errors behind route fallback', async (t) => {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url);
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-provider-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'wrong-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
  });

  await assert.rejects(() => provider.inspect(), /invalid api key/);
  assert.deepEqual(calls, ['/v1/models']);
});

test('compatible provider verifies the configured analysis model after listing models', async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ url: req.url, body: Buffer.concat(chunks) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'image-only-model' }, { id: 'text-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: {
            message:
              'Current group has no available channels for model image-only-model under billing mode pay-as-you-go',
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-model-probe-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'fixture-secret-key',
    textModel: 'image-only-model',
    imageModel: 'image-only-model',
  });

  await assert.rejects(
    () => provider.inspectAnalysis(),
    /分析模型 image-only-model 当前不可调用.*no available channels/i,
  );
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/v1/models', '/v1/chat/completions'],
  );
  assert.equal(JSON.parse(calls[1].body.toString('utf8')).model, 'image-only-model');
});

test('compatible provider sends bounded vision input and parses structured chat output', async (t) => {
  const { calls, temporary, baseUrl } = await fixture(t);
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
  });
  const reference = path.join(temporary, 'private-reference.png');
  writeFileSync(reference, image);
  const result = await provider.run({
    prompt: `分析这张图：${reference}`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reply'],
      properties: { reply: { type: 'string' } },
    },
    images: [reference],
  });
  assert.deepEqual(result, { reply: '结构化返回正常' });
  const request = calls.find((call) => call.url === '/v1/chat/completions');
  const payload = JSON.parse(request.body.toString('utf8'));
  assert.equal(payload.model, 'vision-model');
  assert.match(JSON.stringify(payload), /data:image\/png;base64/);
  assert.doesNotMatch(JSON.stringify(payload), /private-reference\.png/);
});

test('OpenAI dedicated mode uses Responses for analysis and Images for generation', async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    calls.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body,
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(
        JSON.stringify({
          data: [{ id: OPENAI_ANALYSIS_MODEL }, { id: OPENAI_IMAGE_MODEL }],
        }),
      );
      return;
    }
    if (req.url === '/v1/responses') {
      res.end(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"reply":"Responses 分析完成"}' }],
            },
          ],
        }),
      );
      return;
    }
    if (req.url === '/v1/images/generations') {
      res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-openai-provider-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  const snapshot = provider.configure({
    providerType: 'openai',
    baseUrl,
    apiKey: 'openai-fixture-key',
    textModel: OPENAI_ANALYSIS_MODEL,
    imageModel: OPENAI_IMAGE_MODEL,
  });
  assert.equal(snapshot.providerType, 'openai');
  assert.equal(snapshot.analysis.providerType, 'openai');
  assert.equal(snapshot.image.providerType, 'openai');

  const status = await provider.inspect();
  assert.equal(status.ready, true);
  assert.equal(status.capabilities.image.verified, false);
  assert.equal(
    calls.some((call) => call.method === 'OPTIONS'),
    false,
  );

  const reference = path.join(temporary, 'reference.png');
  writeFileSync(reference, image);
  const result = await provider.run({
    prompt: `分析参考图 ${reference}`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reply'],
      properties: { reply: { type: 'string' } },
    },
    images: [reference],
  });
  assert.deepEqual(result, { reply: 'Responses 分析完成' });
  const responseRequest = calls.find((call) => call.url === '/v1/responses');
  assert.equal(responseRequest.authorization, 'Bearer openai-fixture-key');
  const responseBody = JSON.parse(responseRequest.body.toString('utf8'));
  assert.equal(responseBody.model, OPENAI_ANALYSIS_MODEL);
  assert.equal(responseBody.store, false);
  assert.equal(responseBody.text.format.type, 'json_schema');
  assert.equal(responseBody.input[0].content[1].type, 'input_image');
  assert.match(responseBody.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(
    calls.some((call) => call.url === '/v1/chat/completions'),
    false,
  );

  const generated = await provider.generateImage({ prompt: '生成服装图' });
  assert.equal(
    (await sharp(provider.readImage(generated.filePath, generated.threadId)).metadata()).width,
    512,
  );
  const imageRequest = calls.find((call) => call.url === '/v1/images/generations');
  assert.equal(JSON.parse(imageRequest.body.toString('utf8')).model, OPENAI_IMAGE_MODEL);
});

test('compatible provider supports generation and multi-reference image edits', async (t) => {
  const { calls, temporary, baseUrl } = await fixture(t);
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  provider.configure({
    baseUrl,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
    imageSize: '1024x1536',
  });
  const schema = {
    type: 'object',
    properties: {
      image: {
        anyOf: [
          {
            type: 'object',
            properties: { filePath: { type: 'string' }, review: { type: 'string' } },
          },
          { type: 'null' },
        ],
      },
    },
  };
  const generated = await provider.run({ prompt: '生成一套服装', schema });
  const generatedBuffer = provider.readImage(generated.image.filePath, generated.threadId);
  assert.equal((await sharp(generatedBuffer).metadata()).width, 512);
  const generationRequest = calls.find((call) => call.url === '/v1/images/generations');
  assert.equal(JSON.parse(generationRequest.body.toString('utf8')).size, '1024x1536');

  const first = path.join(temporary, 'first.png');
  const second = path.join(temporary, 'second.png');
  writeFileSync(first, image);
  writeFileSync(second, image);
  const edited = await provider.run({
    prompt: `结合 ${first} 和 ${second} 改款`,
    schema,
    images: [first, second],
  });
  assert.equal(
    (await sharp(provider.readImage(edited.image.filePath, edited.threadId)).metadata()).height,
    768,
  );
  const editRequest = calls.find((call) => call.url === '/v1/images/edits');
  assert.match(editRequest.contentType, /^multipart\/form-data; boundary=/);
  const multipart = editRequest.body.toString('latin1');
  assert.equal((multipart.match(/name="image\[\]"/g) || []).length, 2);
  assert.match(multipart, /name="size"[\s\S]*1024x1536/);
  assert.doesNotMatch(multipart, /badmark-provider-test-/);
});

test('compatible provider leaves image size to the API when no size is configured', async (t) => {
  const { calls, temporary, baseUrl } = await fixture(t);
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  const snapshot = provider.configure({
    baseUrl,
    apiKey: 'fixture-secret-key',
    textModel: 'vision-model',
    imageModel: 'image-model',
    imageSize: null,
  });
  assert.equal(snapshot.imageSize, null);
  const result = await provider.generateImage({ prompt: '使用服务商默认尺寸' });
  provider.readImage(result.filePath, result.threadId);
  const generationRequest = calls.find((call) => call.url === '/v1/images/generations');
  assert.equal('size' in JSON.parse(generationRequest.body.toString('utf8')), false);
});

test('compatible provider routes analysis and image generation through independent APIs', async (t) => {
  const analysisCalls = [];
  const imageCalls = [];
  const analysisServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    analysisCalls.push({
      url: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks),
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'analysis-vision-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ message: { content: '{"reply":"图文分析完成"}' } }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  const imageServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    imageCalls.push({
      url: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks),
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'image-only-model' }] }));
      return;
    }
    if (req.url === '/v1/images/generations') {
      res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  analysisServer.listen(0, '127.0.0.1');
  imageServer.listen(0, '127.0.0.1');
  await Promise.all([
    new Promise((resolve) => analysisServer.once('listening', resolve)),
    new Promise((resolve) => imageServer.once('listening', resolve)),
  ]);
  t.after(() => new Promise((resolve) => analysisServer.close(resolve)));
  t.after(() => new Promise((resolve) => imageServer.close(resolve)));
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-split-provider-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const provider = new OpenAICompatibleProvider({ outputRoot: path.join(temporary, 'output') });
  t.after(() => provider.dispose());
  const snapshot = provider.configure({
    analysisBaseUrl: `http://127.0.0.1:${analysisServer.address().port}/v1`,
    analysisApiKey: 'analysis-secret',
    analysisModel: 'analysis-vision-model',
    imageBaseUrl: `http://127.0.0.1:${imageServer.address().port}/v1`,
    imageApiKey: 'image-secret',
    imageModel: 'image-only-model',
    imageSize: '1024x1536',
  });
  assert.equal(snapshot.topology, 'split');
  assert.equal(snapshot.analysis.hasApiKey, true);
  assert.equal(snapshot.image.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /analysis-secret|image-secret/);

  const status = await provider.inspect();
  assert.equal(status.ready, true);
  assert.equal(status.capabilities.analysis.ready, true);
  assert.equal(status.capabilities.image.ready, true);
  assert.equal(status.capabilities.image.verified, true);

  const reference = path.join(temporary, 'analysis-reference.png');
  writeFileSync(reference, image);
  const analysis = await provider.run({
    prompt: `分析图片 ${reference}`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reply'],
      properties: { reply: { type: 'string' } },
    },
    images: [reference],
  });
  assert.deepEqual(analysis, { reply: '图文分析完成' });

  const generated = await provider.run({
    prompt: '生成一张服装图片',
    schema: {
      type: 'object',
      properties: {
        image: {
          anyOf: [
            {
              type: 'object',
              properties: { filePath: { type: 'string' }, review: { type: 'string' } },
            },
            { type: 'null' },
          ],
        },
      },
    },
  });
  assert.equal(
    (await sharp(provider.readImage(generated.image.filePath, generated.threadId)).metadata())
      .width,
    512,
  );
  assert.ok(analysisCalls.some((call) => call.url === '/v1/chat/completions'));
  assert.ok(imageCalls.some((call) => call.url === '/v1/images/generations'));
  assert.ok(analysisCalls.every((call) => call.authorization === 'Bearer analysis-secret'));
  assert.ok(imageCalls.every((call) => call.authorization === 'Bearer image-secret'));
  assert.ok(!analysisCalls.some((call) => call.url.startsWith('/v1/images/')));
  assert.ok(!imageCalls.some((call) => call.url === '/v1/chat/completions'));
});
