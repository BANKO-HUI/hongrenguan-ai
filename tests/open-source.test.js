import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('repository publishes complete AGPL open-source metadata without runtime data', () => {
  const packageJson = JSON.parse(read('package.json'));
  const license = read('LICENSE');
  const readme = read('README.md');
  const contributing = read('CONTRIBUTING.md');
  const gitignore = read('.gitignore');

  assert.equal(packageJson.license, 'AGPL-3.0-only');
  assert.equal(packageJson.engines.node, '>=22.0.0');
  assert.equal(packageJson.repository.url, 'git+https://github.com/BANKO-HUI/hongrenguan-ai.git');
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.match(readme, /AGPL-3\.0/);
  assert.match(contributing, /npm test/);
  assert.match(gitignore, /^\.badmark\/$/m);
  assert.match(gitignore, /^\.env$/m);
});

test('public CI installs locked dependencies and verifies tests plus production build', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
});
