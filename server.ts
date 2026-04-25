import path from 'path';
import dotenv from 'dotenv';
import { logDatabaseConfiguration, openPrimaryDatabase } from './serverDatabase';
import { startServerRuntime } from './serverLifecycle';
import { initializeRuntimeEnvironment, resolveJwtSecret, resolveLanIp } from './serverRuntimeEnvironment';
import { ensureRootSystemOwner } from './serverSecurity';
import { runLegacyDatabaseMigrations } from './serverLegacyMigrations';
import { createLicenseService } from './serverLicenseService';
import { createConfiguredApp, registerApplicationRoutes } from './serverAppBootstrap';
import { createServerConfig } from './serverConfig';
import { createServerComposition } from './serverComposition';
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
} from './serverSharedHelpers';
import { HIGH_RISK_AUDIT_ACTIONS } from './serverBusinessHelpers';

dotenv.config();

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

const {
  selectedProvider: databaseProvider,
  postgresPool,
  isLocalAdapter,
} = openPrimaryDatabase(dataRootDir);

if (!postgresPool) {
  throw new Error('Database could not be initialized. Set DATABASE_URL or GOODY_POS_POSTGRES_URL for PostgreSQL, or remove them to use the embedded local database.');
}

void logDatabaseConfiguration({
  selectedProvider: databaseProvider,
  postgresPool,
  isLocalAdapter,
});

const {
  PORT,
  HOST,
  APP_VERSION,
  JWT_SECRET,
  JWT_EXPIRY,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} = createServerConfig({
  dataRootDir,
  isDesktopRuntime,
  nodeEnv: NODE_ENV,
  resolveJwtSecret,
});
const {
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  checkLicenseServiceConnection,
  activateRemoteStoreLicense,
} = createLicenseService({
  dataRootDir,
  appVersion: APP_VERSION,
});

const LAN_IP = resolveLanIp();

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

scheduleDailyLocalBackups();
void startServerRuntime({
  app,
  appBaseDir,
  dataRootDir,
  uploadsRootDir,
  HOST,
  PORT,
  LAN_IP,
  JWT_EXPIRY,
});
