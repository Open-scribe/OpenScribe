const { ipcMain, dialog, shell, systemPreferences, globalShortcut, app } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
let PostHog;
try {
  ({ PostHog } = require('posthog-node'));
} catch (error) {
  PostHog = null;
}

// Backend executable path - use bundled OpenScribe backend
function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'openscribe-backend', 'openscribe-backend');
  }
  return path.join(process.cwd(), 'local-only', 'openscribe-backend', 'dist', 'openscribe-backend', 'openscribe-backend');
}

function getBackendCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'openscribe-backend');
  }
  return path.join(process.cwd(), 'local-only', 'openscribe-backend', 'dist', 'openscribe-backend');
}

function resolveBackendCommand(args = []) {
  const backendPath = getBackendPath();
  const backendCwd = getBackendCwd();

  if (app.isPackaged || fs.existsSync(backendPath)) {
    return { command: backendPath, args, cwd: backendCwd, mode: 'binary' };
  }

  const backendProjectRoot = path.join(process.cwd(), 'local-only', 'openscribe-backend');
  const scriptPath = path.join(backendProjectRoot, 'simple_recorder.py');
  const venvPython =
    process.platform === 'win32'
      ? path.join(backendProjectRoot, '.venv-backend', 'Scripts', 'python.exe')
      : path.join(backendProjectRoot, '.venv-backend', 'bin', 'python3');
  const pythonCommand = fs.existsSync(venvPython)
    ? venvPython
    : (process.platform === 'win32' ? 'python' : 'python3');

  if (fs.existsSync(scriptPath)) {
    return {
      command: pythonCommand,
      args: [scriptPath, ...args],
      cwd: path.dirname(scriptPath),
      mode: 'python-fallback',
    };
  }

  return { command: backendPath, args, cwd: backendCwd, mode: 'missing' };
}

// Telemetry state
let posthogClient = null;
let telemetryEnabled = false;
let anonymousId = null;

const POSTHOG_API_KEY = 'phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb';
const POSTHOG_HOST = 'https://us.i.posthog.com';

function durationBucket(seconds) {
  if (seconds < 60) return '<1m';
  if (seconds < 300) return '1-5m';
  if (seconds < 900) return '5-15m';
  if (seconds < 1800) return '15-30m';
  if (seconds < 3600) return '30-60m';
  return '60m+';
}

async function initTelemetry() {
  if (!PostHog) return;
  try {
    const result = await new Promise((resolve, reject) => {
      const backend = resolveBackendCommand(['get-telemetry']);
      if (backend.mode === 'python-fallback') {
        console.warn('Backend binary missing; using Python fallback for telemetry.');
      }
      const proc = spawn(backend.command, backend.args, {
        cwd: backend.cwd,
      });
      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`get-telemetry exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    const config = JSON.parse(result.trim());
    telemetryEnabled = config.telemetry_enabled;
    anonymousId = config.anonymous_id;

    if (telemetryEnabled) {
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      posthogClient.identify({
        distinctId: anonymousId,
        properties: {
          platform: process.platform,
          arch: process.arch,
        },
      });
      console.log('Telemetry initialized (anonymous analytics enabled)');
    } else {
      console.log('Telemetry disabled by user preference');
    }
  } catch (error) {
    console.error('Failed to initialize telemetry:', error.message);
    telemetryEnabled = false;
  }
}

function trackEvent(eventName, properties = {}) {
  try {
    if (!telemetryEnabled || !posthogClient || !anonymousId) return;

    const packagePath = path.join(__dirname, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    posthogClient.capture({
      distinctId: anonymousId,
      event: eventName,
      properties: {
        app_version: packageContent.version,
        platform: process.platform,
        arch: process.arch,
        ...properties,
      },
    });
  } catch (error) {
    // Silent fail
  }
}

async function shutdownTelemetry() {
  try {
    if (posthogClient) {
      await posthogClient.shutdown();
      posthogClient = null;
      console.log('Telemetry shut down');
    }
  } catch (error) {
    // Silent fail
  }
}

function validateSafeFilePath(filepath, allowedBaseDirs) {
  if (!filepath) return false;
  try {
    const resolvedPath = path.resolve(filepath);
    for (const baseDir of allowedBaseDirs) {
      const resolvedBase = path.resolve(baseDir);
      if (resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error validating file path:', error);
    return false;
  }
}

function registerGlobalHotkey(mainWindow) {
  const hotkey = process.platform === 'darwin' ? 'Command+Shift+R' : 'Ctrl+Shift+R';
  const registered = globalShortcut.register(hotkey, () => {
    console.log('Global hotkey triggered: toggle recording');
    if (mainWindow) {
      mainWindow.webContents.send('toggle-recording-hotkey');
    }
  });

  if (registered) {
    console.log(`Global hotkey registered: ${hotkey}`);
  } else {
    console.error(`Failed to register global hotkey: ${hotkey}`);
  }
}

// Backend communication
function runPythonScript(mainWindow, script, args = [], silent = false) {
  return new Promise((resolve, reject) => {
    const backend = resolveBackendCommand(args);
    const command = `${backend.command} ${backend.args.join(' ')}`;

    console.log('Running:', command);
    if (!silent) {
      sendDebugLog(mainWindow, `$ openscribe-backend ${args.join(' ')}`);
      if (backend.mode === 'python-fallback') {
        sendDebugLog(mainWindow, 'Backend executable not found; using Python fallback.');
      }
    }

    const process = spawn(backend.command, backend.args, {
      cwd: backend.cwd,
      env: {
        ...globalThis.process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('Python stdout:', output);
      if (!silent) {
        output.split('\n').forEach((line) => {
          if (line.trim()) sendDebugLog(mainWindow, line.trim());
        });
      }
    });

    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('Python stderr:', output);
      if (!silent) {
        output.split('\n').forEach((line) => {
          if (line.trim()) sendDebugLog(mainWindow, 'STDERR: ' + line.trim());
        });
      }
    });

    process.on('close', (code) => {
      if (!silent) {
        sendDebugLog(mainWindow, `Command completed with exit code: ${code}`);
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (error) => {
      sendDebugLog(mainWindow, `Command error: ${error.message}`);
      reject(error);
    });
  });
}

function sendDebugLog(mainWindow, message) {
  if (mainWindow) {
    mainWindow.webContents.send('debug-log', message);
  }
}

// Global recording state management
let currentRecordingProcess = null;
let processingQueue = [];
let isProcessing = false;
let currentProcessingJob = null;
let whisperServiceProcess = null;
const WHISPER_LOCAL_PORT = Number(process.env.WHISPER_LOCAL_PORT || 8002);
const WHISPER_LOCAL_HOST = process.env.WHISPER_LOCAL_HOST || '127.0.0.1';

function resolveWhisperServerCommand() {
  const backend = resolveBackendCommand(['whisper-server', '--port', String(WHISPER_LOCAL_PORT), '--model', 'tiny.en']);
  if (backend.mode === 'binary' && backend.command) {
    return backend;
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'whisper_server.py');
  const backendProjectRoot = path.join(process.cwd(), 'local-only', 'openscribe-backend');
  const venvPython =
    process.platform === 'win32'
      ? path.join(backendProjectRoot, '.venv-backend', 'Scripts', 'python.exe')
      : path.join(backendProjectRoot, '.venv-backend', 'bin', 'python3');
  const pythonCommand = fs.existsSync(venvPython)
    ? venvPython
    : (process.platform === 'win32' ? 'python' : 'python3');

  if (fs.existsSync(scriptPath)) {
    return {
      command: pythonCommand,
      args: [scriptPath, '--host', WHISPER_LOCAL_HOST, '--port', String(WHISPER_LOCAL_PORT), '--model', 'tiny.en', '--backend', 'cpp'],
      cwd: process.cwd(),
      mode: 'script',
    };
  }

  return backend;
}

async function isWhisperServiceHealthy() {
  try {
    const res = await fetch(`http://${WHISPER_LOCAL_HOST}:${WHISPER_LOCAL_PORT}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureWhisperService(mainWindow) {
  if (await isWhisperServiceHealthy()) {
    return { success: true, running: true, reused: true };
  }

  if (whisperServiceProcess && !whisperServiceProcess.killed) {
    for (let i = 0; i < 15; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await isWhisperServiceHealthy()) {
        return { success: true, running: true, reused: true };
      }
    }
  }

  const backend = resolveWhisperServerCommand();
  if (!backend.command) {
    return { success: false, error: 'Unable to resolve Whisper service command' };
  }

  sendDebugLog(mainWindow, `Starting Whisper service: ${backend.command} ${backend.args.join(' ')}`);
  whisperServiceProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    env: {
      ...process.env,
      WHISPER_LOCAL_MODEL: process.env.WHISPER_LOCAL_MODEL || 'tiny.en',
      WHISPER_LOCAL_BACKEND: process.env.WHISPER_LOCAL_BACKEND || 'cpp',
      WHISPER_LOCAL_GPU: process.env.WHISPER_LOCAL_GPU || '1',
      PYTHONUNBUFFERED: '1',
    },
    stdio: 'pipe',
  });

  whisperServiceProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) sendDebugLog(mainWindow, `[whisper] ${text}`);
  });
  whisperServiceProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) sendDebugLog(mainWindow, `[whisper:stderr] ${text}`);
  });
  whisperServiceProcess.on('close', (code) => {
    sendDebugLog(mainWindow, `Whisper service exited with code ${code}`);
    whisperServiceProcess = null;
  });

  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isWhisperServiceHealthy()) {
      return { success: true, running: true, reused: false };
    }
  }

  return { success: false, error: `Whisper service failed health check on ${WHISPER_LOCAL_HOST}:${WHISPER_LOCAL_PORT}` };
}

function stopWhisperService() {
  if (whisperServiceProcess && !whisperServiceProcess.killed) {
    whisperServiceProcess.kill('SIGTERM');
  }
  whisperServiceProcess = null;
}

async function processNextInQueue(mainWindow) {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }

  isProcessing = true;
  currentProcessingJob = processingQueue.shift();

  console.log(`🔄 Processing queued job: ${currentProcessingJob.sessionName}`);

  try {
    const result = await runPythonScript(
      mainWindow,
      'simple_recorder.py',
      ['process', currentProcessingJob.audioFile, '--name', currentProcessingJob.sessionName]
    );
    console.log(`✅ Completed processing: ${currentProcessingJob.sessionName}`);
    trackEvent('transcription_completed', { success: true });
    trackEvent('summarization_completed', { success: true });

    if (mainWindow) {
      try {
        const meetingsResult = await runPythonScript(mainWindow, 'simple_recorder.py', ['list-meetings'], true);
        const allMeetings = JSON.parse(meetingsResult);
        const processedMeeting = allMeetings.find(
          (m) => m.session_info?.name === currentProcessingJob.sessionName
        );

        mainWindow.webContents.send('processing-complete', {
          success: true,
          sessionName: currentProcessingJob.sessionName,
          message: 'Processing completed successfully',
          meetingData: processedMeeting,
        });
      } catch (error) {
        console.error('Error getting processed meeting data:', error);
        mainWindow.webContents.send('processing-complete', {
          success: true,
          sessionName: currentProcessingJob.sessionName,
          message: 'Processing completed successfully',
        });
      }
    }
  } catch (error) {
    console.error(`❌ Processing failed for ${currentProcessingJob.sessionName}:`, error);
    trackEvent('error_occurred', { error_type: 'processing_queue' });

    if (mainWindow) {
      mainWindow.webContents.send('processing-complete', {
        success: false,
        sessionName: currentProcessingJob.sessionName,
        error: error.message,
      });
    }
  } finally {
    isProcessing = false;
    currentProcessingJob = null;
    setTimeout(() => processNextInQueue(mainWindow), 1000);
  }
}

function addToProcessingQueue(mainWindow, audioFile, sessionName) {
  processingQueue.push({ audioFile, sessionName });
  console.log(`📋 Added to processing queue: ${sessionName} (Queue size: ${processingQueue.length})`);
  processNextInQueue(mainWindow);
}

function registerOpenScribeIpcHandlers(mainWindow) {
  // Microphone permission handlers
  ipcMain.handle('check-microphone-permission', async () => {
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      return { success: true, status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('request-microphone-permission', async () => {
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { success: true, granted };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC handlers
  ipcMain.handle('start-recording', async (event, sessionName) => {
    try {
      sendDebugLog(mainWindow, `Starting recording session: ${sessionName || 'Meeting'}`);
      sendDebugLog(mainWindow, '$ python simple_recorder.py start');

      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['start', sessionName || 'Meeting']);

      if (result.includes('SUCCESS')) {
        sendDebugLog(mainWindow, 'Recording started successfully');
        trackEvent('recording_started');
        return { success: true, message: result };
      }
      sendDebugLog(mainWindow, `Recording failed: ${result}`);
      return { success: false, error: result };
    } catch (error) {
      console.error('Start recording error:', error.message);
      sendDebugLog(mainWindow, `Recording error: ${error.message}`);
      trackEvent('error_occurred', { error_type: 'start_recording' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-recording', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['stop']);

      if (result.includes('SUCCESS') || result.includes('Recording saved')) {
        trackEvent('recording_stopped');
        return { success: true, message: result };
      }
      return { success: false, error: result };
    } catch (error) {
      console.error('Stop recording error:', error.message);
      trackEvent('error_occurred', { error_type: 'stop_recording' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-status', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['status'], true);
      return { success: true, status: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('process-recording', async (event, audioFile, sessionName) => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', [
        'process',
        audioFile,
        '--name',
        sessionName,
      ]);
      trackEvent('transcription_completed', { success: true });
      trackEvent('summarization_completed', { success: true });
      return { success: true, result };
    } catch (error) {
      trackEvent('error_occurred', { error_type: 'process_recording' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('test-system', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['test']);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'aac'] }],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }

    return { success: false, error: 'No file selected' };
  });

  ipcMain.handle('list-meetings', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['list-meetings'], true);
      return { success: true, meetings: JSON.parse(result) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-state', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['clear-state']);
      return { success: true, message: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('reprocess-meeting', async (event, summaryFile) => {
    try {
      sendDebugLog(mainWindow, `🔄 Reprocessing meeting: ${summaryFile}`);
      sendDebugLog(mainWindow, `$ python simple_recorder.py reprocess "${summaryFile}"`);

      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['reprocess', summaryFile]);

      sendDebugLog(mainWindow, '✅ Meeting reprocessed successfully');
      return { success: true, message: result };
    } catch (error) {
      sendDebugLog(mainWindow, `❌ Reprocessing failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('query-transcript', async (event, summaryFile, question) => {
    try {
      sendDebugLog(mainWindow, `🤖 Querying transcript: ${question.substring(0, 50)}...`);

      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['query', summaryFile, '-q', question]);

      try {
        const jsonResponse = JSON.parse(result.trim());
        if (jsonResponse.success) {
          sendDebugLog(mainWindow, '✅ Query answered successfully');
          trackEvent('ai_query_used', { success: true });
          return { success: true, answer: jsonResponse.answer };
        }
        sendDebugLog(mainWindow, `❌ Query failed: ${jsonResponse.error}`);
        trackEvent('ai_query_used', { success: false });
        return { success: false, error: jsonResponse.error };
      } catch (parseError) {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonResponse = JSON.parse(jsonMatch[0]);
          if (jsonResponse.success) {
            trackEvent('ai_query_used', { success: true });
            return { success: true, answer: jsonResponse.answer };
          }
          trackEvent('ai_query_used', { success: false });
          return { success: false, error: jsonResponse.error };
        }
        sendDebugLog(mainWindow, `❌ Failed to parse query response: ${parseError.message}`);
        trackEvent('ai_query_used', { success: false });
        return { success: false, error: 'Failed to parse AI response' };
      }
    } catch (error) {
      sendDebugLog(mainWindow, `❌ Query failed: ${error.message}`);
      trackEvent('error_occurred', { error_type: 'query_transcript' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update-meeting', async (event, summaryFilePath, updates) => {
    try {
      const projectRoot = path.join(__dirname, '..');

      const allowedBaseDirs = [
        projectRoot,
        path.join(os.homedir(), 'Library', 'Application Support', 'openscribe-backend'),
      ];

      const absolutePath = path.isAbsolute(summaryFilePath)
        ? summaryFilePath
        : path.join(projectRoot, summaryFilePath);

      if (!validateSafeFilePath(absolutePath, allowedBaseDirs)) {
        console.error(`Security: Blocked attempt to update file outside allowed directories: ${absolutePath}`);
        return { success: false, error: 'Invalid file path' };
      }

      if (!fs.existsSync(absolutePath)) {
        return { success: false, error: 'Meeting file not found' };
      }

      const data = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

      if (updates.name !== undefined) data.session_info.name = updates.name;
      if (updates.summary !== undefined) data.summary = updates.summary;
      if (updates.participants !== undefined) data.participants = updates.participants;
      if (updates.key_points !== undefined) data.key_points = updates.key_points;
      if (updates.action_items !== undefined) data.action_items = updates.action_items;

      data.session_info.updated_at = new Date().toISOString();

      fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf8');

      return { success: true, message: 'Meeting updated successfully', updatedData: data };
    } catch (error) {
      console.error('Update meeting error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-meeting', async (event, meetingData) => {
    try {
      const meeting = meetingData;
      const projectRoot = path.join(__dirname, '..');
      const allowedBaseDirs = [
        projectRoot,
        path.join(os.homedir(), 'Library', 'Application Support', 'openscribe-backend'),
      ];

      const summaryFile = meeting.session_info?.summary_file;
      const transcriptFile = meeting.session_info?.transcript_file;

      const absolutePaths = [];
      if (summaryFile) {
        absolutePaths.push(path.isAbsolute(summaryFile) ? summaryFile : path.join(projectRoot, summaryFile));
      }
      if (transcriptFile) {
        absolutePaths.push(
          path.isAbsolute(transcriptFile) ? transcriptFile : path.join(projectRoot, transcriptFile)
        );
      }

      let deletedCount = 0;
      let validationErrors = 0;

      for (const file of absolutePaths) {
        try {
          if (!validateSafeFilePath(file, allowedBaseDirs)) {
            console.error(`Security: Blocked attempt to delete file outside allowed directories: ${file}`);
            validationErrors++;
            continue;
          }

          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            deletedCount++;
          }
        } catch (err) {
          console.warn(`Could not delete ${file}:`, err.message);
        }
      }

      if (validationErrors > 0) {
        return { success: false, error: `Blocked ${validationErrors} file deletion(s) due to security validation` };
      }

      return { success: true, message: `Deleted meeting and ${deletedCount} associated files` };
    } catch (error) {
      console.error('Delete meeting error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-queue-status', async () => {
    return {
      success: true,
      isProcessing,
      queueSize: processingQueue.length,
      currentJob: currentProcessingJob?.sessionName || null,
      hasRecording: currentRecordingProcess !== null,
    };
  });

  ipcMain.handle('ensure-whisper-service', async () => {
    try {
      return await ensureWhisperService(mainWindow);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('whisper-service-status', async () => {
    try {
      const healthy = await isWhisperServiceHealthy();
      return {
        success: true,
        running: healthy,
        host: WHISPER_LOCAL_HOST,
        port: WHISPER_LOCAL_PORT,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('start-recording-ui', async (_, sessionName, noteType = 'history_physical') => {
    try {
      if (currentRecordingProcess) {
        return { success: false, error: 'Recording already in progress' };
      }

      sendDebugLog(mainWindow, `Starting recording process: ${sessionName || 'Meeting'}`);
      sendDebugLog(mainWindow, '$ openscribe-backend record 7200');

      const actualSessionName = sessionName || 'Meeting';
      const backend = resolveBackendCommand(['record', '7200', actualSessionName, '--note-type', noteType]);

      currentRecordingProcess = spawn(backend.command, backend.args, {
        cwd: backend.cwd,
        env: {
          ...process.env,
          // Warm the local model during active recording so stop->note generation is faster.
          OPENSCRIBE_OLLAMA_WARMUP: '1',
          PYTHONUNBUFFERED: '1',
        },
      });

      let hasStarted = false;
      let processingCompleteSent = false;
      let lastBackendError = '';

      currentRecordingProcess.stdout.on('data', (data) => {
        const output = data.toString();

        output.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          sendDebugLog(mainWindow, trimmed);
          if (
            trimmed.includes('summarizer_unavailable')
            || trimmed.startsWith('ERROR:')
            || trimmed.includes('Processing pipeline failed:')
          ) {
            lastBackendError = trimmed;
          }

          // Emit granular processing stages so UI can show transcription and note generation separately.
          if (mainWindow && !mainWindow.isDestroyed()) {
            const transcriptionDone = trimmed.match(/^⏱️ Transcription stage completed in ([0-9.]+)s$/);
            if (transcriptionDone) {
              const durationMs = Math.round(parseFloat(transcriptionDone[1]) * 1000);
              const endedAtMs = Date.now();
              mainWindow.webContents.send('processing-stage', {
                stage: 'transcription',
                status: 'done',
                endedAtMs,
                durationMs,
              });
              return;
            }

            const noteDone = trimmed.match(/^⏱️ Note generation stage completed in ([0-9.]+)s$/);
            if (noteDone) {
              const durationMs = Math.round(parseFloat(noteDone[1]) * 1000);
              const endedAtMs = Date.now();
              mainWindow.webContents.send('processing-stage', {
                stage: 'note_generation',
                status: 'done',
                endedAtMs,
                durationMs,
              });
              return;
            }

            if (trimmed.startsWith('📝 Transcribing:')) {
              mainWindow.webContents.send('processing-stage', {
                stage: 'transcription',
                status: 'in-progress',
                startedAtMs: Date.now(),
              });
            } else if (trimmed.startsWith('🧠 Generating summary')) {
              mainWindow.webContents.send('processing-stage', {
                stage: 'note_generation',
                status: 'in-progress',
                startedAtMs: Date.now(),
              });
            }
          }
        });

        if (output.includes('✅ Complete processing finished!')) {
          if (mainWindow) {
            runPythonScript(mainWindow, 'simple_recorder.py', ['list-meetings'], true)
              .then((meetingsResult) => {
                const allMeetings = JSON.parse(meetingsResult);
                const processedMeeting = allMeetings.find(
                  (m) => m.session_info?.name === actualSessionName
                );

                mainWindow.webContents.send('processing-complete', {
                  success: true,
                  sessionName: actualSessionName,
                  message: 'Recording and processing completed successfully',
                  meetingData: processedMeeting,
                });
                processingCompleteSent = true;
              })
              .catch(() => {
                mainWindow.webContents.send('processing-complete', {
                  success: true,
                  sessionName: actualSessionName,
                  message: 'Recording and processing completed successfully',
                });
                processingCompleteSent = true;
              });
          }
        }

        if (output.includes('Recording to:') && !hasStarted) {
          hasStarted = true;
        }
      });

      currentRecordingProcess.stderr.on('data', (data) => {
        const output = data.toString();
        output.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed) {
            sendDebugLog(mainWindow, 'STDERR: ' + trimmed);
            lastBackendError = trimmed;
          }
        });
      });

      currentRecordingProcess.on('close', (code) => {
        sendDebugLog(mainWindow, `Recording process completed with exit code: ${code}`);
        if (code !== 0 && !processingCompleteSent && mainWindow && !mainWindow.isDestroyed()) {
          const message = lastBackendError.includes('summarizer_unavailable')
            ? 'Summarizer unavailable. Install/start Ollama and pull a model (e.g. `ollama pull llama3.2:3b`).'
            : (lastBackendError || `Recording backend failed with exit code ${code}`);
          mainWindow.webContents.send('processing-complete', {
            success: false,
            sessionName: actualSessionName,
            error: message,
          });
        }
        currentRecordingProcess = null;
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (currentRecordingProcess) {
        trackEvent('recording_started');
        return { success: true, message: 'Recording started successfully' };
      }
      return { success: false, error: 'Failed to start recording process' };
    } catch (error) {
      console.error('Start recording UI error:', error.message);
      currentRecordingProcess = null;
      trackEvent('error_occurred', { error_type: 'start_recording_ui' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pause-recording-ui', async () => {
    try {
      if (!currentRecordingProcess) {
        sendDebugLog(mainWindow, 'Pause failed: No recording process found');
        return { success: false, error: 'No recording in progress' };
      }

      sendDebugLog(mainWindow, 'Sending SIGUSR1 to pause recording...');

      if (process.platform !== 'win32') {
        currentRecordingProcess.kill('SIGUSR1');
        sendDebugLog(mainWindow, 'SIGUSR1 sent successfully');
        return { success: true, message: 'Recording paused' };
      }
      return { success: false, error: 'Pause not supported on Windows' };
    } catch (error) {
      console.error('Pause recording UI error:', error.message);
      sendDebugLog(mainWindow, `Pause error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resume-recording-ui', async () => {
    try {
      if (!currentRecordingProcess) {
        sendDebugLog(mainWindow, 'Resume failed: No recording process found');
        return { success: false, error: 'No recording in progress' };
      }

      sendDebugLog(mainWindow, 'Sending SIGUSR2 to resume recording...');

      if (process.platform !== 'win32') {
        currentRecordingProcess.kill('SIGUSR2');
        sendDebugLog(mainWindow, 'SIGUSR2 sent successfully');
        return { success: true, message: 'Recording resumed' };
      }
      return { success: false, error: 'Resume not supported on Windows' };
    } catch (error) {
      console.error('Resume recording UI error:', error.message);
      sendDebugLog(mainWindow, `Resume error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-recording-ui', async () => {
    try {
      if (!currentRecordingProcess) {
        return { success: false, error: 'No recording in progress' };
      }

      currentRecordingProcess.kill('SIGTERM');
      currentRecordingProcess = null;

      trackEvent('recording_stopped');
      return { success: true, message: 'Recording stopped - processing will complete in background' };
    } catch (error) {
      console.error('Stop recording UI error:', error.message);
      currentRecordingProcess = null;
      trackEvent('error_occurred', { error_type: 'stop_recording_ui' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('startup-setup-check', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['setup-check']);
      const allGood = result.includes('🎉 System check passed!');

      const lines = result.split('\n');
      const checks = [];

      lines.forEach((line) => {
        if (line.includes('✅') || line.includes('❌') || line.includes('⚠️')) {
          const parts = line.split(/\s{2,}/);
          if (parts.length >= 2) {
            checks.push([parts[0].trim(), parts[1].trim()]);
          }
        }
      });

      return { success: true, allGood, checks };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('setup-ollama-and-model', async () => {
    try {
      sendDebugLog(mainWindow, '$ Checking for existing Ollama installation...');
      sendDebugLog(mainWindow, '$ which ollama || /opt/homebrew/bin/ollama --version || /usr/local/bin/ollama --version');

      const ollamaPath = await new Promise((resolve) => {
        exec('which ollama', { timeout: 5000 }, (error, stdout) => {
          if (!error && stdout.trim()) {
            const foundPath = stdout.trim();
            sendDebugLog(mainWindow, `Found Ollama at: ${foundPath}`);
            resolve(foundPath);
          } else {
            exec('/opt/homebrew/bin/ollama --version', { timeout: 5000 }, (error2) => {
              if (!error2) {
                sendDebugLog(mainWindow, 'Found Ollama at: /opt/homebrew/bin/ollama');
                resolve('/opt/homebrew/bin/ollama');
              } else {
                exec('/usr/local/bin/ollama --version', { timeout: 5000 }, (error3) => {
                  if (!error3) {
                    sendDebugLog(mainWindow, 'Found Ollama at: /usr/local/bin/ollama');
                    resolve('/usr/local/bin/ollama');
                  } else {
                    sendDebugLog(mainWindow, 'Ollama not found in any common locations');
                    resolve(null);
                  }
                });
              }
            });
          }
        });
      });

      if (!ollamaPath) {
        sendDebugLog(mainWindow, 'Ollama not found, checking for Homebrew...');
        sendDebugLog(mainWindow, '$ which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version');

        const brewPath = await new Promise((resolve) => {
          exec('which brew', { timeout: 5000 }, (error, stdout) => {
            if (!error && stdout.trim()) {
              const foundPath = stdout.trim();
              sendDebugLog(mainWindow, `Found Homebrew at: ${foundPath}`);
              resolve(foundPath);
            } else {
              exec('/opt/homebrew/bin/brew --version', { timeout: 5000 }, (error2) => {
                if (!error2) {
                  sendDebugLog(mainWindow, 'Found Homebrew at: /opt/homebrew/bin/brew');
                  resolve('/opt/homebrew/bin/brew');
                } else {
                  exec('/usr/local/bin/brew --version', { timeout: 5000 }, (error3) => {
                    if (!error3) {
                      sendDebugLog(mainWindow, 'Found Homebrew at: /usr/local/bin/brew');
                      resolve('/usr/local/bin/brew');
                    } else {
                      sendDebugLog(mainWindow, 'Homebrew not found in any common locations');
                      resolve(null);
                    }
                  });
                }
              });
            }
          });
        });

        if (!brewPath) {
          sendDebugLog(mainWindow, 'Homebrew not found, installing...');
          sendDebugLog(mainWindow, '$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
          await new Promise((resolve, reject) => {
            const process = exec('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', {
              timeout: 600000,
            });

            process.stdout.on('data', (data) => {
              sendDebugLog(mainWindow, data.toString().trim());
            });

            process.stderr.on('data', (data) => {
              sendDebugLog(mainWindow, 'STDERR: ' + data.toString().trim());
            });

            process.on('close', (code) => {
              if (code === 0) {
                sendDebugLog(mainWindow, 'Homebrew installation completed successfully');
                resolve();
              } else {
                sendDebugLog(mainWindow, `Homebrew installation failed with exit code: ${code}`);
                reject(new Error('Failed to install Homebrew automatically'));
              }
            });
          });
        } else {
          sendDebugLog(mainWindow, 'Homebrew found, proceeding with Ollama installation...');
        }

        const finalBrewPath = brewPath || '/opt/homebrew/bin/brew';

        sendDebugLog(mainWindow, `$ ${finalBrewPath} install ollama`);
        await new Promise((resolve, reject) => {
          const process = exec(`${finalBrewPath} install ollama`, { timeout: 300000 });

          process.stdout.on('data', (data) => {
            sendDebugLog(mainWindow, data.toString().trim());
          });

          process.stderr.on('data', (data) => {
            sendDebugLog(mainWindow, 'STDERR: ' + data.toString().trim());
          });

          process.on('close', (code) => {
            if (code === 0) {
              sendDebugLog(mainWindow, 'Ollama installation completed successfully');
              resolve();
            } else {
              sendDebugLog(mainWindow, `Ollama installation failed with exit code: ${code}`);
              reject(new Error('Failed to install Ollama via Homebrew'));
            }
          });
        });
      } else {
        sendDebugLog(mainWindow, 'Ollama already installed, skipping installation step');
      }

      let finalOllamaPath = ollamaPath;
      if (!finalOllamaPath) {
        finalOllamaPath = await new Promise((resolve) => {
          exec('which ollama', { timeout: 5000 }, (error, stdout) => {
            if (!error && stdout.trim()) {
              resolve(stdout.trim());
              return;
            }
            exec('/opt/homebrew/bin/ollama --version', { timeout: 5000 }, (error2) => {
              if (!error2) {
                resolve('/opt/homebrew/bin/ollama');
                return;
              }
              exec('/usr/local/bin/ollama --version', { timeout: 5000 }, (error3) => {
                if (!error3) {
                  resolve('/usr/local/bin/ollama');
                } else {
                  resolve(null);
                }
              });
            });
          });
        });
      }
      if (!finalOllamaPath) {
        sendDebugLog(mainWindow, 'Error: Ollama executable not found after install/check step');
        return { success: false, error: 'Ollama executable not found' };
      }

      sendDebugLog(mainWindow, `Using Ollama executable: ${finalOllamaPath}`);
      sendDebugLog(mainWindow, 'Downloading AI model (this may take several minutes)...');
      sendDebugLog(mainWindow, '$ openscribe-backend pull-model llama3.2:3b');

      try {
        await runPythonScript(mainWindow, 'simple_recorder.py', ['pull-model', 'llama3.2:3b']);
        sendDebugLog(mainWindow, 'AI model download completed successfully');
        try {
          await runPythonScript(mainWindow, 'simple_recorder.py', ['set-model', 'llama3.2:3b'], true);
        } catch (e) {
          // Non-fatal
        }
        trackEvent('setup_completed', { step: 'ollama_and_model' });
        return { success: true, message: 'Ollama and AI model ready' };
      } catch (pullError) {
        sendDebugLog(mainWindow, `AI model download failed: ${pullError.message}`);
        try {
          const diagnostics = await runPythonScript(mainWindow, 'simple_recorder.py', ['ollama-status'], true);
          sendDebugLog(mainWindow, `Ollama diagnostics: ${diagnostics.trim()}`);
        } catch (diagError) {
          sendDebugLog(mainWindow, `Ollama diagnostics failed: ${diagError.message}`);
        }
        trackEvent('setup_failed', { step: 'ollama_and_model' });
        return { success: false, error: 'Failed to download AI model', details: pullError.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('setup-whisper', async () => {
    try {
      const backend = resolveBackendCommand(['download-whisper-model']);
      sendDebugLog(mainWindow, 'Downloading Whisper transcription model (~500MB)...');
      sendDebugLog(mainWindow, `$ ${backend.command} ${backend.args.join(' ')}`);

      return new Promise((resolve) => {
        const process = spawn(backend.command, backend.args, { cwd: backend.cwd, stdio: 'pipe' });

        process.stdout.on('data', (data) => {
          const text = data.toString().trim();
          if (text) sendDebugLog(mainWindow, text);
        });

        process.stderr.on('data', (data) => {
          const text = data.toString().trim();
          if (text) sendDebugLog(mainWindow, 'STDERR: ' + text);
        });

        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog(mainWindow, 'Whisper model downloaded successfully');
            resolve({ success: true, message: 'Whisper model ready' });
          } else {
            sendDebugLog(mainWindow, `Whisper model download failed with exit code: ${code}`);
            resolve({ success: false, error: 'Failed to download Whisper model' });
          }
        });

        process.on('error', (error) => {
          sendDebugLog(mainWindow, `Process error: ${error.message}`);
          resolve({ success: false, error: error.message });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('setup-test', async () => {
    try {
      sendDebugLog(mainWindow, 'Running system test...');
      sendDebugLog(mainWindow, '$ python simple_recorder.py test');

      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['test']);

      result.split('\n').forEach((line) => {
        if (line.trim()) sendDebugLog(mainWindow, line.trim());
      });

      if (result.includes('System check passed') || result.includes('SUCCESS')) {
        sendDebugLog(mainWindow, 'System test completed successfully');
        trackEvent('setup_completed', { step: 'system_test' });
        return { success: true, message: 'System test passed' };
      }

      const errorLines = result.split('\n').filter((line) => line.includes('ERROR:'));
      const specificError = errorLines.length > 0 ? errorLines[errorLines.length - 1].replace('ERROR: ', '') : 'Unknown error';
      sendDebugLog(mainWindow, `System test failed: ${specificError}`);
      trackEvent('setup_failed', { step: 'system_test' });
      return { success: false, error: `System test failed: ${specificError}`, details: result };
    } catch (error) {
      sendDebugLog(mainWindow, `System test error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-app-version', async () => {
    try {
      const packagePath = path.join(__dirname, 'package.json');
      const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return { success: true, version: packageContent.version, name: packageContent.productName || packageContent.name };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-ai-prompts', async () => {
    try {
      const summarizerPath = path.join(process.cwd(), 'local-only', 'openscribe-backend', 'src', 'summarizer.py');

      if (fs.existsSync(summarizerPath)) {
        const content = fs.readFileSync(summarizerPath, 'utf8');
        const promptMatch = content.match(/def _create_permissive_prompt[\s\S]*?return f"""([\s\S]*?)"""/);
        if (promptMatch) {
          return { success: true, summarization: promptMatch[1].trim() };
        }
      }

      return { success: true, summarization: 'Prompt not found in summarizer.py' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('check-model-installed', async (event, modelName) => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['check-model', modelName]);
      const lines = result.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const data = JSON.parse(lines[i]);
          return { success: true, installed: data.installed };
        } catch (e) {
          continue;
        }
      }
      return { success: false, installed: false, error: 'Could not parse backend response' };
    } catch (error) {
      return { success: false, installed: false, error: error.message };
    }
  });

  ipcMain.handle('list-models', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['list-models']);
      const jsonData = JSON.parse(result);
      return { success: true, ...jsonData };
    } catch (error) {
      sendDebugLog(mainWindow, `Error listing models: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-current-model', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['get-model']);
      const jsonData = JSON.parse(result);
      return { success: true, ...jsonData };
    } catch (error) {
      sendDebugLog(mainWindow, `Error getting current model: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-model', async (event, modelName) => {
    try {
      sendDebugLog(mainWindow, `Setting model to: ${modelName}`);
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['set-model', modelName]);
      const jsonMatch = result.match(/\{.*\}/s);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        trackEvent('model_changed', { model: modelName });
        return jsonData;
      }

      trackEvent('model_changed', { model: modelName });
      return { success: true, model: modelName };
    } catch (error) {
      sendDebugLog(mainWindow, `Error setting model: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-notifications', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['get-notifications']);
      const jsonData = JSON.parse(result);
      return { success: true, ...jsonData };
    } catch (error) {
      sendDebugLog(mainWindow, `Error getting notification settings: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-notifications', async (event, enabled) => {
    try {
      sendDebugLog(mainWindow, `Setting notifications to: ${enabled}`);
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', [
        'set-notifications',
        enabled ? 'True' : 'False',
      ]);

      const jsonMatch = result.match(/\{.*\}/s);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        return jsonData;
      }

      return { success: true, notifications_enabled: enabled };
    } catch (error) {
      sendDebugLog(mainWindow, `Error setting notifications: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-telemetry', async () => {
    try {
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['get-telemetry']);
      const jsonData = JSON.parse(result);
      return { success: true, ...jsonData };
    } catch (error) {
      sendDebugLog(mainWindow, `Error getting telemetry settings: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-telemetry', async (event, enabled) => {
    try {
      sendDebugLog(mainWindow, `Setting telemetry to: ${enabled}`);
      const result = await runPythonScript(mainWindow, 'simple_recorder.py', ['set-telemetry', enabled ? 'True' : 'False']);

      telemetryEnabled = enabled;

      if (enabled && !posthogClient && PostHog) {
        posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
        console.log('Telemetry re-enabled');
      } else if (!enabled && posthogClient) {
        await shutdownTelemetry();
        console.log('Telemetry disabled');
      }

      const jsonMatch = result.match(/\{.*\}/s);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        return jsonData;
      }

      return { success: true, telemetry_enabled: enabled };
    } catch (error) {
      sendDebugLog(mainWindow, `Error setting telemetry: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pull-model', async (event, modelName) => {
    try {
      sendDebugLog(mainWindow, `Pulling model: ${modelName}`);
      sendDebugLog(mainWindow, 'This may take several minutes...');
      const backend = resolveBackendCommand(['pull-model', modelName]);

      return new Promise((resolve) => {
        const proc = spawn(backend.command, backend.args, {
          cwd: backend.cwd,
        });

        proc.stdout.on('data', (data) => {
          const output = data.toString().trim();
          sendDebugLog(mainWindow, output);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-progress', {
              model: modelName,
              progress: output,
            });
          }
        });

        proc.stderr.on('data', (data) => {
          const output = data.toString().trim();
          sendDebugLog(mainWindow, output);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-progress', {
              model: modelName,
              progress: output,
            });
          }
        });

        proc.on('close', (code) => {
          if (code === 0) {
            sendDebugLog(mainWindow, `Successfully pulled model: ${modelName}`);

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('model-pull-complete', {
                model: modelName,
                success: true,
              });
            }

            resolve({ success: true, model: modelName });
          } else {
            sendDebugLog(mainWindow, `Failed to pull model: ${modelName}`);

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('model-pull-complete', {
                model: modelName,
                success: false,
                error: `Process exited with code ${code}`,
              });
            }

            resolve({ success: false, error: `Process exited with code ${code}` });
          }
        });

        proc.on('error', (error) => {
          sendDebugLog(mainWindow, `Error pulling model: ${error.message}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-complete', {
              model: modelName,
              success: false,
              error: error.message,
            });
          }

          resolve({ success: false, error: error.message });
        });
      });
    } catch (error) {
      sendDebugLog(mainWindow, `Error in pull-model handler: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('check-for-updates', async () => {
    return { success: true, updateAvailable: false, disabled: true };
  });

  ipcMain.handle('check-announcements', async () => {
    return { success: true, announcements: [], disabled: true };
  });

  ipcMain.handle('open-release-page', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Background warmup to reduce first note-generation latency.
  setTimeout(() => {
    ensureWhisperService(mainWindow).catch((error) => {
      console.warn('Whisper service warmup skipped:', error.message);
    });

    runPythonScript(mainWindow, 'simple_recorder.py', ['warmup'], true)
      .then((result) => {
        console.log('Backend warmup result:', result.trim());
      })
      .catch((error) => {
        console.warn('Backend warmup skipped:', error.message);
      });
  }, 2500);
}

async function checkForUpdates() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/sammargolis/OpenScribe/releases/latest',
      method: 'GET',
      headers: { 'User-Agent': 'OpenScribe-Updater' },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name.replace(/^v/, '');

          const packagePath = path.join(__dirname, 'package.json');
          const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
          const currentVersion = packageContent.version;

          const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0;

          resolve({
            success: true,
            updateAvailable: isUpdateAvailable,
            currentVersion,
            latestVersion,
            releaseUrl: release.html_url,
            releaseName: release.name || `Version ${latestVersion}`,
            downloadUrl: getDownloadUrl(release.assets),
          });
        } catch (error) {
          resolve({ success: false, error: 'Failed to parse update data' });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Update check timeout' });
    });

    req.end();
  });
}

function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }

  return 0;
}

function getDownloadUrl(assets) {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    const armAsset = assets.find((asset) => asset.name.includes('arm64') && asset.name.includes('dmg'));
    const intelAsset = assets.find((asset) => asset.name.includes('x64') && asset.name.includes('dmg'));

    if (arch === 'arm64' && armAsset) return armAsset.browser_download_url;
    if (intelAsset) return intelAsset.browser_download_url;
    if (armAsset) return armAsset.browser_download_url;
  }

  return assets.length > 0 ? assets[0].browser_download_url : null;
}

module.exports = {
  registerOpenScribeIpcHandlers,
  registerGlobalHotkey,
  initTelemetry,
  shutdownTelemetry,
  trackEvent,
  durationBucket,
  stopWhisperService,
};
