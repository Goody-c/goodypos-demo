import type { Pool } from 'pg';

type CoreReadRepositoryOptions = {
  postgresPool: Pool;
};

type ProductListOptions = {
  storeId: number;
  search?: string;
  category?: string;
  stockStatus?: string;
  sortBy?: string;
  limit?: number;
  offset?: number;
  paginate?: boolean;
};

type UnifiedPosCatalogOptions = {
  storeId: number;
  search?: string;
  limit?: number;
};

type ConsignmentListOptions = {
  storeId: number;
  search?: string;
  status?: string;
};

type AdminUserListOptions = {
  viewerRole: string;
  viewerStoreId?: number | null;
  requestedStoreId?: number | null;
  limit: number;
  offset: number;
};

type SalesListOptions = {
  storeId: number;
  customerId?: number | null;
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
  paginate?: boolean;
};

type ReturnsListOptions = {
  storeId: number;
  search?: string;
  returnType?: string;
};

type MarketCollectionListOptions = {
  storeId: number;
  status?: string | null;
};

type StockAdjustmentListOptions = {
  storeId: number;
  search?: string;
  typeFilter?: string;
  productIdFilter?: number | null;
};

type DashboardActivityFeedOptions = {
  storeId: number;
  userId: number;
  role: string;
  limit: number;
};

type SystemLogsListOptions = {
  storeId: number;
  staffName?: string;
  actionType?: string;
  todayOnly?: boolean;
  highRiskOnly?: boolean;
  limit?: number;
  offset?: number;
  highRiskActions?: string[];
};

export const createCoreReadRepository = ({ postgresPool }: CoreReadRepositoryOptions) => {
  return {
    async getStoreById(storeId: number) {
      const result = await postgresPool.query('SELECT * FROM stores WHERE id = $1 LIMIT 1', [storeId]);
      return result.rows[0] || null;
    },

    async listCustomers(storeId: number, orderBy: 'name' | 'created_desc' = 'name') {
      const orderClause = orderBy === 'created_desc' ? 'created_at DESC, id DESC' : 'name ASC, id ASC';

      const result = await postgresPool.query(`SELECT * FROM customers WHERE store_id = $1 ORDER BY ${orderClause}`, [storeId]);
      return result.rows as any[];
    },

    async listPendingSales(storeId: number) {
      const result = await postgresPool.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.store_id = $1 AND s.status = 'PENDING' AND s.deleted_at IS NULL
        ORDER BY s.timestamp DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async listOpenMarketCollections(storeId: number) {
      const result = await postgresPool.query(`
        SELECT items
        FROM market_collections
        WHERE store_id = $1 AND status = 'OPEN'
      `, [storeId]);
      return result.rows as Array<{ items?: string }>;
    },

    async listProducts(options: ProductListOptions) {
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const normalizedSearch = rawSearch.toLowerCase();
      const requestedCategory = typeof options.category === 'string' ? options.category.trim() : '';
      const requestedStockStatus = typeof options.stockStatus === 'string' ? options.stockStatus.trim().toLowerCase() : 'all';
      const sortBy = typeof options.sortBy === 'string' ? options.sortBy : 'recent';
      const paginate = Boolean(options.paginate);
      const limit = Math.max(1, Math.min(500, Number(options.limit) || 60));
      const offset = Math.max(0, Number(options.offset) || 0);

      const orderByClause = (() => {
        if (sortBy === 'price-low') return `COALESCE(p.price, 0) ASC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === 'price-high') return `COALESCE(p.price, 0) DESC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === 'category-az') return `LOWER(COALESCE(c.name, p.category, 'General')) ASC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === 'category-za') return `LOWER(COALESCE(c.name, p.category, 'General')) DESC, LOWER(COALESCE(p.name, '')) ASC`;
        return `COALESCE(p.created_at, '1970-01-01 00:00:00') DESC, p.id DESC`;
      })();

      const filters = ['p.store_id = $1', 'p.deleted_at IS NULL'];
      const params: any[] = [options.storeId];
      let nextParam = 2;

      if (normalizedSearch) {
        const likeTerm = `%${normalizedSearch}%`;
        filters.push(`(
          LOWER(COALESCE(p.name, '')) LIKE $${nextParam}
          OR LOWER(COALESCE(p.barcode, '')) LIKE $${nextParam + 1}
          OR LOWER(COALESCE(p.quick_code, '')) LIKE $${nextParam + 2}
        )`);
        params.push(likeTerm, likeTerm, likeTerm);
        nextParam += 3;
      }

      if (requestedCategory && requestedCategory !== 'all') {
        filters.push(`LOWER(COALESCE(c.name, p.category, 'General')) = $${nextParam}`);
        params.push(requestedCategory.toLowerCase());
        nextParam += 1;
      }

      if (requestedStockStatus === 'out') {
        filters.push(`COALESCE(p.stock, 0) <= 0`);
      } else if (requestedStockStatus === 'low') {
        filters.push(`COALESCE(p.stock, 0) > 0 AND COALESCE(p.stock, 0) < 5`);
      } else if (requestedStockStatus === 'healthy') {
        filters.push(`COALESCE(p.stock, 0) >= 5`);
      }

      const fromClause = `
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${filters.join(' AND ')}
      `;

      const query = `
        SELECT p.*, COALESCE(c.name, p.category) as category_name
        ${fromClause}
        ORDER BY ${orderByClause}
        ${paginate ? `LIMIT $${nextParam} OFFSET $${nextParam + 1}` : ''}
      `;

      const rows = (await postgresPool.query(query, paginate ? [...params, limit, offset] : params)).rows as any[];
      const total = paginate
        ? Number(((await postgresPool.query(`SELECT COUNT(*)::int as total ${fromClause}`, params)).rows[0] || {}).total || 0)
        : null;

      return {
        rows,
        total,
        limit,
        offset,
      };
    },

    async searchUnifiedPosCatalog(options: UnifiedPosCatalogOptions) {
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const searchLower = rawSearch.toLowerCase();
      const limit = Math.max(1, Math.min(300, Number(options.limit) || 120));

      const params: any[] = [options.storeId];
      const hasSearch = Boolean(searchLower);

      let query = `
        SELECT *
        FROM (
          SELECT
            p.id::integer as id,
            p.name::text as name,
            COALESCE(p.barcode::text, '') as barcode,
            COALESCE(p.quick_code::text, '') as quick_code,
            COALESCE(p.thumbnail::text, '') as thumbnail,
            COALESCE(p.price, 0)::double precision as price,
            COALESCE(p.stock, 0)::integer as stock,
            COALESCE(p.specs::text, '{}') as specs,
            p.condition_matrix::text as condition_matrix,
            'INVENTORY'::text as source_type,
            0::integer as consignment_item_id,
            NULL::text as vendor_name,
            NULL::text as imei_serial,
            0::integer as consignment_quantity,
            0::double precision as agreed_payout,
            NULL::text as internal_condition,
            CASE
              WHEN LOWER(COALESCE(p.quick_code, '')) = $2 THEN 1
              WHEN LOWER(COALESCE(p.barcode, '')) = $2 THEN 2
              WHEN LOWER(COALESCE(p.name, '')) LIKE $3 THEN 6
              ELSE 9
            END as rank_score
          FROM products p
          WHERE p.store_id = $1
            AND p.deleted_at IS NULL

          UNION ALL

          SELECT
            (-ci.id)::integer as id,
            ci.item_name::text as name,
            COALESCE(ci.imei_serial::text, '') as barcode,
            COALESCE(ci.quick_code::text, '') as quick_code,
            ''::text as thumbnail,
            COALESCE(ci.selling_price, 0)::double precision as price,
            1::integer as stock,
            COALESCE(ci.public_specs::text, '{}') as specs,
            NULL::text as condition_matrix,
            'CONSIGNMENT'::text as source_type,
            ci.id::integer as consignment_item_id,
            COALESCE(ci.vendor_name::text, '') as vendor_name,
            COALESCE(ci.imei_serial::text, '') as imei_serial,
            COALESCE(ci.quantity, 0)::integer as consignment_quantity,
            COALESCE(ci.agreed_payout, 0)::double precision as agreed_payout,
            COALESCE(ci.internal_condition::text, '') as internal_condition,
            CASE
              WHEN LOWER(COALESCE(ci.quick_code, '')) = $2 THEN 1
              WHEN LOWER(COALESCE(ci.imei_serial, '')) = $2 THEN 2
              WHEN LOWER(COALESCE(ci.item_name, '')) LIKE $3 THEN 3
              ELSE 9
            END as rank_score
          FROM consignment_items ci
          WHERE ci.store_id = $1
            AND LOWER(COALESCE(ci.status, 'pending')) = 'approved'
            AND COALESCE(ci.quantity, 0) > 0
        ) catalog
      `;

      if (hasSearch) {
        params.push(searchLower, `%${searchLower}%`);
        query += `
          WHERE LOWER(COALESCE(catalog.quick_code, '')) LIKE $3
            OR LOWER(COALESCE(catalog.barcode, '')) LIKE $3
            OR LOWER(COALESCE(catalog.imei_serial, '')) LIKE $3
            OR LOWER(COALESCE(catalog.name, '')) LIKE $3
        `;
      }

      query += ` ORDER BY catalog.rank_score ASC, LOWER(COALESCE(catalog.name, '')) ASC LIMIT ${limit}`;

      const result = await postgresPool.query(query, hasSearch ? params : [options.storeId, '', '']);
      return result.rows as any[];
    },

    async listConsignmentItems(options: ConsignmentListOptions) {
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const search = rawSearch.toLowerCase();
      const statusFilter = String(options.status || '').trim().toLowerCase();

      const filters = ['ci.store_id = $1'];
      const params: any[] = [options.storeId];
      let nextParam = 2;

      if (statusFilter && statusFilter !== 'all') {
        filters.push(`LOWER(COALESCE(ci.status, 'pending')) = $${nextParam}`);
        params.push(statusFilter);
        nextParam += 1;
      }

      if (search) {
        filters.push(`(
          LOWER(COALESCE(ci.item_name, '')) LIKE $${nextParam}
          OR LOWER(COALESCE(ci.vendor_name, '')) LIKE $${nextParam + 1}
          OR LOWER(COALESCE(ci.quick_code, '')) LIKE $${nextParam + 2}
          OR LOWER(COALESCE(ci.imei_serial, '')) LIKE $${nextParam + 3}
          OR LOWER(COALESCE(ci.vendor_phone, '')) LIKE $${nextParam + 4}
          OR LOWER(COALESCE(ci.vendor_address, '')) LIKE $${nextParam + 5}
        )`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      const result = await postgresPool.query(`
        SELECT ci.*, adder.username as added_by_username, approver.username as approved_by_username
        FROM consignment_items ci
        LEFT JOIN users adder ON adder.id = ci.added_by
        LEFT JOIN users approver ON approver.id = ci.approved_by
        WHERE ${filters.join(' AND ')}
        ORDER BY ci.updated_at DESC, ci.id DESC
      `, params);

      return result.rows as any[];
    },

    async getConsignmentItemById(storeId: number, consignmentItemId: number) {
      const result = await postgresPool.query(`
        SELECT ci.*, adder.username as added_by_username, approver.username as approved_by_username
        FROM consignment_items ci
        LEFT JOIN users adder ON adder.id = ci.added_by
        LEFT JOIN users approver ON approver.id = ci.approved_by
        WHERE ci.store_id = $1 AND ci.id = $2
        LIMIT 1
      `, [storeId, consignmentItemId]);

      return result.rows[0] || null;
    },

    async listProformas(storeId: number) {
      const result = await postgresPool.query(`
        SELECT p.*, c.name as linked_customer_name, c.phone as linked_customer_phone, c.address as linked_customer_address
        FROM pro_formas p
        LEFT JOIN customers c ON p.customer_id = c.id
        WHERE p.store_id = $1
        ORDER BY p.created_at DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async listRepairTickets(storeId: number) {
      const orderClause = `
        CASE rt.status
          WHEN 'READY' THEN 0
          WHEN 'RECEIVED' THEN 1
          WHEN 'DIAGNOSING' THEN 2
          WHEN 'AWAITING_PARTS' THEN 3
          WHEN 'IN_REPAIR' THEN 4
          ELSE 5
        END,
        rt.created_at DESC,
        rt.id DESC
      `;

      const result = await postgresPool.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.store_id = $1
        ORDER BY ${orderClause}
      `, [storeId]);
      return result.rows as any[];
    },

    async listExpenses(storeId: number, from?: string, to?: string) {
      const filters = ['e.store_id = $1'];
      const params: Array<string | number> = [storeId];
      let nextParam = 2;

      if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) {
        filters.push(`DATE(e.spent_at) >= DATE($${nextParam})`);
        params.push(String(from));
        nextParam += 1;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) {
        filters.push(`DATE(e.spent_at) <= DATE($${nextParam})`);
        params.push(String(to));
        nextParam += 1;
      }

      const result = await postgresPool.query(`
        SELECT e.*, u.username as created_by_username
        FROM expenses e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE ${filters.join(' AND ')}
        ORDER BY e.spent_at DESC, e.id DESC
      `, params);
      return result.rows as any[];
    },

    async listInternalMessageContacts(storeId: number, currentUserId: number) {
      const result = await postgresPool.query(`
        SELECT *
        FROM (
          SELECT
            u.id,
            u.username,
            u.role,
            (
              SELECT m.message_text
              FROM internal_messages m
              WHERE m.store_id = $1
                AND ((m.sender_id = $2 AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = $3))
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
            ) as last_message_text,
            (
              SELECT m.created_at
              FROM internal_messages m
              WHERE m.store_id = $4
                AND ((m.sender_id = $5 AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = $6))
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
            ) as last_message_at,
            (
              SELECT COUNT(*)
              FROM internal_messages m
              WHERE m.store_id = $7
                AND m.sender_id = u.id
                AND m.recipient_id = $8
                AND m.is_read = 0
            ) as unread_count
          FROM users u
          WHERE u.store_id = $9
            AND u.id != $10
            AND u.role IN ('STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF')
        ) contact_rows
        ORDER BY
          CASE WHEN COALESCE(contact_rows.unread_count, 0) > 0 THEN 0 ELSE 1 END,
          CASE WHEN contact_rows.last_message_at IS NULL THEN 1 ELSE 0 END,
          contact_rows.last_message_at DESC,
          CASE contact_rows.role
            WHEN 'STORE_ADMIN' THEN 0
            WHEN 'ACCOUNTANT' THEN 1
            WHEN 'MANAGER' THEN 2
            WHEN 'PROCUREMENT_OFFICER' THEN 3
            ELSE 4
          END,
          LOWER(COALESCE(contact_rows.username, '')) ASC
      `, [storeId, currentUserId, currentUserId, storeId, currentUserId, currentUserId, storeId, currentUserId, storeId, currentUserId]);
      return result.rows as any[];
    },

    async listAdminStores() {
      const result = await postgresPool.query(`
        SELECT s.*, u.username as owner_username, u.id as owner_id
        FROM stores s
        LEFT JOIN users u ON s.id = u.store_id AND u.role = 'STORE_ADMIN'
        ORDER BY s.id ASC
      `);
      return result.rows as any[];
    },

    async listAdminUsers(options: AdminUserListOptions) {
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
      const offset = Math.max(0, Number(options.offset) || 0);
      const isSystemAdmin = String(options.viewerRole || '') === 'SYSTEM_ADMIN';
      const requestedStoreId = options.requestedStoreId == null ? null : Number(options.requestedStoreId);
      const effectiveStoreId = isSystemAdmin
        ? (requestedStoreId != null && Number.isInteger(requestedStoreId) && requestedStoreId > 0 ? requestedStoreId : null)
        : (options.viewerStoreId == null ? null : Number(options.viewerStoreId));

      if (!isSystemAdmin && (effectiveStoreId == null || !Number.isInteger(effectiveStoreId) || effectiveStoreId <= 0)) {
        return [] as any[];
      }

      const filters: string[] = [];
      const params: Array<number | string> = [];
      let nextParam = 1;

      if (effectiveStoreId != null && Number.isInteger(effectiveStoreId) && effectiveStoreId > 0) {
        filters.push(`store_id = $${nextParam}`);
        params.push(effectiveStoreId);
        nextParam += 1;
      }

      const result = await postgresPool.query(`
        SELECT id, username, role, store_id
        FROM users
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY LOWER(COALESCE(username, '')) ASC, id ASC
        LIMIT $${nextParam} OFFSET $${nextParam + 1}
      `, [...params, limit, offset]);
      return result.rows as any[];
    },

    async listSuppliers(storeId: number) {
      const result = await postgresPool.query(`
        SELECT s.*,
          COALESCE((
            SELECT COUNT(*)
            FROM purchase_orders po
            WHERE po.store_id = s.store_id AND po.supplier_id = s.id AND po.status = 'ORDERED'
          ), 0) as pending_orders
        FROM suppliers s
        WHERE s.store_id = $1
        ORDER BY LOWER(COALESCE(s.name, '')) ASC, s.id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async listPurchaseOrders(storeId: number, statusFilter = '', search = '') {
      const normalizedStatus = String(statusFilter || '').trim().toUpperCase();
      const normalizedSearch = String(search || '').trim().toLowerCase();

      const filters = ['po.store_id = $1'];
      const params: Array<string | number> = [storeId];
      let nextParam = 2;

      if (normalizedStatus && ['ORDERED', 'RECEIVED', 'CANCELLED'].includes(normalizedStatus)) {
        filters.push(`po.status = $${nextParam}`);
        params.push(normalizedStatus);
        nextParam += 1;
      }

      if (normalizedSearch) {
        const likeTerm = `%${normalizedSearch}%`;
        filters.push(`(
          LOWER(COALESCE(po.order_number, '')) LIKE $${nextParam}
          OR LOWER(COALESCE(po.supplier_name, s.name, '')) LIKE $${nextParam + 1}
          OR LOWER(COALESCE(po.note, '')) LIKE $${nextParam + 2}
        )`);
        params.push(likeTerm, likeTerm, likeTerm);
      }

      const result = await postgresPool.query(`
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE ${filters.join(' AND ')}
        ORDER BY po.created_at DESC, po.id DESC
      `, params);
      return result.rows as any[];
    },

    async listInventoryBatches(storeId: number) {
      const result = await postgresPool.query(`
        SELECT ib.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               s.name as supplier_name, u.username as received_by_username
        FROM inventory_batches ib
        LEFT JOIN products p ON ib.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN suppliers s ON ib.supplier_id = s.id
        LEFT JOIN users u ON ib.received_by = u.id
        WHERE ib.store_id = $1
        ORDER BY
          CASE WHEN ib.expiry_date IS NULL OR TRIM(COALESCE(ib.expiry_date, '')) = '' THEN 1 ELSE 0 END,
          ib.expiry_date ASC,
          ib.created_at DESC,
          ib.id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async getInternalConversation(storeId: number, currentUserId: number, withUserId: number) {
      const contactResult = await postgresPool.query(`
        SELECT id, username, role
        FROM users
        WHERE id = $1 AND store_id = $2 AND role IN ('STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF')
        LIMIT 1
      `, [withUserId, storeId]);
      const contact = contactResult.rows[0] || null;

      const unreadResult = await postgresPool.query(`
        SELECT id
        FROM internal_messages
        WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
      `, [storeId, withUserId, currentUserId]);

      const messagesResult = await postgresPool.query(`
        SELECT m.*, sender.username as sender_username, sender.role as sender_role,
               recipient.username as recipient_username, recipient.role as recipient_role
        FROM internal_messages m
        LEFT JOIN users sender ON m.sender_id = sender.id
        LEFT JOIN users recipient ON m.recipient_id = recipient.id
        WHERE m.store_id = $1
          AND ((m.sender_id = $2 AND m.recipient_id = $3) OR (m.sender_id = $4 AND m.recipient_id = $5))
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 300
      `, [storeId, currentUserId, withUserId, withUserId, currentUserId]);

      return {
        contact,
        unreadMessageIds: unreadResult.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isInteger(id) && id > 0),
        messages: messagesResult.rows as any[],
      };
    },

    async listZReportSales(storeId: number, selectedDate: string) {
      const result = await postgresPool.query(`
        SELECT total, payment_methods
        FROM sales
        WHERE store_id = $1
          AND status != 'VOIDED'
          AND deleted_at IS NULL
          AND DATE(timestamp) = DATE($2)
        ORDER BY timestamp ASC, id ASC
      `, [storeId, selectedDate]);
      return result.rows as Array<{ total: number; payment_methods: string }>;
    },

    async getMySalesChartData(storeId: number, userId: number, startDate: string, selectedDate: string) {
      const result = await postgresPool.query(`
        SELECT total, payment_methods, DATE(timestamp)::text AS sale_date
        FROM sales
        WHERE store_id = $1
          AND user_id = $2
          AND status != 'VOIDED'
          AND deleted_at IS NULL
          AND DATE(timestamp) BETWEEN DATE($3) AND DATE($4)
        ORDER BY timestamp ASC, id ASC
      `, [storeId, userId, startDate, selectedDate]);
      return { salesRows: result.rows as Array<{ total: number; payment_methods: string; sale_date: string }> };
    },

    async getFinancialLedgerData(storeId: number, from: string, to: string) {
      const [storeSettingsResult, rowsResult, totalExpensesResult] = await Promise.all([
        postgresPool.query(`
          SELECT COALESCE(default_missing_cost_to_price, 0) as default_missing_cost_to_price,
                 COALESCE(tax_enabled, 0) as tax_enabled,
                 COALESCE(tax_percentage, 0) as tax_percentage
          FROM stores
          WHERE id = $1
          LIMIT 1
        `, [storeId]),
        postgresPool.query(`
          SELECT
            s.id as sale_id,
            s.timestamp,
            s.total,
            s.discount_amount,
            s.tax_amount,
            s.payment_methods,
            si.quantity,
            si.price_at_sale,
            si.cost_at_sale,
            si.condition,
            si.product_id,
            p.name as product_name,
            p.cost as product_cost,
            p.price as product_price,
            p.condition_matrix
          FROM sales s
          LEFT JOIN sale_items si ON si.sale_id = s.id
          LEFT JOIN products p ON si.product_id = p.id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND s.deleted_at IS NULL
            AND DATE(s.timestamp) BETWEEN DATE($2) AND DATE($3)
          ORDER BY s.timestamp ASC, s.id ASC, si.id ASC
        `, [storeId, from, to]),
        postgresPool.query(`
          SELECT COALESCE(SUM(amount), 0) as total
          FROM expenses
          WHERE store_id = $1
            AND DATE(spent_at) BETWEEN DATE($2) AND DATE($3)
        `, [storeId, from, to]),
      ]);

      return {
        storeSettings: storeSettingsResult.rows[0] || null,
        rows: rowsResult.rows as any[],
        totalExpenses: Number((totalExpensesResult.rows[0] as any)?.total || 0) || 0,
      };
    },

    async getStaffSalesChartData(storeId: number, startDate: string, selectedDate: string) {
      const [staffUsersResult, salesRowsResult] = await Promise.all([
        postgresPool.query(`
          SELECT id, username, role
          FROM users
          WHERE store_id = $1 AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
          ORDER BY CASE role WHEN 'STORE_ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, LOWER(COALESCE(username, '')) ASC
        `, [storeId]),
        postgresPool.query(`
          SELECT user_id, total, payment_methods, DATE(timestamp)::text AS sale_date
          FROM sales
          WHERE store_id = $1
            AND status != 'VOIDED'
            AND deleted_at IS NULL
            AND DATE(timestamp) BETWEEN DATE($2) AND DATE($3)
          ORDER BY timestamp ASC, id ASC
        `, [storeId, startDate, selectedDate]),
      ]);

      return {
        staffUsers: staffUsersResult.rows as Array<{ id: number; username: string; role: string }>,
        salesRows: salesRowsResult.rows as Array<{ user_id: number; total: number; payment_methods: string; sale_date: string }>,
      };
    },

    async getStaffSalesHistoryData(storeId: number, userId: number, selectedDate: string, startDate: string, limit: number) {
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

      const memberResult = await postgresPool.query(`
        SELECT id, username, role, store_id
        FROM users
        WHERE id = $1 AND store_id = $2 AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
        LIMIT 1
      `, [userId, storeId]);
      const member = memberResult.rows[0] || null;

      if (!member) {
        return { member: null, salesRows: [] as any[], recentSales: [] as any[] };
      }

      const [salesRowsResult, recentSalesResult] = await Promise.all([
        postgresPool.query(`
          SELECT total, payment_methods, DATE(timestamp)::text AS sale_date
          FROM sales
          WHERE store_id = $1
            AND user_id = $2
            AND status != 'VOIDED'
            AND deleted_at IS NULL
            AND DATE(timestamp) BETWEEN DATE($3) AND DATE($4)
          ORDER BY timestamp ASC, id ASC
        `, [storeId, userId, startDate, selectedDate]),
        postgresPool.query(`
          SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
          FROM sales s
          LEFT JOIN users u ON s.user_id = u.id
          LEFT JOIN customers c ON s.customer_id = c.id
          WHERE s.store_id = $1
            AND s.user_id = $2
            AND s.status != 'VOIDED'
            AND s.deleted_at IS NULL
            AND DATE(s.timestamp) <= DATE($3)
          ORDER BY s.timestamp DESC
          LIMIT $4
        `, [storeId, userId, selectedDate, normalizedLimit]),
      ]);

      return {
        member,
        salesRows: salesRowsResult.rows as Array<{ total: number; payment_methods: string; sale_date: string }>,
        recentSales: recentSalesResult.rows as any[],
      };
    },

    async getCustomerById(storeId: number, customerId: number) {
      const result = await postgresPool.query('SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1', [customerId, storeId]);
      return result.rows[0] || null;
    },

    async getCustomerStats(storeId: number) {
      const result = await postgresPool.query(`
        SELECT
          c.*,
          COUNT(s.id) as purchase_count,
          COALESCE(SUM(s.total), 0) as total_investment,
          MAX(s.timestamp) as last_visit,
          COALESCE((
            SELECT 0
            FROM sales s2
            WHERE s2.customer_id = c.id AND s2.store_id = c.store_id
              AND s2.status IN ('PENDING', 'LAYAWAY', 'INSTALLMENT')
          ), 0) as pending_outstanding
        FROM customers c
        LEFT JOIN sales s ON c.id = s.customer_id AND s.status != 'VOIDED'
        WHERE c.store_id = $1
        GROUP BY c.id
        ORDER BY total_investment DESC, c.id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async listSales(options: SalesListOptions) {
      const customerId = Number(options.customerId || 0);
      const hasCustomerFilter = Number.isFinite(customerId) && customerId > 0;
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const search = rawSearch.toLowerCase();
      const numericSearch = rawSearch.replace(/\D+/g, '');
      const statusFilter = typeof options.status === 'string' ? options.status.trim().toUpperCase() : '';
      const paginate = Boolean(options.paginate);
      const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
      const offset = Math.max(0, Number(options.offset) || 0);

      const filters = ['s.store_id = $1'];
      const params: Array<string | number> = [options.storeId];
      let nextParam = 2;

      if (hasCustomerFilter) {
        filters.push(`s.customer_id = $${nextParam}`);
        params.push(customerId);
        nextParam += 1;
      }

      if (statusFilter) {
        filters.push(`s.status = $${nextParam}`);
        params.push(statusFilter);
        nextParam += 1;
      }

      if (search) {
        filters.push(`(
          CAST(s.id AS TEXT) LIKE $${nextParam}
          OR LPAD(CAST(s.id AS TEXT), 6, '0') LIKE $${nextParam + 1}
          OR LOWER(COALESCE(s.status, '')) LIKE $${nextParam + 2}
          OR LOWER(COALESCE(c.name, '')) LIKE $${nextParam + 3}
          OR COALESCE(c.phone, '') LIKE $${nextParam + 4}
        )`);
        params.push(`%${rawSearch}%`, `%${numericSearch || rawSearch}%`, `%${search}%`, `%${search}%`, `%${rawSearch}%`);
      }

      const fromClause = `
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE ${filters.join(' AND ')}
      `;

      const rows = (await postgresPool.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
          COALESCE((SELECT SUM(sr.returned_value) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returned_amount,
          COALESCE((SELECT SUM(sr.refund_amount) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as refunded_amount,
          COALESCE((SELECT COUNT(*) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returns_count
        ${fromClause}
        ORDER BY s.timestamp DESC
        ${paginate ? `LIMIT $${nextParam} OFFSET $${nextParam + 1}` : ''}
      `, paginate ? [...params, limit, offset] : params)).rows as any[];

      const total = paginate
        ? Number(((await postgresPool.query(`SELECT COUNT(*)::int as total ${fromClause}`, params)).rows[0] || {}).total || 0)
        : null;

      return { rows, total, limit, offset };
    },

    async getSaleById(storeId: number, saleId: number) {
      const result = await postgresPool.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
          COALESCE((SELECT SUM(sr.returned_value) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returned_amount,
          COALESCE((SELECT SUM(sr.refund_amount) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as refunded_amount,
          COALESCE((SELECT COUNT(*) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returns_count
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.id = $1 AND s.store_id = $2
        LIMIT 1
      `, [saleId, storeId]);
      return result.rows[0] || null;
    },

    async getSaleReturnsMeta(saleId: number) {
      const result = await postgresPool.query(`
        SELECT
          COUNT(*) as returns_count,
          COALESCE(SUM(returned_value), 0) as returned_amount,
          COALESCE(SUM(refund_amount), 0) as refunded_amount
        FROM sales_returns
        WHERE sale_id = $1
      `, [saleId]);
      return result.rows[0] || null;
    },

    async getSaleReturnsForSale(saleId: number) {
      const result = await postgresPool.query(`
        SELECT sr.*, u.username as processed_by_username
        FROM sales_returns sr
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE sr.sale_id = $1
        ORDER BY sr.created_at DESC, sr.id DESC
      `, [saleId]);
      return result.rows as any[];
    },

    async getSaleItemsForInvoice(saleId: number) {
      const normalizeSaleItemSpecs = (value: any) => {
        let specs: any = {};
        try {
          specs = value && typeof value === 'object' ? value : JSON.parse(String(value || '{}'));
        } catch {
          specs = {};
        }
        const sourced = Boolean(specs?.sourced_item);
        const consignment = Boolean(specs?.consignment_item);
        const consignmentItemId = Math.max(0, Number(specs?.consignment_item_id || 0) || 0);
        const consignmentItemName = consignment
          ? String(specs?.consignment_item_name || specs?.item_name || '').trim()
          : '';
        return {
          specs,
          isSourced: sourced,
          isConsignment: consignment,
          sourcedItemName: sourced ? String(specs?.sourced_item_name || '').trim() : '',
          sourcedVendorName: sourced ? String(specs?.sourced_vendor_name || '').trim() : '',
          sourcedVendorReference: sourced ? String(specs?.sourced_vendor_reference || '').trim() : '',
          sourcedCostPrice: sourced ? Math.max(0, Number(specs?.sourced_cost_price || 0) || 0) : null,
          consignmentItemId,
          consignmentItemName,
        };
      };

      const items = (await postgresPool.query(`
        SELECT si.*, p.name as product_name, p.quick_code as product_quick_code, p.specs as product_specs, COALESCE(c.name, p.category, 'General') as category_name
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE si.sale_id = $1
        ORDER BY si.id ASC
      `, [saleId])).rows as any[];

      const returnRows = (await postgresPool.query('SELECT items FROM sales_returns WHERE sale_id = $1 ORDER BY id ASC', [saleId])).rows as any[];
      const parsedSpecsBySaleItemId = new Map<number, ReturnType<typeof normalizeSaleItemSpecs>>();
      const consignmentItemIds = new Set<number>();

      for (const item of items) {
        const parsed = normalizeSaleItemSpecs(item.specs_at_sale);
        const saleItemId = Number(item?.id || 0);
        if (saleItemId > 0) {
          parsedSpecsBySaleItemId.set(saleItemId, parsed);
        }
        if (parsed.isConsignment && parsed.consignmentItemId > 0) {
          consignmentItemIds.add(parsed.consignmentItemId);
        }
      }

      const consignmentNameById = new Map<number, string>();
      if (consignmentItemIds.size > 0) {
        const ids = Array.from(consignmentItemIds.values());
        const consignmentRows = (await postgresPool.query(
          'SELECT id, item_name FROM consignment_items WHERE id = ANY($1::int[])',
          [ids],
        )).rows as Array<{ id: number; item_name: string }>;

        consignmentRows.forEach((row) => {
          consignmentNameById.set(Number(row.id), String(row.item_name || '').trim());
        });
      }

      const returnedQuantityBySaleItem = new Map<number, number>();

      for (const row of returnRows) {
        let parsedItems: any[] = [];
        try {
          parsedItems = Array.isArray(row?.items) ? row.items : JSON.parse(String(row?.items || '[]'));
        } catch {
          parsedItems = [];
        }

        for (const returnedItem of parsedItems) {
          const saleItemId = Number(returnedItem?.sale_item_id || returnedItem?.id);
          const quantity = Math.max(0, Number(returnedItem?.quantity) || 0);
          if (!saleItemId || !quantity) continue;
          returnedQuantityBySaleItem.set(saleItemId, (returnedQuantityBySaleItem.get(saleItemId) || 0) + quantity);
        }
      }

      return items.map((item) => {
        const soldQuantity = Math.max(0, Number(item.quantity) || 0);
        const returnedQuantity = Math.min(soldQuantity, Math.max(0, Number(returnedQuantityBySaleItem.get(Number(item.id)) || 0)));
        const parsed = parsedSpecsBySaleItemId.get(Number(item.id)) || normalizeSaleItemSpecs(item.specs_at_sale);
        const productName = String(item.product_name || '').trim();
        const isPlaceholderProduct = productName === '__CONSIGNMENT_PLACEHOLDER__' || productName === '__SOURCED_PLACEHOLDER__';
        const resolvedName = parsed.isSourced
          ? (parsed.sourcedItemName || productName || `Product #${item.product_id}`)
          : parsed.isConsignment
            ? (parsed.consignmentItemName || consignmentNameById.get(parsed.consignmentItemId) || (!isPlaceholderProduct ? productName : '') || `Consignment Item #${parsed.consignmentItemId || item.product_id}`)
            : (productName || `Product #${item.product_id}`);

        return {
          ...item,
          product_name: resolvedName,
          item_source: parsed.isSourced ? 'SOURCED' : (parsed.isConsignment ? 'CONSIGNMENT' : 'INVENTORY'),
          sourced_vendor_name: parsed.sourcedVendorName || null,
          sourced_vendor_reference: parsed.sourcedVendorReference || null,
          quantity: soldQuantity,
          returned_quantity: returnedQuantity,
          returnable_quantity: Math.max(0, soldQuantity - returnedQuantity),
          subtotal: Number(item?.subtotal ?? (Number(item?.price_at_sale || 0) * soldQuantity)) || 0,
          price_at_sale: Number(item?.price_at_sale || 0) || 0,
          cost_at_sale: parsed.isSourced
            ? parsed.sourcedCostPrice
            : (item.cost_at_sale == null ? null : Number(item.cost_at_sale || 0)),
          specs_at_sale: parsed.specs,
        };
      });
    },

    async getSaleDetails(storeId: number, saleId: number) {
      const [sale, items, returns] = await Promise.all([
        this.getSaleById(storeId, saleId),
        this.getSaleItemsForInvoice(saleId),
        this.getSaleReturnsForSale(saleId),
      ]);

      return { sale, items, returns };
    },

    async getCustomerInvoices(storeId: number, customerId: number) {
      const [customer, salesResult] = await Promise.all([
        this.getCustomerById(storeId, customerId),
        this.listSales({ storeId, customerId }),
      ]);

      return {
        customer,
        sales: salesResult.rows,
      };
    },

    async listReturns(options: ReturnsListOptions) {
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const search = rawSearch.toLowerCase();
      const typeFilter = typeof options.returnType === 'string' ? options.returnType.trim().toUpperCase() : '';

      const filters = ['sr.store_id = $1'];
      const params: Array<string | number> = [options.storeId];
      let nextParam = 2;

      if (typeFilter && ['REFUND', 'EXCHANGE', 'RETURN_ONLY'].includes(typeFilter)) {
        filters.push(`UPPER(sr.return_type) = $${nextParam}`);
        params.push(typeFilter);
        nextParam += 1;
      }

      if (search) {
        filters.push(`(
          CAST(sr.id AS TEXT) LIKE $${nextParam}
          OR CAST(sr.sale_id AS TEXT) LIKE $${nextParam + 1}
          OR LOWER(COALESCE(c.name, '')) LIKE $${nextParam + 2}
          OR COALESCE(c.phone, '') LIKE $${nextParam + 3}
          OR LOWER(COALESCE(sr.reason, '')) LIKE $${nextParam + 4}
        )`);
        const likeTerm = `%${search}%`;
        const rawLikeTerm = `%${rawSearch}%`;
        params.push(likeTerm, likeTerm, likeTerm, rawLikeTerm, likeTerm);
      }

      const result = await postgresPool.query(`
        SELECT sr.*, u.username as processed_by_username, c.name as customer_name, c.phone as customer_phone
        FROM sales_returns sr
        LEFT JOIN sales s ON sr.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE ${filters.join(' AND ')}
        ORDER BY sr.created_at DESC, sr.id DESC
      `, params);
      return result.rows as any[];
    },

    async listMarketCollections(options: MarketCollectionListOptions) {
      const normalizedStatus = String(options.status || '').trim().toUpperCase();
      const shouldFilterStatus = ['OPEN', 'SOLD', 'RETURNED'].includes(normalizedStatus);

      const params: Array<string | number> = [options.storeId];
      const filters = ['mc.store_id = $1'];

      if (shouldFilterStatus) {
        filters.push('UPPER(mc.status) = $2');
        params.push(normalizedStatus);
      }

      const result = await postgresPool.query(`
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE mc.status WHEN 'OPEN' THEN 0 WHEN 'SOLD' THEN 1 ELSE 2 END, mc.created_at DESC, mc.id DESC
      `, params);
      return result.rows as any[];
    },

    async listLayawayPlans(storeId: number) {
      const result = await postgresPool.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.store_id = $1
          AND s.deleted_at IS NULL
          AND s.status != 'VOIDED'
          AND COALESCE(s.sale_channel, 'STANDARD') IN ('LAYAWAY', 'INSTALLMENT')
        ORDER BY CASE WHEN s.status = 'PENDING' THEN 0 ELSE 1 END,
                 CASE WHEN s.due_date IS NULL THEN 1 ELSE 0 END,
                 COALESCE(s.due_date, s.timestamp) ASC,
                 s.id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async getDailyReminders(storeId: number) {
      const [pendingSales, marketCollections] = await Promise.all([
        postgresPool.query(`
          SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
          FROM sales s
          LEFT JOIN users u ON s.user_id = u.id
          LEFT JOIN customers c ON s.customer_id = c.id
          WHERE s.store_id = $1 AND s.status = 'PENDING' AND s.deleted_at IS NULL
          ORDER BY COALESCE(s.due_date, s.timestamp) ASC, s.timestamp DESC
        `, [storeId]).then((result) => result.rows as any[]),
        this.listMarketCollections({ storeId, status: 'OPEN' }),
      ]);

      return { pendingSales, marketCollections };
    },

    async listCategories(storeId: number) {
      const result = await postgresPool.query(`
        SELECT *
        FROM categories
        WHERE store_id = $1
        ORDER BY LOWER(COALESCE(name, '')) ASC, id ASC
      `, [storeId]);
      return result.rows as any[];
    },

    async listDeletedProducts() {
      const result = await postgresPool.query(`
        SELECT *
        FROM products
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC, id DESC
      `);
      return result.rows as any[];
    },

    async listActiveHolds(storeId: number) {
      const result = await postgresPool.query(`
        SELECT *
        FROM active_holds
        WHERE store_id = $1
        ORDER BY timestamp DESC, id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async getInventoryDailySummary(storeId: number, requestedDate: string, requestedDays: number) {
      const getLocalDateKey = (date = new Date()) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const getAddedUnitsForDate = async (dateValue: string) => {
        const productsForDate = (await postgresPool.query(`
          SELECT stock, condition_matrix
          FROM products
          WHERE store_id = $1
            AND deleted_at IS NULL
            AND DATE(COALESCE(created_at, CURRENT_TIMESTAMP)) = DATE($2)
        `, [storeId, dateValue])).rows as any[];

        return productsForDate.reduce((sum: number, product: any) => {
          if (product.condition_matrix) {
            try {
              const matrix = typeof product.condition_matrix === 'string'
                ? JSON.parse(product.condition_matrix)
                : product.condition_matrix;
              return sum
                + Number(matrix?.new?.stock || 0)
                + Number(matrix?.open_box?.stock || 0)
                + Number(matrix?.used?.stock || 0);
            } catch {
              return sum + (Number(product.stock) || 0);
            }
          }

          return sum + (Number(product.stock) || 0);
        }, 0);
      };

      const getSoldUnitsForDate = async (dateValue: string) => {
        const soldResult = (await postgresPool.query(`
          SELECT COALESCE(SUM(si.quantity), 0) as count
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND DATE(s.timestamp) = DATE($2)
        `, [storeId, dateValue])).rows[0] as any;

        return Number(soldResult?.count) || 0;
      };

      const baseDate = new Date(`${requestedDate}T12:00:00`);
      const trend = await Promise.all(Array.from({ length: requestedDays }, async (_, index) => {
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() - (requestedDays - 1 - index));
        const dateStr = getLocalDateKey(date);

        return {
          date: dateStr,
          label: date.toLocaleDateString('en-US', { weekday: 'short' }),
          added: await getAddedUnitsForDate(dateStr),
          sold: await getSoldUnitsForDate(dateStr),
        };
      }));

      return {
        selectedDate: requestedDate,
        addedToday: await getAddedUnitsForDate(requestedDate),
        soldToday: await getSoldUnitsForDate(requestedDate),
        trend,
      };
    },

    async listStockAdjustments(options: StockAdjustmentListOptions) {
      const rawSearch = typeof options.search === 'string' ? options.search.trim() : '';
      const search = rawSearch.toLowerCase();
      const typeFilter = typeof options.typeFilter === 'string' ? options.typeFilter.trim().toUpperCase() : '';
      const productIdFilter = Number(options.productIdFilter);

      const filters = ['sa.store_id = $1'];
      const params: any[] = [options.storeId];
      let nextParam = 2;

      if (typeFilter && ['DAMAGED', 'LOST', 'FOUND', 'MANUAL', 'INTERNAL_USE', 'RESTOCK', 'COUNT'].includes(typeFilter)) {
        filters.push(`UPPER(sa.adjustment_type) = $${nextParam}`);
        params.push(typeFilter);
        nextParam += 1;
      }

      if (Number.isInteger(productIdFilter) && productIdFilter > 0) {
        filters.push(`sa.product_id = $${nextParam}`);
        params.push(productIdFilter);
        nextParam += 1;
      }

      if (search) {
        filters.push(`(
          CAST(sa.id AS TEXT) LIKE $${nextParam}
          OR LOWER(COALESCE(p.name, '')) LIKE $${nextParam + 1}
          OR LOWER(COALESCE(sa.note, '')) LIKE $${nextParam + 2}
          OR LOWER(COALESCE(sa.adjustment_type, '')) LIKE $${nextParam + 3}
        )`);
        const likeTerm = `%${search}%`;
        params.push(likeTerm, likeTerm, likeTerm, likeTerm);
      }

      const result = await postgresPool.query(`
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE ${filters.join(' AND ')}
        ORDER BY sa.created_at DESC, sa.id DESC
      `, params);
      return result.rows as any[];
    },

    async getDashboardActivityFeed(options: DashboardActivityFeedOptions) {
      const role = String(options.role || 'STAFF').toUpperCase();
      const restrictToOwnActivity = role === 'STAFF';
      const canViewExpenses = ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(role);
      const limit = Math.min(12, Math.max(4, Number(options.limit) || 8));

      const [saleRowsResult, stockRowsResult, expenseRowsResult] = await Promise.all([
        restrictToOwnActivity
          ? postgresPool.query(`
              SELECT s.id, s.total, s.status, s.sale_channel, s.timestamp, u.username as user_username, c.name as customer_name
              FROM sales s
              LEFT JOIN users u ON s.user_id = u.id
              LEFT JOIN customers c ON s.customer_id = c.id
              WHERE s.store_id = $1 AND s.deleted_at IS NULL AND s.user_id = $2
              ORDER BY s.timestamp DESC, s.id DESC
              LIMIT $3
            `, [options.storeId, options.userId, limit])
          : postgresPool.query(`
              SELECT s.id, s.total, s.status, s.sale_channel, s.timestamp, u.username as user_username, c.name as customer_name
              FROM sales s
              LEFT JOIN users u ON s.user_id = u.id
              LEFT JOIN customers c ON s.customer_id = c.id
              WHERE s.store_id = $1 AND s.deleted_at IS NULL
              ORDER BY s.timestamp DESC, s.id DESC
              LIMIT $2
            `, [options.storeId, limit]),
        restrictToOwnActivity
          ? postgresPool.query(`
              SELECT sa.id, sa.adjustment_mode, sa.quantity_change, sa.cost_impact, sa.created_at,
                     p.name as product_name, u.username as user_username
              FROM stock_adjustments sa
              LEFT JOIN products p ON sa.product_id = p.id
              LEFT JOIN users u ON sa.adjusted_by = u.id
              WHERE sa.store_id = $1 AND sa.adjusted_by = $2
              ORDER BY sa.created_at DESC, sa.id DESC
              LIMIT $3
            `, [options.storeId, options.userId, limit])
          : postgresPool.query(`
              SELECT sa.id, sa.adjustment_mode, sa.quantity_change, sa.cost_impact, sa.created_at,
                     p.name as product_name, u.username as user_username
              FROM stock_adjustments sa
              LEFT JOIN products p ON sa.product_id = p.id
              LEFT JOIN users u ON sa.adjusted_by = u.id
              WHERE sa.store_id = $1
              ORDER BY sa.created_at DESC, sa.id DESC
              LIMIT $2
            `, [options.storeId, limit]),
        canViewExpenses
          ? postgresPool.query(`
              SELECT e.id, e.title, e.amount, e.created_at, u.username as user_username
              FROM expenses e
              LEFT JOIN users u ON e.created_by = u.id
              WHERE e.store_id = $1
              ORDER BY e.created_at DESC, e.id DESC
              LIMIT $2
            `, [options.storeId, limit])
          : Promise.resolve({ rows: [] as any[] }),
      ]);

      return {
        saleRows: saleRowsResult.rows as any[],
        stockRows: stockRowsResult.rows as any[],
        expenseRows: expenseRowsResult.rows as any[],
      };
    },

    async listSystemLogs(options: SystemLogsListOptions) {
      const staffName = String(options.staffName || '').trim().toLowerCase();
      const actionType = String(options.actionType || '').trim().toUpperCase();
      const todayOnly = Boolean(options.todayOnly);
      const highRiskOnly = Boolean(options.highRiskOnly);
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 20));
      const offset = Math.max(0, Number(options.offset) || 0);
      const highRiskActions = Array.isArray(options.highRiskActions)
        ? options.highRiskActions.map((action) => String(action || '').trim().toUpperCase()).filter(Boolean)
        : [];

      const filters = ['store_id = $1'];
      const params: any[] = [options.storeId];
      let nextParam = 2;

      if (staffName) {
        filters.push(`LOWER(COALESCE(user_name, '')) LIKE $${nextParam}`);
        params.push(`%${staffName}%`);
        nextParam += 1;
      }

      if (actionType && actionType !== 'ALL') {
        filters.push(`UPPER(action_type) = $${nextParam}`);
        params.push(actionType);
        nextParam += 1;
      }

      if (todayOnly) {
        filters.push(`DATE(timestamp) = CURRENT_DATE`);
      }

      if (highRiskOnly && highRiskActions.length) {
        filters.push(`UPPER(action_type) = ANY($${nextParam}::text[])`);
        params.push(highRiskActions);
        nextParam += 1;
      }

      const whereClause = filters.join(' AND ');
      const [dataResult, countResult] = await Promise.all([
        postgresPool.query(`
          SELECT id, user_id, user_name, action_type, description, old_value, new_value, timestamp
          FROM system_logs
          WHERE ${whereClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT $${nextParam} OFFSET $${nextParam + 1}
        `, [...params, limit, offset]),
        postgresPool.query(`
          SELECT COUNT(*)::int AS total
          FROM system_logs
          WHERE ${whereClause}
        `, params),
      ]);

      return {
        rows: dataResult.rows as any[],
        total: Number(countResult.rows[0]?.total || 0),
      };
    },

    async getSystemLogsSummary(storeId: number) {
      const [todayStatsResult, recentHighRiskResult] = await Promise.all([
        postgresPool.query(`
          SELECT
            COUNT(*) as "totalToday",
            SUM(CASE WHEN UPPER(action_type) = 'PRICE_CHANGE' THEN 1 ELSE 0 END) as "priceChangesToday",
            SUM(CASE WHEN UPPER(action_type) = 'DISCOUNT' THEN 1 ELSE 0 END) as "discountsToday",
            SUM(CASE WHEN UPPER(action_type) = 'STOCK_ADJUST' THEN 1 ELSE 0 END) as "stockAdjustmentsToday",
            SUM(CASE WHEN UPPER(action_type) IN ('PRICE_CHANGE', 'DELETE', 'STOCK_ADJUST') THEN 1 ELSE 0 END) as "highRiskCount"
          FROM system_logs
          WHERE store_id = $1
            AND DATE(timestamp) = CURRENT_DATE
        `, [storeId]),
        postgresPool.query(`
          SELECT id, user_name, action_type, description, timestamp
          FROM system_logs
          WHERE store_id = $1
            AND UPPER(action_type) IN ('PRICE_CHANGE', 'DELETE', 'STOCK_ADJUST')
          ORDER BY timestamp DESC, id DESC
          LIMIT 6
        `, [storeId]),
      ]);

      return {
        todayStats: todayStatsResult.rows[0] || null,
        recentHighRisk: recentHighRiskResult.rows as any[],
      };
    },

    async listAuditFlags(storeId: number) {
      const result = await postgresPool.query(`
        SELECT tf.*, u.username as flagged_by_username, s.total as sale_total, s.discount_amount, s.timestamp as sale_timestamp
        FROM transaction_flags tf
        LEFT JOIN users u ON tf.flagged_by = u.id
        LEFT JOIN sales s ON tf.sale_id = s.id
        WHERE tf.store_id = $1
        ORDER BY CASE tf.status WHEN 'OPEN' THEN 0 ELSE 1 END, tf.created_at DESC, tf.id DESC
      `, [storeId]);
      return result.rows as any[];
    },

    async exportStoreData(storeId: number) {
      const fetchAllRows = async (queryText: string, params: any[] = [], batchSize = 1000) => {
        const rows: any[] = [];
        for (let offset = 0; ; offset += batchSize) {
          const batch = await postgresPool.query(`${queryText} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, batchSize, offset]);
          rows.push(...batch.rows);
          if (batch.rows.length < batchSize) {
            break;
          }
        }
        return rows;
      };

      const storeResult = await postgresPool.query('SELECT * FROM stores WHERE id = $1 LIMIT 1', [storeId]);
      const usersResult = await fetchAllRows('SELECT * FROM users WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const categoriesResult = await fetchAllRows('SELECT * FROM categories WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const productsResult = await fetchAllRows('SELECT * FROM products WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const stockAdjustmentsResult = await fetchAllRows('SELECT * FROM stock_adjustments WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const salesResult = await fetchAllRows('SELECT * FROM sales WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const saleItemsResult = await fetchAllRows('SELECT * FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1) ORDER BY id ASC', [storeId]);
      const salesReturnsResult = await fetchAllRows('SELECT * FROM sales_returns WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const transactionFlagsResult = await fetchAllRows('SELECT * FROM transaction_flags WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const holdsResult = await fetchAllRows('SELECT * FROM active_holds WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const customersResult = await fetchAllRows('SELECT * FROM customers WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const suppliersResult = await fetchAllRows('SELECT * FROM suppliers WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const purchaseOrdersResult = await fetchAllRows('SELECT * FROM purchase_orders WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const inventoryBatchesResult = await fetchAllRows('SELECT * FROM inventory_batches WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const proformasResult = await fetchAllRows('SELECT * FROM pro_formas WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const expensesResult = await fetchAllRows('SELECT * FROM expenses WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const internalMessagesResult = await fetchAllRows('SELECT * FROM internal_messages WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const handoverNotesResult = await fetchAllRows('SELECT * FROM handover_notes WHERE store_id = $1 ORDER BY is_pinned DESC, created_at DESC, id DESC', [storeId]);
      const staffAttendanceResult = await fetchAllRows('SELECT * FROM staff_attendance WHERE store_id = $1 ORDER BY shift_date DESC, clock_in_at DESC, id DESC', [storeId]);
      const repairTicketsResult = await fetchAllRows('SELECT * FROM repair_tickets WHERE store_id = $1 ORDER BY id ASC', [storeId]);
      const marketCollectionsResult = await fetchAllRows('SELECT * FROM market_collections WHERE store_id = $1 ORDER BY id ASC', [storeId]);

      return {
        store: storeResult.rows[0] || null,
        users: usersResult,
        categories: categoriesResult,
        products: productsResult,
        stockAdjustments: stockAdjustmentsResult,
        sales: salesResult,
        saleItems: saleItemsResult,
        salesReturns: salesReturnsResult,
        transactionFlags: transactionFlagsResult,
        holds: holdsResult,
        customers: customersResult,
        suppliers: suppliersResult,
        purchaseOrders: purchaseOrdersResult,
        inventoryBatches: inventoryBatchesResult,
        proformas: proformasResult,
        expenses: expensesResult,
        internalMessages: internalMessagesResult,
        handoverNotes: handoverNotesResult,
        staffAttendance: staffAttendanceResult,
        repairTickets: repairTicketsResult,
        marketCollections: marketCollectionsResult,
      };
    },

    async listHandoverNotes(storeId: number, limit: number) {
      const result = await postgresPool.query(`
        SELECT n.*, u.username as author_username, u.role as author_role
        FROM handover_notes n
        LEFT JOIN users u ON n.author_id = u.id
        WHERE n.store_id = $1
        ORDER BY n.is_pinned DESC, n.created_at DESC, n.id DESC
        LIMIT $2
      `, [storeId, limit]);
      return result.rows as any[];
    },

    async getAttendanceOverview(storeId: number, currentUserId: number, selectedDate: string, isLeadership: boolean) {
      const currentSessionResult = await postgresPool.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2 AND sa.clock_out_at IS NULL
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT 1
      `, [storeId, currentUserId]);

      const myEntriesResult = await postgresPool.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT 14
      `, [storeId, currentUserId]);

      const teamEntriesResult = isLeadership
        ? await postgresPool.query(`
            SELECT sa.*, u.username as user_name, u.role
            FROM staff_attendance sa
            LEFT JOIN users u ON sa.user_id = u.id
            WHERE sa.store_id = $1 AND sa.shift_date = $2
            ORDER BY CASE WHEN sa.clock_out_at IS NULL THEN 0 ELSE 1 END, sa.clock_in_at DESC, sa.id DESC
          `, [storeId, selectedDate])
        : { rows: [] as any[] };

      return {
        currentSession: currentSessionResult.rows[0] || null,
        myEntries: myEntriesResult.rows as any[],
        teamEntries: teamEntriesResult.rows as any[],
      };
    },

    async getAttendanceHistory(storeId: number, userId: number, page: number, limit: number) {
      const offset = (page - 1) * limit;
      const countResult = await postgresPool.query(
        'SELECT COUNT(*) FROM staff_attendance WHERE store_id = $1 AND user_id = $2',
        [storeId, userId],
      );
      const total = Number(countResult.rows[0]?.count || 0);
      const rowsResult = await postgresPool.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT $3 OFFSET $4
      `, [storeId, userId, limit, offset]);
      return { rows: rowsResult.rows as any[], total, page, limit };
    },
  };
};
