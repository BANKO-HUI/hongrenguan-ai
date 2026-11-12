import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand } from '../scripts/launch.js';

test('desktop launcher selects a safe browser command for each supported platform', () => {
  const url = 'http://127.0.0.1:4174';
  assert.deepEqual(browserCommand('darwin', url), { command: 'open', args: [url] });
  assert.deepEqual(browserCommand('linux', url), { command: 'xdg-open', args: [url] });
  assert.deepEqual(browserCommand('win32', url), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'start', '', url],
  });
});
