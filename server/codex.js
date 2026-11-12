import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ensure } from './schema.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export function codexBinary() {
  const bundled = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  );
  return (
    process.env.BADMARK_CODEX_BIN ||
    (existsSync('/Applications/ChatGPT.app/Contents/Resources/codex')
      ? '/Applications/ChatGPT.app/Contents/Resources/codex'
      : existsSync(bundled)
        ? bundled
        : 'codex')
  );
}

function environment() {
  const env = { ...process.env };
  // Only the user's existing ChatGPT login is used; never fall back to API billing.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

export async function inspectCodex() {
  const child = spawn(codexBinary(), ['app-server'], {
    env: environment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const replies = {};
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (error) return reject(error);
      resolve(result);
    };
    const send = (id, method, params) =>
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    const timer = setTimeout(
      () => finish(new Error('连接 AI 服务超时，请检查应用是否安装完整。')),
      15000,
    );
    child.on('error', finish);
    child.on('exit', () => finish(new Error('AI 服务连接已关闭。')));
    child.stdin.on('error', finish);
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      if (reply.error) return finish(new Error(reply.error.message));
      if (reply.id === 1) {
        child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
        send(2, 'account/read', { refreshToken: false });
      } else if (reply.id === 2) {
        replies[2] = reply.result;
        const account = replies[2]?.account;
        if (account?.type !== 'chatgpt') {
          finish(null, {
            ready: false,
            authRequired: true,
            account: null,
            imageGeneration: false,
            model: null,
            models: [],
            message: '尚未登录 Bomi智绘账号，请先完成授权。',
          });
          return;
        }
        send(3, 'modelProvider/capabilities/read', {});
        send(4, 'config/read', { includeLayers: false });
        send(5, 'model/list', {});
      } else if ([3, 4, 5].includes(reply.id)) {
        replies[reply.id] = reply.result;
        if ([3, 4, 5].every((id) => replies[id])) {
          const account = replies[2].account;
          finish(null, {
            ready: true,
            authRequired: false,
            account: { email: account.email || null, planType: account.planType || null },
            imageGeneration: Boolean(replies[3]?.imageGeneration),
            model: replies[4]?.config?.model || null,
            models: (replies[5]?.data || []).map((model) => ({
              id: model.id,
              displayName: model.displayName,
              description: model.description,
              hidden: model.hidden,
              isDefault: model.isDefault,
            })),
            message: 'AI 服务已就绪；任务使用当前账号的可用额度。',
          });
        }
      }
    });
    send(1, 'initialize', {
      clientInfo: { name: 'badmark_workbench', version: '3.3.0' },
      capabilities: { experimentalApi: true },
    });
  });
}

let activeLogin = null;
let loginStatus = { state: 'idle', loginId: null, error: null };

export function codexLoginStatus() {
  return { ...loginStatus };
}

function createLoginAttempt() {
  const child = spawn(codexBinary(), ['app-server'], {
    env: environment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let settled = false;
  let started = false;
  let resolveStarted;
  let rejectStarted;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  const start = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const close = () => {
    clearTimeout(startTimer);
    clearTimeout(loginTimer);
    child.kill();
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    close();
    if (!started) rejectStarted(error);
    rejectCompletion(error);
  };
  const finish = (notification) => {
    if (settled) return;
    settled = true;
    close();
    if (notification.success) resolveCompletion({ success: true });
    else rejectCompletion(new Error(notification.error || '账号授权未完成。'));
  };
  const send = (id, method, params) =>
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  const startTimer = setTimeout(
    () => fail(new Error('启动账号授权超时，请检查应用是否安装完整。')),
    15000,
  );
  const loginTimer = setTimeout(
    () => fail(new Error('账号授权超时，请重新发起登录。')),
    10 * 60 * 1000,
  );
  child.on('error', fail);
  child.on('exit', () => {
    if (!settled) fail(new Error('账号授权进程已关闭。'));
  });
  child.stdin.on('error', () => {});
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.error) {
      fail(new Error(message.error.message || '账号授权启动失败。'));
      return;
    }
    if (message.id === 1) {
      child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      send(2, 'account/login/start', {
        type: 'chatgpt',
        appBrand: 'chatgpt',
        codexStreamlinedLogin: false,
        useHostedLoginSuccessPage: true,
      });
    } else if (message.id === 2) {
      const result = message.result;
      try {
        ensure(result?.type === 'chatgpt', '当前授权方式不受支持。');
        const authUrl = new URL(result.authUrl);
        ensure(authUrl.protocol === 'https:', '授权地址必须使用 HTTPS。');
        ensure(
          authUrl.hostname === 'openai.com' ||
            authUrl.hostname.endsWith('.openai.com') ||
            authUrl.hostname === 'chatgpt.com' ||
            authUrl.hostname.endsWith('.chatgpt.com'),
          '授权地址不受信任。',
        );
        started = true;
        clearTimeout(startTimer);
        resolveStarted({ authUrl: authUrl.toString(), loginId: result.loginId, completion });
      } catch (error) {
        fail(error);
      }
    } else if (message.method === 'account/login/completed') {
      finish(message.params || {});
    }
  });
  send(1, 'initialize', {
    clientInfo: { name: 'badmark_workbench', title: 'Bomi智绘', version: '3.3.0' },
    capabilities: { experimentalApi: true },
  });
  return start;
}

export function startCodexLogin() {
  if (!activeLogin) {
    loginStatus = { state: 'starting', loginId: null, error: null };
    activeLogin = createLoginAttempt();
    activeLogin.then(
      ({ completion, loginId }) => {
        loginStatus = { state: 'pending', loginId, error: null };
        completion.then(
          () => {
            loginStatus = { state: 'succeeded', loginId, error: null };
            activeLogin = null;
          },
          (error) => {
            loginStatus = { state: 'failed', loginId, error: error.message };
            activeLogin = null;
          },
        );
      },
      (error) => {
        loginStatus = { state: 'failed', loginId: null, error: error.message };
        activeLogin = null;
      },
    );
  }
  return activeLogin;
}

export const generatedRoot = () =>
  path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');

const disabledFeatures = [
  'apps',
  'plugins',
  'browser_use',
  'computer_use',
  'shell_tool',
  'unified_exec',
  'multi_agent',
  'hooks',
];

class AccountAppServer {
  constructor(binary) {
    this.binary = binary;
    this.child = null;
    this.starting = null;
    this.pending = new Map();
    this.turns = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.closing = false;
  }

  async start() {
    if (this.child && !this.child.killed && this.starting) return this.starting;
    const args = [
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'approval_policy="never"',
      '-c',
      'forced_login_method="chatgpt"',
      '-c',
      'web_search="disabled"',
      '-c',
      'model_reasoning_effort="low"',
    ];
    for (const feature of disabledFeatures) args.push('--disable', feature);
    this.closing = false;
    this.child = spawn(this.binary, args, {
      env: environment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', (data) => {
      this.stderr = (this.stderr + data.toString()).slice(-4000);
    });
    this.child.stdin.on('error', () => {});
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', () => {
      if (!this.closing) this.fail(new Error('AI 服务连接已关闭。'));
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
    this.starting = this.requestRaw('initialize', {
      clientInfo: { name: 'badmark_workbench', title: 'Bomi智绘', version: '3.3.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
      .then(() => {
        this.write({ method: 'initialized', params: {} });
        return this;
      })
      .catch((error) => {
        this.dispose();
        throw error;
      });
    return this.starting;
  }

  write(message) {
    if (!this.child || this.child.killed || !this.child.stdin.writable)
      throw new Error('AI 服务尚未启动。');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  requestRaw(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async request(method, params) {
    await this.start();
    return this.requestRaw(method, params);
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'AI 服务请求失败'));
      else pending.resolve(message.result);
      return;
    }
    const params = message.params || {};
    const turn = this.turns.get(params.threadId);
    if (!turn || turn.done) return;
    if (message.method === 'error') {
      if (!params.willRetry) turn.failure = new Error(params.error?.message || 'AI 服务执行失败');
      else turn.onProgress('正在连接 AI 服务，网络异常时会自动尝试重新连接。');
    } else if (message.method === 'item/started' && params.item?.type === 'imageGeneration') {
      turn.onProgress('正在生成真实图片，请稍候；可离开此页面。');
    } else if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
      turn.message = params.item.text;
      turn.onProgress('AI 正在处理与复核本步骤，真实结果通过校验后会自动保存。');
    } else if (message.method === 'turn/completed') {
      const status = params.turn?.status;
      if (turn.failure) turn.finish(turn.failure);
      else if (status !== 'completed')
        turn.finish(new Error(params.turn?.error?.message || 'AI 服务执行未完成'));
      else {
        try {
          ensure(turn.message, 'AI 服务没有返回结构化结果');
          const result = JSON.parse(turn.message);
          ensure(!result.error, result.error);
          turn.finish(null, { ...result, threadId: params.threadId });
        } catch (error) {
          turn.finish(new Error(`AI 结果未通过验收：${error.message}`));
        }
      }
    }
  }

  fail(error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
    for (const turn of this.turns.values()) turn.finish(reason);
    this.turns.clear();
    this.child = null;
    this.starting = null;
  }

  async run({
    directory,
    prompt,
    schema,
    model,
    images = [],
    signal,
    onProgress = () => {},
    timeout = 20 * 60 * 1000,
  }) {
    if (signal?.aborted) throw new Error('任务已结束，已完成的结果会保留。');
    for (const image of images)
      ensure(typeof image === 'string' && path.isAbsolute(image), '参考图片路径无效。');
    const started = await this.request('thread/start', {
      model: model || null,
      cwd: directory,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    ensure(threadId, 'AI 服务没有返回会话标识');
    if (signal?.aborted) throw new Error('任务已结束，已完成的结果会保留。');
    return new Promise((resolve, reject) => {
      const state = {
        done: false,
        turnId: null,
        message: '',
        failure: null,
        onProgress,
        finish: (error, result) => {
          if (state.done) return;
          state.done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          this.turns.delete(threadId);
          if (error) reject(error);
          else resolve(result);
        },
      };
      const interrupt = (error) => {
        if (state.done) return;
        if (state.turnId)
          void this.requestRaw('turn/interrupt', { threadId, turnId: state.turnId }).catch(
            () => {},
          );
        state.finish(error);
      };
      const abort = () => interrupt(new Error('任务已结束，已完成的结果会保留。'));
      const timer = setTimeout(
        () =>
          interrupt(new Error('此步骤处理超时，请检查网络或账号额度后重试；已完成结果已保留。')),
        timeout,
      );
      this.turns.set(threadId, state);
      signal?.addEventListener('abort', abort, { once: true });
      this.requestRaw('turn/start', {
        threadId,
        input: [
          { type: 'text', text: prompt, text_elements: [] },
          ...images.map((image) => ({ type: 'localImage', path: image })),
        ],
        approvalPolicy: 'never',
        model: model || null,
        effort: 'low',
        outputSchema: schema,
      }).then(
        (response) => {
          state.turnId = response?.turn?.id || null;
          if (state.done || signal?.aborted) {
            if (state.turnId)
              void this.requestRaw('turn/interrupt', {
                threadId,
                turnId: state.turnId,
              }).catch(() => {});
            if (!state.done) abort();
          }
        },
        (error) => state.finish(error),
      );
    });
  }

  dispose() {
    this.closing = true;
    try {
      this.child?.kill();
    } catch {}
    this.fail(new Error('AI 服务已停止。'));
  }
}

let accountAppServer = null;

async function appServer() {
  const binary = codexBinary();
  if (!accountAppServer || accountAppServer.binary !== binary) {
    accountAppServer?.dispose();
    accountAppServer = new AccountAppServer(binary);
  }
  await accountAppServer.start();
  return accountAppServer;
}

export function disposeCodexAppServer() {
  accountAppServer?.dispose();
  accountAppServer = null;
}

export async function runCodex(input) {
  const server = await appServer();
  return server.run(input);
}
