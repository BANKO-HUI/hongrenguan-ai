import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { serviceProxyEnvironment } from '../server/system-proxy.js';

export const root = path.resolve(
  process.env.BADMARK_ROOT || fileURLToPath(new URL('..', import.meta.url)),
);
export const directory = path.resolve(process.env.BADMARK_DATA_DIR || path.join(root, '.badmark'));
export const baseUrl = `http://127.0.0.1:${Number(process.env.BADMARK_PORT || 4174)}`;
const expectedId = createHash('sha256').update(directory).digest('hex');

export async function ensureService() {
  async function check() {
    let response;
    try {
      response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return false;
    }
    const body = await response.json().catch(() => ({}));
    if (body.application !== 'badmark-studio' || body.workspaceId !== expectedId)
      throw new Error('4174 端口已有其他服务或工作台，不能连接到错误的项目数据。');
    return body.ok;
  }
  if (!(await check())) {
    mkdirSync(directory, { recursive: true });
    const log = openSync(path.join(directory, 'server.log'), 'a', 0o600);
    const child = spawn(process.execPath, [path.join(root, 'server/start.js')], {
      cwd: root,
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        ...serviceProxyEnvironment(process.env),
        BADMARK_ROOT: root,
        BADMARK_DATA_DIR: directory,
      },
    });
    child.unref();
    closeSync(log);
    for (let i = 0; i < 80; i++) {
      await new Promise((resolve) => setTimeout(resolve, 125));
      if (await check()) return;
    }
    throw new Error(`工作台服务启动失败，请检查 ${path.join(directory, 'server.log')}`);
  }
}

export async function api(route, { method = 'GET', body, form, binary = false } = {}) {
  await ensureService();
  const token = readFileSync(path.join(directory, 'agent-token'), 'utf8').trim();
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
