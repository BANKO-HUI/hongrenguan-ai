import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

export const sourceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const templateMetadata = JSON.parse(
  readFileSync(path.join(sourceRoot, 'GOLDEN-TEMPLATE.json'), 'utf8'),
);
export const releaseName = templateMetadata.technicalId;
export const releasesDirectory = path.join(sourceRoot, 'releases');
export const releaseDirectory = path.join(releasesDirectory, releaseName);
export const archivePath = path.join(releasesDirectory, `${releaseName}.zip`);

const rootFiles = [
  '.gitignore',
  '.prettierrc.json',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'GOLDEN-TEMPLATE.json',
  'LICENSE',
  'README.md',
  'build/icon-source.png',
  'build/icon.png',
  'index.html',
  'install.command',
  'install.cmd',
  'package-lock.json',
  'package.json',
  'playwright.config.js',
  'electron-builder.yml',
  'vite.config.js',
];
const directories = ['.github', 'src', 'server', 'shared', 'master-kit', 'desktop'];
const scriptFiles = [
  'dev.js',
  'e2e-server.js',
  'install-plugin.js',
  'launch.js',
  'package-master-kit.js',
  'service.js',
  'verify-master-kit.js',
  'build-desktop-icon.js',
  'verify-desktop-package.cjs',
];
const testFiles = [
  'annotation-groups.test.js',
  'api-profile-store.test.js',
  'chat.test.js',
  'codex.test.js',
  'generation-slots.test.js',
  'executor.test.js',
  'fake-provider.js',
  'helpers.js',
  'http.test.js',
  'image-sort.test.js',
  'launch.test.js',
  'desktop.test.js',
  'master-package.test.js',
  'mcp.test.js',
  'auth.test.js',
  'openai-compatible.test.js',
  'open-source.test.js',
  'presentation-template.test.js',
  'referenceMentions.test.js',
  'regional-restyle.test.js',
  'scroll-rail.test.js',
  'system-proxy.test.js',
  'theme.test.js',
  'thumbnailNavigation.test.js',
  'ui-copy.test.js',
  'workbench.test.js',
  'zoomMath.test.js',
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const normalize = (filename) => filename.split(path.sep).join('/');

function copyRelative(relative) {
  const source = path.join(sourceRoot, relative);
  if (!existsSync(source)) throw new Error(`母版缺少文件：${relative}`);
  cpSync(source, path.join(releaseDirectory, relative), { recursive: true });
}

function walk(folder, base = folder) {
  const files = [];
  for (const name of readdirSync(folder).sort()) {
    const filename = path.join(folder, name);
    if (statSync(filename).isDirectory()) files.push(...walk(filename, base));
    else files.push({ filename, relative: normalize(path.relative(base, filename)) });
  }
  return files;
}

export function buildMasterKit() {
  rmSync(releaseDirectory, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  rmSync(`${archivePath}.sha256`, { force: true });
  mkdirSync(releaseDirectory, { recursive: true });

  for (const file of rootFiles) copyRelative(file);
  for (const directory of directories) copyRelative(directory);
  for (const file of scriptFiles) copyRelative(path.join('scripts', file));
  for (const file of testFiles) copyRelative(path.join('tests', file));
  copyRelative(path.join('tests', 'e2e'));
  copyRelative(path.join('plugins', 'badmark-studio'));
  copyRelative('public');
  cpSync(
    path.join(sourceRoot, 'master-kit', 'README.md'),
    path.join(releaseDirectory, 'START-HERE.md'),
  );

  const files = walk(releaseDirectory);
  const checksums = Object.fromEntries(
    files.map(({ filename, relative }) => [relative, sha256(readFileSync(filename))]),
  );
  const manifest = {
    formatVersion: 1,
    name: `${templateMetadata.applicationName} ${templateMetadata.name}`,
    version: templateMetadata.templateVersion,
    application: {
      name: templateMetadata.applicationName,
      version: templateMetadata.applicationVersion,
    },
    sourceTag: templateMetadata.gitTag,
    createdAt: new Date().toISOString(),
    purpose: ['跨电脑安装红人馆AI', '创建独立 ID 与端口的新工作台'],
    containsUserData: false,
    requirements: { node: '>=22.0.0', codexLogin: true },
    entryPoints: {
      startHere: 'START-HERE.md',
      bootstrap: 'master-kit/scripts/bootstrap.mjs',
      createWorkbench: 'master-kit/scripts/create-workbench.mjs',
      aiPrompt: 'master-kit/AI-REPLICATION-PROMPT.md',
    },
    excluded: [
      '.badmark',
      'node_modules',
      'dist',
      'outputs',
      '项目资料',
      '交付文档',
      'logs and credentials',
    ],
    checksums,
  };
  writeFileSync(
    path.join(releaseDirectory, 'MASTER-MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const zipEntries = {};
  for (const { filename, relative } of walk(releaseDirectory))
    zipEntries[`${releaseName}/${relative}`] = new Uint8Array(readFileSync(filename));
  const archive = Buffer.from(zipSync(zipEntries, { level: 9 }));
  writeFileSync(archivePath, archive);
  writeFileSync(`${archivePath}.sha256`, `${sha256(archive)}  ${path.basename(archivePath)}\n`);
  return { releaseDirectory, archivePath, manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = buildMasterKit();
  console.log(result.releaseDirectory);
  console.log(result.archivePath);
}
