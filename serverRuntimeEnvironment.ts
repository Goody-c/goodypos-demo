import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

type RuntimeEnvironment = {
  dataRootDir: string;
  uploadsRootDir: string;
  uploadsDir: string;
  dailyBackupDir: string;
  safetySnapshotDir: string;
  dbFilePath: string;
  isDesktopRuntime: boolean;
  NODE_ENV: string;
  makeSafeTimestamp: (date?: Date) => string;
};

const resolveDefaultDataRootDir = (appBaseDir: string) => {
  const configuredDataDir = String(process.env.GOODY_POS_DATA_DIR || '').trim();
  if (configuredDataDir) {
    return path.resolve(configuredDataDir);
  }

  return appBaseDir;
};

export const initializeRuntimeEnvironment = (appBaseDir: string): RuntimeEnvironment => {
  const dataRootDir = resolveDefaultDataRootDir(appBaseDir);

  if (!fs.existsSync(dataRootDir)) {
    fs.mkdirSync(dataRootDir, { recursive: true });
  }

  const uploadsRootDir = path.join(dataRootDir, 'uploads');
  const uploadsDir = path.join(uploadsRootDir, 'invoices');
  const dailyBackupDir = path.join(dataRootDir, 'backups', 'daily');
  const safetySnapshotDir = path.join(dataRootDir, 'backups', 'snapshots');
  const quarantineBackupDir = path.join(dataRootDir, 'backups', 'quarantine');

  [uploadsDir, dailyBackupDir, safetySnapshotDir, quarantineBackupDir].forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });

  const normalizedAppDir = path.resolve(appBaseDir);
  const normalizedDataDir = path.resolve(dataRootDir);
  if (normalizedAppDir !== normalizedDataDir) {
    const legacyDbPath = path.join(appBaseDir, 'pos.db');
    const targetDbPath = path.join(dataRootDir, 'pos.db');

    if (fs.existsSync(legacyDbPath) && !fs.existsSync(targetDbPath)) {
      try {
        for (const suffix of ['', '-wal', '-shm']) {
          const source = `${legacyDbPath}${suffix}`;
          const destination = `${targetDbPath}${suffix}`;
          if (fs.existsSync(source) && !fs.existsSync(destination)) {
            fs.copyFileSync(source, destination);
          }
        }

        const legacyUploadsDir = path.join(appBaseDir, 'uploads');
        if (fs.existsSync(legacyUploadsDir)) {
          fs.cpSync(legacyUploadsDir, uploadsRootDir, { recursive: true, force: false, errorOnExist: false });
        }

        const legacyBackupsDir = path.join(appBaseDir, 'backups');
        const targetBackupsDir = path.join(dataRootDir, 'backups');
        if (fs.existsSync(legacyBackupsDir)) {
          fs.cpSync(legacyBackupsDir, targetBackupsDir, { recursive: true, force: false, errorOnExist: false });
        }

        console.log(`📦 Migrated legacy GoodyPOS data from ${legacyDbPath} to ${targetDbPath}`);
      } catch (error) {
        console.warn('Legacy data migration could not be completed automatically:', error);
      }
    }
  }

  const isDesktopRuntime = Boolean(process.env.GOODY_POS_DATA_DIR);
  const hasProductionBuild = fs.existsSync(path.join(appBaseDir, 'server.mjs')) && fs.existsSync(path.join(appBaseDir, 'dist', 'index.html'));
  const NODE_ENV = process.env.NODE_ENV || (isDesktopRuntime || hasProductionBuild ? 'production' : 'development');
  process.env.NODE_ENV = NODE_ENV;

  const dbFilePath = path.join(dataRootDir, 'pos.db');
  const makeSafeTimestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');

  return {
    dataRootDir,
    uploadsRootDir,
    uploadsDir,
    dailyBackupDir,
    safetySnapshotDir,
    dbFilePath,
    isDesktopRuntime,
    NODE_ENV,
    makeSafeTimestamp,
  };
};

export const resolveJwtSecret = ({
  isDesktopRuntime,
  dataRootDir,
  nodeEnv,
}: {
  isDesktopRuntime: boolean;
  dataRootDir: string;
  nodeEnv: string;
}) => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (isDesktopRuntime) {
    const jwtSecretPath = path.join(dataRootDir, '.jwt-secret');

    try {
      if (fs.existsSync(jwtSecretPath)) {
        const existingSecret = fs.readFileSync(jwtSecretPath, 'utf8').trim();
        if (existingSecret) {
          return existingSecret;
        }
      }

      const generatedSecret = randomBytes(48).toString('hex');
      fs.writeFileSync(jwtSecretPath, generatedSecret, { mode: 0o600 });
      console.warn('⚠️  Warning: JWT_SECRET not set. Generated a device-local desktop secret.');
      return generatedSecret;
    } catch (error) {
      console.warn('⚠️  Warning: Failed to persist desktop JWT secret. Falling back to a temporary in-memory secret.', error);
      return randomBytes(48).toString('hex');
    }
  }

  if (nodeEnv === 'development') {
    console.warn('⚠️  Warning: JWT_SECRET not set. Using development default (INSECURE).');
    return 'dev-key-change-in-production-12345';
  }

  return undefined;
};

export const getLicenseDeviceInfo = (dataRootDir: string) => {
  const deviceIdentityParts = [os.platform(), os.arch(), os.hostname()]
    .map((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'))
    .filter(Boolean);
  const deviceFingerprintFile = path.join(dataRootDir, `.goodypos-device-id-${deviceIdentityParts.join('-') || 'default'}`);
  const legacyFingerprintFile = path.join(dataRootDir, '.goodypos-device-id');
  const currentDevicePrefix = `${os.platform()}:${os.arch()}:`;

  const getOrCreateDeviceFingerprint = () => {
    try {
      if (fs.existsSync(deviceFingerprintFile)) {
        const existing = fs.readFileSync(deviceFingerprintFile, 'utf8').trim();
        if (existing) {
          return existing;
        }
      }

      if (fs.existsSync(legacyFingerprintFile)) {
        const legacyValue = fs.readFileSync(legacyFingerprintFile, 'utf8').trim();
        if (legacyValue && legacyValue.startsWith(currentDevicePrefix)) {
          fs.writeFileSync(deviceFingerprintFile, legacyValue, { mode: 0o600 });
          return legacyValue;
        }
      }

      const generated = [os.platform(), os.arch(), os.hostname(), randomBytes(12).toString('hex')].join(':');
      fs.writeFileSync(deviceFingerprintFile, generated, { mode: 0o600 });
      return generated;
    } catch (error) {
      console.warn('Device fingerprint persistence failed. Falling back to an in-memory identifier.', error);
      return [os.platform(), os.arch(), os.hostname(), randomBytes(12).toString('hex')].join(':');
    }
  };

  return {
    deviceFingerprint: getOrCreateDeviceFingerprint(),
    deviceName: `${os.hostname()} (${os.platform()})`,
  };
};

export const resolveLanIp = () => {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }

  return 'localhost';
};
