const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({ 
    width: 1200, 
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load compiled production app
  win.loadFile(path.join(__dirname, 'dist/index.html'));

  // 🖨️ IPC HANDLER: Silent print directly to default system thermal printer (no print dialog prompt)
  ipcMain.handle('print-silent', async (event, options) => {
    try {
      await win.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: options?.deviceName || ''
      });
      return { success: true };
    } catch (err) {
      console.error('Silent print failed:', err);
      return { success: false, error: err.message };
    }
  });
}

app.whenReady().then(createWindow);