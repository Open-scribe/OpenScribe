const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { app } = require('electron');
const getPort = require('get-port');

let nextServerProcess;
let readyPromise;
let serverUrl;

const resolveNodePath = () => {
  // Use Node.js from system PATH
  // Modern Electron embeds Node.js in the main executable, not as a separate binary
  // So we use the system's Node.js installation instead
  return 'node';
};

const resolveStandaloneDir = () => {
  if (!app || !app.isPackaged) {
    return path.join(process.cwd(), 'build', 'web', 'standalone');
  }

  return path.join(process.resourcesPath, 'next');
};

const waitForServer = (url, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        response.destroy();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Next.js server did not start after ${timeoutMs / 1000}s`));
          return;
        }

        setTimeout(attempt, 500);
      });
    };

    attempt();
  });

const ensureNextServer = async () => {
  if (readyPromise) {
    return readyPromise;
  }

  const standaloneDir = resolveStandaloneDir();
  const serverScript = path.join(standaloneDir, 'apps/web/server.js');
  
  // Try to get preferred port 4123, or find next available port
  const preferredPort = Number(process.env.DESKTOP_SERVER_PORT ?? 4123);
  const port = await getPort({ port: preferredPort });

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} was busy, using port ${port} instead`);
  }

  const nodePath = resolveNodePath();
  console.log(`Starting Next.js server with Node.js at: ${nodePath}`);
  console.log(`Server script: ${serverScript}`);
  console.log(`Working directory: ${standaloneDir}`);

  nextServerProcess = spawn(nodePath, [serverScript], {
    cwd: standaloneDir,  // Start from standalone root, not apps/web
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    // Capture stdio for logging instead of exposing to user
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Log server output for debugging (but don't show to user)
  if (nextServerProcess.stdout) {
    nextServerProcess.stdout.on('data', (data) => {
      if (isVerbose()) {
        console.log('[Next.js Server]:', data.toString().trim());
      }
    });
  }

  if (nextServerProcess.stderr) {
    nextServerProcess.stderr.on('data', (data) => {
      console.error('[Next.js Server Error]:', data.toString().trim());
    });
  }

  // Handle process exit
  nextServerProcess.on('exit', (code, signal) => {
    console.log(`Next.js server exited with code ${code} and signal ${signal}`);
    readyPromise = undefined;
    nextServerProcess = undefined;
    serverUrl = undefined;
  });

  // Handle process errors (e.g., EADDRINUSE)
  nextServerProcess.on('error', (error) => {
    console.error('Next.js server process error:', error);
    readyPromise = undefined;
    nextServerProcess = undefined;
    serverUrl = undefined;
  });

  const url = `http://127.0.0.1:${port}`;
  serverUrl = url;
  readyPromise = waitForServer(url).then(() => {
    console.log(`Next.js server ready on ${url}`);
    return { url, port };
  });

  return readyPromise;
};

const stopNextServer = () => {
  return new Promise((resolve) => {
    if (!nextServerProcess) {
      console.log('No Next.js server to stop');
      resolve();
      return;
    }

    console.log('Stopping Next.js server...');

    const timeout = setTimeout(() => {
      console.log('Server did not stop gracefully, force killing...');
      if (nextServerProcess) {
        nextServerProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000); // 5 second timeout

    nextServerProcess.once('exit', () => {
      clearTimeout(timeout);
      console.log('Next.js server stopped');
      nextServerProcess = undefined;
      readyPromise = undefined;
      serverUrl = undefined;
      resolve();
    });

    // Try graceful shutdown first
    nextServerProcess.kill('SIGTERM');
  });
};

const isVerbose = () => process.env.DEBUG_DESKTOP === '1';

module.exports = {
  ensureNextServer,
  stopNextServer,
};
