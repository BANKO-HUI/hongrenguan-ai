import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Workbench } from './workbench.js';
import { createApp } from './http.js';
import { Executor } from './executor.js';
import { proxyBootstrapEnvironment } from './system-proxy.js';

const defaultRoot = path.resolve(
  process.env.BADMARK_ROOT || fileURLToPath(new URL('..', import.meta.url)),
);

export function startWorkbenchServer({
  root = defaultRoot,
  directory = process.env.BADMARK_DATA_DIR || path.join(root, '.badmark'),
  port = Number(process.env.BADMARK_PORT || 4174),
  host = '127.0.0.1',
  seed = process.env.BADMARK_SEED !== 'false',
  createExecutor = (workbench) => new Executor(workbench),
} = {}) {
  root = path.resolve(root);
  directory = path.resolve(directory);
  let app;
  let executor;
  const server = createServer((req, res) => (app ? app(req, res) : res.writeHead(503).end()));

  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once('error', fail);
    // Acquire the listen socket before loading/recovering the database: there is exactly one writer.
    server.listen(port, host, () => {
      try {
        const workbench = new Workbench({ root, directory, seed });
        executor = createExecutor(workbench);
        app = createApp(workbench, {
          workspaceId: createHash('sha256').update(directory).digest('hex'),
          executor,
        });
        executor.start();
        server.off('error', fail);
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        const url = `http://${host}:${actualPort}`;
        const close = async () => {
          await executor?.stop();
          if (!server.listening) return;
          await new Promise((done, closeReject) =>
            server.close((error) => (error ? closeReject(error) : done())),
          );
        };
        console.log(`红人馆AI工作台：${url}`);
        resolve({ server, executor, workbench, url, directory, close });
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const proxyEnvironment = proxyBootstrapEnvironment();
  if (proxyEnvironment) {
    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: process.cwd(),
      env: proxyEnvironment,
      stdio: 'inherit',
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        if (!child.killed) child.kill(signal);
      });
    const [code, signal] = await once(child, 'exit');
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  } else {
    let runtime;
    try {
      runtime = await startWorkbenchServer();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, async () => {
        await runtime.close();
        process.exit(0);
      });
  }
}
