import type { Pool, PoolClient } from 'pg';

type CreateCustomerInput = {
  storeId: number;
  name: string;
  phone: string;
  address?: string | null;
  customerCode: string;
};

type UpdateCustomerInput = {
  storeId: number;
  customerId: number;
  name: string;
  phone: string;
  address?: string | null;
};

type DeleteCustomerInput = {
  storeId: number;
  customerId: number;
};

type SqlQueryClient = Pick<PoolClient, 'query'>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && 'code' in error && (error as any).code === '23505';

const withPostgresTransaction = async <T = void>(pool: Pool, operation: (client: PoolClient) => Promise<T>, maxRetries = 3): Promise<T> => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      attempt += 1;
      if (isUniqueViolation(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};

const normalizePhone = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const getSingleQueryRow = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return (result.rows[0] ?? null) as T | null;
};

export const createCustomersWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createCustomer(input: CreateCustomerInput) {
    const createdAt = new Date().toISOString();


    let createdCustomer: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const duplicateCustomer = await getSingleQueryRow<any>(
        client,
        `SELECT id FROM customers
         WHERE store_id = $1
           AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
         LIMIT 1`,
        [input.storeId, normalizePhone(input.phone)],
      );

      if (duplicateCustomer) {
        throw new Error('A customer with this phone number already exists');
      }

      const result = await client.query(`
        INSERT INTO customers (store_id, name, phone, address, customer_code, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        input.storeId,
        input.name,
        input.phone,
        input.address || null,
        input.customerCode,
        createdAt,
      ]);

      createdCustomer = result.rows[0] || null;
    });

    return createdCustomer || {
      store_id: input.storeId,
      name: input.name,
      phone: input.phone,
      address: input.address || null,
      customer_code: input.customerCode,
      created_at: createdAt,
    };

  },

  async updateCustomer(input: UpdateCustomerInput) {

    let updatedCustomer: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const existingCustomer = await getSingleQueryRow<any>(
        client,
        'SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1',
        [input.customerId, input.storeId],
      );

      if (!existingCustomer) {
        throw new Error('Customer not found');
      }

      const duplicateCustomer = await getSingleQueryRow<any>(
        client,
        `SELECT id FROM customers
         WHERE store_id = $1
           AND id <> $2
           AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $3
         LIMIT 1`,
        [input.storeId, input.customerId, normalizePhone(input.phone)],
      );

      if (duplicateCustomer) {
        throw new Error('A customer with this phone number already exists');
      }

      const result = await client.query(`
        UPDATE customers
        SET name = $1, phone = $2, address = $3
        WHERE id = $4 AND store_id = $5
        RETURNING *
      `, [
        input.name,
        input.phone,
        input.address || null,
        input.customerId,
        input.storeId,
      ]);

      updatedCustomer = result.rows[0] || existingCustomer;
    });

    return updatedCustomer;

  },

  async deleteCustomer(input: DeleteCustomerInput) {

    await withPostgresTransaction(postgresPool, async (client) => {
      const existingCustomer = await getSingleQueryRow<any>(
        client,
        'SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1',
        [input.customerId, input.storeId],
      );

      if (!existingCustomer) {
        throw new Error('Customer not found');
      }

      const outstandingRow = await getSingleQueryRow<any>(client, `
        SELECT COALESCE(SUM(GREATEST(0, total - COALESCE(amount_paid, total))), 0)::numeric as outstanding
        FROM sales
        WHERE store_id = $1 AND customer_id = $2 AND status IN ('PENDING', 'LAYAWAY', 'INSTALLMENT')
      `, [input.storeId, input.customerId]);

      if (Number(outstandingRow?.outstanding || 0) > 0) {
        throw new Error('This customer has an outstanding balance and cannot be deleted.');
      }

      await client.query('UPDATE pro_formas SET customer_id = NULL WHERE store_id = $1 AND customer_id = $2', [input.storeId, input.customerId]);
      await client.query('DELETE FROM customers WHERE id = $1 AND store_id = $2', [input.customerId, input.storeId]);
    });

    return { success: true, deletedId: input.customerId };

  },
});
