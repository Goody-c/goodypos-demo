import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(
  process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos',
).trim();

test('staff can send an internal message to a manager and read it back', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const managerUsername = `msg_mgr_${stamp}`;
  const staffUsername = `msg_staff_${stamp}`;
  const password = 'Message123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Messaging Store ${stamp}`, 'SUPERMARKET'],
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

  const created = { storeId, managerId, staffId };

  try {
    const staffLogin = await request.post('/api/auth/login', {
      data: { username: staffUsername, password },
    });
    const staffBody = await staffLogin.json();
    expect(staffLogin.ok(), JSON.stringify(staffBody)).toBeTruthy();
    const staffHeaders = { Authorization: `Bearer ${staffBody.token}` };

    const contactsResponse = await request.get('/api/internal-messages/contacts', { headers: staffHeaders });
    const contactsBody = await contactsResponse.json().catch(() => ({}));
    expect(contactsResponse.ok(), JSON.stringify(contactsBody)).toBeTruthy();
    const contactFound = (contactsBody.contacts ?? []).some((c: any) => Number(c?.id) === managerId);
    expect(contactFound).toBeTruthy();

    const sendResponse = await request.post('/api/internal-messages', {
      headers: staffHeaders,
      data: {
        recipient_id: managerId,
        message: 'Stock running low on aisle 3, please reorder.',
      },
    });
    const sendBody = await sendResponse.json().catch(() => ({}));
    expect(sendResponse.ok(), JSON.stringify(sendBody)).toBeTruthy();
    expect(sendBody.success).toBeTruthy();
    expect(sendBody.message?.message_text).toContain('aisle 3');

    const mgrLogin = await request.post('/api/auth/login', {
      data: { username: managerUsername, password },
    });
    const mgrBody = await mgrLogin.json();
    const mgrHeaders = { Authorization: `Bearer ${mgrBody.token}` };

    const convResponse = await request.get(`/api/internal-messages?with_user_id=${staffId}`, {
      headers: mgrHeaders,
    });
    const convBody = await convResponse.json().catch(() => ({}));
    expect(convResponse.ok(), JSON.stringify(convBody)).toBeTruthy();
    expect(Array.isArray(convBody.messages)).toBeTruthy();
    const msgFound = convBody.messages.some((m: any) =>
      String(m?.message_text || '').includes('aisle 3'),
    );
    expect(msgFound).toBeTruthy();
  } finally {
    try { await client.query('DELETE FROM internal_messages WHERE store_id = $1', [storeId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [managerId, staffId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('sending a message to yourself returns 400', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const username = `msg_self_${stamp}`;
  const password = 'Self123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Self-Msg Store ${stamp}`, 'SUPERMARKET'],
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

    const selfResponse = await request.post('/api/internal-messages', {
      headers,
      data: { recipient_id: userId, message: 'Hello myself' },
    });
    expect(selfResponse.status()).toBe(400);
    const selfBody = await selfResponse.json().catch(() => ({}));
    expect(String(selfBody.error || '')).toMatch(/yourself/i);
  } finally {
    try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id = $1', [userId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id = $1', [storeId]); } catch { /* ignore */ }
    await client.end();
  }
});

test('messages are scoped per store and not visible across stores', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const storeAMgr = `store_a_mgr_${stamp}`;
  const storeAStaff = `store_a_stf_${stamp}`;
  const storeBStaff = `store_b_stf_${stamp}`;
  const password = 'Scope123!';

  const storeAResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Store A Msg ${stamp}`, 'SUPERMARKET'],
  );
  const storeAId = Number(storeAResult.rows[0]?.id || 0);

  const storeBResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Store B Msg ${stamp}`, 'SUPERMARKET'],
  );
  const storeBId = Number(storeBResult.rows[0]?.id || 0);

  const mgrResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [storeAMgr, bcrypt.hashSync(password, 10), 'MANAGER', storeAId],
  );
  const mgrId = Number(mgrResult.rows[0]?.id || 0);

  const staffAResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [storeAStaff, bcrypt.hashSync(password, 10), 'STAFF', storeAId],
  );
  const staffAId = Number(staffAResult.rows[0]?.id || 0);

  const staffBResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [storeBStaff, bcrypt.hashSync(password, 10), 'STAFF', storeBId],
  );
  const staffBId = Number(staffBResult.rows[0]?.id || 0);

  try {
    const staffALogin = await request.post('/api/auth/login', { data: { username: storeAStaff, password } });
    const staffABody = await staffALogin.json();
    await request.post('/api/internal-messages', {
      headers: { Authorization: `Bearer ${staffABody.token}` },
      data: { recipient_id: mgrId, message: 'Confidential from Store A' },
    });

    const staffBLogin = await request.post('/api/auth/login', { data: { username: storeBStaff, password } });
    const staffBBody = await staffBLogin.json();
    const contactsResp = await request.get('/api/internal-messages/contacts', {
      headers: { Authorization: `Bearer ${staffBBody.token}` },
    });
    const contactsBody = await contactsResp.json().catch(() => ({}));
    const storeBSeesMgr = (contactsBody.contacts ?? []).some((c: any) => Number(c?.id) === mgrId);
    expect(storeBSeesMgr).toBeFalsy();
  } finally {
    try { await client.query('DELETE FROM internal_messages WHERE store_id IN ($1, $2)', [storeAId, storeBId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2, $3)', [mgrId, staffAId, staffBId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2, $3)', [mgrId, staffAId, staffBId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [mgrId, staffAId, staffBId]); } catch { /* ignore */ }
    try { await client.query('DELETE FROM stores WHERE id IN ($1, $2)', [storeAId, storeBId]); } catch { /* ignore */ }
    await client.end();
  }
});
