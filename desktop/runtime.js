import { existsSync } from 'node:fs';
import path from 'node:path';

const targets = {
  'darwin-arm64': {
    packageName: 'codex-darwin-arm64',
    triple: 'aarch64-apple-darwin',
    executable: 'codex',
  },
  'darwin-x64': {
    packageName: 'codex-darwin-x64',
    triple: 'x86_64-apple-darwin',
    executable: 'codex',
  },
  'linux-arm64': {
    packageName: 'codex-linux-arm64',
    triple: 'aarch64-unknown-linux-musl',
    executable: 'codex',
  },
  'linux-x64': {
    packageName: 'codex-linux-x64',
    triple: 'x86_64-unknown-linux-musl',
    executable: 'codex',
  },
  'win32-arm64': {
    packageName: 'codex-win32-arm64',
    triple: 'aarch64-pc-windows-msvc',
    executable: 'codex.exe',
  },
  'win32-x64': {
    packageName: 'codex-win32-x64',
    triple: 'x86_64-pc-windows-msvc',
    executable: 'codex.exe',
  },
};

export function desktopDataDirectory(userData) {
  return path.join(path.resolve(userData), 'workspace');
}

export function resolveDesktopDataDirectory({
  userData,
  legacyUserData = path.join(path.dirname(path.resolve(userData)), 'BadMark'),
  directoryExists = existsSync,
}) {
  const current = desktopDataDirectory(userData);
  const legacy = desktopDataDirectory(legacyUserData);
  return !directoryExists(current) && directoryExists(legacy) ? legacy : current;
}

export function bundledAiRelativePath(platform = process.platform, arch = process.arch) {
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`当前系统暂不支持桌面运行组件：${platform} ${arch}`);
  return path.join(
    'node_modules',
    '@openai',
    target.packageName,
    'vendor',
    target.triple,
    'bin',
    target.executable,
  );
}

export function resolveBundledAiBinary({
  appPath,
  resourcesPath,
  packaged,
  platform = process.platform,
  arch = process.arch,
  fileExists = existsSync,
}) {
  const relative = bundledAiRelativePath(platform, arch);
  const candidates = packaged
    ? [path.join(resourcesPath, 'app.asar.unpacked', relative), path.join(appPath, relative)]
    : [path.join(appPath, relative)];
  const binary = candidates.find((candidate) => fileExists(candidate));
  if (!binary) throw new Error(`红人馆AI桌面运行组件不完整，请重新安装。缺少：${relative}`);
  return binary;
}
