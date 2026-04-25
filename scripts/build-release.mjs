#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const releasesDir = path.join(rootDir, 'releases');
const runtimeCacheDir = path.join(rootDir, '.cache', 'release-runtime');

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = String(packageJson.version || '0.0.0');
const releaseBaseName = `GoodyPOS-v${version}`;
const macAppBundleName = 'GoodyPOS.app';
const requestedTarget = String(process.argv[2] || 'mac').toLowerCase();
const skipBuild = process.argv.includes('--skip-build');
const targets = requestedTarget === 'all'
  ? ['mac', 'windows']
  : [requestedTarget === 'win' ? 'windows' : requestedTarget];
const releaseNodeVersion = String(process.env.GOODY_POS_RELEASE_NODE_VERSION || process.version).replace(/^v?/, 'v');
const macArch = String(process.env.GOODY_POS_RELEASE_MAC_ARCH || 'universal').toLowerCase();
const windowsArch = String(process.env.GOODY_POS_RELEASE_WINDOWS_ARCH || 'x64').toLowerCase();
const windowsRuntimeNodeVersion = String(
  windowsArch === 'x86'
    ? (process.env.GOODY_POS_RELEASE_WINDOWS_X86_NODE_VERSION || 'v20.19.5')
    : releaseNodeVersion,
).replace(/^v?/, 'v');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const supportedMacArchitectures = new Set(['universal', 'arm64', 'x64']);
const supportedWindowsArchitectures = new Set(['x64', 'x86']);

if (!supportedMacArchitectures.has(macArch)) {
  console.error(`Unsupported macOS release architecture: ${macArch}. Use universal, arm64, or x64.`);
  process.exit(1);
}

if (!supportedWindowsArchitectures.has(windowsArch)) {
  console.error(`Unsupported Windows release architecture: ${windowsArch}. Use x64 or x86.`);
  process.exit(1);
}

const supportedTargets = new Set(['mac', 'windows']);
if (targets.some((target) => !supportedTargets.has(target))) {
  console.error(`Unsupported release target: ${requestedTarget}. Use mac, windows, win, or all.`);
  process.exit(1);
}

const releaseNotes = String(process.env.RELEASE_NOTES || 'Self-contained offline launcher now included|Production dependencies are pre-bundled for first-run startup|Cross-platform update flow keeps live store data outside the app package')
  .split('|')
  .map((item) => item.trim())
  .filter(Boolean);

const filesToCopy = [
  '.env.example',
  '.env.postgres.example',
  'certs',
  'database',
  'dist',
  'LICENSE',
  'metadata.json',
  'package-lock.json',
  'package.json',
  'POSTGRES_SETUP.md',
  'public',
  'RAILWAY-DEPLOY.md',
  'railway.json',
  'scripts',
  'server.mjs',
  'shims',
  'start-goodypos-web.command',
  'start-goodypos-web.bat',
];

const excludedNames = new Set([
  '.DS_Store',
  '.env',
  '.git',
  '.gitignore',
  'backups',
  'dist-electron',
  'node_modules',
  'playwright-report',
  'pos.db',
  'pos.db-shm',
  'pos.db-wal',
  'releases',
  'test-results',
  'uploads',
]);

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const safeCopy = (sourcePath, destinationPath) => {
  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (candidate) => {
      const relative = path.relative(rootDir, candidate);
      const name = path.basename(candidate);

      if (!relative) return true;
      if (excludedNames.has(name)) return false;
      if (relative.startsWith('.git' + path.sep)) return false;
      if (relative.startsWith('backups' + path.sep)) return false;
      if (relative.startsWith('uploads' + path.sep)) return false;
      if (relative.startsWith('releases' + path.sep)) return false;
      if (relative.startsWith('playwright-report' + path.sep)) return false;
      if (relative.startsWith('test-results' + path.sep)) return false;
      if (/\.log$/i.test(name)) return false;
      return true;
    },
  });
};

const writeFile = (filePath, content, modeValue) => {
  fs.writeFileSync(filePath, content, 'utf8');
  if (modeValue) fs.chmodSync(filePath, modeValue);
};

const ensureExecutable = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o755);
    }
  } catch {
    // Ignore platforms that do not persist POSIX execute bits.
  }
};

const canRunCommand = (command, args = ['--version']) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const createZipArchive = (sourceDirName, destinationZipPath, cwd) => {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${sourceDirName}' -DestinationPath '${destinationZipPath}' -Force`,
      ],
      { cwd, stdio: 'inherit' },
    );
    return;
  }

  execFileSync('zip', ['-rq', destinationZipPath, sourceDirName], { cwd, stdio: 'inherit' });
};

const postProcessMacPackage = (packageDir) => {
  try {
    execFileSync('xattr', ['-dr', 'com.apple.quarantine', packageDir], { stdio: 'ignore' });
  } catch {
    // Ignore missing quarantine flags during packaging.
  }
};

const downloadIfMissing = (url, destinationPath) => {
  if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
    return;
  }

  ensureDir(path.dirname(destinationPath));
  console.log(`⬇️ Downloading ${path.basename(destinationPath)}...`);
  execFileSync('curl', ['-L', '--fail', '--retry', '3', '--retry-delay', '2', '-o', destinationPath, url], {
    stdio: 'inherit',
  });
};

const extractArchive = (archivePath, destinationPath) => {
  const tempDir = path.join(runtimeCacheDir, '__extract__', path.basename(archivePath, path.extname(archivePath)));
  fs.rmSync(tempDir, { recursive: true, force: true });
  ensureDir(tempDir);

  const tarArgs = archivePath.endsWith('.tar.gz')
    ? ['-xzf', archivePath, '-C', tempDir]
    : ['-xf', archivePath, '-C', tempDir];
  execFileSync('tar', tarArgs, { stdio: 'inherit' });

  const entries = fs.readdirSync(tempDir).filter((name) => name !== '__MACOSX');
  const extractedRoot = entries.length === 1 ? path.join(tempDir, entries[0]) : tempDir;

  fs.rmSync(destinationPath, { recursive: true, force: true });
  ensureDir(destinationPath);
  for (const entry of fs.readdirSync(extractedRoot)) {
    fs.cpSync(path.join(extractedRoot, entry), path.join(destinationPath, entry), { recursive: true, force: true });
  }
};

const getRuntimeSpecs = (target) => {
  if (target === 'windows') {
    return [{
      archiveName: `node-${windowsRuntimeNodeVersion}-win-${windowsArch}.zip`,
      url: `https://nodejs.org/dist/${windowsRuntimeNodeVersion}/node-${windowsRuntimeNodeVersion}-win-${windowsArch}.zip`,
      nodeRelativePath: 'node.exe',
      runtimeSubdir: 'runtime',
      label: `Node ${windowsRuntimeNodeVersion} for Windows ${windowsArch}`,
    }];
  }

  const macArchitectures = macArch === 'universal' ? ['arm64', 'x64'] : [macArch];
  return macArchitectures.map((arch) => ({
    archiveName: `node-${releaseNodeVersion}-darwin-${arch}.tar.gz`,
    url: `https://nodejs.org/dist/${releaseNodeVersion}/node-${releaseNodeVersion}-darwin-${arch}.tar.gz`,
    nodeRelativePath: path.join('bin', 'node'),
    runtimeSubdir: macArchitectures.length > 1 ? path.join('runtime', arch) : 'runtime',
    label: `Node ${releaseNodeVersion} for macOS ${arch}`,
  }));
};

const prepareBundledRuntime = (target, packageDir) => {
  const specs = getRuntimeSpecs(target);
  const bundledLabels = [];

  specs.forEach((spec) => {
    const archivePath = path.join(runtimeCacheDir, spec.archiveName);
    const runtimeDir = path.join(packageDir, spec.runtimeSubdir);
    downloadIfMissing(spec.url, archivePath);
    extractArchive(archivePath, runtimeDir);

    const bundledNodePath = path.join(runtimeDir, spec.nodeRelativePath);
    if (!fs.existsSync(bundledNodePath)) {
      throw new Error(`Bundled runtime is missing ${spec.nodeRelativePath} for ${target}.`);
    }

    if (target === 'mac') {
      fs.chmodSync(bundledNodePath, 0o755);
    }

    bundledLabels.push(spec.label);
  });

  const runtimeLabel = target === 'mac' && specs.length > 1
    ? `Node ${releaseNodeVersion} for macOS universal (arm64 + x64)`
    : bundledLabels[0];

  const runtimeRootDir = path.join(packageDir, 'runtime');
  ensureDir(runtimeRootDir);
  writeFile(
    path.join(runtimeRootDir, 'RUNTIME-VERSION.txt'),
    `${runtimeLabel}\nBundled on: ${new Date().toISOString()}\n${bundledLabels.map((label) => `- ${label}`).join('\n')}\n`,
  );

  return runtimeLabel;
};

const installProductionDependencies = (packageDir) => {
  console.log(`📥 Installing production dependencies for ${path.basename(packageDir)}...`);
  execSync('npm ci --omit=dev --no-audit --no-fund', {
    cwd: packageDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    },
  });

  const readyMarker = path.join(packageDir, 'node_modules', '.goodypos-runtime-ready');
  ensureDir(path.dirname(readyMarker));
  fs.writeFileSync(readyMarker, `bundled ${new Date().toISOString()}\n`, 'utf8');
};

const buildRuntimeEnvContent = () => {
  const configuredLicenseUrl = String(process.env.GOODY_POS_LICENSE_API_URL || '').trim();
  const licenseRequired = configuredLicenseUrl
    ? String(process.env.GOODY_POS_LICENSE_REQUIRED_FOR_NEW_STORES || 'true').trim()
    : 'false';
  const updateBaseUrl = String(process.env.GOODY_POS_PUBLIC_UPDATE_BASE_URL || '').trim();
  const updateManifestUrl = String(process.env.GOODY_POS_UPDATE_MANIFEST_URL || '').trim();
  const recoveryCode = String(process.env.GOODY_POS_RECOVERY_CODE || '').trim();

  return [
    '# Generated by scripts/build-release.mjs for the offline desktop package.',
    'NODE_ENV=production',
    'PORT=3000',
    'HOST=0.0.0.0',
    'GOODY_POS_DATA_DIR=',
    `GOODY_POS_LICENSE_API_URL=${configuredLicenseUrl}`,
    `GOODY_POS_LICENSE_REQUIRED_FOR_NEW_STORES=${licenseRequired}`,
    `GOODY_POS_PUBLIC_UPDATE_BASE_URL=${updateBaseUrl}`,
    `GOODY_POS_UPDATE_MANIFEST_URL=${updateManifestUrl}`,
    `GOODY_POS_RECOVERY_CODE=${recoveryCode}`,
    '',
  ].join('\n');
};

const buildWindowsPortableLauncher = (packageDir) => {
  const launcherSourcePath = path.join(rootDir, 'scripts', 'portable-exe-launcher.cjs');
  const nativeLauncherSourcePath = path.join(rootDir, 'scripts', 'portable-exe-launcher-win.c');
  const resourceScriptPath = path.join(rootDir, 'scripts', 'portable-exe-launcher.rc');
  const launcherOutputPath = path.join(packageDir, 'GoodyPOS.exe');
  const mingwCompiler = windowsArch === 'x86' ? 'i686-w64-mingw32-gcc' : 'x86_64-w64-mingw32-gcc';
  const windresCompiler = windowsArch === 'x86' ? 'i686-w64-mingw32-windres' : 'x86_64-w64-mingw32-windres';

  if (fs.existsSync(nativeLauncherSourcePath) && canRunCommand(mingwCompiler)) {
    console.log(`🪟 Building Windows portable EXE launcher with ${mingwCompiler}...`);
    const compileArgs = [
      nativeLauncherSourcePath,
      '-municode',
      '-O2',
      '-s',
    ];

    if (fs.existsSync(resourceScriptPath) && canRunCommand(windresCompiler)) {
      const resourceObjectPath = path.join(runtimeCacheDir, `goodypos-icon-${windowsArch}.o`);
      execFileSync(
        windresCompiler,
        [
          resourceScriptPath,
          '-O',
          'coff',
          '-o',
          resourceObjectPath,
        ],
        {
          cwd: rootDir,
          stdio: 'inherit',
        },
      );
      compileArgs.push(resourceObjectPath);
    }

    compileArgs.push('-o', launcherOutputPath);

    execFileSync(
      mingwCompiler,
      compileArgs,
      {
        cwd: rootDir,
        stdio: 'inherit',
      },
    );

    if (fs.existsSync(launcherOutputPath)) {
      return true;
    }
  }

  if (!fs.existsSync(launcherSourcePath)) {
    throw new Error(`Missing portable launcher source: ${launcherSourcePath}`);
  }

  if (windowsArch === 'x86' && process.platform !== 'win32') {
    console.log('ℹ️ Skipping GoodyPOS.exe build for Windows x86 on this host. Use start-goodypos-web.bat inside the package.');
    return false;
  }

  console.log('🪟 Building Windows portable EXE launcher...');
  execFileSync(
    npxCommand,
    [
      '--yes',
      '@yao-pkg/pkg',
      launcherSourcePath,
      '--target',
      `node20-win-${windowsArch === 'x86' ? 'x86' : windowsArch}`,
      '--output',
      launcherOutputPath,
    ],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        PKG_CACHE_PATH: path.join(runtimeCacheDir, 'pkg-cache'),
      },
    },
  );

  if (!fs.existsSync(launcherOutputPath)) {
    throw new Error('Windows portable EXE launcher could not be created.');
  }

  return true;
};
const createMacAppBundle = (packageDir) => {
  const appBundleDir = path.join(packageDir, macAppBundleName);
  const contentsDir = path.join(appBundleDir, 'Contents');
  const macOSDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  const embeddedAppDir = path.join(resourcesDir, 'app');

  fs.rmSync(appBundleDir, { recursive: true, force: true });
  ensureDir(macOSDir);
  ensureDir(embeddedAppDir);

  for (const entry of fs.readdirSync(packageDir)) {
    if (entry === macAppBundleName) continue;
    fs.cpSync(path.join(packageDir, entry), path.join(embeddedAppDir, entry), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }

  const bundledDriverTarget = path.join(embeddedAppDir, 'node_modules', 'goody-db-driver');
  const bundledDriverSource = path.join(embeddedAppDir, 'shims', 'goody-db-driver');
  try {
    if (fs.existsSync(bundledDriverTarget) && fs.lstatSync(bundledDriverTarget).isSymbolicLink()) {
      fs.rmSync(bundledDriverTarget, { recursive: true, force: true });
    }
    if (!fs.existsSync(bundledDriverTarget) && fs.existsSync(bundledDriverSource)) {
      fs.cpSync(bundledDriverSource, bundledDriverTarget, {
        recursive: true,
        force: true,
        dereference: true,
      });
    }
  } catch (error) {
    console.warn('Could not fully materialize the bundled goody-db-driver dependency for the macOS app bundle:', error);
  }

  writeFile(
    path.join(contentsDir, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>GoodyPOS</string>
    <key>CFBundleExecutable</key>
    <string>GoodyPOS</string>
    <key>CFBundleIdentifier</key>
    <string>com.goody.pos</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>GoodyPOS</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
  </dict>
</plist>
`,
  );
  writeFile(path.join(contentsDir, 'PkgInfo'), 'APPL????\n');

  writeFile(
    path.join(macOSDir, 'GoodyPOS'),
    `#!/bin/zsh
APP_ROOT="$(cd "$(dirname "$0")/../Resources/app" && pwd)"

resolve_bundled_node() {
  local detected_arch="$(uname -m 2>/dev/null || echo '')"
  local -a candidates

  case "$detected_arch" in
    arm64|aarch64)
      candidates=(
        "$APP_ROOT/runtime/arm64/bin/node"
        "$APP_ROOT/runtime/bin/node"
        "$APP_ROOT/runtime/x64/bin/node"
      )
      ;;
    x86_64|amd64)
      candidates=(
        "$APP_ROOT/runtime/x64/bin/node"
        "$APP_ROOT/runtime/bin/node"
        "$APP_ROOT/runtime/arm64/bin/node"
      )
      ;;
    *)
      candidates=(
        "$APP_ROOT/runtime/bin/node"
        "$APP_ROOT/runtime/arm64/bin/node"
        "$APP_ROOT/runtime/x64/bin/node"
      )
      ;;
  esac

  for candidate in "\${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      chmod +x "$candidate" 2>/dev/null || true
    fi
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

BUNDLED_NODE="$(resolve_bundled_node)"

if [ -n "$BUNDLED_NODE" ] && [ -x "$BUNDLED_NODE" ]; then
  cd "$APP_ROOT" || exit 1
  export GOODY_POS_APP_DIR="$APP_ROOT"
  exec "$BUNDLED_NODE" "./scripts/start-goodypos.mjs" "$@"
fi

if command -v node >/dev/null 2>&1; then
  cd "$APP_ROOT" || exit 1
  export GOODY_POS_APP_DIR="$APP_ROOT"
  exec node "./scripts/start-goodypos.mjs" "$@"
fi

echo "GoodyPOS could not find a compatible runtime. Please re-copy GoodyPOS.app and try again."
exit 1
`,
    0o755,
  );

  ensureExecutable(path.join(macOSDir, 'GoodyPOS'));
  return appBundleDir;
};

const createGuide = (target, packageDirName, runtimeLabel) => {
  const isWindowsTarget = target === 'windows';
  const platformLabel = isWindowsTarget ? 'Windows' : 'macOS';
  const dataFolder = isWindowsTarget
    ? '%APPDATA%\\GoodyPOS'
    : '$HOME/Library/Application Support/GoodyPOS';
  const launchFile = isWindowsTarget ? 'GoodyPOS.exe' : 'start-goodypos-web.command';

  return [
    `GoodyPOS ${version} ${platformLabel} offline package`,
    '',
    'This package is self-contained:',
    `- Bundled runtime: ${runtimeLabel}`,
    '- Production dependencies are already included.',
    '- No internet connection is required to install or launch the portable release.',
    '- Internet is only required once during first-store setup to activate the license.',
    '',
    'How to update safely:',
    '1. Close any running GoodyPOS windows.',
    `2. Keep your data folder untouched: ${dataFolder}`,
    isWindowsTarget
      ? `3. Extract the full zip, then double-click ${launchFile} (or use start-goodypos-web.bat as a fallback).`
      : `3. Extract the full zip, then drag ${macAppBundleName} into /Applications or open it directly from the extracted folder.`,
    '4. Your live store data, uploads, and backups will continue from the external GoodyPOS data folder.',
    isWindowsTarget
      ? '5. If Windows SmartScreen warns the first time, choose More info > Run anyway for this trusted local package.'
      : `5. If macOS warns the first time, right-click ${macAppBundleName} and choose Open once.`,
    '',
    'Release highlights:',
    ...releaseNotes.map((item, index) => `${index + 1}. ${item}`),
    '',
    `Package folder: ${packageDirName}`,
  ].join('\n');
};

const buildPackage = (target) => {
  const packageDirName = target === 'windows'
    ? `${releaseBaseName}-windows-${windowsArch}`
    : `${releaseBaseName}-mac`;
  const packageDir = path.join(releasesDir, packageDirName);
  fs.rmSync(packageDir, { recursive: true, force: true });
  ensureDir(packageDir);

  for (const entry of filesToCopy) {
    if (target === 'windows' && entry === 'start-goodypos-web.command') continue;
    if (target === 'mac' && entry === 'start-goodypos-web.bat') continue;
    const sourcePath = path.join(rootDir, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const destinationPath = path.join(packageDir, entry);
    safeCopy(sourcePath, destinationPath);
  }

  writeFile(path.join(packageDir, '.env'), buildRuntimeEnvContent());

  installProductionDependencies(packageDir);
  const runtimeLabel = prepareBundledRuntime(target, packageDir);

  if (target === 'mac') {
    ensureExecutable(path.join(packageDir, 'start-goodypos-web.command'));
    ensureExecutable(path.join(packageDir, 'scripts', 'start-goodypos.mjs'));
    ensureExecutable(path.join(packageDir, 'runtime', 'bin', 'node'));
    ensureExecutable(path.join(packageDir, 'runtime', 'arm64', 'bin', 'node'));
    ensureExecutable(path.join(packageDir, 'runtime', 'x64', 'bin', 'node'));
  }

  if (target === 'windows') {
    buildWindowsPortableLauncher(packageDir);
  }

  if (target === 'mac') {
    createMacAppBundle(packageDir);
    postProcessMacPackage(packageDir);
    writeFile(
      path.join(packageDir, 'Update-GoodyPOS.command'),
      `#!/bin/zsh\ncd "$(dirname "$0")"\necho "GoodyPOS ${version} offline package is ready."\necho "No extra downloads are required."\necho "Your live data stays in $HOME/Library/Application Support/GoodyPOS."\necho "Starting the new version now..."\nif [ -d "./${macAppBundleName}" ]; then\n  open "./${macAppBundleName}"\nelse\n  ./start-goodypos-web.command\nfi\n`,
      0o755,
    );
  } else {
    writeFile(
      path.join(packageDir, 'Update-GoodyPOS.bat'),
      `@echo off\r\ncd /d "%~dp0"\r\necho GoodyPOS ${version} offline package is ready.\r\necho No extra downloads are required.\r\necho Your live data stays in %%APPDATA%%\\GoodyPOS.\r\necho Internet is only needed once to activate a new store license.\r\necho Starting the new version now...\r\nif exist "GoodyPOS.exe" (\r\n  start "" "GoodyPOS.exe"\r\n) else (\r\n  call start-goodypos-web.bat\r\n)\r\n`,
    );
  }

  writeFile(path.join(packageDir, 'UPDATE-INSTRUCTIONS.txt'), createGuide(target, packageDirName, runtimeLabel));
  writeFile(path.join(packageDir, 'VERSION.txt'), `GoodyPOS ${version}\nBuilt: ${new Date().toISOString()}\n${runtimeLabel}\n`);

  const zipName = `${packageDirName}.zip`;
  const zipPath = path.join(releasesDir, zipName);
  fs.rmSync(zipPath, { force: true });
  createZipArchive(packageDirName, zipPath, releasesDir);

  return { packageDirName, zipPath, runtimeLabel };
};

ensureDir(releasesDir);
ensureDir(runtimeCacheDir);

console.log(`\n📦 Building GoodyPOS offline release package${targets.length > 1 ? 's' : ''} for: ${targets.join(', ')}...\n`);
if (!skipBuild) {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  execSync('npm run build:server', { cwd: rootDir, stdio: 'inherit' });
}

const buildResults = targets.map(buildPackage);

console.log('\n✅ Offline release package(s) created successfully:');
buildResults.forEach((result) => {
  console.log(`- ${result.zipPath} (${result.runtimeLabel})`);
});
console.log('\nNext step: share the generated zip file(s) from the `releases` folder.\n');
