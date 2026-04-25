import path from 'path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { logDatabaseConfiguration, openPrimaryDatabase } from '../serverDatabase.js';
import { initializeRuntimeEnvironment, resolveJwtSecret } from '../serverRuntimeEnvironment.js';
import { ensureRootSystemOwner } from '../serverSecurity.js';
import { runLegacyDatabaseMigrations } from '../serverLegacyMigrations.js';
import { createLicenseService } from '../serverLicenseService.js';
import { createConfiguredApp, registerApplicationRoutes } from '../serverAppBootstrap.js';
import { createServerConfig } from '../serverConfig.js';
import { createServerComposition } from '../serverComposition.js';
import {
  clampChatCleanupReminderDay,
  clampChatRetentionValue,
  formatAttendanceEntry,
  formatHandoverNoteRecord,
  getAttendanceDurationMinutes,
  getShiftDateKey,
  isChatCleanupReminderDue,
  normalizeBatchCode,
  normalizeBatchExpiryDate,
  normalizeChatRetentionUnit,
  normalizeCollectionCondition,
  normalizeHandoverPriority,
  normalizePaymentFrequency,
  normalizePhone,
  normalizeProductBarcode,
  normalizeRecountStatus,
  normalizeSaleChannel,
  normalizeStaffAnnouncement,
  normalizeStoreDiscountCodes,
  normalizeStoreSignatureImage,
  safeJsonParse,
} from '../serverSharedHelpers.js';
import { HIGH_RISK_AUDIT_ACTIONS } from '../serverBusinessHelpers.js';
import { seedDemoData } from '../serverDemoSeeder.js';
import { SEED_DB_BASE64 } from './seedData.js';

dotenv.config();

// On Vercel, use /tmp for SQLite storage
if (!process.env.GOODY_POS_DATA_DIR) {
  process.env.GOODY_POS_DATA_DIR = '/tmp/goodypos';
}
if (!process.env.GOODY_POS_DB_PROVIDER) {
  process.env.GOODY_POS_DB_PROVIDER = 'local';
}

const appBaseDir = process.env.GOODY_POS_APP_DIR ? path.resolve(process.env.GOODY_POS_APP_DIR) : process.cwd();

const {
  dataRootDir,
  uploadsRootDir,
  uploadsDir,
  dailyBackupDir,
  safetySnapshotDir,
  isDesktopRuntime,
  NODE_ENV,
  makeSafeTimestamp,
} = initializeRuntimeEnvironment(appBaseDir);

const isNewDatabase = !fs.existsSync(path.join(dataRootDir, 'pos.db'));

const {
  selectedProvider: databaseProvider,
  postgresPool,
  isLocalAdapter,
} = openPrimaryDatabase(dataRootDir);

if (!postgresPool) {
  throw new Error('Database could not be initialized.');
}

void logDatabaseConfiguration({ selectedProvider: databaseProvider, postgresPool, isLocalAdapter });

const {
  PORT,
  HOST,
  APP_VERSION,
  JWT_SECRET,
  JWT_EXPIRY,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} = createServerConfig({ dataRootDir, isDesktopRuntime, nodeEnv: NODE_ENV, resolveJwtSecret });

const {
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  checkLicenseServiceConnection,
  activateRemoteStoreLicense,
} = createLicenseService({ dataRootDir, appVersion: APP_VERSION });

const {
  coreReadRepository,
  coreWriteRepository,
  createSafetySnapshot,
  scheduleDailyLocalBackups,
  getLoginAttemptKey,
  getRemainingLockoutMs,
  registerFailedLogin,
  clearLoginAttempt,
  normalizePin,
  hashPin,
  verifyPin,
  resolveCheckoutActorByPin,
  findUserById,
  findStoreById,
  authenticate,
  authorize,
  checkStoreLock,
  logSystemActivity,
  formatAuditCurrency,
  getMissingCostPriceLabels,
  getAuditActorLabel,
  logAuditEvent,
  getProductTotalStock,
  toFiniteNumberOrNull,
  resolveTrackedCost,
  getTotalPaidFromPaymentMethods,
  buildLayawayPaymentPlan,
  formatInventoryBatch,
  formatStockAdjustmentEntry,
  formatPurchaseOrder,
  formatMarketCollection,
  formatRepairTicket,
  formatSaleReturnEntry,
  getSaleReturnsMeta,
  formatSaleResponse,
  collectUnusedMediaCleanupStats,
  markExpiredProformas,
  startScheduledMaintenance,
  generateUniqueQuickCode,
  generateUniqueBarcode,
  reconcileInventoryBatchQuantity,
  generateUniquePurchaseOrderNumber,
  generateUniqueRepairTicketNumber,
} = createServerComposition({
  postgresPool,
  dailyBackupDir,
  safetySnapshotDir,
  makeSafeTimestamp,
  jwtSecret: JWT_SECRET,
  maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
  lockoutDurationMs: LOCKOUT_DURATION_MS,
  uploadsRootDir,
});

await runLegacyDatabaseMigrations({ postgresPool, isLocalAdapter });

await ensureRootSystemOwner({
  postgresPool,
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMe123!',
});

// On cold start, copy pre-seeded DB instead of seeding from scratch (faster)
if (isNewDatabase) {
  try {
    fs.mkdirSync(dataRootDir, { recursive: true });
    fs.writeFileSync(path.join(dataRootDir, 'pos.db'), Buffer.from(SEED_DB_BASE64, 'base64'));
    console.log('✅ Pre-seeded demo database written to /tmp.');
  } catch (err) {
    console.warn('⚠️ Demo seed skipped:', err instanceof Error ? err.message : err);
  }
}

const LAN_IP = '';
const app = createConfiguredApp({ PORT, LAN_IP });

registerApplicationRoutes({
  app,
  db: postgresPool,
  postgresPool,
  uploadsDir,
  APP_VERSION,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  findStoreById,
  findUserById,
  normalizePhone,
  safeJsonParse,
  normalizeStaffAnnouncement,
  normalizeStoreDiscountCodes,
  normalizeStoreSignatureImage,
  clampChatCleanupReminderDay,
  clampChatRetentionValue,
  normalizeChatRetentionUnit,
  isChatCleanupReminderDue,
  formatHandoverNoteRecord,
  getAttendanceDurationMinutes,
  getShiftDateKey,
  formatAttendanceEntry,
  normalizeHandoverPriority,
  normalizeBatchCode,
  normalizeBatchExpiryDate,
  normalizeCollectionCondition,
  normalizePaymentFrequency,
  normalizeSaleChannel,
  normalizeRecountStatus,
  normalizeProductBarcode,
  normalizePin,
  hashPin,
  verifyPin,
  resolveCheckoutActorByPin,
  resolveTrackedCost,
  getTotalPaidFromPaymentMethods,
  getProductTotalStock,
  getSaleReturnsMeta,
  getMissingCostPriceLabels,
  getAuditActorLabel,
  logAuditEvent,
  logSystemActivity,
  formatAuditCurrency,
  toFiniteNumberOrNull,
  buildLayawayPaymentPlan,
  formatInventoryBatch,
  formatStockAdjustmentEntry,
  formatPurchaseOrder,
  formatMarketCollection,
  formatRepairTicket,
  formatSaleReturnEntry,
  formatSaleResponse,
  HIGH_RISK_AUDIT_ACTIONS,
  getLoginAttemptKey,
  getRemainingLockoutMs,
  registerFailedLogin,
  clearLoginAttempt,
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  JWT_SECRET,
  JWT_EXPIRY,
  checkLicenseServiceConnection,
  activateRemoteStoreLicense,
  markExpiredProformas,
  startScheduledMaintenance,
  generateUniqueQuickCode,
  generateUniqueBarcode,
  reconcileInventoryBatchQuantity,
  generateUniquePurchaseOrderNumber,
  generateUniqueRepairTicketNumber,
  collectUnusedMediaCleanupStats,
  createSafetySnapshot: async (reason?: string) => createSafetySnapshot(reason === 'startup' ? 'startup' : 'pre-maintenance'),
});

app.post('/api/reset', async (req: any, res: any) => {
  const secret = String(req.headers['x-cron-secret'] || req.query.secret || '');
  const expectedSecret = process.env.CRON_SECRET || process.env.DEMO_RESET_TOKEN || '';

  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const dbPath = path.join(dataRootDir, 'pos.db');
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
    return res.json({ success: true, message: 'Demo database reset. A fresh instance will re-seed on the next request.' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Reset failed' });
  }
});

// Vercel serverless handler
export default function handler(req: any, res: any) {
  return app(req, res);
}
