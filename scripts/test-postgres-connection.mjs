#!/usr/bin/env node
import 'dotenv/config';
import { Client } from 'pg';

const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
const sslEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.GOODY_POS_POSTGRES_SSL || '').trim().toLowerCase());

if (!connectionString) {
  console.error('❌ Missing GOODY_POS_POSTGRES_URL or DATABASE_URL in your environment.');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           version() AS version
  `);
  const row = result.rows[0] || {};
  console.log('✅ PostgreSQL connection successful');
  console.log(`Database: ${row.database_name || 'unknown'}`);
  console.log(`User: ${row.database_user || 'unknown'}`);
  console.log(`Version: ${String(row.version || 'unknown').split('\n')[0]}`);
} catch (error) {
  console.error('❌ PostgreSQL connection failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
