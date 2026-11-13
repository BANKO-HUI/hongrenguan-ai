import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { unzipSync } from 'fflate';
import {
  archivePath,
  releaseDirectory,
  releaseName,
  sourceRoot,
  templateMetadata,
} from './package-master-kit.js';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const forbiddenParts = new Set([
  '.badmark',
  'node_modules',
  'dist',
  'outputs',
  '项目资料',
  '交付文档',
  'test-results',
  'playwright-report',
]);
const textExtensions = new Set(['.js', '.mjs', '.jsx', '.json', '.md', '.html', '.css', '.svg']);

function walk(folder, base = folder) {
  const files = [];
  for (const name of readdirSync(folder).sort()) {
    const filename = path.join(folder, name);
    if (statSync(filename).isDirectory()) files.push(...walk(filename, base));
    else
      files.push({ filename, relative: path.relative(base, filename).split(path.sep).join('/') });
  }
  return files;
}

export function verifyMasterKit() {
  const packagedRoot = existsSync(path.join(releaseDirectory, 'MASTER-MANIFEST.json'))
    ? releaseDirectory
    : sourceRoot;
  const manifestPath = path.join(packagedRoot, 'MASTER-MANIFEST.json');
  if (!existsSync(manifestPath))
    throw new Error('未找到 MASTER-MANIFEST.json，请先运行 npm run master:package。');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.containsUserData !== false)
    throw new Error('母版清单必须明确 containsUserData=false。');
  if (
    manifest.name !== `${templateMetadata.applicationName} ${templateMetadata.name}` ||
    manifest.version !== templateMetadata.templateVersion
  )
    throw new Error(`母版清单不是${templateMetadata.name}。`);
  if (manifest.sourceTag !== templateMetadata.gitTag)
    throw new Error('母版清单缺少当前黄金母版标记。');

  for (const [relative, expected] of Object.entries(manifest.checksums)) {
    const filename = path.join(packagedRoot, relative);
    if (!existsSync(filename)) throw new Error(`母版缺少清单文件：${relative}`);
    if (sha256(readFileSync(filename)) !== expected) throw new Error(`文件校验失败：${relative}`);
  }
  for (const { filename, relative } of walk(packagedRoot)) {
    const parts = relative.split('/');
    if (parts.some((part) => forbiddenParts.has(part)))
      throw new Error(`母版包含运行数据：${relative}`);
    if (textExtensions.has(path.extname(filename))) {
      const text = readFileSync(filename, 'utf8');
      if (/\/Users\/banko\/|[A-Za-z]:\\Users\\banko\\/i.test(text))
        throw new Error(`母版包含开发电脑绝对路径：${relative}`);
    }
  }

  if (packagedRoot === releaseDirectory) {
    if (!existsSync(archivePath)) throw new Error('母版 ZIP 不存在。');
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)));
    const required = [
      `${releaseName}/START-HERE.md`,
      `${releaseName}/GOLDEN-TEMPLATE.json`,
      `${releaseName}/LICENSE`,
      `${releaseName}/CONTRIBUTING.md`,
      `${releaseName}/.github/workflows/ci.yml`,
      `${releaseName}/package.json`,
      `${releaseName}/electron-builder.yml`,
      `${releaseName}/desktop/main.js`,
      `${releaseName}/server/workbench.js`,
      `${releaseName}/shared/openai-defaults.js`,
      `${releaseName}/scripts/verify-desktop-package.cjs`,
      `${releaseName}/build/icon-source.png`,
      `${releaseName}/plugins/badmark-studio/.codex-plugin/plugin.json`,
      `${releaseName}/master-kit/scripts/bootstrap.mjs`,
      `${releaseName}/public/fonts/kanit-400.ttf`,
    ];
    for (const entry of required) if (!entries[entry]) throw new Error(`ZIP 缺少：${entry}`);
  }
  return { packagedRoot, files: Object.keys(manifest.checksums).length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyMasterKit();
  console.log(`母版验证通过：${result.files} 个受校验文件，目录 ${result.packagedRoot}`);
}
