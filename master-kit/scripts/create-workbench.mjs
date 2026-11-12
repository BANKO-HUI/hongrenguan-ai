import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';

const sourceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const rawArgs = process.argv.slice(2);
const destinationArg = rawArgs.find((arg) => !arg.startsWith('--'));
const configIndex = rawArgs.indexOf('--config');
const configArg = configIndex >= 0 ? rawArgs[configIndex + 1] : null;
if (!destinationArg || !configArg)
  throw new Error(
    '用法：node master-kit/scripts/create-workbench.mjs <目标目录> --config <配置文件>',
  );

const destination = path.resolve(destinationArg);
const configPath = path.resolve(configArg);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const { pluginId, displayName, brandName, frontendPort, backendPort } = config;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId || ''))
  throw new Error('pluginId 必须是小写连字符格式，例如 my-fashion-workbench。');
if (!String(displayName || '').trim() || !String(brandName || '').trim())
  throw new Error('displayName 和 brandName 不能为空。');
for (const [key, value] of Object.entries({ frontendPort, backendPort }))
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`${key} 必须是 1024–65535 的整数。`);
if (frontendPort === backendPort) throw new Error('前端和后端端口不能相同。');
if (existsSync(destination) && readdirSync(destination).length)
  throw new Error(`目标目录必须为空：${destination}`);

const excludedNames = new Set([
  '.git',
  '.badmark',
  'node_modules',
  'dist',
  'outputs',
  'releases',
  'prototypes',
  'test-results',
  'playwright-report',
  '项目资料',
  '交付文档',
]);
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(sourceRoot)) {
  if (excludedNames.has(name)) continue;
  cpSync(path.join(sourceRoot, name), path.join(destination, name), { recursive: true });
}

const oldPluginDirectory = path.join(destination, 'plugins', 'badmark-studio');
const newPluginDirectory = path.join(destination, 'plugins', pluginId);
if (oldPluginDirectory !== newPluginDirectory) renameSync(oldPluginDirectory, newPluginDirectory);

const textExtensions = new Set(['.js', '.mjs', '.jsx', '.json', '.md', '.html', '.css', '.svg']);
const visit = (folder) => {
  for (const entry of readdirSync(folder)) {
    const filename = path.join(folder, entry);
    const stat = statSync(filename);
    if (stat.isDirectory()) visit(filename);
    else if (textExtensions.has(path.extname(entry))) {
      const original = readFileSync(filename, 'utf8');
      const updated = original
        .replaceAll('badmark-studio', pluginId)
        .replaceAll('BadMark Studio', displayName)
        .replaceAll('BadMark', brandName)
        .replaceAll('4173', String(frontendPort))
        .replaceAll('4174', String(backendPort));
      if (updated !== original) writeFileSync(filename, updated);
    }
  }
};
visit(destination);

const mcpPath = path.join(newPluginDirectory, '.mcp.json');
writeFileSync(
  mcpPath,
  `${JSON.stringify(
    {
      mcpServers: {
        [pluginId.replace(/-/g, '_')]: {
          command: 'node',
          args: ['../../server/mcp.js'],
          cwd: '../..',
        },
      },
    },
    null,
    2,
  )}\n`,
);
const pluginManifestPath = path.join(newPluginDirectory, '.codex-plugin', 'plugin.json');
const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8'));
pluginManifest.name = pluginId;
pluginManifest.interface.displayName = displayName;
pluginManifest.interface.developerName = brandName;
writeFileSync(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
writeFileSync(
  path.join(destination, 'workbench.config.json'),
  `${JSON.stringify({ ...config, createdFrom: 'bomi-golden-master-3.0' }, null, 2)}\n`,
);

process.stdout.write(
  `已创建 ${displayName}：${destination}\n下一步：进入该目录并运行 node master-kit/scripts/bootstrap.mjs\n`,
);
