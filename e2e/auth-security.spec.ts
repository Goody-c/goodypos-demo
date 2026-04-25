import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('login page loads and shows access terminal button', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /access terminal/i })).toBeVisible();
});

test('invalid credentials return 401', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    data: { username: 'ghost_user_nonexistent', password: 'WrongPass999!' },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(401);
  const body = await response.json().catch(() => ({}));
  expect(body.error || body.message).toBeTruthy();
});

test('missing token on protected endpoint returns 401', async ({ request }) => {
  const response = await request.get('/api/products', { failOnStatusCode: false });
  expect(response.status()).toBe(401);
});

test('wrong role on restricted endpoint returns 403', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const staffUsername = `auth_staff_${stamp}`;
  const staffPassword = 'AuthStaff123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Auth Security Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [staffUsername, bcrypt.hashSync(staffPassword, 10), 'STAFF', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: staffUsername, password: staffPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const expenseResponse = await request.get('/api/expenses', { headers, failOnStatusCode: false });
    expect(expenseResponse.status()).toBe(403);

    const analyticsResponse = await request.get('/api/vendor-payables', { headers, failOnStatusCode: false });
    expect(analyticsResponse.status()).toBe(403);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('malformed JWT token returns 401', async ({ request }) => {
  const response = await request.get('/api/products', {
    headers: { Authorization: 'Bearer not.a.valid.jwt.token' },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(401);
});

test('empty username and password returns 4xx error', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    data: { username: '', password: '' },
    failOnStatusCode: false,
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
});

test('health check endpoint is publicly accessible', async ({ request }) => {
  const response = await request.get('/api/health', { failOnStatusCode: false });
  expect([200, 204]).toContain(response.status());
});

test('store STAFF cannot access system admin endpoints', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const staffUsername = `sec_staff_${stamp}`;
  const staffPassword = 'SecStaff123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Sec Staff Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [staffUsername, bcrypt.hashSync(staffPassword, 10), 'STAFF', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: staffUsername, password: staffPassword },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const adminResponse = await request.get('/api/admin/stores', { headers, failOnStatusCode: false });
    expect([401, 403]).toContain(adminResponse.status());
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('login UI shows error for bad credentials', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/username/i).fill('definitely_not_a_real_user');
  await page.getByLabel(/password/i).fill('WrongPassword999!');
  await page.getByRole('button', { name: /access terminal/i }).click();
  await expect(
    page.getByText(/invalid|incorrect|not found|wrong|unauthorized/i).first(),
  ).toBeVisible({ timeout: 10000 });
});
