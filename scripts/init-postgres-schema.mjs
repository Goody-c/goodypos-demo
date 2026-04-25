#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Client } from 'pg';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, '..');
const schemaPath = path.join(repoRootDir, 'database', 'postgres', 'core-schema.sql');
const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
const sslEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.GOODY_POS_POSTGRES_SSL || '').trim().toLowerCase());

if (!connectionString) {
  console.error('❌ Missing GOODY_POS_POSTGRES_URL or DATABASE_URL in your environment.');
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) {
  console.error(`❌ Schema file not found: ${schemaPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(schemaPath, 'utf8');
const client = new Client({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query(sql);
  console.log('✅ PostgreSQL core schema initialized successfully');
  console.log(`Schema file: ${schemaPath}`);
} catch (error) {
  console.error('❌ PostgreSQL schema initialization failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
