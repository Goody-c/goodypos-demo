import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos').trim();

test('store owner can edit and delete a customer without purchase history', async ({ request }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const ownerUsername = `customer_owner_${stamp}`;
  const ownerPassword = 'Owner123!';
  const managerUsername = `customer_manager_${stamp}`;
  const managerPassword = 'Manager123!';

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Customer Store ${stamp}`, 'SUPERMARKET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  const managerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [managerUsername, bcrypt.hashSync(managerPassword, 10), 'MANAGER', storeId],
  );
  const managerId = Number(managerResult.rows[0]?.id || 0);

  const created = { storeId, ownerId, managerId };

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const headers = {
      Authorization: `Bearer ${loginBody.token}`,
    };

    const createResponse = await request.post('/api/customers', {
      headers,
      data: {
        name: 'Original Customer',
        phone: '+233501234567',
        address: 'Old address',
      },
    });
    const createBody = await createResponse.json();
    expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();
    expect(createBody.phone).toBe('+233501234567');

    const customerId = Number(createBody.id);
    expect(customerId).toBeGreaterThan(0);

    const managerLoginResponse = await request.post('/api/auth/login', {
      data: { username: managerUsername, password: managerPassword },
    });
    const managerLoginBody = await managerLoginResponse.json();
    expect(managerLoginResponse.ok(), JSON.stringify(managerLoginBody)).toBeTruthy();

    const managerHeaders = {
      Authorization: `Bearer ${managerLoginBody.token}`,
    };

    const updateResponse = await request.put(`/api/customers/${customerId}`, {
      headers: managerHeaders,
      data: {
        name: 'Updated Customer',
        phone: '+233509876543',
        address: 'New address',
      },
    });
    const updateBody = await updateResponse.json().catch(() => ({}));
    expect(updateResponse.ok(), JSON.stringify(updateBody)).toBeTruthy();
    expect(updateBody).toMatchObject({
      id: customerId,
      name: 'Updated Customer',
      phone: '+233509876543',
      address: 'New address',
    });

    const forbiddenDeleteResponse = await request.delete(`/api/customers/${customerId}`, { headers: managerHeaders });
    const forbiddenDeleteBody = await forbiddenDeleteResponse.json().catch(() => ({}));
    expect(forbiddenDeleteResponse.status(), JSON.stringify(forbiddenDeleteBody)).toBe(403);

    const statsResponse = await request.get('/api/customers/stats', { headers });
    const statsBody = await statsResponse.json();
    expect(statsResponse.ok(), JSON.stringify(statsBody)).toBeTruthy();
    const savedCustomer = (Array.isArray(statsBody) ? statsBody : []).find((entry: any) => Number(entry?.id) === customerId);
    expect(savedCustomer).toMatchObject({
      name: 'Updated Customer',
      phone: '+233509876543',
      address: 'New address',
    });

    const deleteResponse = await request.delete(`/api/customers/${customerId}`, { headers });
    const deleteBody = await deleteResponse.json().catch(() => ({}));
    expect(deleteResponse.ok(), JSON.stringify(deleteBody)).toBeTruthy();
    expect(deleteBody.success).toBeTruthy();

    const afterDeleteResponse = await request.get('/api/customers/stats', { headers });
    const afterDeleteBody = await afterDeleteResponse.json();
    expect(afterDeleteResponse.ok(), JSON.stringify(afterDeleteBody)).toBeTruthy();
    expect((Array.isArray(afterDeleteBody) ? afterDeleteBody : []).some((entry: any) => Number(entry?.id) === customerId)).toBeFalsy();
  } finally {
    try { await client.query('DELETE FROM customers WHERE store_id = $1', [created.storeId]); } catch {}
    try { await client.query('DELETE FROM users_role_upgrade WHERE id IN ($1, $2)', [created.ownerId, created.managerId]); } catch {}
    try { await client.query('DELETE FROM users_legacy_roles WHERE id IN ($1, $2)', [created.ownerId, created.managerId]); } catch {}
    try { await client.query('DELETE FROM users WHERE id IN ($1, $2)', [created.ownerId, created.managerId]); } catch {}
    try { await client.query('DELETE FROM stores WHERE id = $1', [created.storeId]); } catch {}
    await client.end();
  }
});
