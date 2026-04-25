import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can create a product and retrieve it from the catalog', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `prod_owner_${stamp}`;
  const ownerPassword = 'Product123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Products Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const created = { storeId, ownerId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const createResponse = await request.post('/api/products', {
      headers,
      data: {
        name: `Test Widget ${stamp}`,
        barcode: `BC${stamp}`,
        quick_code: `QC${String(stamp).slice(-4)}`,
        price: 5000,
        cost: 3000,
        stock: 20,
        category: 'Electronics',
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    // The create response returns { id, quick_code, barcode } — name is validated below via list

    const productId = Number(createBody.id);
    expect(productId).toBeGreaterThan(0);

    const listResponse = await request.get('/api/products', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const found = (Array.isArray(listBody) ? listBody : listBody?.products ?? []).find(
      (p: any) => Number(p?.id) === productId,
    );
    expect(found).toBeDefined();
    expect(found?.name).toBe(`Test Widget ${stamp}`);
    expect(Number(found?.price)).toBe(5000);
  } finally {
    try { await client.query('DELETE FROM products WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can submit and approve a stock adjustment', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `stock_owner_${stamp}`;
  const ownerPassword = 'Stock123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Stock Adj Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  // PROCUREMENT_OFFICER submits count — this stays PENDING until owner approves
  const staffUsername = `stock_staff_${stamp}`;
  const staffPassword = 'Staff123!';
  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [staffUsername, bcrypt.hashSync(staffPassword, 10), 'PROCUREMENT_OFFICER', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  const productResult = await client.query(
    'INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [storeId, `Adj Product ${stamp}`, `ADJ${stamp}`, `AD${String(stamp).slice(-4)}`, 3000, 10, 1500],
  );
  const productId = Number(productResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, staffId, productId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const headers = { Authorization: `Bearer ${loginBody.token}` };

    // Staff submits the count adjustment (stays PENDING for STAFF)
    const staffLogin = await request.post('/api/auth/login', { data: { username: `stock_staff_${stamp}`, password: 'Staff123!' } });
    const staffBody = await staffLogin.json();
    const staffHeaders = { Authorization: `Bearer ${staffBody.token}` };

    const adjResponse = await request.post('/api/stock-adjustments', {
      headers: staffHeaders,
      data: {
        product_id: productId,
        adjustment_type: 'COUNT',
        adjustment_mode: 'SET',
        quantity: 15,
        note: 'Physical count in warehouse',
      },
    });
    const adjBody = await adjResponse.json().catch(() => ({}));
    expect(adjResponse.ok(), JSON.stringify(adjBody)).toBeTruthy();

    const adjId = Number(adjBody.adjustment?.id || 0);
    expect(adjId).toBeGreaterThan(0);

    // Owner approves the pending count
    const approveResponse = await request.post(`/api/stock-adjustments/${adjId}/approve`, { headers });
    const approveBody = await approveResponse.json().catch(() => ({}));
    expect(approveResponse.ok(), JSON.stringify(approveBody)).toBeTruthy();

    const listResponse = await request.get('/api/stock-adjustments', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const adjustments = Array.isArray(listBody)
      ? listBody
      : (listBody?.adjustments ?? []);
    const found = adjustments.find((a: any) => Number(a?.id) === adjId);
    expect(found).toBeDefined();
    expect(String(found?.recount_status || found?.status || '').toUpperCase()).toContain('APPROV');
  } finally {
    try { await client.query('DELETE FROM stock_adjustments WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [ownerId, created.staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [ownerId, created.staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, created.staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can search for products via POS search endpoint', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const ownerUsername = `pos_srch_${stamp}`;
  const ownerPassword = 'Search123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Search Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const productResult = await client.query(
    'INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [storeId, `Searchable Gadget ${stamp}`, `SG${stamp}`, `SG${String(stamp).slice(-4)}`, 7500, 5, 4000],
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

    const searchResponse = await request.get(`/api/pos/search-items?q=Searchable+Gadget+${stamp}`, { headers });
    const searchBody = await searchResponse.json().catch(() => ([]));
    expect(searchResponse.ok(), JSON.stringify(searchBody)).toBeTruthy();
    const results = Array.isArray(searchBody) ? searchBody : (searchBody?.items ?? []);
    const found = results.find((p: any) => Number(p?.id) === productId);
    expect(found).toBeDefined();
  } finally {
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can reject a pending stock adjustment', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 3;
  const ownerUsername = `rej_stock_${stamp}`;
  const ownerPassword = 'Reject123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Reject Adj Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  // PROCUREMENT_OFFICER submits count for reject test — stays PENDING for non-admin
  const rejStaffUsername = `rej_staff_${stamp}`;
  const rejStaffPassword = 'Staff123!';
  const rejStaffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [rejStaffUsername, bcrypt.hashSync(rejStaffPassword, 10), 'PROCUREMENT_OFFICER', storeId],
  );
  const rejStaffId = Number(rejStaffResult.rows[0]?.id || 0);

  const productResult = await client.query(
    'INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [storeId, `Reject Item ${stamp}`, `RJ${stamp}`, `RJ${String(stamp).slice(-4)}`, 2000, 8, 1000],
  );
  const productId = Number(productResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, rejStaffId, productId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    // Staff submits count
    const staffLogin = await request.post('/api/auth/login', { data: { username: rejStaffUsername, password: rejStaffPassword } });
    const staffBody = await staffLogin.json();
    const staffHeaders = { Authorization: `Bearer ${staffBody.token}` };

    const adjResponse = await request.post('/api/stock-adjustments', {
      headers: staffHeaders,
      data: {
        product_id: productId,
        adjustment_type: 'COUNT',
        adjustment_mode: 'SET',
        quantity: 6,
        note: 'Damaged items stock recount',
      },
    });
    const adjBody = await adjResponse.json().catch(() => ({}));
    expect(adjResponse.ok(), JSON.stringify(adjBody)).toBeTruthy();

    const adjId = Number(adjBody.adjustment?.id || 0);
    expect(adjId).toBeGreaterThan(0);

    const rejectResponse = await request.post(`/api/stock-adjustments/${adjId}/reject`, { headers });
    const rejectBody = await rejectResponse.json().catch(() => ({}));
    expect(rejectResponse.ok(), JSON.stringify(rejectBody)).toBeTruthy();

    const listResponse = await request.get('/api/stock-adjustments', { headers });
    const listBody = await listResponse.json().catch(() => ([]));
    const adjustments = Array.isArray(listBody) ? listBody : (listBody?.adjustments ?? []);
    const found = adjustments.find((a: any) => Number(a?.id) === adjId);
    expect(found).toBeDefined();
    expect(String(found?.recount_status || found?.status || '').toUpperCase()).toContain('REJECT');
  } finally {
    try { await client.query('DELETE FROM stock_adjustments WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM products WHERE id = $1', [created.productId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [ownerId, rejStaffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [ownerId, rejStaffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, rejStaffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
