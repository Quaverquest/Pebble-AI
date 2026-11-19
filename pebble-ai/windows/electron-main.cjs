const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const PORT = process.env.PORT || 3000;
let mainWindow = null;
let serverProcess = null;
let tray = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getAppDataModelDir() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  const dir = path.join(localAppData, 'PebbleAI', 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function startLocalBackend() {
  const rootDir = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
  const serverEntry = path.join(rootDir, 'server.ts');
  const tsxBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    PEBBLE_MODELS_DIR: getAppDataModelDir(),
  };

  serverProcess = spawn(tsxBin, [serverEntry], {
    cwd: rootDir,
    env,
    windowsHide: true,
    stdio: 'pipe',
  });

  serverProcess.stdout?.on('data', (d) => console.log(`[pebble-backend] ${d}`));
  serverProcess.stderr?.on('data', (d) => console.error(`[pebble-backend] ${d}`));
}

function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (left <= 0) return reject(new Error('Pebble local backend timed out starting.'));
          setTimeout(() => attempt(left - 1), 250);
        });
    };
    attempt(retries);
  });
}

async function createWindow() {
  startLocalBackend();
  await waitForServer(`http://127.0.0.1:${PORT}/api/health`).catch((err) => console.error(err));

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#111315',
    title: 'Pebble AI',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
