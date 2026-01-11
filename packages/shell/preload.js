const { contextBridge, ipcRenderer } = require('electron');

async function getPrimaryScreenSource() {
  try {
    const sources = await ipcRenderer.invoke('desktop-capturer:get-sources', {
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    
    if (!sources || sources.length === 0) {
      return null;
    }
    
    const primarySource =
      sources.find((source) => source.display_id === '0') ||
      sources.find((source) => /screen 1/i.test(source.name)) ||
      sources[0];
      
    return primarySource
      ? { id: primarySource.id, name: primarySource.name, displayId: primarySource.display_id }
      : null;
  } catch (error) {
    console.error('Failed to enumerate screens', error);
    return null;
  }
}

contextBridge.exposeInMainWorld('desktop', {
  versions: process.versions,
  requestMediaPermissions: () => ipcRenderer.invoke('media-permissions:request'),
  getMediaAccessStatus: (mediaType) => ipcRenderer.invoke('media-permissions:status', mediaType),
  openScreenPermissionSettings: () => ipcRenderer.invoke('media-permissions:open-screen-settings'),
  getPrimaryScreenSource,
  
  // Secure storage API for HIPAA-compliant encryption
  secureStorage: {
    isAvailable: () => ipcRenderer.invoke('secure-storage:is-available'),
    encrypt: (plaintext) => ipcRenderer.invoke('secure-storage:encrypt', plaintext),
    decrypt: (encryptedBase64) => ipcRenderer.invoke('secure-storage:decrypt', encryptedBase64),
    generateKey: () => ipcRenderer.invoke('secure-storage:generate-key'),
  },

  // Audit log API for HIPAA compliance
  auditLog: {
    writeEntry: (entry) => ipcRenderer.invoke('audit-log:write', entry),
    readEntries: (filter) => ipcRenderer.invoke('audit-log:read', filter),
    exportLog: (options) => ipcRenderer.invoke('audit-log:export', options),
  },
});
