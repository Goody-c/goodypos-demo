import type { Pool, PoolClient } from 'pg';

type UpdateStoreSettingsInput = {
  storeId: number;
  name: string;
  logo?: string | null;
  signatureImage?: string | null;
  address?: string | null;
  phone?: string | null;
  customSpecs: string[];
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  currencyCode: string;
  receiptPaperSize: 'THERMAL' | 'THERMAL_58' | 'A4';
  documentColor: string;
  showStoreNameOnDocuments: number;
  taxEnabled: number;
  taxPercentage: number;
  receiptHeaderNote: string;
  receiptFooterNote: string;
  receiptShowBankDetails: number;
  defaultMissingCostToPrice: number;
  discountCodes: any[];
  staffAnnouncementText: string;
  staffAnnouncementActive: number;
  staffAnnouncementUpdatedAt?: string | null;
  pinCheckoutEnabled: number;
  vendorPortalEnabled: number;
  chatCleanupRemindersEnabled: number;
  chatCleanupReminderDay: number;
  chatRetentionValue: number;
  chatRetentionUnit: string;
  lastChatCleanupAt?: string | null;
};

type DeleteStoreInput = {
  storeId: number;
};

type DeleteUserInput = {
  userId: number;
  actorUserId?: number | null;
};

type SqlQueryClient = Pick<PoolClient, 'query'>;

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
      const isUniqueViolation = error instanceof Error && 'code' in error && (error as any).code === '23505';
      if (isUniqueViolation && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};

const getSingleQueryRow = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return (result.rows[0] ?? null) as T | null;
};

const getQueryRows = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return result.rows as T[];
};

const deleteStoreCascade = async (client: PoolClient, storeId: number) => {
  await client.query('DELETE FROM sales_returns WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]);
  await client.query('DELETE FROM transaction_flags WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]);
  await client.query('DELETE FROM vendor_payables WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]);
  await client.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [storeId]);
  await client.query('DELETE FROM stock_adjustments WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM staff_attendance WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM inventory_batches WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM purchase_orders WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM market_collections WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM repair_tickets WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM expenses WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM pro_formas WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM active_holds WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM system_activity_logs WHERE store_id = $1', [storeId]);
  try {
    await client.query('DELETE FROM system_logs WHERE store_id = $1', [storeId]);
  } catch {
    // Some deployments do not create this table.
  }
  await client.query('DELETE FROM internal_messages WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM handover_notes WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM consignment_vendor_bank_details WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM consignment_items WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM product_change_requests WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM sales WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM products WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM categories WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM customers WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM suppliers WHERE store_id = $1', [storeId]);
  // Null out added_by on consignment_items in OTHER stores that reference this store's users
  // before deleting users, to avoid FK constraint violation on consignment_items_added_by_fkey
  await client.query(
    'UPDATE consignment_items SET added_by = NULL WHERE added_by IN (SELECT id FROM users WHERE store_id = $1)',
    [storeId],
  );
  await client.query('DELETE FROM users WHERE store_id = $1', [storeId]);
  await client.query('DELETE FROM stores WHERE id = $1', [storeId]);
};

export const createSettingsWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async updateStoreSettings(input: UpdateStoreSettingsInput) {
    const result = await postgresPool.query(`
      UPDATE stores SET
        name = $1, logo = $2, signature_image = $3, address = $4, phone = $5,
        custom_specs = $6, bank_name = $7, account_number = $8, account_name = $9,
        currency_code = $10, receipt_paper_size = $11, document_color = $12,
        show_store_name_on_documents = $13, tax_enabled = $14, tax_percentage = $15,
        receipt_header_note = $16, receipt_footer_note = $17, receipt_show_bank_details = $18,
        default_missing_cost_to_price = $19, discount_codes = $20,
        staff_announcement_text = $21, staff_announcement_active = $22,
        staff_announcement_updated_at = $23, pin_checkout_enabled = $24,
        vendor_portal_enabled = $25, chat_cleanup_reminders_enabled = $26, chat_cleanup_reminder_day = $27,
        chat_retention_value = $28, chat_retention_unit = $29, last_chat_cleanup_at = $30
      WHERE id = $31
      RETURNING *
    `, [
      input.name,
      input.logo || null,
      input.signatureImage || null,
      input.address || null,
      input.phone || null,
      JSON.stringify(input.customSpecs),
      input.bankName || null,
      input.accountNumber || null,
      input.accountName || null,
      input.currencyCode,
      input.receiptPaperSize,
      input.documentColor,
      input.showStoreNameOnDocuments,
      input.taxEnabled,
      input.taxPercentage,
      input.receiptHeaderNote,
      input.receiptFooterNote,
      input.receiptShowBankDetails,
      input.defaultMissingCostToPrice,
      JSON.stringify(input.discountCodes),
      input.staffAnnouncementText,
      input.staffAnnouncementActive,
      input.staffAnnouncementUpdatedAt || null,
      input.pinCheckoutEnabled,
      input.vendorPortalEnabled,
      input.chatCleanupRemindersEnabled,
      input.chatCleanupReminderDay,
      input.chatRetentionValue,
      input.chatRetentionUnit,
      input.lastChatCleanupAt || null,
      input.storeId,
    ]);
    return result.rows[0] || null;
  },

  async deleteStore(input: DeleteStoreInput) {
    await withPostgresTransaction(postgresPool, async (client) => {
      await deleteStoreCascade(client, input.storeId);
    });

    return input.storeId;

  },

  async deleteStoreRecord(storeId: number) {
    await withPostgresTransaction(postgresPool, async (client) => {
      await deleteStoreCascade(client, storeId);
    });
    return storeId;
  },

  async deleteUser(input: DeleteUserInput) {
    let deletedUserId: number | null = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const existingUser = await getSingleQueryRow<any>(
        client,
        'SELECT id, store_id, role FROM users WHERE id = $1 LIMIT 1',
        [input.userId],
      );
      if (!existingUser) return;

      const actorUserId = Number(input.actorUserId || 0) > 0 ? Number(input.actorUserId) : null;
      const fallbackCandidates = await getQueryRows<{ id: number }>(
        client,
        `SELECT id, store_id, role
         FROM users
         WHERE id != $1
         ORDER BY
           CASE WHEN id = $2 THEN 0 ELSE 1 END,
           CASE WHEN store_id = $3 THEN 0 ELSE 1 END,
           CASE role
             WHEN 'SYSTEM_ADMIN' THEN 0
             WHEN 'STORE_ADMIN' THEN 1
             WHEN 'MANAGER' THEN 2
             WHEN 'ACCOUNTANT' THEN 3
             WHEN 'PROCUREMENT_OFFICER' THEN 4
             ELSE 5
           END,
           id ASC`,
        [Number(existingUser.id), actorUserId ?? -1, existingUser.store_id ?? -1],
      );
      const fallbackUserId = Number(fallbackCandidates[0]?.id || 0) || null;

      const referenceCounts = await Promise.all([
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM sales WHERE user_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM sales_returns WHERE processed_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM stock_adjustments WHERE adjusted_by = $1 OR approved_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM active_holds WHERE user_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM internal_messages WHERE sender_id = $1 OR recipient_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM handover_notes WHERE author_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM expenses WHERE created_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM system_activity_logs WHERE user_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM transaction_flags WHERE flagged_by = $1 OR resolved_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM purchase_orders WHERE created_by = $1 OR received_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM market_collections WHERE created_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM repair_tickets WHERE created_by = $1 OR updated_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM staff_attendance WHERE user_id = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM consignment_items WHERE added_by = $1 OR approved_by = $1', [Number(existingUser.id)]),
        getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM product_change_requests WHERE requested_by = $1 OR reviewed_by = $1', [Number(existingUser.id)]),
      ]);
      let systemLogsCount = 0;
      try {
        const systemLogsRow = await getSingleQueryRow<{ count: string }>(client, 'SELECT COUNT(*) as count FROM system_logs WHERE user_id = $1', [Number(existingUser.id)]);
        systemLogsCount = Number(systemLogsRow?.count || 0);
      } catch {
        systemLogsCount = 0;
      }

      const totalReferences = referenceCounts.reduce((sum, row) => sum + Number(row?.count || 0), 0) + systemLogsCount;

      if (totalReferences > 0 && !fallbackUserId) {
        throw new Error('This user still owns sales, stock, attendance, messaging, or audit history. Add another admin or staff account first, then retry the deletion.');
      }

      if (fallbackUserId) {
        const fromUserId = Number(existingUser.id);
        await client.query('UPDATE sales SET user_id = $1 WHERE user_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE sales_returns SET processed_by = $1 WHERE processed_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE stock_adjustments SET adjusted_by = $1 WHERE adjusted_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE stock_adjustments SET approved_by = $1 WHERE approved_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE active_holds SET user_id = $1 WHERE user_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE internal_messages SET sender_id = $1 WHERE sender_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE internal_messages SET recipient_id = $1 WHERE recipient_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE handover_notes SET author_id = $1 WHERE author_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE expenses SET created_by = $1 WHERE created_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE system_activity_logs SET user_id = $1 WHERE user_id = $2', [fallbackUserId, fromUserId]);
        try {
          await client.query('UPDATE system_logs SET user_id = $1 WHERE user_id = $2', [fallbackUserId, fromUserId]);
        } catch {
          // Some deployments do not create this table.
        }
        await client.query('UPDATE transaction_flags SET flagged_by = $1 WHERE flagged_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE transaction_flags SET resolved_by = $1 WHERE resolved_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE purchase_orders SET created_by = $1 WHERE created_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE purchase_orders SET received_by = $1 WHERE received_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE market_collections SET created_by = $1 WHERE created_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE repair_tickets SET created_by = $1 WHERE created_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE repair_tickets SET updated_by = $1 WHERE updated_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE staff_attendance SET user_id = $1 WHERE user_id = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE consignment_items SET added_by = $1 WHERE added_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE consignment_items SET approved_by = $1 WHERE approved_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE product_change_requests SET requested_by = $1 WHERE requested_by = $2', [fallbackUserId, fromUserId]);
        await client.query('UPDATE product_change_requests SET reviewed_by = $1 WHERE reviewed_by = $2', [fallbackUserId, fromUserId]);
      }

      await client.query('DELETE FROM users WHERE id = $1', [Number(existingUser.id)]);
      deletedUserId = Number(existingUser.id);
    });

    return deletedUserId;
  },
});
