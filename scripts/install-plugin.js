import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root } from './service.js';

export function updateMarketplace(existing, { name, relativeSource }) {
  const marketplace = existing || {
    name: 'personal',
    interface: { displayName: 'Personal' },
    plugins: [],
  };
  marketplace.name ||= 'personal';
  marketplace.interface ||= { displayName: 'Personal' };
  marketplace.plugins ||= [];
  const entry = {
    name,
    source: { source: 'local', path: relativeSource },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
  };
  const index = marketplace.plugins.findIndex((plugin) => plugin.name === name);
  if (index >= 0) marketplace.plugins[index] = entry;
  else marketplace.plugins.push(entry);
  return marketplace;
}

export function installedMcpConfig({ name, projectRoot, nodePath }) {
  const key = name.replace(/-/g, '_');
  return {
    mcpServers: {
      [key]: {
        command: nodePath,
        args: [path.join(projectRoot, 'server/mcp.js')],
        env: { BADMARK_ROOT: projectRoot },
      },
    },
  };
}

export function installPlugin({
  projectRoot = root,
  homeDirectory = os.homedir(),
  nodePath = process.execPath,
  runCodex = true,
} = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const name = packageJson.name;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error('package.json 的 name 必须是小写连字符格式。');

  const source = path.join(projectRoot, 'plugins', name);
  if (!existsSync(source)) throw new Error(`找不到插件源目录：${source}`);
  const destination = path.join(homeDirectory, 'plugins', name);
  const marketplacePath = path.join(homeDirectory, '.agents', 'plugins', 'marketplace.json');

  mkdirSync(path.dirname(destination), { recursive: true });
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  writeFileSync(
    path.join(destination, '.mcp.json'),
    `${JSON.stringify(installedMcpConfig({ name, projectRoot, nodePath }), null, 2)}\n`,
  );

  mkdirSync(path.dirname(marketplacePath), { recursive: true });
  const existing = existsSync(marketplacePath)
    ? JSON.parse(readFileSync(marketplacePath, 'utf8'))
    : null;
  const marketplace = updateMarketplace(existing, {
    name,
    relativeSource: `./plugins/${name}`,
  });
  const temporary = `${marketplacePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(marketplace, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, marketplacePath);

  if (runCodex) {
    const command = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const result = spawnSync(command, ['plugin', 'add', `${name}@${marketplace.name}`], {
      cwd: homeDirectory,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Bomi智绘智能组件安装失败。');
  }
  return { name, destination, marketplacePath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = installPlugin();
  console.log(`${result.name} 已安装。重新打开应用即可加载更新；网页工作台可继续直接使用。`);
}
