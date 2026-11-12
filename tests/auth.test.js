import test from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopShell, openAuthorizationUrl } from '../src/auth.js';

test('desktop authorization uses intercepted navigation for the system browser', () => {
  const assigned = [];
  const opened = [];
  const mode = openAuthorizationUrl('https://auth.openai.com/authorize', {
    userAgent: 'Mozilla/5.0 Electron/40.10.2',
    location: { assign: (url) => assigned.push(url) },
    openWindow: (...args) => opened.push(args),
  });
  assert.equal(isDesktopShell('Electron/40.10.2'), true);
  assert.equal(mode, 'system-browser');
  assert.deepEqual(assigned, ['https://auth.openai.com/authorize']);
  assert.deepEqual(opened, []);
});

test('browser authorization reuses the synchronous popup and keeps a fallback', () => {
  const popup = { location: { href: '' } };
  assert.equal(
    openAuthorizationUrl('https://auth.openai.com/authorize', {
      userAgent: 'Mozilla/5.0 Chrome/140',
      popup,
    }),
    'popup',
  );
  assert.equal(popup.location.href, 'https://auth.openai.com/authorize');

  const opened = [];
  assert.equal(
    openAuthorizationUrl('https://auth.openai.com/fallback', {
      userAgent: 'Mozilla/5.0 Chrome/140',
      openWindow: (...args) => opened.push(args),
    }),
    'new-window',
  );
  assert.deepEqual(opened, [['https://auth.openai.com/fallback', '_blank', 'noopener,noreferrer']]);
});
