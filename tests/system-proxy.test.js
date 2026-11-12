import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMacSystemProxy,
  parseWindowsSystemProxy,
  proxyBootstrapEnvironment,
  serviceProxyEnvironment,
} from '../server/system-proxy.js';

test('macOS system HTTPS proxy is converted into Node fetch proxy environment', () => {
  const output = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`;
  assert.equal(parseMacSystemProxy(output), 'http://127.0.0.1:7890');
  const environment = serviceProxyEnvironment(
    { PATH: '/usr/bin' },
    { platform: 'darwin', execute: () => output },
  );
  assert.equal(environment.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(environment.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(environment.NODE_USE_ENV_PROXY, '1');
  assert.match(environment.NO_PROXY, /127\.0\.0\.1/);
  assert.match(environment.NO_PROXY, /localhost/);
});

test('Windows proxy and explicit environment settings are preserved safely', () => {
  const output = `
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       http=10.0.0.8:8080;https=10.0.0.9:8443
  `;
  assert.equal(parseWindowsSystemProxy(output), 'http://10.0.0.9:8443');
  const environment = serviceProxyEnvironment(
    { HTTPS_PROXY: 'http://existing.proxy:3128', NO_PROXY: 'internal.example' },
    { platform: 'win32', execute: () => output },
  );
  assert.equal(environment.HTTPS_PROXY, 'http://existing.proxy:3128');
  assert.equal(environment.HTTP_PROXY, 'http://existing.proxy:3128');
  assert.match(environment.NO_PROXY, /internal\.example/);
  assert.equal(environment.NODE_USE_ENV_PROXY, '1');
});

test('disabled or malformed system proxies are ignored', () => {
  assert.equal(parseMacSystemProxy('HTTPSEnable : 0'), '');
  assert.equal(
    parseWindowsSystemProxy('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ 127.0.0.1:8080'),
    '',
  );
  assert.deepEqual(
    serviceProxyEnvironment(
      { PATH: '/usr/bin' },
      { platform: 'linux', execute: () => assert.fail('should not execute') },
    ),
    { PATH: '/usr/bin' },
  );
});

test('direct server launches restart once with system proxy support enabled', () => {
  const output = `
<dictionary> {
  HTTPSEnable : 1
  HTTPSPort : 17891
  HTTPSProxy : 127.0.0.1
}`;
  const environment = proxyBootstrapEnvironment(
    { PATH: '/usr/bin' },
    { platform: 'darwin', execute: () => output },
  );
  assert.equal(environment.HTTPS_PROXY, 'http://127.0.0.1:17891');
  assert.equal(environment.NODE_USE_ENV_PROXY, '1');
  assert.equal(environment.BADMARK_PROXY_BOOTSTRAPPED, '1');
  assert.equal(
    proxyBootstrapEnvironment(environment, {
      platform: 'darwin',
      execute: () => assert.fail('must not restart twice'),
    }),
    null,
  );
});

test('direct server launch keeps an explicitly proxy-enabled environment in place', () => {
  assert.equal(
    proxyBootstrapEnvironment(
      {
        NODE_USE_ENV_PROXY: '1',
        HTTPS_PROXY: 'http://existing.proxy:3128',
      },
      { platform: 'win32', execute: () => assert.fail('must preserve explicit settings') },
    ),
    null,
  );
});
