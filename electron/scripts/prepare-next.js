#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, '.next', 'standalone');
const staticSource = path.join(rootDir, '.next', 'static');
const staticDestination = path.join(standaloneDir, '.next', 'static');
const publicSource = path.join(rootDir, 'public');
const publicDestination = path.join(standaloneDir, 'public');

const ensureExists = async (source, destination) => {
  if (!(await fs.pathExists(source))) {
    throw new Error(`Required path missing: ${source}`);
  }

  await fs.remove(destination);
  await fs.mkdirp(path.dirname(destination));
  await fs.copy(source, destination);
};

const run = async () => {
  if (!(await fs.pathExists(standaloneDir))) {
    throw new Error(
      'Next standalone output has not been generated. Run "pnpm build" before packaging the desktop app.',
    );
  }

  await ensureExists(staticSource, staticDestination);
  await ensureExists(publicSource, publicDestination);

  console.log('✅ Prepared standalone Next.js output for Electron packaging');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
