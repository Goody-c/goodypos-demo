import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test.describe.configure({ mode: 'serial' });

test('store-owner login is blocked when the account has no store assigned', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const username = `missing_store_${stamp}`;
  const password = 'MissingStore123!';

  const userId = Number(
    db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, NULL)')
      .run(username, bcrypt.hashSync(password, 10), 'STORE_ADMIN').lastInsertRowid,
  );

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username, password },
    });
    const loginBody = await loginResponse.json();

    expect(loginResponse.status(), JSON.stringify(loginBody)).toBe(403);
    expect(String(loginBody?.error || '')).toMatch(/not linked to an active store|assign or recreate/i);
  } finally {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.close();
  }
});

test('auth middleware returns 404 when token user no longer exists', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 1;
  const username = `deleted_user_${stamp}`;
  const password = 'DeletedUser123!';

  const userId = Number(
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), 'SYSTEM_ADMIN').lastInsertRowid,
  );

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username, password },
    });
    const loginBody = await loginResponse.json();

    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const response = await request.get('/api/auth/verify', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = await response.json();

    expect(response.status(), JSON.stringify(body)).toBe(404);
    expect(body.error).toMatch(/user not found/i);
  } finally {
    db.close();
  }
});
