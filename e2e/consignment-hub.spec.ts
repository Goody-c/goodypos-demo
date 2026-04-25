import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can add a consignment item and list it', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `consign_owner_${stamp}`;
  const ownerPassword = 'Consign123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Consignment Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/consignment-items', {
      headers,
      data: {
        vendor_name: `Vendor ${stamp}`,
        vendor_phone: '08099887711',
        item_name: `iPhone 14 Pro ${stamp}`,
        imei_serial: `IMEI${stamp}`,
        quick_code: `CS${String(stamp).slice(-4)}`,
        quantity: 1,
        agreed_payout: 350000,
        selling_price: 420000,
        internal_condition: 'Good',
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();

    // The API response doesn't include id/item_name due to a known server limitation,
    // so we fetch the created item directly from the database.
    const itemRow = await client.query(
      'SELECT id, item_name FROM consignment_items WHERE store_id = $1 ORDER BY id DESC LIMIT 1',
      [storeId],
    );
    expect(itemRow.rows.length).toBeGreaterThan(0);
    expect(itemRow.rows[0].item_name).toContain(`iPhone 14 Pro ${stamp}`);
    const itemId = Number(itemRow.rows[0].id);

    const listResponse = await request.get('/api/consignment-items', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const items = Array.isArray(listBody) ? listBody : (listBody?.items ?? []);
    const found = items.find((i: any) => Number(i?.id) === itemId);
    expect(found).toBeDefined();
    expect(String(found?.status || '').toUpperCase()).toBe('PENDING');
  } finally {
    try { await client.query('DELETE FROM consignment_items WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can approve a consignment item', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `consign_appr_${stamp}`;
  const ownerPassword = 'Approve123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Consign Approve Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/consignment-items', {
      headers,
      data: {
        vendor_name: `Vendor Approve ${stamp}`,
        item_name: `Samsung S23 ${stamp}`,
        quantity: 1,
        agreed_payout: 200000,
        selling_price: 250000,
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();

    const itemRow = await client.query(
      'SELECT id FROM consignment_items WHERE store_id = $1 ORDER BY id DESC LIMIT 1',
      [storeId],
    );
    expect(itemRow.rows.length).toBeGreaterThan(0);
    const itemId = Number(itemRow.rows[0].id);

    const approveResponse = await request.post(`/api/consignment-items/${itemId}/approve`, { headers });
    const approveBody = await approveResponse.json().catch(() => ({}));
    expect(approveResponse.ok(), JSON.stringify(approveBody)).toBeTruthy();

    const listResponse = await request.get('/api/consignment-items', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    const items = Array.isArray(listBody) ? listBody : (listBody?.items ?? []);
    const found = items.find((i: any) => Number(i?.id) === itemId);
    expect(found).toBeDefined();
    expect(String(found?.status || '').toUpperCase()).toBe('APPROVED');
  } finally {
    try { await client.query('DELETE FROM consignment_items WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can reject a consignment item', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const ownerUsername = `consign_rej_${stamp}`;
  const ownerPassword = 'Reject123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Consign Reject Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/consignment-items', {
      headers,
      data: {
        vendor_name: `Reject Vendor ${stamp}`,
        item_name: `Faulty Laptop ${stamp}`,
        quantity: 1,
        agreed_payout: 50000,
        selling_price: 70000,
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();

    const itemRow = await client.query(
      'SELECT id FROM consignment_items WHERE store_id = $1 ORDER BY id DESC LIMIT 1',
      [storeId],
    );
    expect(itemRow.rows.length).toBeGreaterThan(0);
    const itemId = Number(itemRow.rows[0].id);

    const rejectResponse = await request.post(`/api/consignment-items/${itemId}/reject`, { headers });
    const rejectBody = await rejectResponse.json().catch(() => ({}));
    expect(rejectResponse.ok(), JSON.stringify(rejectBody)).toBeTruthy();

    const listResponse = await request.get('/api/consignment-items', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    const items = Array.isArray(listBody) ? listBody : (listBody?.items ?? []);
    const found = items.find((i: any) => Number(i?.id) === itemId);
    expect(found).toBeDefined();
    expect(String(found?.status || '').toUpperCase()).toBe('REJECTED');
  } finally {
    try { await client.query('DELETE FROM consignment_items WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('adding consignment item without required fields returns 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 3;
  const ownerUsername = `consign_val_${stamp}`;
  const ownerPassword = 'Val123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Consign Val Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const badResponse = await request.post('/api/consignment-items', {
      headers,
      data: { item_name: `Missing Vendor ${stamp}` },
    });
    expect(badResponse.status()).toBe(400);
    const badBody = await badResponse.json().catch(() => ({}));
    expect(String(badBody.error || '')).toMatch(/vendor/i);
  } finally {
    try { await client.query('DELETE FROM consignment_items WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
