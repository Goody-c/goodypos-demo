#!/usr/bin/env node
/**
 * Reset the SYSTEM_ADMIN password directly in the database.
 * Usage: node scripts/reset-admin-password.mjs <new-password>
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const newPassword = process.argv[2];

if (!newPassword) {
  console.error('Usage: node scripts/reset-admin-password.mjs <new-password>');
  process.exit(1);
}

if (newPassword.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, 10);

// Determine provider: postgres if DATABASE_URL / GOODY_POS_POSTGRES_URL is set, else SQLite
const postgresUrl =
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '';

if (postgresUrl) {
  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: postgresUrl });

  try {
    const result = await pool.query(
      `UPDATE users SET password = $1 WHERE role = 'SYSTEM_ADMIN' RETURNING username`,
      [hash]
    );

    if (result.rowCount === 0) {
      console.error('No SYSTEM_ADMIN account found in the database.');
      process.exit(1);
    }

    const username = result.rows[0].username;
    console.log(`✓ Password reset for SYSTEM_ADMIN "${username}" (PostgreSQL).`);
  } finally {
    await pool.end();
  }
} else {
  // ── SQLite (local) ──────────────────────────────────────────────────────────
  const dbPath = path.join(rootDir, 'pos.db');

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    console.error('better-sqlite3 not found. Make sure dependencies are installed.');
    process.exit(1);
  }

  const db = new Database(dbPath);

  try {
    const stmt = db.prepare(
      `UPDATE users SET password = ? WHERE role = 'SYSTEM_ADMIN'`
    );
    const info = stmt.run(hash);

    if (info.changes === 0) {
      console.error('No SYSTEM_ADMIN account found in the database.');
      process.exit(1);
    }

    // Fetch the username for confirmation
    const row = db.prepare(`SELECT username FROM users WHERE role = 'SYSTEM_ADMIN'`).get();
    console.log(`✓ Password reset for SYSTEM_ADMIN "${row?.username}" (SQLite: ${dbPath}).`);
  } finally {
    db.close();
  }
}
