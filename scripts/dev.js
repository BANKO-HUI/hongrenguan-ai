import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensureService, root } from './service.js';
await ensureService();
const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
