const { contextBridge, ipcRenderer } = require('electron');

function mapMicError(error) {
  const name = error && typeof error === 'object' ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      success: false,
      code: 'MIC_PERMISSION_DENIED',
      userMessage: 'Microphone permission is denied. Enable it in system settings and retry.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      success: false,
      code: 'MIC_STREAM_UNAVAILABLE',
      userMessage: 'No usable microphone input was found.',
    };
  }
  return {
    success: false,
    code: 'MIC_STREAM_UNAVAILABLE',
    userMessage: error && error.message ? error.message : 'Unable to access microphone.',
  };
}

async function sampleMicSignal(preferredDeviceId) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      success: false,
      code: 'MIC_STREAM_UNAVAILABLE',
      userMessage: 'Microphone API is unavailable.',
    };
  }

  let stream;
  let audioContext;
  try {
    const makeConstraints = (deviceId) => {
      const constraints = {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      };
      if (deviceId) constraints.deviceId = { exact: deviceId };
      return constraints;
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: makeConstraints(preferredDeviceId) });
    } catch (firstError) {
      const name = firstError && typeof firstError === 'object' ? firstError.name : '';
      if ((name === 'NotFoundError' || name === 'OverconstrainedError') && preferredDeviceId) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: makeConstraints('') });
      } else {
        throw firstError;
      }
    }
  } catch (error) {
    return mapMicError(error);
  }

  try {
    const track = stream.getAudioTracks()[0];
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    let sumSquares = 0;
    let total = 0;
    let nonTrivial = 0;

    const start = Date.now();
    while (Date.now() - start < 1100) {
      analyser.getFloatTimeDomainData(samples);
      for (let i = 0; i < samples.length; i += 1) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
        if (abs > 0.002) nonTrivial += 1;
        sumSquares += samples[i] * samples[i];
      }
      total += samples.length;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const rms = total > 0 ? Math.sqrt(sumSquares / total) : 0;
    const nonTrivialRatio = total > 0 ? nonTrivial / total : 0;

    if (rms < 0.001 && peak < 0.01 && nonTrivialRatio < 0.01) {
      return {
        success: false,
        code: 'MIC_SIGNAL_TOO_LOW',
        userMessage: 'Microphone is connected but no usable speech signal was detected.',
        metrics: { rms, peak },
        activeDeviceId: track?.getSettings?.().deviceId || '',
      };
    }

    return {
      success: true,
      metrics: { rms, peak },
      activeDeviceId: track?.getSettings?.().deviceId || '',
    };
  } catch (error) {
    return {
      success: false,
      code: 'MIC_STREAM_UNAVAILABLE',
      userMessage: error && error.message ? error.message : 'Unable to analyze microphone signal.',
    };
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}

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
  openMicrophonePermissionSettings: () => ipcRenderer.invoke('media-permissions:open-microphone-settings'),
  openScreenPermissionSettings: () => ipcRenderer.invoke('media-permissions:open-screen-settings'),
  getPrimaryScreenSource,
  checkMicrophoneReadiness: (preferredDeviceId) => sampleMicSignal(preferredDeviceId),
  
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
        'get-setup-status',
        'set-setup-completed',
        'ensure-mixed-runtime-ready',
        'ensure-local-runtime-ready',
        'set-runtime-preference',
        'get-ipc-contract',
        'send-to-openclaw',
        'openclaw-chat-turn',
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
