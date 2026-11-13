const { existsSync } = require('node:fs');
const path = require('node:path');
const { listPackage } = require('@electron/asar');

const REQUIRED_ASAR_FILES = [
  '/LICENSE',
  '/README.md',
  '/desktop/main.js',
  '/desktop/runtime.js',
  '/dist/index.html',
  '/package.json',
  '/server/api-profile-store.js',
  '/server/start.js',
  '/shared/openai-defaults.js',
];

const WINDOWS_REQUIRED_UNPACKED_FILES = [
  'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.4.node',
  'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll',
  'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.6.dll',
  'node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
  'node_modules/@napi-rs/canvas-win32-x64-msvc/icudtl.dat',
  'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
];

function packagedAsarPath(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar',
    );
  }
  return path.join(context.appOutDir, 'resources', 'app.asar');
}

function verifyPackagedAsar(archivePath, requiredFiles = REQUIRED_ASAR_FILES) {
  if (!existsSync(archivePath)) {
    throw new Error(`桌面安装包校验失败：找不到 ${archivePath}`);
  }
  const entries = new Set(listPackage(archivePath));
  const missing = requiredFiles.filter((file) => !entries.has(file));
  if (missing.length) {
    throw new Error(`桌面安装包校验失败，缺少：${missing.join('、')}`);
  }
  return { archivePath, checked: requiredFiles.length };
}

function verifyPackagedNativeRuntime(context) {
  if (context.electronPlatformName !== 'win32') return { checked: 0, skipped: true };
  const unpackedRoot = path.join(path.dirname(packagedAsarPath(context)), 'app.asar.unpacked');
  const missing = WINDOWS_REQUIRED_UNPACKED_FILES.filter(
    (relativePath) => !existsSync(path.join(unpackedRoot, relativePath)),
  );
  if (missing.length) {
    throw new Error(`Windows 安装包校验失败，缺少原生组件：${missing.join('、')}`);
  }
  return { unpackedRoot, checked: WINDOWS_REQUIRED_UNPACKED_FILES.length };
}

async function afterPack(context) {
  verifyPackagedAsar(packagedAsarPath(context));
  verifyPackagedNativeRuntime(context);
}

module.exports = afterPack;
module.exports.REQUIRED_ASAR_FILES = REQUIRED_ASAR_FILES;
module.exports.WINDOWS_REQUIRED_UNPACKED_FILES = WINDOWS_REQUIRED_UNPACKED_FILES;
module.exports.packagedAsarPath = packagedAsarPath;
module.exports.verifyPackagedAsar = verifyPackagedAsar;
module.exports.verifyPackagedNativeRuntime = verifyPackagedNativeRuntime;
