import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { updateMarketplace, installedMcpConfig } from '../scripts/install-plugin.js';
import { verifyMasterKit } from '../scripts/verify-master-kit.js';

test('portable plugin installer creates marketplace and target-machine MCP configuration', () => {
  const marketplace = updateMarketplace(null, {
    name: 'sample-workbench',
    relativeSource: './plugins/sample-workbench',
  });
  assert.equal(marketplace.name, 'personal');
  assert.equal(marketplace.plugins[0].name, 'sample-workbench');
  const mcp = installedMcpConfig({
    name: 'sample-workbench',
    projectRoot: '/portable/project',
    nodePath: '/portable/node',
  });
  assert.equal(mcp.mcpServers.sample_workbench.command, '/portable/node');
  assert.deepEqual(mcp.mcpServers.sample_workbench.args, ['/portable/project/server/mcp.js']);
});

test('master release is complete, checksum-verified and free of runtime data', () => {
  const result = verifyMasterKit();
  assert.ok(result.files > 25);
  const manifest = JSON.parse(readFileSync(path.join(result.packagedRoot, 'MASTER-MANIFEST.json')));
  assert.equal(manifest.name, '红人馆AI 黄金母版3.0');
  assert.equal(manifest.application.name, '红人馆AI');
  assert.equal(manifest.version, '3.0');
  assert.equal(manifest.application.version, '3.4.4');
  assert.equal(manifest.sourceTag, 'golden-master-3.0');
  assert.equal(manifest.containsUserData, false);
  assert.ok(existsSync(path.join(result.packagedRoot, 'public/fonts/kanit-400.ttf')));
  assert.ok(existsSync(path.join(result.packagedRoot, 'tests/theme.test.js')));
  assert.ok(existsSync(path.join(result.packagedRoot, 'shared/openai-defaults.js')));
  assert.ok(existsSync(path.join(result.packagedRoot, 'build/icon-source.png')));
  assert.ok(existsSync(path.join(result.packagedRoot, 'LICENSE')));
  assert.ok(existsSync(path.join(result.packagedRoot, 'CONTRIBUTING.md')));
  assert.ok(existsSync(path.join(result.packagedRoot, '.github/workflows/ci.yml')));
});

test('master initializer creates an independently named and ported workbench', () => {
  const packagedRoot = verifyMasterKit().packagedRoot;
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-master-clone-'));
  const destination = path.join(temporary, 'new-workbench');
  const config = path.resolve('master-kit/project.config.example.json');
  execFileSync(
    process.execPath,
    [
      path.join(packagedRoot, 'master-kit/scripts/create-workbench.mjs'),
      destination,
      '--config',
      config,
    ],
    { stdio: 'pipe' },
  );
  const packageJson = JSON.parse(readFileSync(path.join(destination, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'my-fashion-workbench');
  const manifest = JSON.parse(
    readFileSync(
      path.join(destination, 'plugins/my-fashion-workbench/.codex-plugin/plugin.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.name, 'my-fashion-workbench');
  assert.equal(manifest.interface.displayName, '我的服装工作台');
  assert.match(readFileSync(path.join(destination, 'vite.config.js'), 'utf8'), /4273/);
  assert.match(readFileSync(path.join(destination, 'server/start.js'), 'utf8'), /4274/);
  const workbenchConfig = JSON.parse(
    readFileSync(path.join(destination, 'workbench.config.json'), 'utf8'),
  );
  assert.equal(workbenchConfig.createdFrom, 'bomi-golden-master-3.0');
});
