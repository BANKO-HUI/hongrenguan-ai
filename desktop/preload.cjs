const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bomiDesktop', {
  selectOutputDirectory: () => ipcRenderer.invoke('bomi:select-output-directory'),
});
