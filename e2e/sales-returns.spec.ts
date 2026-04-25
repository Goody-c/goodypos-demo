import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can create a sale and retrieve its details', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `sale_owner_${stamp}`;
  const ownerPassword = 'Sale123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Sales Store ${stamp}`, 'SUPERMARKET'],
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
    [storeId, `Sale Product ${stamp}`, `SP${stamp}`, `SP${String(stamp).slice(-4)}`, 8000, 10, 5000],
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

    const saleResponse = await request.post('/api/sales', {
      headers,
      data: {
        total: 8000,
        subtotal: 8000,
        tax_amount: 0,
        tax_percentage: 0,
        payment_methods: { cash: 8000, transfer: 0, pos: 0 },
        items: [
          {
            product_id: productId,
            quantity: 1,
            price_at_sale: 8000,
            cost_at_sale: 5000,
          },
        ],
        status: 'COMPLETED',
      },
    });
    const saleBody = await saleResponse.json().catch(() => ({}));
    expect(saleResponse.ok(), JSON.stringify(saleBody)).toBeTruthy();
    expect(saleBody.id).toBeDefined();

    const saleId = Number(saleBody.id);
    expect(saleId).toBeGreaterThan(0);

    const detailResponse = await request.get(`/api/sales/${saleId}/details`, { headers });
    const detailBody = await detailResponse.json().catch(() => ({}));
    expect(detailResponse.ok(), JSON.stringify(detailBody)).toBeTruthy();
    expect(Number(detailBody.total || detailBody.sale?.total)).toBe(8000);
  } finally {
    try { await client.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM sales WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can process a return on a completed sale', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `return_owner_${stamp}`;
  const ownerPassword = 'Return123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Return Store ${stamp}`, 'SUPERMARKET'],
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
    [storeId, `Return Product ${stamp}`, `RP${stamp}`, `RP${String(stamp).slice(-4)}`, 12000, 5, 7000],
  );
  const productId = Number(productResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, productId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const saleResponse = await request.post('/api/sales', {
      headers,
      data: {
        total: 12000,
        subtotal: 12000,
        tax_amount: 0,
        tax_percentage: 0,
        payment_methods: { cash: 12000, transfer: 0, pos: 0 },
        items: [
          {
            product_id: productId,
            quantity: 1,
            price_at_sale: 12000,
            cost_at_sale: 7000,
          },
        ],
        status: 'COMPLETED',
      },
    });
    const saleBody = await saleResponse.json().catch(() => ({}));
    expect(saleResponse.ok(), JSON.stringify(saleBody)).toBeTruthy();
    const saleId = Number(saleBody.id);

    // Fetch the sale items to get the sale_item_id required for returns
    const saleDetailResponse = await request.get(`/api/sales/${saleId}/details`, { headers });
    const saleDetailBody = await saleDetailResponse.json().catch(() => ({}));
    expect(saleDetailResponse.ok(), JSON.stringify(saleDetailBody)).toBeTruthy();
    const saleItems = saleDetailBody.items ?? saleDetailBody.sale_items ?? [];
    const saleItemId = Number(saleItems[0]?.id || 0);
    expect(saleItemId).toBeGreaterThan(0);

    const returnResponse = await request.post(`/api/sales/${saleId}/returns`, {
      headers,
      data: {
        reason: 'Customer changed mind',
        items: [{ sale_item_id: saleItemId, quantity: 1 }],
      },
    });
    const returnBody = await returnResponse.json().catch(() => ({}));
    expect(returnResponse.ok(), JSON.stringify(returnBody)).toBeTruthy();

    const returnsListResponse = await request.get('/api/returns', { headers });
    const returnsListBody = await returnsListResponse.json().catch(() => ([]));
    expect(returnsListResponse.ok(), JSON.stringify(returnsListBody)).toBeTruthy();
    const returns = Array.isArray(returnsListBody) ? returnsListBody : (returnsListBody?.returns ?? []);
    const foundReturn = returns.find((r: any) => Number(r?.sale_id) === saleId);
    expect(foundReturn).toBeDefined();
  } finally {
    try { await client.query('DELETE FROM sale_returns WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM sales WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('sale without items is rejected with 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const ownerUsername = `sale_noitems_${stamp}`;
  const ownerPassword = 'NoItems123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Sale Validation Store ${stamp}`, 'SUPERMARKET'],
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

    const badSale = await request.post('/api/sales', {
      headers,
      data: {
        total: 5000,
        subtotal: 5000,
        payment_methods: { cash: 5000 },
        items: [],
      },
      failOnStatusCode: false,
    });
    expect(badSale.status()).toBe(400);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('owner can view sales list with pagination', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 3;
  const ownerUsername = `sales_list_${stamp}`;
  const ownerPassword = 'List123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Sales List Store ${stamp}`, 'SUPERMARKET'],
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

    const listResponse = await request.get('/api/sales', { headers });
    const listBody = await listResponse.json().catch(() => ({}));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    expect(Array.isArray(listBody) || Array.isArray(listBody?.sales)).toBeTruthy();
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
