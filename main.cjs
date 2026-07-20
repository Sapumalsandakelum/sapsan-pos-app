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

  // 🖨️ IPC HANDLER: Get all system printers connected to the operating system
  ipcMain.handle('get-system-printers', async () => {
    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers;
    } catch (e) {
      console.error('Error fetching system printers:', e);
      return [];
    }
  });

  // 🖨️ IPC HANDLER: Print to system default printer or specified printer
  ipcMain.handle('print-to-system-printer', async (event, options) => {
    try {
      const deviceName = options?.deviceName || '';
      await win.webContents.print({
        silent: options?.silent !== false,
        printBackground: true,
        deviceName: deviceName
      });
      return { success: true };
    } catch (err) {
      console.error('System print error:', err);
      return { success: false, error: err.message };
    }
  });
}

app.whenReady().then(createWindow);