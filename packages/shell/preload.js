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

  openscribeBackend: {
    invoke: (channel, ...args) => {
      const allowed = new Set([
        'check-microphone-permission',
        'request-microphone-permission',
        'start-recording',
        'stop-recording',
        'get-status',
        'process-recording',
        'test-system',
        'select-audio-file',
        'list-meetings',
        'clear-state',
        'reprocess-meeting',
        'query-transcript',
        'update-meeting',
        'delete-meeting',
        'get-queue-status',
        'start-recording-ui',
        'pause-recording-ui',
        'resume-recording-ui',
        'stop-recording-ui',
        'startup-setup-check',
        'setup-ollama-and-model',
        'setup-whisper',
        'setup-test',
        'get-app-version',
        'get-ai-prompts',
        'check-model-installed',
        'list-models',
        'get-current-model',
        'set-model',
        'get-notifications',
        'set-notifications',
        'get-telemetry',
        'set-telemetry',
        'pull-model',
        'ensure-whisper-service',
        'whisper-service-status',
        'check-for-updates',
        'check-announcements',
        'open-release-page',
      ]);

      if (!allowed.has(channel)) {
        throw new Error(`Blocked IPC channel: ${channel}`);
      }
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, listener) => {
      const allowed = new Set([
        'debug-log',
        'toggle-recording-hotkey',
        'processing-stage',
        'processing-complete',
        'model-pull-progress',
        'model-pull-complete',
        'meetings-refreshed',
      ]);
      if (!allowed.has(channel)) {
        throw new Error(`Blocked IPC event: ${channel}`);
      }
      ipcRenderer.on(channel, listener);
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  },
});
