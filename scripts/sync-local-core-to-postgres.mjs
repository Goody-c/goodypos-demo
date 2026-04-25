#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import Database from '../localDataStore.mjs';
import { Client } from 'pg';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, '..');
const configuredDataDir = String(process.env.GOODY_POS_DATA_DIR || '').trim();
const localStorePath = path.join(configuredDataDir ? path.resolve(configuredDataDir) : repoRootDir, 'pos.db');
const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
const sslEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.GOODY_POS_POSTGRES_SSL || '').trim().toLowerCase());

const tables = [
  'stores',
  'users',
  'active_holds',
  'categories',
  'products',
  'customers',
  'sales',
  'sale_items',
  'sales_returns',
  'stock_adjustments',
  'expenses',
  'system_activity_logs',
  'system_logs',
  'transaction_flags',
  'suppliers',
  'purchase_orders',
  'inventory_batches',
  'pro_formas',
  'internal_messages',
  'handover_notes',
  'staff_attendance',
  'repair_tickets',
  'market_collections',
];

if (!fs.existsSync(localStorePath)) {
  console.error(`❌ Local compatibility data store not found: ${localStorePath}`);
  process.exit(1);
}

if (!connectionString) {
  console.error('❌ Missing GOODY_POS_POSTGRES_URL or DATABASE_URL in your environment.');
  process.exit(1);
}

const localStoreDb = new Database(localStorePath, { readonly: true, fileMustExist: true });
const client = new Client({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

try {
  await client.connect();

  for (const table of tables) {
    const rows = localStoreDb.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      console.log(`ℹ️ ${table}: no rows to sync`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const columnList = columns.map(quoteIdentifier).join(', ');
    const updateColumns = columns.filter((column) => column !== 'id');
    const updateList = updateColumns.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ');

    await client.query('BEGIN');
    try {
      for (const row of rows) {
        const values = columns.map((column) => row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        const query = `
          INSERT INTO ${quoteIdentifier(table)} (${columnList})
          VALUES (${placeholders})
          ON CONFLICT (id) DO UPDATE SET ${updateList}
        `;
        await client.query(query, values);
      }

      await client.query('COMMIT');
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 1),
          true
        )
      `).catch(() => undefined);
      console.log(`✅ ${table}: synced ${rows.length} row(s)`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${table}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n✅ Local core data synced to PostgreSQL successfully');
} catch (error) {
  console.error('❌ Core sync failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    localStoreDb.close();
  } catch {
    // ignore
  }
  await client.end().catch(() => undefined);
}
