import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { startWorkbenchServer } from '../server/start.js';
import { Executor } from '../server/executor.js';
import { resolveBundledAiBinary, resolveDesktopDataDirectory } from './runtime.js';

let mainWindow;
let runtime;

function createWindow(url, appPath = app.getAppPath()) {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#f6f4ef',
    title: 'Bomi智绘',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(appPath, 'desktop', 'preload.cjs'),
    },
  });
  const sameOrigin = new URL(url).origin;
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(sameOrigin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 820,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(sameOrigin)) return;
    event.preventDefault();
    if (/^https:\/\//i.test(target)) void shell.openExternal(target);
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(url);
  return window;
}

async function startDesktop() {
  const appPath = app.getAppPath();
  const directory =
    process.env.BADMARK_DATA_DIR ||
    resolveDesktopDataDirectory({ userData: app.getPath('userData') });
  process.env.BADMARK_CODEX_BIN = resolveBundledAiBinary({
    appPath,
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });
  runtime = await startWorkbenchServer({
    root: appPath,
    directory,
    port: 0,
    seed: false,
    createExecutor: (workbench) =>
      new Executor(workbench, {
        thirdPartyFetch: (...args) => net.fetch(...args),
      }),
  });
  mainWindow = createWindow(runtime.url, appPath);
}

app.setName('Bomi智绘');
ipcMain.handle('bomi:select-output-directory', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return '';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择成片自动保存文件夹',
    buttonLabel: '绑定此文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0] || '';
});
app
  .whenReady()
  .then(startDesktop)
  .catch((error) => {
    dialog.showErrorBox('Bomi智绘无法启动', error.message);
    app.quit();
  });

app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length && runtime)
    mainWindow = createWindow(runtime.url, app.getAppPath());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!runtime || runtime.closing) return;
  event.preventDefault();
  runtime.closing = true;
  void runtime.close().finally(() => {
    runtime = null;
    app.quit();
  });
});
