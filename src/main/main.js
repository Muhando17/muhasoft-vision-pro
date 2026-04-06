const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { setupIPC } = require('./ipc');
const { startServer } = require('./server');
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pages', 'splash.html'));
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    title: 'Muhasoft GestPro',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pages', 'login.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    createSplashWindow();

    // Initialize database
    const db = initDatabase();

    // Start LAN server
    const serverInfo = await startServer(db);
    store.set('serverInfo', serverInfo);

    // Setup IPC handlers
    setupIPC(mainWindow, db);

    // Wait a bit for splash screen effect
    setTimeout(() => {
      createMainWindow();
    }, 2500);
  } catch (error) {
    console.error('Failed to initialize application:', error);
    dialog.showErrorBox('Erro de Inicialização', `Falha ao iniciar o sistema: ${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Navigate to different pages
ipcMain.on('navigate', (event, page) => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pages', page));
  }
});

ipcMain.on('navigate-main', (event, page) => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pages', page));
  }
});
