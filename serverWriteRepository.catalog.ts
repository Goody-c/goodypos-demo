import type { Pool } from 'pg';

type CreateCategoryInput = {
  storeId: number;
  name: string;
  description?: string | null;
};

type UpdateCategoryInput = {
  storeId: number;
  categoryId: number;
  name: string;
  description?: string | null;
};

type DeleteCategoryInput = {
  categoryId: number;
  storeId: number;
};

type RestoreDeletedProductInput = {
  productId: number;
};

type CreateActiveHoldInput = {
  storeId: number;
  userId: number;
  staffName: string;
  customerName?: string | null;
  note?: string | null;
  cartData: unknown;
};

type DeleteActiveHoldInput = {
  holdId: number;
  storeId: number;
};

type ClearActiveHoldsInput = {
  storeId?: number | null;
};

export const createCatalogWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createCategory(input: CreateCategoryInput) {
    const result = await postgresPool.query(`
      INSERT INTO categories (store_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [input.storeId, input.name, input.description || null]);
    return result.rows[0] || null;
  },

  async updateCategory(input: UpdateCategoryInput) {
    const result = await postgresPool.query(`
      UPDATE categories
      SET name = $1, description = $2
      WHERE id = $3 AND store_id = $4
      RETURNING *
    `, [input.name, input.description || null, input.categoryId, input.storeId]);
    return result.rows[0] || null;
  },

  async deleteCategory(input: DeleteCategoryInput) {
    const usageResult = await postgresPool.query(
      'SELECT COUNT(*)::int AS count FROM products WHERE store_id = $1 AND category_id = $2 AND deleted_at IS NULL',
      [input.storeId, input.categoryId],
    );
    const usageCount = Number(usageResult.rows[0]?.count || 0);
    if (usageCount > 0) {
      throw new Error(`This category is still assigned to ${usageCount} product${usageCount === 1 ? '' : 's'}. Move those products first, then retry.`);
    }

    await postgresPool.query('DELETE FROM categories WHERE id = $1 AND store_id = $2', [input.categoryId, input.storeId]);
    return input.categoryId;
  },

  async restoreDeletedProduct(input: RestoreDeletedProductInput) {
    const result = await postgresPool.query('UPDATE products SET deleted_at = NULL WHERE id = $1 RETURNING *', [input.productId]);
    return result.rows[0] || null;
  },

  async createActiveHold(input: CreateActiveHoldInput) {
    const result = await postgresPool.query(`
      INSERT INTO active_holds (store_id, user_id, staff_name, customer_name, note, cart_data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      input.storeId,
      input.userId,
      input.staffName,
      input.customerName || null,
      input.note || null,
      JSON.stringify(input.cartData),
    ]);
    return result.rows[0] || null;
  },

  async deleteActiveHold(input: DeleteActiveHoldInput) {
    await postgresPool.query('DELETE FROM active_holds WHERE id = $1 AND store_id = $2', [input.holdId, input.storeId]);
    return input.holdId;
  },

  async clearActiveHolds(input: ClearActiveHoldsInput = {}) {
    if (input.storeId != null && Number.isInteger(Number(input.storeId)) && Number(input.storeId) > 0) {
      await postgresPool.query('DELETE FROM active_holds WHERE store_id = $1', [Number(input.storeId)]);
    } else {
      await postgresPool.query('DELETE FROM active_holds');
    }
    return input.storeId ?? null;
  },
});
