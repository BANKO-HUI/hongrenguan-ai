import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const skipPlugin = args.has('--skip-plugin');
const full = args.has('--full');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 9))
  throw new Error(`需要 Node.js 20.9 或更高版本，当前为 ${process.versions.node}。`);
if (!existsSync(path.join(root, 'package-lock.json')))
  throw new Error('母版缺少 package-lock.json。');

const executable = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const run = (command, commandArgs) => {
  const result = spawnSync(executable(command), commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} 执行失败。`);
};

run('npm', ['ci', '--no-audit', '--no-fund']);
run('npm', ['test']);
run('npm', ['run', 'build']);
if (full) {
  run('npx', ['playwright', 'install', 'chromium']);
  run('npm', ['run', 'test:e2e']);
}
if (!skipPlugin) run('npm', ['run', 'plugin:install']);

process.stdout.write(
  `\n安装完成。运行 npm run open 打开工作台。${skipPlugin ? '当前跳过了智能组件安装。' : '重新打开应用即可加载更新。'}\n`,
);
