#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const isPackaged = typeof process.pkg !== 'undefined';
const rootDir = isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const bundledNodePath = path.join(rootDir, 'runtime', 'node.exe');
const startScriptPath = path.join(rootDir, 'scripts', 'start-goodypos.mjs');

if (!fs.existsSync(startScriptPath)) {
  console.error('GoodyPOS could not find its startup files. Please re-extract the full portable release and try again.');
  process.exit(1);
}

const command = fs.existsSync(bundledNodePath) ? bundledNodePath : process.execPath;
const args = [startScriptPath, ...process.argv.slice(2)];
const result = spawnSync(command, args, {
  cwd: rootDir,
  env: {
    ...process.env,
    GOODY_POS_APP_DIR: process.env.GOODY_POS_APP_DIR || rootDir,
  },
  stdio: 'inherit',
  shell: false,
  windowsHide: false,
});

if (result.error) {
  console.error(result.error.message || 'GoodyPOS portable launcher could not be started.');
  process.exit(1);
}

process.exit(result.status ?? 0);
