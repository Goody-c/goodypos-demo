import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can create a layaway plan for a customer', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `layaway_owner_${stamp}`;
  const ownerPassword = 'Layaway123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Layaway Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const productResult = await client.query(
    `INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [storeId, `Layaway TV ${stamp}`, `LTV${stamp}`, `LT${String(stamp).slice(-4)}`, 150000, 5, 100000],
  );
  const productId = Number(productResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, productId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/layaways', {
      headers,
      data: {
        customer_name: `Layaway Customer ${stamp}`,
        customer_phone: '08033445566',
        due_date: '2030-06-30',
        sale_channel: 'LAYAWAY',
        installment_count: 3,
        payment_frequency: 'MONTHLY',
        payment_methods: { cash: 30000, transfer: 0, pos: 0 },
        items: [{ product_id: productId, quantity: 1 }],
        note: 'Test layaway plan',
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.success).toBeTruthy();
    expect(createBody.sale).toBeDefined();
    expect(String(createBody.sale?.sale_channel || '').toUpperCase()).toBe('LAYAWAY');

    const saleId = Number(createBody.sale?.id || 0);
    expect(saleId).toBeGreaterThan(0);

    const listResponse = await request.get('/api/layaways', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const layaways = Array.isArray(listBody) ? listBody : (listBody?.plans ?? []);
    const found = layaways.find((l: any) => Number(l?.id) === saleId);
    expect(found).toBeDefined();
  } finally {
    try { await client.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1 AND sale_channel = $2)', [storeId, 'LAYAWAY']); } catch { /* ignore */ }
    try { await client.query('DELETE FROM sales WHERE store_id = $1 AND sale_channel = $2', [storeId, 'LAYAWAY']); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('layaway without items is rejected with 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `layaway_noitems_${stamp}`;
  const ownerPassword = 'NoItems123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Layaway Validation Store ${stamp}`, 'SUPERMARKET'],
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

    const badResponse = await request.post('/api/layaways', {
      headers,
      data: {
        customer_name: `No Items Customer ${stamp}`,
        customer_phone: '08011223344',
        due_date: '2030-01-01',
        sale_channel: 'LAYAWAY',
        items: [],
      },
    });
    expect(badResponse.status()).toBe(400);
    const badBody = await badResponse.json().catch(() => ({}));
    expect(String(badBody.error || '')).toMatch(/item/i);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can create an installment plan with partial payment', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const ownerUsername = `installment_${stamp}`;
  const ownerPassword = 'Install123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Installment Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const productResult = await client.query(
    `INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [storeId, `Instl Fridge ${stamp}`, `IF${stamp}`, `IF${String(stamp).slice(-4)}`, 80000, 3, 50000],
  );
  const productId = Number(productResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, productId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/layaways', {
      headers,
      data: {
        customer_name: `Instl Customer ${stamp}`,
        customer_phone: '08044556677',
        due_date: '2030-12-31',
        sale_channel: 'INSTALLMENT',
        installment_count: 4,
        payment_frequency: 'MONTHLY',
        payment_methods: { cash: 20000, transfer: 0, pos: 0 },
        items: [{ product_id: productId, quantity: 1 }],
        note: 'Installment purchase',
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.success).toBeTruthy();
    expect(String(createBody.sale?.sale_channel || '').toUpperCase()).toBe('INSTALLMENT');
    expect(String(createBody.sale?.status || '').toUpperCase()).toBe('PENDING');
  } finally {
    try { await client.query("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1 AND sale_channel IN ('LAYAWAY','INSTALLMENT'))", [storeId]); } catch { /* ignore */ }
    try { await client.query("DELETE FROM sales WHERE store_id = $1 AND sale_channel IN ('LAYAWAY','INSTALLMENT')", [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
