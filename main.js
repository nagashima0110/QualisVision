const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SRC_DIR = __dirname;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(SRC_DIR, 'preload.js')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0c10',
    show: false,
    title: 'QualisVision'
  });

  win.loadFile(path.join(SRC_DIR, 'index.html'));
  win.once('ready-to-show', () => { win.show(); });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ファイル選択ダイアログ
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Excel / TSV Files', extensions: ['xlsx', 'xls', 'tsv', 'txt'] }]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ファイル読み込み（xlsx: base64、テキスト: パース済み2次元配列）
ipcMain.handle('read-file', async (event, filePath) => {
  const buffer = fs.readFileSync(filePath);

  const magic4 = buffer.slice(0, 4).toString('hex');
  const isZip = magic4 === '504b0304'; // xlsx
  const isCfb = magic4 === 'd0cf11e0'; // xls

  if (isZip || isCfb) {
    return { type: 'excel', data: buffer.toString('base64') };
  }

  let text;
  try {
    const decoder = new TextDecoder('shift-jis');
    text = decoder.decode(buffer);
  } catch (e) {
    text = buffer.toString('utf-8');
  }

  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const firstLine = text.split(/\r?\n/)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const rawData = lines.map(line =>
    line.split(delimiter).map(cell => {
      const trimmed = cell.trim();
      return trimmed === '' ? null : trimmed;
    })
  );

  return { type: 'text', data: rawData };
});

// CSVエクスポート
ipcMain.handle('save-csv', async (event, content, defaultName) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, '﻿' + content, 'utf8');
  return true;
});

// Excelエクスポート
ipcMain.handle('save-excel', async (event, base64Data, defaultName) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return false;
  const buf = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(result.filePath, buf);
  return true;
});
