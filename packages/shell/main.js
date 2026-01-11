const path = require('path');
const { app, BrowserWindow, shell, dialog, ipcMain, systemPreferences, safeStorage } = require('electron');
const { ensureNextServer, stopNextServer } = require('./next-server');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
const isMac = process.platform === 'darwin';

// Set app name (for development mode and dock)
if (app) {
  app.setName('OpenScribe');
}

let mainWindow;

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#050505',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      enableRemoteModule: false,
    },
  });

  window.on('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    if (isDev) {
      await window.loadURL(DEV_SERVER_URL);
      window.webContents.openDevTools({ mode: 'detach' });
    } else {
      const server = await ensureNextServer();
      await window.loadURL(server.url);
      // Open DevTools in production temporarily for debugging CSS issue
      window.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (error) {
    dialog.showErrorBox(
      'Unable to open OpenScribe',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    app.quit();
  }

  window.on('closed', () => {
    mainWindow = undefined;
  });

  return window;
};

const checkIfRunningFromDMG = () => {
  // Only check on macOS and when app is packaged
  if (!isMac || !app.isPackaged) {
    return false;
  }

  const exePath = app.getPath('exe');
  return exePath.startsWith('/Volumes/');
};

const boot = async () => {
  await app.whenReady();

  // Check if running from DMG and warn user
  if (checkIfRunningFromDMG()) {
    const response = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Installation Required',
      message: 'Please install OpenScribe to your Applications folder',
      detail: 'Running directly from the disk image may cause startup issues. Please drag OpenScribe to your Applications folder and run it from there.\n\nWould you like to continue anyway?',
      buttons: ['Quit and Install', 'Continue Anyway'],
      defaultId: 0,
      cancelId: 0,
    });

    if (response === 0) {
      // User chose to quit and install properly
      app.quit();
      return;
    }
    // Otherwise continue with warning acknowledged
  }

  registerPermissionHandlers();
  mainWindow = await createMainWindow();

  app.on('activate', async () => {
    // Get all windows including any that might be hidden or minimized
    const allWindows = BrowserWindow.getAllWindows();
    
    if (allWindows.length === 0) {
      // No windows exist, create one
      mainWindow = await createMainWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // Restore minimized window
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      // Bring window to front
      mainWindow.show();
      mainWindow.focus();
    } else {
      // mainWindow reference is stale, use first available window
      const existingWindow = allWindows[0];
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.show();
      existingWindow.focus();
      mainWindow = existingWindow;
    }
  });
};

// Single instance lock - prevent multiple app instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running
  console.log('Another instance of OpenScribe is already running. Exiting.');
  app.quit();
  process.exit(0);
} else {
  // This is the primary instance
  // Handle attempts to launch a second instance
  app.on('second-instance', () => {
    // Someone tried to open the app again
    // Focus our existing window instead of creating a new instance
    if (mainWindow) {
      // Restore window if minimized
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      
      // Show window if hidden
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      
      // Focus the window
      mainWindow.focus();
      
      // On macOS, bounce the dock icon to get user's attention
      if (process.platform === 'darwin') {
        app.dock.bounce('informational');
      }
    }
  });

  // Now boot the application normally
  boot();
}

// Track if we're already quitting to prevent multiple cleanup attempts
let isQuitting = false;

app.on('before-quit', async (event) => {
  if (isQuitting) {
    // Already cleaning up, let it proceed
    return;
  }
  
  console.log('App quitting, cleaning up Next.js server...');
  isQuitting = true;
  
  // Prevent immediate quit
  event.preventDefault();
  
  // Force quit after 3 seconds even if cleanup hasn't finished
  const forceQuitTimer = setTimeout(() => {
    console.warn('Cleanup timeout - forcing quit');
    app.exit(0);
  }, 3000);
  
  try {
    await stopNextServer();
    console.log('Cleanup complete');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    clearTimeout(forceQuitTimer);
    // Now allow the app to quit
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle renderer process crashes
app.on('render-process-gone', (event, webContents, details) => {
  console.error('Renderer process crashed:', details);
  
  // Auto-restart on crash
  if (details.reason === 'crashed') {
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: 'OpenScribe Crashed',
      message: 'The application has crashed. Would you like to restart?',
      buttons: ['Restart', 'Quit'],
      defaultId: 0,
    });
    
    if (response === 0) {
      // Restart
      app.relaunch();
      app.exit(0);
    } else {
      app.quit();
    }
  }
});

// Handle child process crashes
app.on('child-process-gone', (event, details) => {
  console.error('Child process crashed:', details);
});

function registerPermissionHandlers() {
  ipcMain.handle('media-permissions:request', async () => {
    if (!isMac) {
      return { microphoneGranted: true, screenStatus: 'granted' };
    }
    let microphoneGranted = false;
    try {
      microphoneGranted = await systemPreferences.askForMediaAccess('microphone');
    } catch (error) {
      console.error('Microphone permission request failed', error);
    }
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    return { microphoneGranted, screenStatus };
  });

  ipcMain.handle('media-permissions:status', (_event, mediaType) => {
    if (!isMac) return 'granted';
    try {
      return systemPreferences.getMediaAccessStatus(mediaType);
    } catch (error) {
      console.error('Failed to read media access status', error);
      return 'unknown';
    }
  });

  ipcMain.handle('media-permissions:open-screen-settings', () => {
    if (!isMac) return false;
    const settingsUrl = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
    shell.openExternal(settingsUrl).catch((error) => {
      console.error('Failed to open screen permissions panel', error);
    });
    return true;
  });

  ipcMain.handle('desktop-capturer:get-sources', async (_event, opts) => {
    try {
      const { desktopCapturer } = require('electron');
      
      // Validate options
      if (!opts || (!opts.types || opts.types.length === 0)) {
        console.error('Invalid desktop capturer options:', opts);
        return [];
      }
      
      const sources = await desktopCapturer.getSources(opts);
      
      if (!sources || sources.length === 0) {
        console.log('No desktop sources found for types:', opts.types);
        return [];
      }
      
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        thumbnail: source.thumbnail?.toDataURL?.(),
      }));
    } catch (error) {
      console.error('Failed to get desktop sources:', error.message || error);
      // Check for common permission issues
      if (error.message?.includes('screen')) {
        console.error('Screen recording permission may not be granted. Check System Preferences > Security & Privacy > Screen Recording');
      }
      return [];
    }
  });

  // Secure storage IPC handlers for HIPAA-compliant key management
  ipcMain.handle('secure-storage:is-available', () => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle('secure-storage:encrypt', (_event, plaintext) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this system');
      }
      const buffer = safeStorage.encryptString(plaintext);
      // Return as base64 string for JSON serialization
      return buffer.toString('base64');
    } catch (error) {
      console.error('Encryption failed:', error);
      throw error;
    }
  });

  ipcMain.handle('secure-storage:decrypt', (_event, encryptedBase64) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Decryption is not available on this system');
      }
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw error;
    }
  });

  // Generate a secure random key for encryption
  ipcMain.handle('secure-storage:generate-key', () => {
    try {
      // Generate 256-bit (32 byte) random key
      const key = crypto.randomBytes(32);
      return key.toString('base64');
    } catch (error) {
      console.error('Key generation failed:', error);
      throw error;
    }
  });

  // Audit log IPC handlers for HIPAA compliance
  const fs = require('fs').promises;
  const auditLogDir = path.join(app.getPath('userData'), 'audit-logs');

  // Ensure audit log directory exists
  fs.mkdir(auditLogDir, { recursive: true }).catch(err => {
    console.error('Failed to create audit log directory:', err);
  });

  ipcMain.handle('audit-log:write', async (_event, entry) => {
    try {
      // For now, we'll return success and let the renderer handle localStorage
      // Future enhancement: write to filesystem for archival
      return { success: true };
    } catch (error) {
      console.error('Audit log write failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audit-log:read', async (_event, filter) => {
    try {
      // For now, return empty array - renderer uses localStorage
      // Future enhancement: read from archived filesystem logs
      return [];
    } catch (error) {
      console.error('Audit log read failed:', error);
      return [];
    }
  });

  ipcMain.handle('audit-log:export', async (_event, options) => {
    try {
      const { data, filename } = options;
      
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Audit Log',
        defaultPath: path.join(app.getPath('downloads'), filename),
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      // Write the file
      await fs.writeFile(result.filePath, data, 'utf8');
      
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error('Audit log export failed:', error);
      return { success: false, error: error.message };
    }
  });
}

