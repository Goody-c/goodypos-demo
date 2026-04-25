import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('store owner can create and list expenses', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `exp_owner_${stamp}`;
  const ownerPassword = 'Expense123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Expense Store ${stamp}`, 'SUPERMARKET'],
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

    const createResponse = await request.post('/api/expenses', {
      headers,
      data: {
        title: `Office Supplies ${stamp}`,
        category: 'Operations',
        amount: 12000,
        note: 'Bought pens and paper',
        spent_at: new Date().toISOString(),
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.title).toBe(`Office Supplies ${stamp}`);
    expect(Number(createBody.amount)).toBe(12000);

    const expenseId = Number(createBody.id);
    expect(expenseId).toBeGreaterThan(0);

    const listResponse = await request.get('/api/expenses', { headers });
    const listBody = await listResponse.json().catch(() => ({}));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    const expenses = Array.isArray(listBody) ? listBody : (listBody?.expenses ?? []);
    const found = expenses.find((e: any) => Number(e?.id) === expenseId);
    expect(found).toBeDefined();
    expect(found?.title).toBe(`Office Supplies ${stamp}`);
    expect(Number(found?.amount)).toBe(12000);
  } finally {
    try { await client.query('DELETE FROM expenses WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('store owner can delete an expense', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const ownerUsername = `exp_del_${stamp}`;
  const ownerPassword = 'Delete123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Del Expense Store ${stamp}`, 'SUPERMARKET'],
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

    const createResponse = await request.post('/api/expenses', {
      headers,
      data: {
        title: `Temp Expense ${stamp}`,
        category: 'Misc',
        amount: 5000,
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    const expenseId = Number(createBody.id);

    const deleteResponse = await request.delete(`/api/expenses/${expenseId}`, { headers });
    const deleteBody = await deleteResponse.json().catch(() => ({}));
    expect(deleteResponse.ok(), JSON.stringify(deleteBody)).toBeTruthy();

    const listResponse = await request.get('/api/expenses', { headers });
    const listBody = await listResponse.json().catch(() => ({}));
    const expenses = Array.isArray(listBody) ? listBody : (listBody?.expenses ?? []);
    const found = expenses.find((e: any) => Number(e?.id) === expenseId);
    expect(found).toBeUndefined();
  } finally {
    try { await client.query('DELETE FROM expenses WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('accountant can list expenses but STAFF cannot', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const accountantUsername = `exp_acct_${stamp}`;
  const staffUsername = `exp_staff_${stamp}`;
  const password = 'Role123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Role Expense Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [accountantUsername, bcrypt.hashSync(password, 10), 'ACCOUNTANT', storeId],
  );
  const accountantId = Number(ownerResult.rows[0]?.id || 0);

  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [staffUsername, bcrypt.hashSync(password, 10), 'STAFF', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  try {
    const acctLogin = await request.post('/api/auth/login', {
      data: { username: accountantUsername, password },
    });
    const acctBody = await acctLogin.json();
    expect(acctLogin.ok(), JSON.stringify(acctBody)).toBeTruthy();

    const acctResp = await request.get('/api/expenses', {
      headers: { Authorization: `Bearer ${acctBody.token}` },
    });
    expect(acctResp.ok()).toBeTruthy();

    const staffLogin = await request.post('/api/auth/login', {
      data: { username: staffUsername, password },
    });
    const staffBody = await staffLogin.json();
    expect(staffLogin.ok(), JSON.stringify(staffBody)).toBeTruthy();

    const staffResp = await request.get('/api/expenses', {
      headers: { Authorization: `Bearer ${staffBody.token}` },
    });
    expect(staffResp.status()).toBe(403);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [accountantId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [accountantId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [accountantId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('expenses summary includes category breakdown', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 3;
  const ownerUsername = `exp_catg_${stamp}`;
  const ownerPassword = 'Category123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Category Expense Store ${stamp}`, 'SUPERMARKET'],
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

    await request.post('/api/expenses', {
      headers,
      data: { title: `Rent ${stamp}`, category: 'Rent', amount: 50000 },
    });
    await request.post('/api/expenses', {
      headers,
      data: { title: `Utilities ${stamp}`, category: 'Utilities', amount: 8000 },
    });
    await request.post('/api/expenses', {
      headers,
      data: { title: `Cleaning ${stamp}`, category: 'Utilities', amount: 3000 },
    });

    const listResponse = await request.get('/api/expenses', { headers });
    const listBody = await listResponse.json().catch(() => ({}));
    expect(listResponse.ok(), JSON.stringify(listBody)).toBeTruthy();
    expect(listBody).toHaveProperty('summary');
    expect(listBody.summary).toHaveProperty('totalExpenses');
    expect(listBody.summary).toHaveProperty('categoryBreakdown');
    const breakdown = listBody.summary.categoryBreakdown as Array<{ category: string; total: number }>;
    const utilitiesBreakdown = breakdown.find((b) => b.category === 'Utilities');
    expect(utilitiesBreakdown?.total).toBe(11000);
  } finally {
    try { await client.query('DELETE FROM expenses WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [ownerId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
