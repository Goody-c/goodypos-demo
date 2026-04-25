import { Pool } from 'pg';
import path from 'node:path';
import { createLocalDatabasePool, type LocalDatabasePool } from './serverLocalDatabaseAdapter';

export type SupportedDatabaseProvider = 'postgres' | 'local';

const normalizeProvider = (value: unknown): SupportedDatabaseProvider => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'local' || v === 'sqlite') return 'local';
  return 'postgres';
};

const isTruthyFlag = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const getConfiguredDatabaseProvider = (): SupportedDatabaseProvider => {
  const explicitProvider = process.env.GOODY_POS_DB_PROVIDER || process.env.GOODY_POS_DATABASE_PROVIDER || '';
  if (explicitProvider) return normalizeProvider(explicitProvider);

  // Auto-detect: if a PostgreSQL URL is configured, use postgres; otherwise fall back to local
  if (getConfiguredPostgresUrl()) return 'postgres';
  return 'local';
};

export const getConfiguredPostgresUrl = () => {
  return String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
};

const shouldUsePostgresSsl = () => {
  return isTruthyFlag(process.env.GOODY_POS_POSTGRES_SSL);
};

const createPostgresPool = () => {
  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString) {
    return null;
  }

  return new Pool({
    connectionString,
    ssl: shouldUsePostgresSsl() ? { rejectUnauthorized: false } : undefined,
    max: 6,
  });
};

const postgresSequenceTables = [
  'stores',
  'users',
  'categories',
  'products',
  'consignment_items',
  'customers',
  'sales',
  'sale_items',
  'sales_returns',
  'expenses',
  'suppliers',
  'purchase_orders',
  'inventory_batches',
  'market_collections',
  'repair_tickets',
  'staff_attendance',
  'internal_messages',
  'handover_notes',
  'pro_formas',
  'stock_adjustments',
  'product_change_requests',
  'transaction_flags',
  'vendor_payables',
];

const syncPostgresSequences = async (pool: Pool) => {
  for (const tableName of postgresSequenceTables) {
    try {
      await pool.query(`
        SELECT setval(
          pg_get_serial_sequence('${tableName}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1,
          false
        )
      `);
    } catch {
      // Ignore tables without serial-backed IDs.
    }
  }
};

export const openPrimaryDatabase = (dataRootDir?: string) => {
  const selectedProvider = getConfiguredDatabaseProvider();

  if (selectedProvider === 'local') {
    const dbDir = dataRootDir || process.cwd();
    const dbPath = path.join(dbDir, 'pos.db');
    const localPool = createLocalDatabasePool(dbPath);
    return {
      selectedProvider,
      postgresConfigured: false,
      postgresPool: localPool as any,
      isLocalAdapter: true,
    };
  }

  const postgresPool = createPostgresPool();

  return {
    selectedProvider,
    postgresConfigured: Boolean(getConfiguredPostgresUrl()),
    postgresPool,
    isLocalAdapter: false,
  };
};

export const testPostgresConnection = async (existingPool?: Pool | null) => {
  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString && !existingPool) {
    throw new Error('Missing GOODY_POS_POSTGRES_URL or DATABASE_URL');
  }

  const pool = existingPool || createPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL pool could not be created from the current environment');
  }

  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
             current_user AS database_user,
             version() AS version
    `);

    const row = result.rows[0] || {};
    return {
      databaseName: String(row.database_name || ''),
      databaseUser: String(row.database_user || ''),
      version: String(row.version || ''),
    };
  } finally {
    if (!existingPool) {
      await pool.end();
    }
  }
};

export const logDatabaseConfiguration = async (options: {
  selectedProvider: SupportedDatabaseProvider;
  postgresPool?: Pool | LocalDatabasePool | null;
  isLocalAdapter?: boolean;
}) => {
  const { selectedProvider, postgresPool = null, isLocalAdapter = false } = options;

  if (isLocalAdapter) {
    console.log(`🗄️ Runtime database engine: LOCAL (embedded SQLite)`);
    console.log('📦 Offline mode — no external database required.');
    return;
  }

  if (!postgresPool) {
    console.error('❌ No PostgreSQL URL configured. GoodyPOS requires a database. Set DATABASE_URL or GOODY_POS_POSTGRES_URL.');
    return;
  }

  console.log(`🗄️ Runtime database engine: ${selectedProvider.toUpperCase()}`);
  console.log('🐘 PostgreSQL mode is active.');

  try {
    const connection = await testPostgresConnection(postgresPool as Pool);
    await syncPostgresSequences(postgresPool as Pool);
    console.log(`🐘 PostgreSQL connection ready: ${connection.databaseName || 'database'} as ${connection.databaseUser || 'user'}`);
    console.log('🔧 PostgreSQL ID sequences aligned with the current dataset.');
  } catch (error) {
    console.warn('⚠️ PostgreSQL connection check failed:', error instanceof Error ? error.message : error);
  }
};
