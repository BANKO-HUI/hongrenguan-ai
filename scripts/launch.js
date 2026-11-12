import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { baseUrl, ensureService } from './service.js';

export function browserCommand(platform, url) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32')
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export async function launchWorkbench({ platform = process.platform, open = true } = {}) {
  await ensureService();
  if (open) {
    const target = browserCommand(platform, baseUrl);
    const child = spawn(target.command, target.args, {
      detached: platform !== 'win32',
      stdio: 'ignore',
    });
    child.unref();
  }
  return baseUrl;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const url = await launchWorkbench({ open: !process.argv.includes('--no-open') });
  console.log(`Bomi智绘工作台已启动：${url}`);
}
