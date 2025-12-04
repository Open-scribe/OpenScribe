const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { app } = require('electron');

let nextServerProcess;
let readyPromise;

const resolveStandaloneDir = () => {
  if (!app || !app.isPackaged) {
    return path.join(process.cwd(), '.next', 'standalone');
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

const ensureNextServer = () => {
  if (readyPromise) {
    return readyPromise;
  }

  const standaloneDir = resolveStandaloneDir();
  const serverScript = path.join(standaloneDir, 'server.js');
  const port = Number(process.env.DESKTOP_SERVER_PORT ?? 4123);

  nextServerProcess = spawn(process.execPath, [serverScript], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: isVerbose() ? 'inherit' : 'ignore',
  });

  nextServerProcess.on('exit', (code, signal) => {
    console.log(`Next.js server exited (${code ?? signal ?? 'unknown'})`);
    readyPromise = undefined;
    nextServerProcess = undefined;
  });

  const url = `http://127.0.0.1:${port}`;
  readyPromise = waitForServer(url).then(() => ({ url }));

  return readyPromise;
};

const stopNextServer = () => {
  if (!nextServerProcess) {
    return;
  }

  nextServerProcess.kill();
  nextServerProcess = undefined;
  readyPromise = undefined;
};

const isVerbose = () => process.env.DEBUG_DESKTOP === '1';

module.exports = {
  ensureNextServer,
  stopNextServer,
};
