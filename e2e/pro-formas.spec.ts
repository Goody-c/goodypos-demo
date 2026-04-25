import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can create a pro-forma invoice and list it', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `proforma_owner_${stamp}`;
  const ownerPassword = 'Proforma123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`ProForma Store ${stamp}`, 'SUPERMARKET'],
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

    const createResponse = await request.post('/api/pro-formas', {
      headers,
      data: {
        customer_name: `PF Customer ${stamp}`,
        customer_phone: '08012345678',
        items: [{ name: `Item A ${stamp}`, quantity: 2, price: 5000 }],
        subtotal: 10000,
        total: 10000,
        tax_amount: 0,
        tax_percentage: 0,
        expiry_hours: 48,
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.success).toBeTruthy();

    const proFormaId = Number(createBody.id);
    expect(proFormaId).toBeGreaterThan(0);

    const listResponse = await request.get('/api/pro-formas', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const found = (Array.isArray(listBody) ? listBody : []).find((p: any) => Number(p?.id) === proFormaId);
    expect(found).toBeDefined();
    expect(found?.customer_name).toBe(`PF Customer ${stamp}`);
    expect(Number(found?.total)).toBe(10000);
  } finally {
    try { await client.query('DELETE FROM pro_formas WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can update pro-forma status and then delete it', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `pf_del_${stamp}`;
  const ownerPassword = 'PfDel123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`PF Del Store ${stamp}`, 'SUPERMARKET'],
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

    const createResponse = await request.post('/api/pro-formas', {
      headers,
      data: {
        customer_name: `Status PF ${stamp}`,
        items: [{ name: `Bulk Item ${stamp}`, quantity: 1, price: 20000 }],
        subtotal: 20000,
        total: 20000,
        tax_amount: 0,
        tax_percentage: 0,
        expiry_hours: 24,
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    const proFormaId = Number(createBody.id);

    const statusResponse = await request.put(`/api/pro-formas/${proFormaId}/status`, {
      headers,
      data: { status: 'CONFIRMED' },
    });
    expect(statusResponse.ok(), await statusResponse.text()).toBeTruthy();

    const deleteResponse = await request.delete(`/api/pro-formas/${proFormaId}`, { headers });
    expect(deleteResponse.ok(), await deleteResponse.text()).toBeTruthy();

    const listResponse = await request.get('/api/pro-formas', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    const found = (Array.isArray(listBody) ? listBody : []).find((p: any) => Number(p?.id) === proFormaId);
    expect(found).toBeUndefined();
  } finally {
    try { await client.query('DELETE FROM pro_formas WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('creating pro-forma without required fields returns 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const ownerUsername = `pf_valid_${stamp}`;
  const ownerPassword = 'Validate123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`PF Validate Store ${stamp}`, 'SUPERMARKET'],
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

    const badResponse = await request.post('/api/pro-formas', {
      headers,
      data: { customer_name: 'Ghost Customer' },
    });
    expect(badResponse.status()).toBe(400);
  } finally {
    try { await client.query('DELETE FROM pro_formas WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
