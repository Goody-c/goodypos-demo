import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos').trim();

test.describe.configure({ mode: 'serial' });

test('store handover notes stay scoped to the current store', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const primaryStoreName = `Handover Store ${stamp}`;
  const secondaryStoreName = `Other Handover Store ${stamp}`;
  const primaryUsername = `handover_admin_${stamp}`;
  const secondaryUsername = `handover_other_${stamp}`;
  const password = 'Handover123!';

  const primaryStoreResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [primaryStoreName, 'SUPERMARKET'],
  );
  const primaryStoreId = Number(primaryStoreResult.rows[0]?.id || 0);

  const secondaryStoreResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [secondaryStoreName, 'SUPERMARKET'],
  );
  const secondaryStoreId = Number(secondaryStoreResult.rows[0]?.id || 0);

  const primaryUserResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [primaryUsername, bcrypt.hashSync(password, 10), 'STORE_ADMIN', primaryStoreId],
  );
  const primaryUserId = Number(primaryUserResult.rows[0]?.id || 0);

  const secondaryUserResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [secondaryUsername, bcrypt.hashSync(password, 10), 'STORE_ADMIN', secondaryStoreId],
  );
  const secondaryUserId = Number(secondaryUserResult.rows[0]?.id || 0);

  const created = { primaryStoreId, secondaryStoreId, primaryUserId, secondaryUserId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: primaryUsername, password },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const createResponse = await request.post('/api/handover-notes', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: { note: 'Cash counted and receipt paper replaced.' },
    });
    const createBody = await createResponse.json();
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.note?.note_text).toContain('Cash counted');

    const listResponse = await request.get('/api/handover-notes', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const listBody = await listResponse.json();
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    expect(Array.isArray(listBody.notes)).toBe(true);
    expect(listBody.notes.some((entry: any) => String(entry.note_text).includes('Cash counted'))).toBe(true);

    const otherLoginResponse = await request.post('/api/auth/login', {
      data: { username: secondaryUsername, password },
    });
    const otherLoginBody = await otherLoginResponse.json();
    expect(otherLoginResponse.ok(), JSON.stringify(otherLoginBody)).toBeTruthy();

    const otherListResponse = await request.get('/api/handover-notes', {
      headers: { Authorization: `Bearer ${otherLoginBody.token}` },
    });
    const otherListBody = await otherListResponse.json();
    expect(otherListResponse.ok(), JSON.stringify(otherListBody)).toBeTruthy();
    expect(Array.isArray(otherListBody.notes)).toBe(true);
    expect(otherListBody.notes.some((entry: any) => String(entry.note_text).includes('Cash counted'))).toBe(false);
  } finally {
    try { await client.query('DELETE FROM handover_notes WHERE store_id IN ($1, $2)', [created.primaryStoreId, created.secondaryStoreId]); } catch {}
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [created.primaryUserId, created.secondaryUserId]); } catch {}
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [created.primaryUserId, created.secondaryUserId]); } catch {}
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [created.primaryUserId, created.secondaryUserId]); } catch {}
    try { await client.query('DELETE FROM stores WHERE id IN ($1, $2)', [created.primaryStoreId, created.secondaryStoreId]); } catch {}
    await client.end();
  }
});
