import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workbench } from '../server/workbench.js';
import { createApp } from '../server/http.js';
import { Executor } from '../server/executor.js';
import { fakeProvider } from '../tests/fake-provider.js';
const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-e2e-'));
const directory = path.join(temporary, '.badmark');
const workbench = new Workbench({ root: process.cwd(), directory });
const provider = fakeProvider();
const executor = new Executor(workbench, provider);
const app = createApp(workbench, {
  agentKey: 'e2e-isolated-only',
  executor,
  chat: async () => ({ reply: '已读取当前项目和任务状态，可以继续完善设计方向。' }),
});
executor.start();
const server = app.listen(4184, '127.0.0.1');
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await executor.stop();
    server.close(() => process.exit(0));
  });
