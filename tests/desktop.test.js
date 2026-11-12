import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { startWorkbenchServer } from '../server/start.js';
import {
  bundledAiRelativePath,
  desktopDataDirectory,
  resolveBundledAiBinary,
  resolveDesktopDataDirectory,
} from '../desktop/runtime.js';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const {
  REQUIRED_ASAR_FILES,
  packagedAsarPath,
  verifyPackagedAsar,
} = require('../scripts/verify-desktop-package.cjs');

test('desktop runtime stores mutable workspace data outside the application bundle', () => {
  assert.equal(
    desktopDataDirectory('/Users/designer/Library/Application Support/Bomi智绘'),
    path.join('/Users/designer/Library/Application Support/Bomi智绘', 'workspace'),
  );
});

test('desktop runtime reuses the legacy BadMark workspace only when Bomi智绘 has no data yet', () => {
  const current = path.join('/Users/designer/Library/Application Support/Bomi智绘', 'workspace');
  const legacy = path.join('/Users/designer/Library/Application Support/BadMark', 'workspace');

  assert.equal(
    resolveDesktopDataDirectory({
      userData: '/Users/designer/Library/Application Support/Bomi智绘',
      directoryExists: (candidate) => candidate === legacy,
    }),
    legacy,
  );
  assert.equal(
    resolveDesktopDataDirectory({
      userData: '/Users/designer/Library/Application Support/Bomi智绘',
      directoryExists: (candidate) => candidate === current || candidate === legacy,
    }),
    current,
  );
  assert.equal(
    resolveDesktopDataDirectory({
      userData: '/Users/designer/Library/Application Support/Bomi智绘',
      directoryExists: () => false,
    }),
    current,
  );
});

test('desktop runtime resolves the packaged native AI component for supported systems', () => {
  const relative = bundledAiRelativePath('darwin', 'arm64');
  assert.equal(
    relative,
    path.join(
      'node_modules',
      '@openai',
      'codex-darwin-arm64',
      'vendor',
      'aarch64-apple-darwin',
      'bin',
      'codex',
    ),
  );
  const expected = path.join(
    '/Applications/Bomi智绘.app/Contents/Resources/app.asar.unpacked',
    relative,
  );
  assert.equal(
    resolveBundledAiBinary({
      appPath: '/Applications/Bomi智绘.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/Bomi智绘.app/Contents/Resources',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
      fileExists: (candidate) => candidate === expected,
    }),
    expected,
  );
});

test('desktop runtime rejects unsupported or incomplete packages', () => {
  assert.throws(() => bundledAiRelativePath('freebsd', 'x64'), /暂不支持/);
  assert.throws(
    () =>
      resolveBundledAiBinary({
        appPath: '/missing/app',
        resourcesPath: '/missing/resources',
        packaged: false,
        platform: 'win32',
        arch: 'x64',
        fileExists: () => false,
      }),
    /不完整/,
  );
});

test('desktop OpenAI requests use Electron networking so system proxy settings apply', () => {
  const source = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*net[^}]*\} from 'electron'/);
  assert.match(source, /thirdPartyFetch: \(\.\.\.args\) => net\.fetch/);
});

test('desktop exposes a native local output folder picker through an isolated preload', () => {
  const source = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(source, /preload: path\.join\(appPath, 'desktop', 'preload\.cjs'\)/);
  assert.match(source, /ipcMain\.handle\('bomi:select-output-directory'/);
  assert.match(source, /properties: \['openDirectory', 'createDirectory'\]/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('bomiDesktop'/);
  assert.match(preload, /ipcRenderer\.invoke\('bomi:select-output-directory'\)/);
});

test('Windows installer build targets mainstream x64 PCs even on an ARM Mac', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['desktop:dist:win'], /electron-builder --win nsis --x64/);
});

test('desktop package includes shared runtime modules and verifies every packaged app', () => {
  const builderConfig = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(builderConfig, /^\s*- shared\/\*\*\/\*\s*$/m);
  assert.match(builderConfig, /^afterPack: scripts\/verify-desktop-package\.cjs$/m);
  assert.ok(REQUIRED_ASAR_FILES.includes('/shared/openai-defaults.js'));
  assert.equal(
    packagedAsarPath({
      appOutDir: '/tmp/mac-arm64',
      electronPlatformName: 'darwin',
      packager: { appInfo: { productFilename: 'Bomi智绘' } },
    }),
    '/tmp/mac-arm64/Bomi智绘.app/Contents/Resources/app.asar',
  );
  assert.equal(
    packagedAsarPath({
      appOutDir: 'C:\\build\\win-unpacked',
      electronPlatformName: 'win32',
      packager: { appInfo: { productFilename: 'Bomi智绘' } },
    }),
    path.join('C:\\build\\win-unpacked', 'resources', 'app.asar'),
  );
});

test('desktop package verification rejects an installer with a missing shared runtime module', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bomi-desktop-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const archive = path.join(directory, 'app.asar');
  for (const file of REQUIRED_ASAR_FILES.filter(
    (entry) => entry !== '/shared/openai-defaults.js',
  )) {
    const output = path.join(source, file);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, file);
  }
  await createPackage(source, archive);
  assert.throws(() => verifyPackagedAsar(archive), /shared\/openai-defaults\.js/);
});

test('desktop server uses an isolated data directory and an available local port', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'badmark-desktop-server-'));
  let stopped = false;
  const runtime = await startWorkbenchServer({
    root: process.cwd(),
    directory,
    port: 0,
    seed: false,
    createExecutor: () => ({
      start() {},
      async stop() {
        stopped = true;
      },
      snapshot() {
        return { ready: false, message: 'test' };
      },
    }),
  });
  t.after(async () => {
    if (runtime.server.listening) await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const health = await fetch(`${runtime.url}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'local-ai');
  assert.equal(runtime.directory, directory);
  await runtime.close();
  assert.equal(stopped, true);
  assert.equal(runtime.server.listening, false);
});
