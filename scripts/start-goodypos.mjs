#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const dryRun = process.argv.includes('--dry-run');
const systemNpmCommand = isWindows ? 'npm.cmd' : 'npm';
const bundledRuntimeDir = path.join(rootDir, 'runtime');
const bundledNpmCommand = isWindows
  ? path.join(bundledRuntimeDir, 'npm.cmd')
  : path.join(bundledRuntimeDir, 'bin', 'npm');
const packagedServerEntry = path.join(rootDir, 'server.mjs');
const devServerEntry = path.join(rootDir, 'server.ts');
const localTsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const resolveDataDir = () => {
  const configured = String(process.env.GOODY_POS_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);

  if (isWindows) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'GoodyPOS');
  }

  if (isMac) {
    return path.join(os.homedir(), 'Library', 'Application Support', 'GoodyPOS');
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'GoodyPOS');
};

const dataDir = resolveDataDir();
const logFilePath = path.join(dataDir, 'goodypos-web.log');
const readyMarkerPath = path.join(rootDir, 'node_modules', '.goodypos-runtime-ready');
const certPath = path.join(rootDir, 'certs', 'localhost-cert.pem');
const keyPath = path.join(rootDir, 'certs', 'localhost-key.pem');
const protocol = fs.existsSync(certPath) && fs.existsSync(keyPath) ? 'https' : 'http';
const portValue = String(process.env.PORT || '3000').trim() || '3000';
const appUrl = `${protocol}://localhost:${portValue}`;
const healthUrlPath = '/api/health';
const requiredRuntimePaths = [
  path.join(rootDir, 'node_modules', 'express'),
  path.join(rootDir, 'node_modules', 'pg'),
  path.join(rootDir, 'node_modules', 'dotenv'),
  path.join(rootDir, 'node_modules', 'goody-db-driver'),
  path.join(rootDir, 'dist', 'index.html'),
  path.join(rootDir, 'server.mjs'),
];

const runtimeEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || (fs.existsSync(packagedServerEntry) ? 'production' : 'development'),
  GOODY_POS_APP_DIR: process.env.GOODY_POS_APP_DIR || rootDir,
  GOODY_POS_DATA_DIR: dataDir,
  PORT: portValue,
};

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveNpmCommand = () => (fs.existsSync(bundledNpmCommand) ? bundledNpmCommand : systemNpmCommand);

const ensureCommand = (command, args = ['--version']) => {
  if (!command) return false;
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    return false;
  }

  const result = spawnSync(command, args, { stdio: 'ignore', shell: false });
  return result.status === 0;
};

const hasRuntimeDependencies = () => requiredRuntimePaths.every((candidate) => fs.existsSync(candidate));

const markRuntimeReady = () => {
  ensureDir(path.dirname(readyMarkerPath));
  fs.writeFileSync(readyMarkerPath, `ready ${new Date().toISOString()}\n`, 'utf8');
};

const pingPath = (pathname) => new Promise((resolve) => {
  const client = protocol === 'https' ? https : http;
  const request = client.request(
    {
      hostname: '127.0.0.1',
      port: Number(portValue),
      path: pathname,
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 1200,
    },
    (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    }
  );

  request.on('error', () => resolve(false));
  request.on('timeout', () => {
    request.destroy();
    resolve(false);
  });
  request.end();
});

const isServerReachable = async () => {
  if (await pingPath(healthUrlPath)) return true;
  return pingPath('/');
};

const ensureRuntimeDependencies = () => {
  if (hasRuntimeDependencies()) {
    if (!fs.existsSync(readyMarkerPath)) {
      markRuntimeReady();
    }
    return;
  }

  const isPackagedOfflineRelease = fs.existsSync(packagedServerEntry);
  if (isPackagedOfflineRelease) {
    console.error('GoodyPOS is missing packaged app files from the offline release. Please re-extract the full release zip or re-copy the complete GoodyPOS app bundle and try again.');
    process.exit(1);
  }

  const npmCommand = resolveNpmCommand();
  if (!ensureCommand(npmCommand)) {
    console.error('GoodyPOS is missing packaged runtime dependencies. Please re-extract the full release package and try again.');
    process.exit(1);
  }

  console.log('Finishing GoodyPOS runtime setup for this computer...');
  const installResult = spawnSync(npmCommand, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: rootDir,
    env: runtimeEnv,
    stdio: 'inherit',
    shell: false,
  });

  if (installResult.status !== 0 || !hasRuntimeDependencies()) {
    console.error('GoodyPOS runtime setup could not be completed.');
    process.exit(installResult.status || 1);
  }

  markRuntimeReady();
};

const readLogTail = (filePath, maxLines = 40) => {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = String(content || '').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
};

const startServer = () => {
  ensureDir(path.dirname(logFilePath));
  fs.appendFileSync(logFilePath, `\n[${new Date().toISOString()}] Starting GoodyPOS...\n`, 'utf8');
  const logFd = fs.openSync(logFilePath, 'a');

  let command = process.execPath;
  let args = [packagedServerEntry];

  if (!fs.existsSync(packagedServerEntry)) {
    if (fs.existsSync(localTsxCli) && fs.existsSync(devServerEntry)) {
      args = [localTsxCli, devServerEntry];
    } else {
      command = resolveNpmCommand();
      args = ['run', 'dev'];
    }
  }

  const child = spawn(command, args, {
    cwd: rootDir,
    env: runtimeEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    shell: false,
    windowsHide: false,
  });

  fs.closeSync(logFd);
  child.unref();
  return child.pid;
};

const openBrowser = () => {
  if (dryRun) {
    console.log(`[dry-run] Would open ${appUrl}`);
    return;
  }

  if (isMac) {
    spawn('open', [appUrl], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (isWindows) {
    spawn('cmd', ['/c', 'start', '', appUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }

  spawn('xdg-open', [appUrl], { detached: true, stdio: 'ignore' }).unref();
};

const main = async () => {
  ensureDir(dataDir);

  console.log(`GoodyPOS app folder: ${rootDir}`);
  console.log(`Safe data folder: ${dataDir}`);
  console.log(`Target URL: ${appUrl}`);

  if (!ensureCommand(process.execPath)) {
    console.error('GoodyPOS could not start its bundled runtime. Please re-extract the release package and try again.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  if (await isServerReachable()) {
    console.log('GoodyPOS is already running. Opening it in your browser...');
    openBrowser();
    return;
  }

  ensureRuntimeDependencies();

  console.log('Starting GoodyPOS web server...');
  const serverPid = startServer();

  console.log('Waiting for server to boot...');
  let ready = false;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (await isServerReachable()) {
      ready = true;
      break;
    }
    await delay(1000);
  }

  if (!ready) {
    console.error('GoodyPOS did not respond in time.');
    console.error(`Check the log file for details: ${logFilePath}`);
    const recentLogOutput = readLogTail(logFilePath);
    if (recentLogOutput) {
      console.error('\nRecent log output:');
      console.error(recentLogOutput);
    }
    process.exit(1);
  }
  console.log('Opening GoodyPOS in your browser...');
  openBrowser();
  console.log(`GoodyPOS server is running in the background (PID: ${serverPid}).`);
  console.log(`Logs: ${logFilePath}`);
  if (protocol === 'https') {
    console.log('If you see a certificate warning, trust it once for local HTTPS access.');
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
