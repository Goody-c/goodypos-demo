import express, { type Express } from 'express';
import cors from 'cors';
import { registerAuthAdminRoutes } from './serverAuthAdminRoutes';
import { registerCatalogRoutes } from './serverCatalogRoutes';
import { registerOperationsRoutes } from './serverOperationsRoutes';
import { registerSalesReportingRoutes } from './serverSalesReportingRoutes';
import { registerStaffCommunicationRoutes } from './serverStaffCommunicationRoutes';
import { registerSystemRoutes } from './serverSystemRoutes';

export const createConfiguredApp = ({
  PORT,
  LAN_IP,
}: {
  PORT: number;
  LAN_IP: string;
}) => {
  const app = express();
  const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const nearbyDevPorts = Array.from(new Set([PORT, PORT + 1, PORT + 2, PORT + 3, PORT + 4, 5173]));
  const allowedCorsOrigins = new Set([
    ...configuredCorsOrigins,
    ...nearbyDevPorts.flatMap((port) => [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://${LAN_IP}:${port}`,
    ]),
  ]);

  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedCorsOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');

    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  return app;
};

type RegisterApplicationRoutesDependencies = {
  app: Express;
  db: any;
  postgresPool: any;
  uploadsDir: string;
  APP_VERSION: string;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  findStoreById: (storeId: unknown) => Promise<any>;
  findUserById: (userId: unknown) => any;
  normalizePhone: (value: unknown) => string;
  safeJsonParse: (value: any, fallback: any) => any;
  normalizeStaffAnnouncement: (value: any) => { text: string; active: boolean; updated_at: string | null };
  normalizeStoreDiscountCodes: (value: unknown) => any[];
  normalizeStoreSignatureImage: (value: unknown) => string | null;
  clampChatCleanupReminderDay: (value: unknown) => number;
  clampChatRetentionValue: (value: unknown) => number;
  normalizeChatRetentionUnit: (value: unknown) => 'days' | 'months';
  isChatCleanupReminderDue: (store: any, referenceDate?: Date) => boolean;
  formatHandoverNoteRecord: (note: any, currentUser?: any) => any;
  getAttendanceDurationMinutes: (clockInAt: unknown, clockOutAt?: unknown) => number;
  getShiftDateKey: (dateInput?: Date) => string;
  formatAttendanceEntry: (entry: any) => any;
  normalizeHandoverPriority: (value: unknown) => string;
  normalizeBatchCode: (value: unknown) => string | null;
  normalizeBatchExpiryDate: (value: unknown) => string | null;
  normalizeCollectionCondition: (value: unknown) => string | null;
  normalizePaymentFrequency: (value: unknown) => string;
  normalizeSaleChannel: (value: unknown) => string;
  normalizeRecountStatus: (value: unknown) => string;
  normalizeProductBarcode: (value: unknown) => string;
  normalizePin: (value: unknown) => string;
  hashPin: (pin: string) => string;
  verifyPin: (pin: string, hash: string) => boolean;
  resolveCheckoutActorByPin: (storeId: unknown, pin: unknown) => Promise<any>;
  resolveTrackedCost: (options: any) => any;
  getTotalPaidFromPaymentMethods: (paymentMethods: any) => number;
  getProductTotalStock: (product: any) => number;
  getSaleReturnsMeta: (saleId: number) => Promise<any>;
  getMissingCostPriceLabels: (options: any) => { primaryLabel: string; allConditionsLabel: string | null };
  getAuditActorLabel: (role: unknown) => string;
  logAuditEvent: (payload: any) => Promise<void>;
  logSystemActivity: (payload: any) => Promise<void>;
  formatAuditCurrency: (value: unknown) => string;
  toFiniteNumberOrNull: (value: any) => number | null;
  buildLayawayPaymentPlan: (options: any) => any;
  formatInventoryBatch: (entry: any) => any;
  formatStockAdjustmentEntry: (entry: any) => any;
  formatPurchaseOrder: (entry: any) => any;
  formatMarketCollection: (entry: any) => any;
  formatRepairTicket: (entry: any) => any;
  formatSaleReturnEntry: (entry: any) => any;
  formatSaleResponse: (sale: any) => Promise<any>;
  HIGH_RISK_AUDIT_ACTIONS: string[];
  getLoginAttemptKey: (username: string, ipAddress?: string) => string;
  getRemainingLockoutMs: (key: string) => number;
  registerFailedLogin: (key: string) => { remainingAttempts: number; lockUntil: number };
  clearLoginAttempt: (key: string) => void;
  LICENSE_API_BASE_URL: string;
  LICENSE_REQUIRED_FOR_NEW_STORES: boolean;
  LICENSE_DEVICE_NAME: string;
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  checkLicenseServiceConnection: () => Promise<{ configured: boolean; connected: boolean; statusCode: number | null; error: string | null }>;
  activateRemoteStoreLicense: (payload: { licenseKey: string; storeName: string; storeMode: 'SUPERMARKET' | 'GADGET' }) => Promise<any>;
  markExpiredProformas: () => Promise<void>;
  startScheduledMaintenance: () => void;
  generateUniqueQuickCode: (maxAttempts?: number, excludeProductId?: number | null, preferredCandidate?: string | null) => Promise<string | null>;
  generateUniqueBarcode: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  reconcileInventoryBatchQuantity: (payload: { productId: number; storeId: number; condition?: string | null; targetStock: number }) => Promise<void>;
  generateUniquePurchaseOrderNumber: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  generateUniqueRepairTicketNumber: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  collectUnusedMediaCleanupStats: () => Promise<{ scannedFiles: number; deletedFiles: number; deletedBytes: number }>;
  createSafetySnapshot: (reason?: string) => Promise<any>;
};

export const registerApplicationRoutes = ({
  app,
  db: _db,
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
  createSafetySnapshot,
}: RegisterApplicationRoutesDependencies) => {
  registerSystemRoutes({
    app,
    postgresPool,
    APP_VERSION,
    authenticate,
    authorize,
    LICENSE_API_BASE_URL,
    LICENSE_REQUIRED_FOR_NEW_STORES,
    LICENSE_DEVICE_NAME,
    checkLicenseServiceConnection,
  });

  startScheduledMaintenance();

  registerOperationsRoutes({
    app,
    postgresPool,
    authenticate,
    authorize,
    checkStoreLock,
    coreReadRepository,
    coreWriteRepository,
    normalizePhone,
    safeJsonParse,
    resolveTrackedCost,
    normalizeCollectionCondition,
    normalizeSaleChannel,
    normalizePaymentFrequency,
    getTotalPaidFromPaymentMethods,
    buildLayawayPaymentPlan,
    formatSaleResponse,
    formatMarketCollection,
    formatRepairTicket,
    formatInventoryBatch,
    formatPurchaseOrder,
    normalizeBatchCode,
    normalizeBatchExpiryDate,
    generateUniqueRepairTicketNumber,
    generateUniquePurchaseOrderNumber,
    getAuditActorLabel,
    logAuditEvent,
    logSystemActivity,
    formatAuditCurrency,
    collectUnusedMediaCleanupStats,
    createSafetySnapshot,
  });

  registerAuthAdminRoutes({
    app,
    postgresPool,
    authenticate,
    authorize,
    checkStoreLock,
    coreReadRepository,
    coreWriteRepository,
    findStoreById,
    findUserById,
    normalizeStaffAnnouncement,
    safeJsonParse,
    getLoginAttemptKey,
    getRemainingLockoutMs,
    registerFailedLogin,
    clearLoginAttempt,
    activateRemoteStoreLicense,
    markExpiredProformas,
    normalizePin,
    hashPin,
    verifyPin,
    resolveCheckoutActorByPin,
    LICENSE_REQUIRED_FOR_NEW_STORES,
    LICENSE_DEVICE_NAME,
    JWT_SECRET,
    JWT_EXPIRY,
  });

  registerStaffCommunicationRoutes({
    app,
    postgresPool,
    authenticate,
    authorize,
    checkStoreLock,
    coreReadRepository,
    coreWriteRepository,
    clampChatRetentionValue,
    normalizeChatRetentionUnit,
    isChatCleanupReminderDue,
    formatHandoverNoteRecord,
    normalizeHandoverPriority,
    formatAttendanceEntry,
    getShiftDateKey,
    getAttendanceDurationMinutes,
  });

  registerCatalogRoutes({
    app,
    postgresPool,
    authenticate,
    authorize,
    checkStoreLock,
    coreReadRepository,
    coreWriteRepository,
    findStoreById,
    safeJsonParse,
    normalizeStoreDiscountCodes,
    normalizeStaffAnnouncement,
    normalizeStoreSignatureImage,
    clampChatCleanupReminderDay,
    clampChatRetentionValue,
    normalizeChatRetentionUnit,
    isChatCleanupReminderDue,
    getProductTotalStock,
    formatStockAdjustmentEntry,
    normalizeRecountStatus,
    getAuditActorLabel,
    logAuditEvent,
    formatAuditCurrency,
    normalizeProductBarcode,
    generateUniqueBarcode,
    generateUniqueQuickCode,
    reconcileInventoryBatchQuantity,
  });

  registerSalesReportingRoutes({
    app,
    postgresPool,
    uploadsDir,
    authenticate,
    authorize,
    checkStoreLock,
    coreReadRepository,
    coreWriteRepository,
    findStoreById,
    safeJsonParse,
    normalizePhone,
    normalizeSaleChannel,
    normalizePin,
    resolveCheckoutActorByPin,
    getTotalPaidFromPaymentMethods,
    getSaleReturnsMeta,
    formatSaleResponse,
    formatSaleReturnEntry,
    formatMarketCollection,
    getAuditActorLabel,
    formatAuditCurrency,
    logSystemActivity,
    logAuditEvent,
    HIGH_RISK_AUDIT_ACTIONS,
    toFiniteNumberOrNull,
    resolveTrackedCost,
    getMissingCostPriceLabels,
    getProductTotalStock,
  });
};
