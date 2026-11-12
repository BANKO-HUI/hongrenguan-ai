import { execFileSync } from 'node:child_process';

const localBypass = ['127.0.0.1', 'localhost', '::1'];

const valueFromScutil = (source, key) =>
  source.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm'))?.[1]?.trim() || '';

export function parseMacSystemProxy(source = '') {
  for (const prefix of ['HTTPS', 'HTTP']) {
    if (valueFromScutil(source, `${prefix}Enable`) !== '1') continue;
    const host = valueFromScutil(source, `${prefix}Proxy`);
    const port = Number(valueFromScutil(source, `${prefix}Port`));
    if (host && Number.isInteger(port) && port > 0 && port <= 65535)
      return `http://${host}:${port}`;
  }
  return '';
}

export function parseWindowsSystemProxy(source = '') {
  const enabled = source.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1];
  if (!enabled || Number.parseInt(enabled, 16) !== 1) return '';
  const raw = source.match(/ProxyServer\s+REG_SZ\s+(.+?)\s*$/im)?.[1]?.trim() || '';
  if (!raw) return '';
  const entries = Object.fromEntries(
    raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
          ? ['all', part]
          : [part.slice(0, separator).toLowerCase(), part.slice(separator + 1)];
      }),
  );
  const address = entries.https || entries.http || entries.all || '';
  if (!address || !/^[^\s/:]+:\d+$/.test(address)) return '';
  return `http://${address}`;
}

export function readSystemProxy({ platform = process.platform, execute = execFileSync } = {}) {
  try {
    if (platform === 'darwin')
      return parseMacSystemProxy(execute('scutil', ['--proxy'], { encoding: 'utf8' }));
    if (platform === 'win32')
      return parseWindowsSystemProxy(
        execute(
          'reg.exe',
          ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
  } catch {
    return '';
  }
  return '';
}

export function serviceProxyEnvironment(
  source = process.env,
  { platform = process.platform, execute = execFileSync } = {},
) {
  const environment = { ...source };
  const existing =
    environment.HTTPS_PROXY ||
    environment.https_proxy ||
    environment.ALL_PROXY ||
    environment.all_proxy ||
    environment.HTTP_PROXY ||
    environment.http_proxy;
  const proxy = existing || readSystemProxy({ platform, execute });
  if (!proxy) return environment;
  if (!environment.HTTPS_PROXY && !environment.https_proxy) environment.HTTPS_PROXY = proxy;
  if (!environment.HTTP_PROXY && !environment.http_proxy) environment.HTTP_PROXY = proxy;
  const currentBypass = environment.NO_PROXY || environment.no_proxy || '';
  environment.NO_PROXY = [
    ...new Set(
      [...currentBypass.split(','), ...localBypass].map((item) => item.trim()).filter(Boolean),
    ),
  ].join(',');
  environment.NODE_USE_ENV_PROXY = '1';
  return environment;
}

export function proxyBootstrapEnvironment(
  source = process.env,
  { platform = process.platform, execute = execFileSync } = {},
) {
  if (source.BADMARK_PROXY_BOOTSTRAPPED === '1' || source.NODE_USE_ENV_PROXY === '1') return null;
  const environment = serviceProxyEnvironment(source, { platform, execute });
  if (environment.NODE_USE_ENV_PROXY !== '1') return null;
  return { ...environment, BADMARK_PROXY_BOOTSTRAPPED: '1' };
}
