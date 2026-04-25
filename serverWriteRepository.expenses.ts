import type { Pool } from 'pg';

type CreateExpenseInput = {
  storeId: number;
  title: string;
  category: string;
  amount: number;
  note?: string | null;
  spentAt: string;
  createdBy?: number | null;
};

type DeleteExpenseInput = {
  expenseId: number;
  storeId: number;
};

type DeleteProFormaInput = {
  proFormaId: number;
  storeId: number;
};

type ClearExpiredProformasInput = {
  storeId: number;
};

type ClearOldActivityLogsInput = {
  storeId: number;
};

export const createExpensesWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createExpense(input: CreateExpenseInput) {
    const result = await postgresPool.query(`
      INSERT INTO expenses (store_id, title, category, amount, note, spent_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      input.storeId,
      input.title,
      input.category,
      input.amount,
      input.note || null,
      input.spentAt,
      input.createdBy ?? null,
    ]);
    return result.rows[0] || null;
  },

  async deleteExpense(input: DeleteExpenseInput) {
    const existing = await postgresPool.query('SELECT * FROM expenses WHERE id = $1 AND store_id = $2 LIMIT 1', [input.expenseId, input.storeId]);
    const existingExpense = existing.rows[0] || null;
    const result = await postgresPool.query('DELETE FROM expenses WHERE id = $1 AND store_id = $2', [input.expenseId, input.storeId]);
    return {
      changes: Number(result.rowCount || 0),
      expense: existingExpense,
    };
  },

  async deleteProForma(input: DeleteProFormaInput) {
    const existing = await postgresPool.query('SELECT * FROM pro_formas WHERE id = $1 AND store_id = $2 LIMIT 1', [input.proFormaId, input.storeId]);
    const existingProForma = existing.rows[0] || null;
    const result = await postgresPool.query('DELETE FROM pro_formas WHERE id = $1 AND store_id = $2', [input.proFormaId, input.storeId]);
    return {
      changes: Number(result.rowCount || 0),
      proForma: existingProForma,
    };
  },

  async clearExpiredProformas(input: ClearExpiredProformasInput) {
    const result = await postgresPool.query(`
      DELETE FROM pro_formas
      WHERE store_id = $1
        AND DATE(COALESCE(expiry_date, created_at)) < CURRENT_DATE - INTERVAL '30 day'
    `, [input.storeId]);
    return Number(result.rowCount || 0);
  },

  async clearOldActivityLogs(input: ClearOldActivityLogsInput) {
    const result = await postgresPool.query(`
      DELETE FROM system_activity_logs
      WHERE store_id = $1
        AND created_at < NOW() - INTERVAL '6 months'
    `, [input.storeId]);
    return Number(result.rowCount || 0);
  },
});
