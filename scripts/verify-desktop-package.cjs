const { existsSync } = require('node:fs');
const path = require('node:path');
const { listPackage } = require('@electron/asar');

const REQUIRED_ASAR_FILES = [
  '/desktop/main.js',
  '/desktop/runtime.js',
  '/dist/index.html',
  '/package.json',
  '/server/api-profile-store.js',
  '/server/start.js',
  '/shared/openai-defaults.js',
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

async function afterPack(context) {
  verifyPackagedAsar(packagedAsarPath(context));
}

module.exports = afterPack;
module.exports.REQUIRED_ASAR_FILES = REQUIRED_ASAR_FILES;
module.exports.packagedAsarPath = packagedAsarPath;
module.exports.verifyPackagedAsar = verifyPackagedAsar;
