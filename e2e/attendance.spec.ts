import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('staff can clock in and then clock out', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const staffUsername = `attend_staff_${stamp}`;
  const staffPassword = 'Attend123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Attendance Store ${stamp}`, 'SUPERMARKET'],
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

    const clockInResponse = await request.post('/api/attendance/clock-in', {
      headers,
      data: { note: 'Starting afternoon shift' },
    });
    const clockInBody = await clockInResponse.json().catch(() => ({}));
    expect(clockInResponse.ok(), JSON.stringify(clockInBody)).toBeTruthy();
    expect(clockInBody.success).toBeTruthy();
    expect(clockInBody.entry).toBeDefined();
    expect(clockInBody.entry.is_open).toBeTruthy();

    const doubleClockIn = await request.post('/api/attendance/clock-in', { headers });
    expect(doubleClockIn.status()).toBe(400);
    const doubleBody = await doubleClockIn.json().catch(() => ({}));
    expect(String(doubleBody.error || '')).toMatch(/active shift|clock out/i);

    const clockOutResponse = await request.post('/api/attendance/clock-out', {
      headers,
      data: { note: 'End of shift' },
    });
    const clockOutBody = await clockOutResponse.json().catch(() => ({}));
    expect(clockOutResponse.ok(), JSON.stringify(clockOutBody)).toBeTruthy();
    expect(clockOutBody.success).toBeTruthy();
    expect(clockOutBody.entry.is_open).toBeFalsy();

    const getResponse = await request.get('/api/attendance', { headers });
    const getBody = await getResponse.json().catch(() => ({}));
    expect(getResponse.ok(), JSON.stringify(getBody)).toBeTruthy();
    expect(getBody).toHaveProperty('current_session');
    expect(getBody.current_session).toBeNull();
  } finally {
    try { await client.query('DELETE FROM attendance WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('manager can view team attendance including all staff entries', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const managerUsername = `attend_mgr_${stamp}`;
  const staffUsername = `attend_stf_${stamp}`;
  const password = 'View123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Team Attend Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const managerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [managerUsername, bcrypt.hashSync(password, 10), 'MANAGER', storeId],
  );
  const managerId = Number(managerResult.rows[0]?.id || 0);

  const staffResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [staffUsername, bcrypt.hashSync(password, 10), 'STAFF', storeId],
  );
  const staffId = Number(staffResult.rows[0]?.id || 0);

  try {
    const staffLogin = await request.post('/api/auth/login', {
      data: { username: staffUsername, password },
    });
    const staffBody = await staffLogin.json();
    expect(staffLogin.ok()).toBeTruthy();

    await request.post('/api/attendance/clock-in', {
      headers: { Authorization: `Bearer ${staffBody.token}` },
      data: { note: 'Morning shift' },
    });

    const mgrLogin = await request.post('/api/auth/login', {
      data: { username: managerUsername, password },
    });
    const mgrBody = await mgrLogin.json();
    expect(mgrLogin.ok()).toBeTruthy();

    const attendResponse = await request.get('/api/attendance', {
      headers: { Authorization: `Bearer ${mgrBody.token}` },
    });
    const attendBody = await attendResponse.json().catch(() => ({}));
    expect(attendResponse.ok(), JSON.stringify(attendBody)).toBeTruthy();
    expect(attendBody).toHaveProperty('summary');
    expect(Number(attendBody.summary?.open_count || 0)).toBeGreaterThanOrEqual(1);
    const staffEntry = (attendBody.team_entries ?? []).find(
      (e: any) => Number(e?.user_id) === staffId,
    );
    expect(staffEntry).toBeDefined();
  } finally {
    try { await client.query('DELETE FROM attendance WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('clock out without active session returns 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const username = `attend_noshift_${stamp}`;
  const password = 'NoShift123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`No-Shift Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const userResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, bcrypt.hashSync(password, 10), 'STAFF', storeId],
  );
  const userId = Number(userResult.rows[0]?.id || 0);

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username, password },
    });
    const loginBody = await loginResponse.json();
    const headers = { Authorization: `Bearer ${loginBody.token}` };

    const clockOutResponse = await request.post('/api/attendance/clock-out', { headers });
    expect(clockOutResponse.status()).toBe(400);
    const body = await clockOutResponse.json().catch(() => ({}));
    expect(String(body.error || '')).toMatch(/no active shift/i);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});
