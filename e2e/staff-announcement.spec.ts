import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos').trim();

test('store owner can post a staff announcement that shows on login and dashboard', async ({ request, page }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerPassword = 'Owner123!';
  const staffPassword = 'Staff123!';
  const message = 'Transfer customers must wait for confirmation';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Announcement Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [`announce_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [`announce_staff_${stamp}`, bcrypt.hashSync(staffPassword, 10), 'STAFF', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, staffId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `announce_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/staff announcement banner/i)).toBeVisible();
    await page.getByLabel(/staff announcement note/i).fill(message);
    await page.getByRole('button', { name: /post announcement/i }).click();

    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/login$/, { timeout: 10000 });

    await page.getByLabel(/username/i).fill(`announce_staff_${stamp}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(message)).toBeVisible();
    await page.getByRole('button', { name: /close announcement/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByLabel(/password/i).fill(staffPassword);
    await page.getByRole('button', { name: /access terminal/i }).click();

    await expect(page.getByText(message).first()).toBeVisible();
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [created.ownerId, created.staffId]); } catch {}
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [created.ownerId, created.staffId]); } catch {}
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [created.ownerId, created.staffId]); } catch {}
    try { await client.query('DELETE FROM stores WHERE id = $1', [created.storeId]); } catch {}
    await client.end();
  }
});
