import path from 'node:path';
import os from 'node:os';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ensure } from './schema.js';

const maxResponseBytes = 30 * 1024 * 1024;
const maxReferenceBytes = 20 * 1024 * 1024;
const normalizeProviderType = (value) => (value === 'openai' ? 'openai' : 'compatible');
const modelName = (value, label) => {
  ensure(typeof value === 'string' && value.trim(), `请填写${label}`);
  ensure(value.trim().length <= 200, `${label}过长`);
  return value.trim();
};
const imageMime = (filename) => {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'image/png';
};
const responseMessage = (payload, fallback) =>
  String(payload?.error?.message || payload?.message || fallback).slice(0, 800);
const compatibleEndpointSuffixes = [
  '/chat/completions',
  '/responses',
  '/models',
  '/images/generations',
  '/images/edits',
];

class CompatibleApiError extends Error {
  constructor(message, status, route) {
    super(message);
    this.name = 'CompatibleApiError';
    this.status = status;
    this.route = route;
  }
}

const missingEndpoint = (error) => {
  if (Number.isInteger(error?.status)) return [404, 405].includes(error.status);
  return /(?:not\s*found|does\s*not\s*exist|cannot\s+(?:find|post|get)|no\s+route|unknown\s+endpoint|地址不存在|接口不存在|未找到接口)/i.test(
    error?.message || '',
  );
};

export function normalizeCompatibleBaseUrl(value) {
  ensure(typeof value === 'string' && value.trim(), '请填写 API Base URL');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    ensure(false, 'API Base URL 格式无效');
  }
  ensure(!url.username && !url.password, 'API Base URL 不能包含帐号或密码');
  ensure(!url.search && !url.hash, 'API Base URL 不能包含查询参数或锚点');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  ensure(
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback),
    '远程 API 必须使用 HTTPS',
  );
  let pathname = url.pathname.replace(/\/+$/, '') || '/';
  const endpointSuffix = compatibleEndpointSuffixes.find((suffix) =>
    pathname.toLowerCase().endsWith(suffix),
  );
  if (endpointSuffix) pathname = pathname.slice(0, -endpointSuffix.length) || '/';
  url.pathname = pathname;
  return url.toString().replace(/\/$/, '');
}

function compatibleBaseCandidates(baseUrl) {
  const candidates = [baseUrl];
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!/\/v\d+(?:beta)?$/i.test(pathname)) {
    url.pathname = `${pathname}/v1`.replace(/^\/\//, '/');
    candidates.push(url.toString().replace(/\/$/, ''));
  }
  return [...new Set(candidates)];
}

async function boundedBuffer(response, limit = maxResponseBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  ensure(!declared || declared <= limit, 'API 返回内容过大', 502);
  ensure(response.body, 'API 未返回内容', 502);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      ensure(false, 'API 返回内容过大', 502);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function parseJsonContent(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  const text = Array.isArray(content)
    ? content.map((item) => item?.text || item?.content || '').join('')
    : String(content || '');
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    ensure(start >= 0 && end > start, '第三方 API 未返回有效 JSON', 502);
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      ensure(false, '第三方 API 返回的 JSON 无法解析', 502);
    }
  }
}

export class OpenAICompatibleProvider {
  constructor({ outputRoot, fetchImpl = globalThis.fetch, analysisTimeout = 300_000 } = {}) {
    this.outputRoot = outputRoot || mkdtempSync(path.join(os.tmpdir(), 'badmark-provider-'));
    mkdirSync(this.outputRoot, { recursive: true, mode: 0o700 });
    this.fetchImpl = fetchImpl;
    this.analysisTimeout = analysisTimeout;
    this.config = null;
  }

  configure(input = {}) {
    const previous = this.config || {};
    const analysisInput = input.analysis || {};
    const imageInput = input.image || {};
    const splitInput = Boolean(
      input.analysis ||
      input.image ||
      input.analysisBaseUrl !== undefined ||
      input.analysisApiKey !== undefined ||
      input.analysisModel !== undefined ||
      input.analysisProviderType !== undefined ||
      input.imageBaseUrl !== undefined ||
      input.imageApiKey !== undefined ||
      input.imageProviderType !== undefined,
    );
    const sharedProviderType = normalizeProviderType(input.providerType || previous.providerType);
    const analysisProviderType = normalizeProviderType(
      analysisInput.providerType || input.analysisProviderType || sharedProviderType,
    );
    const imageProviderType = normalizeProviderType(
      imageInput.providerType || input.imageProviderType || sharedProviderType,
    );
    const retainedKey = (value, fallback) =>
      typeof value === 'string' && value.trim() ? value.trim() : fallback;
    const analysisApiKey = retainedKey(
      analysisInput.apiKey ?? input.analysisApiKey ?? (!splitInput ? input.apiKey : undefined),
      previous.analysisApiKey,
    );
    ensure(analysisApiKey && analysisApiKey.length <= 4096, '请填写有效的分析 API Key');
    const hasNestedImageSize = Object.prototype.hasOwnProperty.call(imageInput, 'imageSize');
    const hasImageSize = Object.prototype.hasOwnProperty.call(input, 'imageSize');
    const imageSizeValue = hasNestedImageSize
      ? imageInput.imageSize
      : hasImageSize
        ? input.imageSize
        : previous.imageSize;
    const imageSize =
      typeof imageSizeValue === 'string' && imageSizeValue.trim() ? imageSizeValue.trim() : null;
    ensure(
      !imageSize || ['1024x1024', '1024x1536', '1536x1024'].includes(imageSize),
      '图片尺寸无效',
    );
    const imageGeneration =
      typeof input.imageGeneration === 'boolean'
        ? input.imageGeneration
        : previous.imageGeneration !== false;
    const imageApiKey = retainedKey(
      imageInput.apiKey ?? input.imageApiKey ?? (!splitInput ? input.apiKey : undefined),
      previous.imageApiKey,
    );
    if (imageGeneration)
      ensure(imageApiKey && imageApiKey.length <= 4096, '请填写有效的生图 API Key');
    const analysisBaseUrl = normalizeCompatibleBaseUrl(
      analysisInput.baseUrl ||
        input.analysisBaseUrl ||
        (!splitInput ? input.baseUrl : '') ||
        previous.analysisBaseUrl ||
        '',
    );
    const imageBaseValue =
      imageInput.baseUrl ||
      input.imageBaseUrl ||
      (!splitInput ? input.baseUrl : '') ||
      previous.imageBaseUrl ||
      '';
    this.config = {
      providerType:
        analysisProviderType === imageProviderType ? analysisProviderType : 'compatible',
      analysisProviderType,
      analysisBaseUrl,
      analysisApiKey,
      textModel: modelName(
        analysisInput.model || input.analysisModel || input.textModel || previous.textModel || '',
        '分析模型',
      ),
      imageProviderType,
      imageBaseUrl: imageGeneration ? normalizeCompatibleBaseUrl(imageBaseValue) : imageBaseValue,
      imageApiKey,
      imageModel: modelName(
        imageInput.model || input.imageModel || previous.imageModel || 'gpt-image-1',
        '图像模型',
      ),
      imageGeneration,
      imageSize,
      sharedConnection: !splitInput,
    };
    return this.snapshot();
  }

  setTextModel(value) {
    ensure(this.config, '请先配置第三方 API');
    this.config.textModel = modelName(value, '文字模型');
  }

  snapshot() {
    const config = this.config || {
      providerType: 'compatible',
      analysisProviderType: 'compatible',
      analysisBaseUrl: '',
      textModel: '',
      imageProviderType: 'compatible',
      imageBaseUrl: '',
      imageModel: 'gpt-image-1',
      imageGeneration: true,
      imageSize: null,
    };
    const analysis = {
      providerType: config.analysisProviderType || 'compatible',
      baseUrl: config.analysisBaseUrl,
      model: config.textModel,
      textModel: config.textModel,
      hasApiKey: Boolean(config.analysisApiKey),
    };
    const image = {
      providerType: config.imageProviderType || 'compatible',
      baseUrl: config.imageBaseUrl,
      model: config.imageModel,
      imageModel: config.imageModel,
      enabled: config.imageGeneration,
      imageGeneration: config.imageGeneration,
      imageSize: config.imageSize,
      hasApiKey: Boolean(config.imageApiKey),
    };
    return {
      mode: 'third-party',
      providerType: config.providerType || 'compatible',
      topology: config.sharedConnection ? 'shared' : 'split',
      analysis,
      image,
      baseUrl: analysis.baseUrl,
      analysisBaseUrl: analysis.baseUrl,
      textModel: analysis.model,
      analysisModel: analysis.model,
      imageBaseUrl: image.baseUrl,
      imageModel: image.model,
      imageGeneration: image.enabled,
      imageSize: image.imageSize,
      hasApiKey: analysis.hasApiKey && (!image.enabled || image.hasApiKey),
      sessionOnly: true,
    };
  }

  endpoint(route, baseUrl) {
    ensure(this.config, '请先配置第三方 API');
    return new URL(route.replace(/^\//, ''), `${baseUrl}/`).toString();
  }

  async fetch(route, options = {}) {
    ensure(this.config, '请先配置第三方 API');
    const {
      timeout = 60_000,
      signal: callerSignal,
      channel = 'analysis',
      baseUrl = channel === 'image' ? this.config.imageBaseUrl : this.config.analysisBaseUrl,
      ...requestOptions
    } = options;
    const label = channel === 'image' ? '生图 API' : '分析 API';
    const apiKey = channel === 'image' ? this.config.imageApiKey : this.config.analysisApiKey;
    const headers = new Headers(requestOptions.headers || {});
    headers.set('Authorization', `Bearer ${apiKey}`);
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    const response = await this.fetchImpl(this.endpoint(route, baseUrl), {
      ...requestOptions,
      headers,
      redirect: 'error',
      signal,
    }).catch((error) => {
      if (callerSignal?.aborted) throw callerSignal.reason || error;
      if (error?.name === 'AbortError') throw error;
      const providerType =
        channel === 'image' ? this.config.imageProviderType : this.config.analysisProviderType;
      if (providerType === 'openai') {
        const reason =
          error?.name === 'TimeoutError'
            ? '连接超时'
            : error?.cause?.code || error?.cause?.message || error.message;
        throw new Error(`OpenAI ${label}连接失败，请检查系统网络或代理设置：${reason}`);
      }
      if (error?.name === 'TimeoutError') throw new Error(`${label}连接超时`);
      throw new Error(`${label}连接失败：${error?.cause?.code || error.message}`);
    });
    return response;
  }

  async json(route, options = {}) {
    const { responseLimit = 2 * 1024 * 1024, ...requestOptions } = options;
    const response = await this.fetch(route, requestOptions);
    const buffer = await boundedBuffer(response, responseLimit);
    let payload;
    try {
      payload = JSON.parse(buffer.toString('utf8'));
    } catch {
      if (!response.ok)
        throw new CompatibleApiError(
          `第三方 API 请求失败 (${response.status})`,
          response.status,
          route,
        );
      ensure(false, '第三方 API 返回了无效数据', 502);
    }
    if (!response.ok)
      throw new CompatibleApiError(
        responseMessage(payload, `第三方 API 请求失败 (${response.status})`),
        response.status,
        route,
      );
    return payload;
  }

  async verifyCompatibleAnalysisModel(baseUrl, { signal } = {}) {
    try {
      const payload = await this.json('chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.textModel,
          messages: [{ role: 'user', content: '回复 OK' }],
        }),
        signal,
        baseUrl,
        channel: 'analysis',
      });
      ensure(
        Array.isArray(payload?.choices) && payload.choices.length,
        '第三方 API 未返回对话结果',
        502,
      );
      return payload;
    } catch (error) {
      if (missingEndpoint(error)) throw error;
      const wrapped = new Error(
        `分析模型 ${this.config.textModel} 当前不可调用：${error.message}`,
        { cause: error },
      );
      wrapped.code = 'analysis-model-unavailable';
      wrapped.status = error?.status;
      throw wrapped;
    }
  }

  async inspectAnalysis({ signal } = {}) {
    ensure(this.config, '请先配置第三方 API');
    const configuredBaseUrl = this.config.analysisBaseUrl;
    const candidates = compatibleBaseCandidates(configuredBaseUrl);
    const connected = (baseUrl, models, message) => {
      this.config.analysisBaseUrl = baseUrl;
      if (this.config.sharedConnection) this.config.imageBaseUrl = baseUrl;
      if (!models.some((item) => item.id === this.config.textModel))
        models.unshift({
          id: this.config.textModel,
          displayName: this.config.textModel,
          description: '当前配置的文字模型',
          hidden: false,
          isDefault: true,
        });
      return {
        ready: true,
        checking: false,
        authRequired: false,
        account: null,
        imageGeneration: this.config.imageGeneration,
        model: this.config.textModel,
        models,
        providerMode: 'third-party',
        message,
      };
    };

    for (const baseUrl of candidates) {
      try {
        const payload = await this.json('models', { method: 'GET', signal, baseUrl });
        const source = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.models)
            ? payload.models
            : [];
        const models = source
          .map((item) => (typeof item === 'string' ? item : item?.id))
          .filter((id) => typeof id === 'string' && id.trim())
          .map((id) => ({
            id,
            displayName: id,
            description: '第三方 API 可用模型',
            hidden: false,
          }));
        if (this.config.analysisProviderType !== 'openai')
          await this.verifyCompatibleAnalysisModel(baseUrl, { signal });
        return connected(
          baseUrl,
          models,
          this.config.analysisProviderType === 'openai'
            ? 'OpenAI API 已连接；请留意帐号额度与计费规则。'
            : '第三方 API 已连接，当前分析模型已通过实际调用验证；请留意对方的额度与计费规则。',
        );
      } catch (error) {
        if (!missingEndpoint(error)) throw error;
      }
    }

    for (const baseUrl of candidates) {
      try {
        await this.verifyCompatibleAnalysisModel(baseUrl, { signal });
        return connected(
          baseUrl,
          [],
          '第三方 API 已连接；该服务未提供模型列表，已通过文字模型验证。',
        );
      } catch (error) {
        if (!missingEndpoint(error)) throw error;
      }
    }

    this.config.analysisBaseUrl = configuredBaseUrl;
    throw new Error(
      '未找到兼容的分析 API 接口。请填写服务根地址（通常以 /v1 结尾）或完整的 /chat/completions 地址，不要填写服务商控制台网页地址。',
    );
  }

  async inspectImage({ signal } = {}) {
    ensure(this.config, '请先配置第三方 API');
    if (!this.config.imageGeneration)
      return {
        ready: true,
        enabled: false,
        verified: true,
        baseUrl: '',
        model: this.config.imageModel,
        message: '生图 API 已停用。',
      };
    const sharedConnection =
      this.config.imageBaseUrl === this.config.analysisBaseUrl &&
      this.config.imageApiKey === this.config.analysisApiKey;

    if (this.config.imageProviderType === 'openai' && sharedConnection)
      return {
        ready: true,
        enabled: true,
        verified: false,
        baseUrl: this.config.imageBaseUrl,
        model: this.config.imageModel,
        message: 'OpenAI 连接已验证；生图能力将在首次生成时验证额度与权限。',
      };

    const configuredBaseUrl = this.config.imageBaseUrl;
    let candidates = compatibleBaseCandidates(configuredBaseUrl);
    if (!sharedConnection) {
      for (const baseUrl of candidates) {
        try {
          await this.json('models', {
            method: 'GET',
            signal,
            baseUrl,
            channel: 'image',
          });
          candidates = [baseUrl];
          break;
        } catch (error) {
          if (!missingEndpoint(error)) throw error;
        }
      }
    }
    for (const baseUrl of candidates) {
      const response = await this.fetch('images/generations', {
        method: 'OPTIONS',
        signal,
        baseUrl,
        channel: 'image',
      });
      if (response.status === 404) continue;
      ensure(
        ![401, 403].includes(response.status),
        `生图 API 身份验证失败 (${response.status})`,
        502,
      );
      ensure(response.status < 500, `生图 API 检测失败 (${response.status})`, 502);
      this.config.imageBaseUrl = baseUrl;
      return {
        ready: true,
        enabled: true,
        verified: true,
        baseUrl,
        model: this.config.imageModel,
        message: sharedConnection ? '共用服务的生图端点已连接。' : '独立生图 API 端点已连接。',
      };
    }
    this.config.imageBaseUrl = configuredBaseUrl;
    return {
      ready: true,
      enabled: true,
      verified: false,
      baseUrl: configuredBaseUrl,
      model: this.config.imageModel,
      message: '生图 API 已配置；服务未提供无计费检测端点，将在首次生图时验证。',
    };
  }

  async inspect({ signal } = {}) {
    const analysis = await this.inspectAnalysis({ signal });
    const image = await this.inspectImage({ signal });
    return {
      ...analysis,
      ready: analysis.ready && image.ready,
      imageGeneration: image.enabled && image.ready,
      capabilities: {
        analysis: {
          ready: analysis.ready,
          verified: true,
          baseUrl: this.config.analysisBaseUrl,
          model: this.config.textModel,
          message: analysis.message,
        },
        image,
      },
      message: `${analysis.message} ${image.message}`,
    };
  }

  redactPaths(prompt, images) {
    return images.reduce(
      (text, filename, index) => text.split(filename).join(`[参考图 ${index + 1}]`),
      String(prompt || ''),
    );
  }

  imageParts(images) {
    return images.slice(0, 5).map((filename) => {
      ensure(typeof filename === 'string' && path.isAbsolute(filename), '参考图路径无效');
      const stat = statSync(filename);
      ensure(stat.isFile() && stat.size <= maxReferenceBytes, '参考图无效或过大');
      return {
        type: 'image_url',
        image_url: {
          url: `data:${imageMime(filename)};base64,${readFileSync(filename).toString('base64')}`,
        },
      };
    });
  }

  responseImageParts(images) {
    return this.imageParts(images).map((item) => ({
      type: 'input_image',
      image_url: item.image_url.url,
      detail: 'high',
    }));
  }

  responseOutputText(payload) {
    if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;
    const content = (payload?.output || []).flatMap((item) => item?.content || []);
    const refusal = content.find((item) => item?.type === 'refusal')?.refusal;
    ensure(!refusal, refusal || 'OpenAI API 拒绝了该请求', 502);
    const text = content
      .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('');
    ensure(text, 'OpenAI API 未返回文字结果', 502);
    return text;
  }

  async completeOpenAIJson({ prompt, schema, model, images = [], signal }) {
    const text = this.redactPaths(prompt, images);
    const content = [{ type: 'input_text', text }, ...this.responseImageParts(images)];
    const body = {
      model: model || this.config.textModel,
      instructions: '你是 Bomi智绘服装工作台的执行引擎。只返回符合指定 JSON Schema 的 JSON。',
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'badmark_response',
          strict: true,
          schema,
        },
      },
      store: false,
    };
    let payload;
    try {
      payload = await this.json('responses', {
        timeout: this.analysisTimeout,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        channel: 'analysis',
      });
    } catch (error) {
      if (
        ![400, 422].includes(error?.status) &&
        !/(?:\b(?:400|422)\b|json.?schema|text\.format)/i.test(error.message)
      )
        throw error;
      payload = await this.json('responses', {
        timeout: this.analysisTimeout,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          text: { format: { type: 'json_object' } },
        }),
        signal,
        channel: 'analysis',
      });
    }
    const result = parseJsonContent(this.responseOutputText(payload));
    ensure(!result?.error, result.error || 'OpenAI API 执行失败', 502);
    return result;
  }

  async completeJson({ prompt, schema, model, images = [], signal }) {
    if (this.config.analysisProviderType === 'openai')
      return this.completeOpenAIJson({ prompt, schema, model, images, signal });
    const text = this.redactPaths(prompt, images);
    const content = images.length ? [{ type: 'text', text }, ...this.imageParts(images)] : text;
    const body = {
      model: model || this.config.textModel,
      messages: [
        {
          role: 'system',
          content:
            '你是 Bomi智绘服装工作台的执行引擎。只返回符合指定 JSON Schema 的 JSON，不要返回 Markdown。',
        },
        { role: 'user', content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'badmark_response', strict: true, schema },
      },
    };
    let payload;
    try {
      payload = await this.json('chat/completions', {
        timeout: this.analysisTimeout,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        channel: 'analysis',
      });
    } catch (error) {
      if (
        ![400, 415, 422].includes(error?.status) &&
        !/(?:\b(?:400|415|422)\b|response.?format|json.?schema)/i.test(error.message)
      )
        throw error;
      const { response_format: _ignored, ...fallback } = body;
      fallback.messages = [
        ...body.messages,
        { role: 'system', content: `返回 JSON 必须符合此结构：${JSON.stringify(schema)}` },
      ];
      payload = await this.json('chat/completions', {
        timeout: this.analysisTimeout,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallback),
        signal,
        channel: 'analysis',
      });
    }
    const result = parseJsonContent(payload?.choices?.[0]?.message?.content);
    ensure(!result?.error, result.error || '第三方 API 执行失败', 502);
    return result;
  }

  async downloadImage(url, signal) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      ensure(false, '第三方 API 返回的图片地址无效', 502);
    }
    ensure(['https:', 'http:'].includes(parsed.protocol), '第三方 API 返回的图片地址无效', 502);
    const downloadSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000);
    const response = await this.fetchImpl(parsed, { redirect: 'error', signal: downloadSignal });
    ensure(response.ok, `下载生成图片失败 (${response.status})`, 502);
    return boundedBuffer(response);
  }

  async generateImage({ prompt, images = [], signal }) {
    ensure(this.config.imageGeneration, '当前第三方 API 未启用图像能力');
    ensure(images.length <= 5, '一次最多使用 5 张参考图');
    const cleanPrompt = this.redactPaths(prompt, images);
    let payload;
    if (images.length) {
      const form = new FormData();
      form.append('model', this.config.imageModel);
      form.append('prompt', cleanPrompt);
      if (this.config.imageSize) form.append('size', this.config.imageSize);
      form.append('n', '1');
      images.forEach((filename, index) => {
        const stat = statSync(filename);
        ensure(stat.isFile() && stat.size <= maxReferenceBytes, '参考图无效或过大');
        form.append(
          images.length === 1 ? 'image' : 'image[]',
          new Blob([readFileSync(filename)], { type: imageMime(filename) }),
          `reference-${index + 1}${path.extname(filename) || '.png'}`,
        );
      });
      payload = await this.json('images/edits', {
        method: 'POST',
        body: form,
        signal,
        timeout: 10 * 60_000,
        responseLimit: Math.ceil(maxResponseBytes * 1.5),
        channel: 'image',
      });
    } else {
      payload = await this.json('images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.imageModel,
          prompt: cleanPrompt,
          ...(this.config.imageSize ? { size: this.config.imageSize } : {}),
          n: 1,
        }),
        signal,
        timeout: 10 * 60_000,
        responseLimit: Math.ceil(maxResponseBytes * 1.5),
        channel: 'image',
      });
    }
    const item = payload?.data?.[0] || payload?.images?.[0];
    ensure(item, '第三方 API 未返回图片', 502);
    const encoded = item.b64_json || item.b64 || item.base64;
    let buffer;
    if (typeof encoded === 'string' && encoded) {
      ensure(encoded.length <= maxResponseBytes * 1.5, '第三方 API 返回的图片过大', 502);
      buffer = Buffer.from(encoded, 'base64');
    } else {
      ensure(typeof item.url === 'string', '第三方 API 未返回可用图片', 502);
      buffer = await this.downloadImage(item.url, signal);
    }
    ensure(
      buffer.length > 0 && buffer.length <= maxResponseBytes,
      '第三方 API 返回的图片无效',
      502,
    );
    const threadId = randomUUID();
    const directory = path.join(this.outputRoot, threadId);
    mkdirSync(directory, { mode: 0o700 });
    const filePath = path.join(directory, 'result.png');
    writeFileSync(filePath, buffer, { mode: 0o600 });
    return { filePath, threadId };
  }

  async run({ prompt, schema, model, images = [], signal, onProgress = () => {} }) {
    ensure(this.config, '请先配置第三方 API');
    const imageEnvelope = schema?.properties?.image;
    const combinedEnvelope = schema?.properties?.result?.anyOf?.[0]?.properties;
    if (!imageEnvelope && !combinedEnvelope)
      return this.completeJson({ prompt, schema, model, images, signal });

    let plan;
    if (combinedEnvelope?.plan) {
      onProgress('正在生成款式方案…');
      const planned = await this.completeJson({
        prompt: `${prompt}\n只先返回单款设计方案，不要声称已生成图片。`,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['plan'],
          properties: { plan: combinedEnvelope.plan },
        },
        model,
        images,
        signal,
      });
      plan = planned.plan;
    }
    onProgress(images.length ? `正在上传 ${images.length} 张参考图并生成图片…` : '正在生成图片…');
    const generated = await this.generateImage({
      prompt: plan ? `${prompt}\n已确定方案：${JSON.stringify(plan)}` : prompt,
      images,
      signal,
    });
    const image = {
      filePath: generated.filePath,
      review: this.config.imageSize
        ? `第三方图像接口已返回 ${this.config.imageSize} 结果，请人工复核。`
        : '第三方图像接口已返回结果，请人工复核。',
    };
    return combinedEnvelope
      ? { result: { plan, image }, threadId: generated.threadId }
      : { image, threadId: generated.threadId };
  }

  readImage(filename, threadId) {
    ensure(typeof filename === 'string' && path.isAbsolute(filename), '生成结果路径无效');
    ensure(/^[0-9a-f-]{36}$/.test(threadId || ''), '生成会话无效');
    const directory = realpathSync(path.join(this.outputRoot, threadId));
    const full = realpathSync(filename);
    ensure(full.startsWith(`${directory}${path.sep}`), '生成结果不属于当前会话');
    ensure(statSync(full).isFile(), '生成结果文件无效');
    const buffer = readFileSync(full);
    rmSync(directory, { recursive: true, force: true });
    return buffer;
  }

  dispose() {
    this.config = null;
    rmSync(this.outputRoot, { recursive: true, force: true });
  }
}
