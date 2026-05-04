const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveCsv: (content, defaultName) => ipcRenderer.invoke('save-csv', content, defaultName),
  saveExcel: (base64Data, defaultName) => ipcRenderer.invoke('save-excel', base64Data, defaultName),
});
