// api/index.ts
import path6 from "path";
import fs5 from "node:fs";
import dotenv from "dotenv";

// serverDatabase.ts
import { Pool } from "pg";
import path from "node:path";

// serverLocalDatabaseAdapter.ts
import Database from "goody-db-driver";

// serverSchemaBootstrap.ts
var initializeDatabaseSchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mode TEXT CHECK(mode IN ('SUPERMARKET', 'GADGET')) DEFAULT 'SUPERMARKET',
      logo TEXT,
      signature_image TEXT,
      address TEXT,
      phone TEXT,
      is_locked INTEGER DEFAULT 0,
      custom_specs TEXT DEFAULT '[]', -- JSON array of strings
      bank_name TEXT,
      account_number TEXT,
      account_name TEXT,
      currency_code TEXT DEFAULT 'USD',
      receipt_paper_size TEXT CHECK(receipt_paper_size IN ('THERMAL', 'THERMAL_58', 'A4')) DEFAULT 'THERMAL',
      document_color TEXT DEFAULT '#F4BD4A',
      show_store_name_on_documents INTEGER DEFAULT 0,
      tax_enabled INTEGER DEFAULT 0,
      tax_percentage REAL DEFAULT 0,
      receipt_header_note TEXT DEFAULT '',
      receipt_footer_note TEXT DEFAULT 'Thank you for your business!',
      receipt_show_bank_details INTEGER DEFAULT 1,
      default_missing_cost_to_price INTEGER DEFAULT 0,
      discount_codes TEXT DEFAULT '[]',
      staff_announcement_text TEXT DEFAULT '',
      staff_announcement_active INTEGER DEFAULT 0,
      staff_announcement_updated_at DATETIME,
      pin_checkout_enabled INTEGER DEFAULT 1,
      chat_cleanup_reminders_enabled INTEGER DEFAULT 1,
      chat_cleanup_reminder_day INTEGER DEFAULT 28,
      chat_retention_value INTEGER DEFAULT 3,
      chat_retention_unit TEXT CHECK(chat_retention_unit IN ('days', 'months')) DEFAULT 'months',
      last_chat_cleanup_at DATETIME,
      license_key TEXT,
      license_status TEXT DEFAULT 'UNLICENSED',
      license_plan TEXT,
      license_cache_token TEXT,
      license_activated_at DATETIME,
      license_last_validated_at DATETIME,
      license_device_name TEXT,
      vendor_portal_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('SYSTEM_ADMIN', 'STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF')) NOT NULL,
      store_id INTEGER,
      pin TEXT,
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS active_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      staff_name TEXT NOT NULL,
      customer_name TEXT,
      note TEXT,
      cart_data TEXT NOT NULL, -- JSON string of cart items
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      category TEXT,
      category_id INTEGER,
      thumbnail TEXT,
      quick_code TEXT UNIQUE,
      specs TEXT, -- JSON
      condition_matrix TEXT, -- JSON: { new: { price, stock }, used: { price, stock }, open_box: { price, stock } }
      price REAL, -- Default price for supermarket mode
      stock INTEGER, -- Default stock for supermarket mode
      cost REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS consignment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      quick_code TEXT UNIQUE,
      vendor_name TEXT NOT NULL,
      vendor_phone TEXT,
      vendor_address TEXT,
      item_name TEXT NOT NULL,
      imei_serial TEXT UNIQUE,
      quantity INTEGER NOT NULL DEFAULT 1,
      agreed_payout REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      public_specs TEXT DEFAULT '{}',
      internal_condition TEXT,
      added_by INTEGER,
      approved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(added_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, name),
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      subtotal REAL,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL DEFAULT 0,
      discount_note TEXT,
      show_discount_on_invoice INTEGER DEFAULT 1,
      tax_amount REAL DEFAULT 0,
      tax_percentage REAL DEFAULT 0,
      total REAL NOT NULL,
      user_id INTEGER NOT NULL,
      payment_methods TEXT NOT NULL, -- JSON: { cash, transfer, pos }
      status TEXT CHECK(status IN ('COMPLETED', 'PENDING', 'VOIDED')) DEFAULT 'COMPLETED',
      sale_channel TEXT DEFAULT 'STANDARD',
      payment_plan TEXT, -- JSON
      locked_until_paid INTEGER DEFAULT 0,
      pdf_path TEXT,
      customer_id INTEGER,
      customer_name TEXT,
      due_date DATETIME,
      note TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      void_reason TEXT,
      voided_by INTEGER,
      is_ledger_locked INTEGER DEFAULT 0,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(voided_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      address TEXT,
      customer_code TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_sale REAL NOT NULL,
      base_price_at_sale REAL,
      price_markup REAL NOT NULL DEFAULT 0,
      subtotal REAL,
      cost_at_sale REAL,
      imei_serial TEXT,
      condition TEXT,
      specs_at_sale TEXT, -- JSON
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      processed_by INTEGER NOT NULL,
      returned_value REAL NOT NULL DEFAULT 0,
      refund_amount REAL NOT NULL DEFAULT 0,
      refund_method TEXT DEFAULT 'cash',
      return_type TEXT CHECK(return_type IN ('REFUND', 'EXCHANGE', 'RETURN_ONLY')) DEFAULT 'REFUND',
      restock_items INTEGER DEFAULT 1,
      reason TEXT NOT NULL,
      items TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(processed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vendor_payables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      sale_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'SOURCED',
      vendor_name TEXT NOT NULL,
      vendor_reference TEXT,
      item_name TEXT NOT NULL,
      amount_due REAL NOT NULL DEFAULT 0,
      status TEXT CHECK(status IN ('UNPAID', 'SETTLED')) DEFAULT 'UNPAID',
      settled_at DATETIME,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(sale_item_id) REFERENCES sale_items(id)
    );

    CREATE TABLE IF NOT EXISTS consignment_vendor_bank_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      vendor_name TEXT NOT NULL,
      vendor_key TEXT NOT NULL,
      bank_name TEXT,
      account_number TEXT,
      account_name TEXT,
      bank_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, vendor_key),
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      adjusted_by INTEGER NOT NULL,
      adjustment_type TEXT CHECK(adjustment_type IN ('DAMAGED', 'LOST', 'FOUND', 'MANUAL', 'INTERNAL_USE', 'RESTOCK', 'COUNT')) DEFAULT 'MANUAL',
      adjustment_mode TEXT CHECK(adjustment_mode IN ('INCREASE', 'DECREASE', 'SET')) DEFAULT 'DECREASE',
      quantity_before INTEGER NOT NULL DEFAULT 0,
      quantity_change INTEGER NOT NULL DEFAULT 0,
      quantity_after INTEGER NOT NULL DEFAULT 0,
      cost_impact REAL DEFAULT 0,
      condition TEXT,
      note TEXT,
      counted_quantity INTEGER,
      variance_quantity INTEGER DEFAULT 0,
      recount_status TEXT CHECK(recount_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'NOT_REQUIRED',
      approved_by INTEGER,
      approved_at DATETIME,
      approval_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(adjusted_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS product_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      request_type TEXT NOT NULL CHECK(request_type IN ('CREATE', 'UPDATE')),
      product_id INTEGER,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      requested_by INTEGER NOT NULL,
      reviewed_by INTEGER,
      review_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(requested_by) REFERENCES users(id),
      FOREIGN KEY(reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pro_formas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      items TEXT NOT NULL, -- JSON
      subtotal REAL,
      tax_amount REAL DEFAULT 0,
      tax_percentage REAL DEFAULT 0,
      total REAL NOT NULL,
      expiry_date DATETIME NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      amount REAL NOT NULL,
      note TEXT,
      spent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transaction_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      sale_id INTEGER NOT NULL,
      flagged_by INTEGER,
      issue_type TEXT DEFAULT 'CHECK_REQUIRED',
      note TEXT NOT NULL,
      status TEXT CHECK(status IN ('OPEN', 'RESOLVED')) DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by INTEGER,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(flagged_by) REFERENCES users(id),
      FOREIGN KEY(resolved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, name),
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      supplier_id INTEGER,
      supplier_name TEXT,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('ORDERED', 'RECEIVED', 'CANCELLED')) DEFAULT 'ORDERED',
      items TEXT NOT NULL,
      subtotal REAL DEFAULT 0,
      note TEXT,
      expected_date DATE,
      created_by INTEGER,
      received_by INTEGER,
      received_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(received_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS market_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      collector_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      items TEXT NOT NULL,
      expected_return_date DATE NOT NULL,
      tracking_code TEXT NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('OPEN', 'SOLD', 'RETURNED')) DEFAULT 'OPEN',
      note TEXT,
      created_by INTEGER,
      converted_sale_id INTEGER,
      sold_at DATETIME,
      returned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(converted_sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS repair_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      ticket_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      device_name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      imei_serial TEXT,
      issue_summary TEXT NOT NULL,
      accessories TEXT,
      purchase_reference TEXT,
      warranty_status TEXT CHECK(warranty_status IN ('IN_WARRANTY', 'OUT_OF_WARRANTY', 'NO_WARRANTY')) DEFAULT 'NO_WARRANTY',
      technician_name TEXT,
      intake_notes TEXT,
      internal_notes TEXT,
      estimated_cost REAL DEFAULT 0,
      final_cost REAL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      status TEXT CHECK(status IN ('RECEIVED', 'DIAGNOSING', 'AWAITING_PARTS', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED')) DEFAULT 'RECEIVED',
      promised_date DATE,
      created_by INTEGER,
      updated_by INTEGER,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS internal_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      message_text TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(recipient_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS handover_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      note_text TEXT NOT NULL,
      priority TEXT CHECK(priority IN ('INFO', 'IMPORTANT')) DEFAULT 'INFO',
      is_pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      purchase_order_id INTEGER,
      received_by INTEGER,
      condition TEXT,
      batch_code TEXT,
      expiry_date TEXT,
      quantity_received INTEGER NOT NULL DEFAULT 0,
      quantity_remaining INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY(received_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      shift_date TEXT NOT NULL,
      clock_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      clock_out_at DATETIME,
      total_minutes INTEGER DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(store_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_products_store_category ON products(store_id, category);
      CREATE INDEX IF NOT EXISTS idx_consignment_items_store_status ON consignment_items(store_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_consignment_items_store_name ON consignment_items(store_id, item_name);
      CREATE INDEX IF NOT EXISTS idx_consignment_items_store_quick_code ON consignment_items(store_id, quick_code);
      CREATE INDEX IF NOT EXISTS idx_consignment_items_store_imei ON consignment_items(store_id, imei_serial);
      CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id);
      CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sales_store_timestamp ON sales(store_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_sales_store_status_timestamp ON sales(store_id, status, timestamp);
      CREATE INDEX IF NOT EXISTS idx_sales_store_customer_timestamp ON sales(store_id, customer_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_sales_store_due_date ON sales(store_id, due_date);
      CREATE INDEX IF NOT EXISTS idx_sales_store_channel_status_due ON sales(store_id, sale_channel, status, due_date);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sales_returns_sale_id ON sales_returns(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sales_returns_store_created ON sales_returns(store_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vendor_payables_store_status_created ON vendor_payables(store_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vendor_payables_sale_item ON vendor_payables(sale_item_id);
      CREATE INDEX IF NOT EXISTS idx_vendor_payables_vendor_name ON vendor_payables(store_id, vendor_name);
      CREATE INDEX IF NOT EXISTS idx_stock_adjustments_store_created ON stock_adjustments(store_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_created ON stock_adjustments(product_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_product_change_requests_store_status_created ON product_change_requests(store_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_product_change_requests_product_created ON product_change_requests(product_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
      CREATE INDEX IF NOT EXISTS idx_customers_store_phone ON customers(store_id, phone);
      CREATE INDEX IF NOT EXISTS idx_pro_formas_store_id ON pro_formas(store_id);
      CREATE INDEX IF NOT EXISTS idx_pro_formas_expiry ON pro_formas(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_active_holds_store_id ON active_holds(store_id);
      CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id);
      CREATE INDEX IF NOT EXISTS idx_categories_store_id ON categories(store_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_store_id ON expenses(store_id, spent_at);
      CREATE INDEX IF NOT EXISTS idx_expenses_store_category_date ON expenses(store_id, category, spent_at);
      CREATE INDEX IF NOT EXISTS idx_system_activity_logs_store_created ON system_activity_logs(store_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system_logs_store_timestamp ON system_logs(store_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_system_logs_action_timestamp ON system_logs(store_id, action_type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_transaction_flags_store_created ON transaction_flags(store_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_suppliers_store_name ON suppliers(store_id, name);
      CREATE TRIGGER IF NOT EXISTS system_logs_block_update
      BEFORE UPDATE ON system_logs
      BEGIN
        SELECT RAISE(ABORT, 'system_logs is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS system_logs_block_delete
      BEFORE DELETE ON system_logs
      BEGIN
        SELECT RAISE(ABORT, 'system_logs is immutable');
      END;
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_status_created ON purchase_orders(store_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_created ON purchase_orders(store_id, supplier_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_market_collections_store_id ON market_collections(store_id, status, expected_return_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_market_collections_tracking_code ON market_collections(tracking_code);
      CREATE INDEX IF NOT EXISTS idx_repair_tickets_store_status_created ON repair_tickets(store_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_repair_tickets_store_promised_date ON repair_tickets(store_id, promised_date, status);
      CREATE INDEX IF NOT EXISTS idx_internal_messages_store_participants ON internal_messages(store_id, sender_id, recipient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_internal_messages_recipient_read ON internal_messages(recipient_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_handover_notes_store_created ON handover_notes(store_id, is_pinned, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_batches_store_product_expiry ON inventory_batches(store_id, product_id, expiry_date, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_batches_store_expiry_remaining ON inventory_batches(store_id, expiry_date, quantity_remaining);
      CREATE INDEX IF NOT EXISTS idx_staff_attendance_store_shift_date ON staff_attendance(store_id, shift_date DESC, clock_in_at DESC);
      CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_shift_date ON staff_attendance(user_id, shift_date DESC, clock_in_at DESC);
      CREATE INDEX IF NOT EXISTS idx_handover_notes_author_created ON handover_notes(author_id, created_at DESC);
    `);
  } catch {
  }
};

// serverLocalDatabaseAdapter.ts
var getSqlCommand = (sql) => {
  const match = String(sql || "").trim().match(/^([A-Z]+)/i);
  return String(match?.[1] || "").toUpperCase();
};
var isMutating = (sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql);
var expandAnyArrays = (sql, params) => {
  const anyPattern = /=\s*ANY\s*\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/gi;
  if (!anyPattern.test(sql)) return { sql, params };
  anyPattern.lastIndex = 0;
  const newParams = [...params];
  let result = sql;
  const matches = [];
  let m;
  while ((m = anyPattern.exec(sql)) !== null) {
    matches.push({ fullMatch: m[0], paramNum: parseInt(m[1], 10), index: m.index });
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, paramNum, index } = matches[i];
    const paramIdx = paramNum - 1;
    const arr = Array.isArray(newParams[paramIdx]) ? newParams[paramIdx] : [];
    if (arr.length === 0) {
      result = result.substring(0, index) + "IN (NULL)" + result.substring(index + fullMatch.length);
      newParams.splice(paramIdx, 1);
    } else {
      const placeholders = arr.map((_, j) => `$${paramNum + j}`).join(", ");
      result = result.substring(0, index) + `IN (${placeholders})` + result.substring(index + fullMatch.length);
      newParams.splice(paramIdx, 1, ...arr);
    }
  }
  let idx = 0;
  result = result.replace(/\$(\d+)/g, () => {
    idx += 1;
    return `$${idx}`;
  });
  return { sql: result, params: newParams };
};
var stripTypeCasts = (sql) => sql.replace(/::(int|integer|text|double precision|jsonb|numeric|real|bigint|varchar|boolean|date|timestamptz|timestamp|text\[\]|int\[\]|integer\[\])\b/gi, "");
var extractReturning = (sql) => {
  const rAll = sql.match(/\s+RETURNING\s+\*\s*$/i);
  const rId = sql.match(/\s+RETURNING\s+id\s*$/i);
  if (!rAll && !rId) return { sql, mode: "none", tableName: null, isUpdate: false };
  const tblMatch = sql.match(/^\s*(?:INSERT\s+INTO|UPDATE)\s+(\w+)/i);
  const isUpdate = /^\s*UPDATE\b/i.test(sql);
  return {
    sql: sql.replace(/\s+RETURNING\s+(?:id|\*)\s*$/i, ""),
    mode: rAll ? "all" : "id",
    tableName: tblMatch?.[1] ?? null,
    isUpdate
  };
};
var translateFunctions = (sql) => {
  let s = sql;
  s = s.replace(/\bNOW\(\)/gi, "datetime('now')");
  s = s.replace(
    /CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `datetime('now', '-${n} ${u}s')`
  );
  s = s.replace(
    /CURRENT_TIMESTAMP\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `datetime('now', '+${n} ${u}s')`
  );
  s = s.replace(
    /CURRENT_DATE\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `date('now', '-${n} ${u}s')`
  );
  s = s.replace(
    /CURRENT_DATE\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `date('now', '+${n} ${u}s')`
  );
  s = s.replace(
    /datetime\('now'\)\s*-\s*CAST\s*\(\s*(\$\d+)\s+AS\s+INTERVAL\s*\)/gi,
    (_, param) => `goodypos_datetime_sub_interval(datetime('now'), ${param})`
  );
  s = s.replace(
    /LPAD\s*\(\s*CAST\s*\(\s*([\w.]+)\s+AS\s+TEXT\s*\)\s*,\s*(\d+)\s*,\s*'(\d)'\s*\)/gi,
    (_, expr, width, pad) => `substr('${pad.repeat(parseInt(width, 10))}' || CAST(${expr} AS TEXT), -${width})`
  );
  s = s.replace(/\bGREATEST\s*\(/gi, "MAX(");
  s = s.replace(/\bLEAST\s*\(/gi, "MIN(");
  s = s.replace(
    /([\w.]+)\s*->>\s*'(\w+)'/gi,
    (_, expr, key) => `json_extract(${expr}, '$.${key}')`
  );
  s = s.replace(
    /REGEXP_REPLACE\s*\(\s*COALESCE\s*\(\s*(\w+)\s*,\s*''\s*\)\s*,\s*'\[\^0-9\]'\s*,\s*''\s*,\s*'g'\s*\)/gi,
    (_, col) => `goodypos_digits_only(COALESCE(${col}, ''))`
  );
  return s;
};
var dollarToPositional = (sql) => {
  const map = [];
  const out = sql.replace(/\$(\d+)/g, (_, n) => {
    map.push(parseInt(n, 10) - 1);
    return "?";
  });
  return { sql: out, map };
};
var reorder = (params, map) => map.length ? map.map((i) => params[i] ?? null) : params;
var normalizeParam = (v) => {
  if (v === void 0 || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && !Buffer.isBuffer(v)) {
    const json = JSON.stringify(v);
    return json === "null" ? null : json;
  }
  if (v === "null") return null;
  return v;
};
var translateDdl = (sql) => {
  let s = sql;
  s = s.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");
  s = s.replace(/\bJSONB\b/gi, "TEXT");
  s = s.replace(/\bDOUBLE\s+PRECISION\b/gi, "REAL");
  s = s.replace(/\bNUMERIC\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, "REAL");
  s = s.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, "TEXT");
  s = s.replace(/\bTIMESTAMP\b/gi, "DATETIME");
  s = s.replace(/'{}'\s*$/gm, "'{}'");
  s = s.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, "ADD COLUMN");
  return s;
};
var isAlterAddColumn = (sql) => /^\s*ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(sql);
var translateGenerateSeries = (sql) => {
  const gsStart = sql.search(/WITH\s+\w+\s+AS\s*\(\s*SELECT\s+generate_series\s*\(/i);
  if (gsStart === -1) return sql;
  const headerMatch = sql.slice(gsStart).match(/WITH\s+(\w+)\s+AS\s*\(\s*SELECT\s+generate_series\s*\(/);
  if (!headerMatch) return sql;
  const cteName = headerMatch[1];
  const parenStart = gsStart + headerMatch[0].length - 1;
  let depth = 1;
  let pos = parenStart + 1;
  while (pos < sql.length && depth > 0) {
    if (sql[pos] === "(") depth++;
    else if (sql[pos] === ")") depth--;
    pos++;
  }
  const rawArgs = sql.slice(parenStart + 1, pos - 1);
  const afterParen = sql.slice(pos);
  const colNameMatch = afterParen.match(/^\s+AS\s+(\w+)\s*\)/i);
  if (!colNameMatch) return sql;
  const colName = colNameMatch[1];
  const fullMatchEnd = pos + colNameMatch[0].length;
  const fullMatch = sql.slice(gsStart, fullMatchEnd);
  const args = rawArgs.split(",").map((a) => a.trim());
  if (args.length < 2) return sql;
  let startExpr = args[0];
  let endExpr = args[1];
  const intrvl = (s) => s.replace(/CURRENT_DATE\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi, (_, n, u) => `date('now', '-${n} ${u}s')`).replace(/CURRENT_DATE\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi, (_, n, u) => `date('now', '+${n} ${u}s')`).replace(/\bCURRENT_DATE\b/gi, "date('now')");
  startExpr = intrvl(startExpr);
  endExpr = intrvl(endExpr);
  const recursive = `WITH RECURSIVE ${cteName}(${colName}) AS (SELECT ${startExpr} UNION ALL SELECT date(${colName}, '+1 day') FROM ${cteName} WHERE ${colName} < ${endExpr})`;
  return sql.replace(fullMatch, recursive);
};
var translate = (sql, params = []) => {
  let s = String(sql || "").trim();
  let p = (params || []).map(normalizeParam);
  const upper = s.toUpperCase();
  if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") {
    return { sql: s, params: [], returningMode: "none", tableName: null, isUpdate: false };
  }
  if (/\bpg_get_serial_sequence\b/i.test(s) || /\bsetval\b/i.test(s) || /\bcurrent_database\(\)/i.test(s) || /\bversion\(\)/i.test(s)) {
    return { sql: "", params: [], returningMode: "none", tableName: null, isUpdate: false };
  }
  if (/^\s*(CREATE|ALTER|DROP)\b/i.test(s)) {
    s = translateDdl(s);
    s = stripTypeCasts(s);
    return { sql: s, params: [], returningMode: "none", tableName: null, isUpdate: false };
  }
  const expanded = expandAnyArrays(s, p);
  s = expanded.sql;
  p = expanded.params;
  s = stripTypeCasts(s);
  s = translateGenerateSeries(s);
  s = translateFunctions(s);
  const ret = extractReturning(s);
  s = ret.sql;
  const pos = dollarToPositional(s);
  s = pos.sql;
  p = reorder(p, pos.map);
  return { sql: s, params: p, returningMode: ret.mode, tableName: ret.tableName, isUpdate: ret.isUpdate };
};
var LocalDatabaseClient = class {
  constructor(db) {
    this.db = db;
  }
  async query(sql, params) {
    return executeLocalQuery(this.db, sql, params);
  }
  release() {
  }
};
var executeLocalQuery = (db, sql, params = []) => {
  const { sql: tSql, params: tParams, returningMode, tableName, isUpdate } = translate(sql, params);
  if (!tSql) {
    return { rows: [], rowCount: 0, command: "" };
  }
  const command = getSqlCommand(tSql);
  if (command === "BEGIN" || command === "COMMIT" || command === "ROLLBACK") {
    try {
      db.exec(tSql);
    } catch {
    }
    return { rows: [], rowCount: 0, command };
  }
  if (command === "CREATE" || command === "DROP") {
    try {
      db.exec(tSql);
    } catch {
    }
    return { rows: [], rowCount: 0, command };
  }
  if (command === "ALTER") {
    if (isAlterAddColumn(tSql)) {
      try {
        db.exec(tSql);
      } catch {
      }
    } else {
      try {
        db.exec(tSql);
      } catch {
      }
    }
    return { rows: [], rowCount: 0, command };
  }
  if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(tSql)) {
    try {
      db.exec(tSql);
    } catch {
    }
    return { rows: [], rowCount: 0, command: "CREATE" };
  }
  if (isMutating(tSql)) {
    let updateWhereId = null;
    if (isUpdate && returningMode !== "none" && tableName) {
      const whereIdMatch = tSql.match(/WHERE\s+id\s*=\s*\?/i);
      if (whereIdMatch) {
        const beforeWhere = tSql.substring(0, whereIdMatch.index);
        const qCount = (beforeWhere.match(/\?/g) || []).length;
        updateWhereId = Number(tParams[qCount]) || null;
      }
    }
    const stmt2 = db.prepare(tSql);
    const result = stmt2.run(...tParams);
    const lastId = Number(result.lastInsertRowid || 0);
    const changes = Number(result.changes || 0);
    if (returningMode === "id") {
      if (isUpdate && updateWhereId) {
        return { rows: [{ id: updateWhereId }], rowCount: changes, command };
      }
      return { rows: [{ id: lastId }], rowCount: changes, command };
    }
    if (returningMode === "all" && tableName) {
      const lookupId = isUpdate ? updateWhereId || lastId : lastId;
      if (lookupId) {
        const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(lookupId);
        return { rows: row ? [row] : [], rowCount: changes, command };
      }
      if (lastId) {
        const row = db.prepare(`SELECT * FROM ${tableName} WHERE rowid = ?`).get(lastId);
        return { rows: row ? [row] : [], rowCount: changes, command };
      }
      return { rows: [], rowCount: changes, command };
    }
    return { rows: [], rowCount: changes, command };
  }
  const stmt = db.prepare(tSql);
  const rows = stmt.all(...tParams);
  return { rows, rowCount: rows.length, command };
};
var createLocalDatabasePool = (databasePath) => {
  const db = new Database(databasePath);
  const registerCustomFunctions = () => {
    const rawDb = db._db;
    if (!rawDb?.create_function) return;
    rawDb.create_function(
      "goodypos_digits_only",
      (input) => String(input || "").replace(/[^0-9]/g, "")
    );
    rawDb.create_function("REGEXP_REPLACE", (input, pattern, replacement, _flags) => {
      try {
        const flags = String(_flags || "").replace(/[^gimsuy]/g, "");
        return String(input || "").replace(new RegExp(pattern, flags), replacement);
      } catch {
        return String(input || "");
      }
    });
    rawDb.create_function("goodypos_datetime_sub_interval", (dt, interval) => {
      const match = String(interval || "").match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?/i);
      if (!match) return dt;
      const n = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      const d = new Date(dt || (/* @__PURE__ */ new Date()).toISOString());
      switch (unit) {
        case "second":
          d.setSeconds(d.getSeconds() - n);
          break;
        case "minute":
          d.setMinutes(d.getMinutes() - n);
          break;
        case "hour":
          d.setHours(d.getHours() - n);
          break;
        case "day":
          d.setDate(d.getDate() - n);
          break;
        case "week":
          d.setDate(d.getDate() - n * 7);
          break;
        case "month":
          d.setMonth(d.getMonth() - n);
          break;
        case "year":
          d.setFullYear(d.getFullYear() - n);
          break;
      }
      return d.toISOString().replace("T", " ").substring(0, 19);
    });
  };
  registerCustomFunctions();
  const origPersist = db._persistLocalDatabase?.bind(db);
  if (origPersist) {
    db._persistLocalDatabase = function() {
      origPersist();
      registerCustomFunctions();
    };
  }
  initializeDatabaseSchema(db);
  return {
    __isLocalAdapter: true,
    async query(sql, params) {
      return executeLocalQuery(db, sql, params);
    },
    async connect() {
      return new LocalDatabaseClient(db);
    },
    async end() {
      try {
        db.close();
      } catch {
      }
    }
  };
};

// serverDatabase.ts
var normalizeProvider = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (v === "local" || v === "sqlite") return "local";
  return "postgres";
};
var isTruthyFlag = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};
var getConfiguredDatabaseProvider = () => {
  const explicitProvider = process.env.GOODY_POS_DB_PROVIDER || process.env.GOODY_POS_DATABASE_PROVIDER || "";
  if (explicitProvider) return normalizeProvider(explicitProvider);
  if (getConfiguredPostgresUrl()) return "postgres";
  return "local";
};
var getConfiguredPostgresUrl = () => {
  return String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || "").trim();
};
var shouldUsePostgresSsl = () => {
  return isTruthyFlag(process.env.GOODY_POS_POSTGRES_SSL);
};
var createPostgresPool = () => {
  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString) {
    return null;
  }
  return new Pool({
    connectionString,
    ssl: shouldUsePostgresSsl() ? { rejectUnauthorized: false } : void 0,
    max: 6
  });
};
var postgresSequenceTables = [
  "stores",
  "users",
  "categories",
  "products",
  "consignment_items",
  "customers",
  "sales",
  "sale_items",
  "sales_returns",
  "expenses",
  "suppliers",
  "purchase_orders",
  "inventory_batches",
  "market_collections",
  "repair_tickets",
  "staff_attendance",
  "internal_messages",
  "handover_notes",
  "pro_formas",
  "stock_adjustments",
  "product_change_requests",
  "transaction_flags",
  "vendor_payables"
];
var syncPostgresSequences = async (pool) => {
  for (const tableName of postgresSequenceTables) {
    try {
      await pool.query(`
        SELECT setval(
          pg_get_serial_sequence('${tableName}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1,
          false
        )
      `);
    } catch {
    }
  }
};
var openPrimaryDatabase = (dataRootDir2) => {
  const selectedProvider = getConfiguredDatabaseProvider();
  if (selectedProvider === "local") {
    const dbDir = dataRootDir2 || process.cwd();
    const dbPath = path.join(dbDir, "pos.db");
    const localPool = createLocalDatabasePool(dbPath);
    return {
      selectedProvider,
      postgresConfigured: false,
      postgresPool: localPool,
      isLocalAdapter: true
    };
  }
  const postgresPool2 = createPostgresPool();
  return {
    selectedProvider,
    postgresConfigured: Boolean(getConfiguredPostgresUrl()),
    postgresPool: postgresPool2,
    isLocalAdapter: false
  };
};
var testPostgresConnection = async (existingPool) => {
  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString && !existingPool) {
    throw new Error("Missing GOODY_POS_POSTGRES_URL or DATABASE_URL");
  }
  const pool = existingPool || createPostgresPool();
  if (!pool) {
    throw new Error("PostgreSQL pool could not be created from the current environment");
  }
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
             current_user AS database_user,
             version() AS version
    `);
    const row = result.rows[0] || {};
    return {
      databaseName: String(row.database_name || ""),
      databaseUser: String(row.database_user || ""),
      version: String(row.version || "")
    };
  } finally {
    if (!existingPool) {
      await pool.end();
    }
  }
};
var logDatabaseConfiguration = async (options) => {
  const { selectedProvider, postgresPool: postgresPool2 = null, isLocalAdapter: isLocalAdapter2 = false } = options;
  if (isLocalAdapter2) {
    console.log(`\u{1F5C4}\uFE0F Runtime database engine: LOCAL (embedded SQLite)`);
    console.log("\u{1F4E6} Offline mode \u2014 no external database required.");
    return;
  }
  if (!postgresPool2) {
    console.error("\u274C No PostgreSQL URL configured. GoodyPOS requires a database. Set DATABASE_URL or GOODY_POS_POSTGRES_URL.");
    return;
  }
  console.log(`\u{1F5C4}\uFE0F Runtime database engine: ${selectedProvider.toUpperCase()}`);
  console.log("\u{1F418} PostgreSQL mode is active.");
  try {
    const connection = await testPostgresConnection(postgresPool2);
    await syncPostgresSequences(postgresPool2);
    console.log(`\u{1F418} PostgreSQL connection ready: ${connection.databaseName || "database"} as ${connection.databaseUser || "user"}`);
    console.log("\u{1F527} PostgreSQL ID sequences aligned with the current dataset.");
  } catch (error) {
    console.warn("\u26A0\uFE0F PostgreSQL connection check failed:", error instanceof Error ? error.message : error);
  }
};

// serverRuntimeEnvironment.ts
import fs from "fs";
import os from "os";
import path2 from "path";
import { randomBytes } from "crypto";
var resolveDefaultDataRootDir = (appBaseDir2) => {
  const configuredDataDir = String(process.env.GOODY_POS_DATA_DIR || "").trim();
  if (configuredDataDir) {
    return path2.resolve(configuredDataDir);
  }
  return appBaseDir2;
};
var initializeRuntimeEnvironment = (appBaseDir2) => {
  const dataRootDir2 = resolveDefaultDataRootDir(appBaseDir2);
  if (!fs.existsSync(dataRootDir2)) {
    fs.mkdirSync(dataRootDir2, { recursive: true });
  }
  const uploadsRootDir2 = path2.join(dataRootDir2, "uploads");
  const uploadsDir2 = path2.join(uploadsRootDir2, "invoices");
  const dailyBackupDir2 = path2.join(dataRootDir2, "backups", "daily");
  const safetySnapshotDir2 = path2.join(dataRootDir2, "backups", "snapshots");
  const quarantineBackupDir = path2.join(dataRootDir2, "backups", "quarantine");
  [uploadsDir2, dailyBackupDir2, safetySnapshotDir2, quarantineBackupDir].forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
  const normalizedAppDir = path2.resolve(appBaseDir2);
  const normalizedDataDir = path2.resolve(dataRootDir2);
  if (normalizedAppDir !== normalizedDataDir) {
    const legacyDbPath = path2.join(appBaseDir2, "pos.db");
    const targetDbPath = path2.join(dataRootDir2, "pos.db");
    if (fs.existsSync(legacyDbPath) && !fs.existsSync(targetDbPath)) {
      try {
        for (const suffix of ["", "-wal", "-shm"]) {
          const source = `${legacyDbPath}${suffix}`;
          const destination = `${targetDbPath}${suffix}`;
          if (fs.existsSync(source) && !fs.existsSync(destination)) {
            fs.copyFileSync(source, destination);
          }
        }
        const legacyUploadsDir = path2.join(appBaseDir2, "uploads");
        if (fs.existsSync(legacyUploadsDir)) {
          fs.cpSync(legacyUploadsDir, uploadsRootDir2, { recursive: true, force: false, errorOnExist: false });
        }
        const legacyBackupsDir = path2.join(appBaseDir2, "backups");
        const targetBackupsDir = path2.join(dataRootDir2, "backups");
        if (fs.existsSync(legacyBackupsDir)) {
          fs.cpSync(legacyBackupsDir, targetBackupsDir, { recursive: true, force: false, errorOnExist: false });
        }
        console.log(`\u{1F4E6} Migrated legacy GoodyPOS data from ${legacyDbPath} to ${targetDbPath}`);
      } catch (error) {
        console.warn("Legacy data migration could not be completed automatically:", error);
      }
    }
  }
  const isDesktopRuntime2 = Boolean(process.env.GOODY_POS_DATA_DIR);
  const hasProductionBuild = fs.existsSync(path2.join(appBaseDir2, "server.mjs")) && fs.existsSync(path2.join(appBaseDir2, "dist", "index.html"));
  const NODE_ENV2 = process.env.NODE_ENV || (isDesktopRuntime2 || hasProductionBuild ? "production" : "development");
  process.env.NODE_ENV = NODE_ENV2;
  const dbFilePath = path2.join(dataRootDir2, "pos.db");
  const makeSafeTimestamp2 = (date = /* @__PURE__ */ new Date()) => date.toISOString().replace(/[:.]/g, "-");
  return {
    dataRootDir: dataRootDir2,
    uploadsRootDir: uploadsRootDir2,
    uploadsDir: uploadsDir2,
    dailyBackupDir: dailyBackupDir2,
    safetySnapshotDir: safetySnapshotDir2,
    dbFilePath,
    isDesktopRuntime: isDesktopRuntime2,
    NODE_ENV: NODE_ENV2,
    makeSafeTimestamp: makeSafeTimestamp2
  };
};
var resolveJwtSecret = ({
  isDesktopRuntime: isDesktopRuntime2,
  dataRootDir: dataRootDir2,
  nodeEnv
}) => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (isDesktopRuntime2) {
    const jwtSecretPath = path2.join(dataRootDir2, ".jwt-secret");
    try {
      if (fs.existsSync(jwtSecretPath)) {
        const existingSecret = fs.readFileSync(jwtSecretPath, "utf8").trim();
        if (existingSecret) {
          return existingSecret;
        }
      }
      const generatedSecret = randomBytes(48).toString("hex");
      fs.writeFileSync(jwtSecretPath, generatedSecret, { mode: 384 });
      console.warn("\u26A0\uFE0F  Warning: JWT_SECRET not set. Generated a device-local desktop secret.");
      return generatedSecret;
    } catch (error) {
      console.warn("\u26A0\uFE0F  Warning: Failed to persist desktop JWT secret. Falling back to a temporary in-memory secret.", error);
      return randomBytes(48).toString("hex");
    }
  }
  if (nodeEnv === "development") {
    console.warn("\u26A0\uFE0F  Warning: JWT_SECRET not set. Using development default (INSECURE).");
    return "dev-key-change-in-production-12345";
  }
  return void 0;
};
var getLicenseDeviceInfo = (dataRootDir2) => {
  const deviceIdentityParts = [os.platform(), os.arch(), os.hostname()].map((value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")).filter(Boolean);
  const deviceFingerprintFile = path2.join(dataRootDir2, `.goodypos-device-id-${deviceIdentityParts.join("-") || "default"}`);
  const legacyFingerprintFile = path2.join(dataRootDir2, ".goodypos-device-id");
  const currentDevicePrefix = `${os.platform()}:${os.arch()}:`;
  const getOrCreateDeviceFingerprint = () => {
    try {
      if (fs.existsSync(deviceFingerprintFile)) {
        const existing = fs.readFileSync(deviceFingerprintFile, "utf8").trim();
        if (existing) {
          return existing;
        }
      }
      if (fs.existsSync(legacyFingerprintFile)) {
        const legacyValue = fs.readFileSync(legacyFingerprintFile, "utf8").trim();
        if (legacyValue && legacyValue.startsWith(currentDevicePrefix)) {
          fs.writeFileSync(deviceFingerprintFile, legacyValue, { mode: 384 });
          return legacyValue;
        }
      }
      const generated = [os.platform(), os.arch(), os.hostname(), randomBytes(12).toString("hex")].join(":");
      fs.writeFileSync(deviceFingerprintFile, generated, { mode: 384 });
      return generated;
    } catch (error) {
      console.warn("Device fingerprint persistence failed. Falling back to an in-memory identifier.", error);
      return [os.platform(), os.arch(), os.hostname(), randomBytes(12).toString("hex")].join(":");
    }
  };
  return {
    deviceFingerprint: getOrCreateDeviceFingerprint(),
    deviceName: `${os.hostname()} (${os.platform()})`
  };
};

// serverSecurity.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
var createSecurityHelpers = ({
  postgresPool: postgresPool2,
  jwtSecret,
  maxLoginAttempts,
  lockoutDurationMs
}) => {
  const loginAttempts = /* @__PURE__ */ new Map();
  const getLoginAttemptKey2 = (username, ipAddress) => `${String(ipAddress ?? "unknown")}:${String(username).trim().toLowerCase()}`;
  const getRemainingLockoutMs2 = (key) => {
    const attempt = loginAttempts.get(key);
    if (!attempt) {
      return 0;
    }
    const remaining = attempt.lockUntil - Date.now();
    if (remaining <= 0) {
      loginAttempts.delete(key);
      return 0;
    }
    return remaining;
  };
  const registerFailedLogin2 = (key) => {
    const now = Date.now();
    const current = loginAttempts.get(key);
    const nextCount = !current || current.lockUntil <= now ? 1 : current.count + 1;
    const lockUntil = nextCount >= maxLoginAttempts ? now + lockoutDurationMs : 0;
    loginAttempts.set(key, {
      count: nextCount,
      lockUntil,
      lastAttemptAt: now
    });
    return {
      remainingAttempts: Math.max(0, maxLoginAttempts - nextCount),
      lockUntil
    };
  };
  const clearLoginAttempt2 = (key) => {
    loginAttempts.delete(key);
  };
  const normalizePin2 = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 6);
  const hashPin3 = (pin) => bcrypt.hashSync(normalizePin2(pin), 10);
  const verifyPin2 = (pin, hash2) => {
    const normalizedPin = normalizePin2(pin);
    const storedHash = String(hash2 || "").trim();
    if (!normalizedPin || !storedHash) {
      return false;
    }
    try {
      return bcrypt.compareSync(normalizedPin, storedHash);
    } catch {
      return storedHash === normalizedPin;
    }
  };
  const resolveCheckoutActorByPin2 = async (storeId, pin) => {
    const normalizedStoreId = Number(storeId);
    const normalizedPin = normalizePin2(pin);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0 || !/^\d{4,6}$/.test(normalizedPin)) {
      return null;
    }
    const result = await postgresPool2.query(`
      SELECT id, username, role, store_id, pin
      FROM users
      WHERE store_id = $1
        AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
        AND pin IS NOT NULL
    `, [normalizedStoreId]);
    const candidates = result.rows;
    return candidates.find((candidate) => verifyPin2(normalizedPin, String(candidate?.pin || ""))) || null;
  };
  const findUserById2 = async (userId) => {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      return null;
    }
    const result = await postgresPool2.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [normalizedUserId]);
    return result.rows[0] || null;
  };
  const findStoreById2 = async (storeId) => {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return null;
    }
    const result = await postgresPool2.query("SELECT * FROM stores WHERE id = $1 LIMIT 1", [normalizedStoreId]);
    return result.rows[0] || null;
  };
  const authenticate2 = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, jwtSecret);
      const currentUser = await findUserById2(decoded?.id);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }
      req.user = {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        store_id: currentUser.store_id ?? null
      };
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
  const authorize2 = (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
  const checkStoreLock2 = async (req, res, next) => {
    if (req.user.role === "SYSTEM_ADMIN") return next();
    const normalizedStoreId = Number(req.user.store_id || 0);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return res.status(403).json({ error: "This account is not linked to an active store. Ask the system admin to reassign it." });
    }
    const store = await findStoreById2(normalizedStoreId);
    if (!store) {
      return res.status(403).json({ error: "This account is linked to a store that no longer exists. Ask the system admin to fix it." });
    }
    req.store = store;
    if (Number(store.is_locked) === 1) {
      return res.status(403).json({ error: "Store is locked by System Administrator" });
    }
    next();
  };
  return {
    getLoginAttemptKey: getLoginAttemptKey2,
    getRemainingLockoutMs: getRemainingLockoutMs2,
    registerFailedLogin: registerFailedLogin2,
    clearLoginAttempt: clearLoginAttempt2,
    normalizePin: normalizePin2,
    hashPin: hashPin3,
    verifyPin: verifyPin2,
    resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
    findUserById: findUserById2,
    findStoreById: findStoreById2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2
  };
};
var ensureRootSystemOwner = async ({
  postgresPool: postgresPool2,
  rootUsername = "Goody",
  initialAdminPassword
}) => {
  const existingResult = await postgresPool2.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", [rootUsername]);
  if (existingResult.rows[0]) {
    return;
  }
  const hashedPassword = bcrypt.hashSync(initialAdminPassword, 10);
  console.warn("\u26A0\uFE0F  Initial admin password: Check INITIAL_ADMIN_PASSWORD environment variable. Change on first login.");
  const oldAdminResult = await postgresPool2.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", ["admin"]);
  const oldAdmin = oldAdminResult.rows[0];
  if (oldAdmin) {
    await postgresPool2.query("UPDATE users SET username = $1, password = $2 WHERE id = $3", [rootUsername, hashedPassword, oldAdmin.id]);
    console.log("\u2705 Root System Owner updated to: Goody");
  } else {
    await postgresPool2.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", [rootUsername, hashedPassword, "SYSTEM_ADMIN"]);
    console.log("\u2705 Root System Owner created: Goody");
  }
};

// serverLegacyMigrations.ts
var LEGACY_QUICK_CODE_PATTERN = /^([1-9])\1\1\d{2}$/;
var buildRepeatedPrefixQuickCode = (leadingDigit, trailingValue) => {
  const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
  const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, "0");
  return `${repeatedDigit.repeat(3)}${suffix}`;
};
var createQuickCodeAllocator = (existingCodes) => {
  const taken = new Set(
    Array.from(existingCodes, (code) => String(code || "").trim()).filter((code) => LEGACY_QUICK_CODE_PATTERN.test(code))
  );
  return (seed = 0) => {
    const safeSeed = Math.max(0, Math.trunc(seed) || 0);
    for (let offset = 0; offset < 900; offset += 1) {
      const candidateIndex = (safeSeed + offset) % 900;
      const candidate = buildRepeatedPrefixQuickCode(
        Math.floor(candidateIndex / 100) + 1,
        candidateIndex % 100
      );
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    return null;
  };
};
var normalizePostgresProductQuickCodes = async (postgresPool2) => {
  if (!postgresPool2) return;
  try {
    const result = await postgresPool2.query("SELECT id, quick_code FROM products WHERE deleted_at IS NULL ORDER BY id ASC");
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const allocateQuickCode = createQuickCodeAllocator(rows.map((row) => String(row?.quick_code || "").trim()));
    let updatedCount = 0;
    for (const row of rows) {
      const currentQuickCode = String(row?.quick_code || "").trim();
      if (LEGACY_QUICK_CODE_PATTERN.test(currentQuickCode)) {
        continue;
      }
      const nextQuickCode = allocateQuickCode(Number(row?.id) || 0);
      if (!nextQuickCode) {
        continue;
      }
      await postgresPool2.query("UPDATE products SET quick_code = $1 WHERE id = $2", [nextQuickCode, row.id]);
      updatedCount += 1;
    }
    if (updatedCount > 0) {
      console.log(`\u{1F501} Normalized ${updatedCount} legacy product quick code(s) in PostgreSQL.`);
    }
  } catch (error) {
    console.warn("Quick-code normalization skipped for PostgreSQL:", error);
  }
};
var runLegacyDatabaseMigrations = async ({ postgresPool: postgresPool2, isLocalAdapter: isLocalAdapter2 }) => {
  if (!isLocalAdapter2) {
    await normalizePostgresProductQuickCodes(postgresPool2);
  }
  if (postgresPool2) {
    try {
      await postgresPool2.query(`
        CREATE TABLE IF NOT EXISTS consignment_items (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL REFERENCES stores(id),
          quick_code VARCHAR(80) UNIQUE,
          vendor_name TEXT NOT NULL,
          vendor_phone TEXT,
          vendor_address TEXT,
          item_name TEXT NOT NULL,
          imei_serial VARCHAR(160) UNIQUE,
          quantity INTEGER NOT NULL DEFAULT 1,
          agreed_payout NUMERIC(14, 2) NOT NULL DEFAULT 0,
          selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          public_specs JSONB DEFAULT '{}'::jsonb,
          internal_condition TEXT,
          added_by INTEGER REFERENCES users(id),
          approved_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_consignment_items_store_status ON consignment_items(store_id, status, updated_at DESC)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_consignment_items_store_name ON consignment_items(store_id, item_name)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_consignment_items_store_quick_code ON consignment_items(store_id, quick_code)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_consignment_items_store_imei ON consignment_items(store_id, imei_serial)");
      await postgresPool2.query("ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS vendor_phone TEXT");
      await postgresPool2.query("ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS vendor_address TEXT");
      await postgresPool2.query("ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1");
      await postgresPool2.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS show_discount_on_invoice INTEGER NOT NULL DEFAULT 1");
      await postgresPool2.query("ALTER TABLE stores ADD COLUMN IF NOT EXISTS vendor_portal_enabled INTEGER NOT NULL DEFAULT 0");
      await postgresPool2.query(`
        CREATE TABLE IF NOT EXISTS product_change_requests (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL REFERENCES stores(id),
          request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('CREATE', 'UPDATE')),
          product_id INTEGER REFERENCES products(id),
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          requested_by INTEGER NOT NULL REFERENCES users(id),
          reviewed_by INTEGER REFERENCES users(id),
          review_note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP
        )
      `);
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_product_change_requests_store_status_created ON product_change_requests(store_id, status, created_at DESC)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_product_change_requests_product_created ON product_change_requests(product_id, created_at DESC)");
      await postgresPool2.query(`
        CREATE TABLE IF NOT EXISTS vendor_payables (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL REFERENCES stores(id),
          sale_id INTEGER NOT NULL REFERENCES sales(id),
          sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
          source_type TEXT NOT NULL DEFAULT 'SOURCED',
          vendor_name TEXT NOT NULL,
          vendor_reference TEXT,
          item_name TEXT NOT NULL,
          amount_due DOUBLE PRECISION NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'SETTLED')),
          settled_at TIMESTAMP,
          note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgresPool2.query("ALTER TABLE vendor_payables ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'SOURCED'");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_vendor_payables_store_status_created ON vendor_payables(store_id, status, created_at DESC)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_vendor_payables_sale_item ON vendor_payables(sale_item_id)");
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_vendor_payables_vendor_name ON vendor_payables(store_id, vendor_name)");
      await postgresPool2.query("ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS base_price_at_sale DOUBLE PRECISION");
      await postgresPool2.query("ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_markup DOUBLE PRECISION NOT NULL DEFAULT 0");
      await postgresPool2.query(`
        CREATE TABLE IF NOT EXISTS consignment_vendor_bank_details (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL REFERENCES stores(id),
          vendor_name TEXT NOT NULL,
          vendor_key TEXT NOT NULL,
          bank_name TEXT,
          account_number TEXT,
          account_name TEXT,
          bank_note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (store_id, vendor_key)
        )
      `);
      await postgresPool2.query("CREATE INDEX IF NOT EXISTS idx_vendor_bank_details_store_vendor_key ON consignment_vendor_bank_details(store_id, vendor_key)");
    } catch (error) {
      console.warn("Vendor payables migration skipped for PostgreSQL:", error);
    }
    try {
      await postgresPool2.query("ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_receipt_paper_size_check");
      await postgresPool2.query("ALTER TABLE stores ADD CONSTRAINT stores_receipt_paper_size_check CHECK (receipt_paper_size IN ('THERMAL', 'THERMAL_58', 'A4'))");
    } catch (error) {
      console.warn("Paper size constraint migration skipped:", error);
    }
  }
};

// serverLicenseService.ts
var normalizeLicenseServiceBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
var LICENSE_ACTIVATION_TIMEOUT_MS = 15e3;
var LICENSE_HEALTH_TIMEOUT_MS = 12e3;
var LICENSE_HEALTH_RETRY_DELAY_MS = 2e3;
var normalizeLicenseServiceErrorMessage = (message) => {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return "License activation failed";
  }
  if (/DEPLOYMENT_NOT_FOUND|deployment could not be found on vercel/i.test(normalized)) {
    return "The configured license server deployment was not found on Vercel. Update GOODY_POS_LICENSE_API_URL or redeploy the licensing service.";
  }
  if (/already linked to another license|already bound to another device/i.test(normalized)) {
    return normalized;
  }
  if (/failed to activate license/i.test(normalized)) {
    return "License activation could not be completed right now. Please confirm the key is genuine and try again.";
  }
  return normalized;
};
var getResponseMessage = (payload, fallback) => {
  if (typeof payload === "object" && payload !== null) {
    return String(payload?.error || payload?.message || fallback);
  }
  return String(payload || fallback);
};
var createLicenseService = ({
  dataRootDir: dataRootDir2,
  appVersion
}) => {
  const LICENSE_API_BASE_URL2 = normalizeLicenseServiceBaseUrl(process.env.GOODY_POS_LICENSE_API_URL);
  const licenseRestrictionFlag = String(process.env.GOODY_POS_LICENSE_REQUIRED_FOR_NEW_STORES || "").trim().toLowerCase();
  const LICENSE_REQUIRED_FOR_NEW_STORES2 = LICENSE_API_BASE_URL2 ? ["1", "true", "yes", "on"].includes(licenseRestrictionFlag) : false;
  const {
    deviceFingerprint: LICENSE_DEVICE_FINGERPRINT,
    deviceName: LICENSE_DEVICE_NAME2
  } = getLicenseDeviceInfo(dataRootDir2);
  const attemptLicenseHealthCheck = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(`${LICENSE_API_BASE_URL2}/api/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const contentType = String(response.headers.get("content-type") || "");
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          error: normalizeLicenseServiceErrorMessage(getResponseMessage(payload, "License service is unavailable right now."))
        };
      }
      const payloadOk = typeof payload === "object" && payload !== null ? Boolean(payload?.ok ?? true) : true;
      return {
        ok: payloadOk,
        statusCode: response.status,
        error: payloadOk ? null : normalizeLicenseServiceErrorMessage(getResponseMessage(payload, "License service is unavailable right now."))
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        error: error?.name === "AbortError" ? "timeout" : error?.message || "network error",
        isTransient: true
      };
    } finally {
      clearTimeout(timeout);
    }
  };
  const checkLicenseServiceConnection2 = async () => {
    if (!LICENSE_API_BASE_URL2) {
      return {
        configured: false,
        connected: false,
        statusCode: null,
        error: "License service URL is not configured yet."
      };
    }
    let result = await attemptLicenseHealthCheck();
    if (!result.ok && result.isTransient) {
      await new Promise((resolve) => setTimeout(resolve, LICENSE_HEALTH_RETRY_DELAY_MS));
      result = await attemptLicenseHealthCheck();
    }
    if (result.ok) {
      return {
        configured: true,
        connected: true,
        statusCode: result.statusCode,
        error: null
      };
    }
    const userFacingError = result.error === "timeout" ? "Could not reach the configured license server in time. Check the deployment URL and internet connection." : normalizeLicenseServiceErrorMessage(result.error || "Could not reach the configured license server.");
    return {
      configured: true,
      connected: false,
      statusCode: result.statusCode,
      error: userFacingError
    };
  };
  const activateRemoteStoreLicense2 = async ({
    licenseKey,
    storeName,
    storeMode
  }) => {
    if (!LICENSE_API_BASE_URL2) {
      throw new Error("License service is not configured for this GoodyPOS deployment yet.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_ACTIVATION_TIMEOUT_MS);
    try {
      const response = await fetch(`${LICENSE_API_BASE_URL2}/api/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          licenseKey,
          deviceFingerprint: LICENSE_DEVICE_FINGERPRINT,
          deviceName: LICENSE_DEVICE_NAME2,
          storeName,
          storeMode,
          appVersion
        })
      });
      const contentType = String(response.headers.get("content-type") || "");
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const message = normalizeLicenseServiceErrorMessage(
          getResponseMessage(payload, "License activation failed")
        );
        throw new Error(message);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Could not reach the license server in time. Internet is required for first activation.");
      }
      const message = normalizeLicenseServiceErrorMessage(error?.message || "License activation failed");
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    LICENSE_API_BASE_URL: LICENSE_API_BASE_URL2,
    LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
    LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
    checkLicenseServiceConnection: checkLicenseServiceConnection2,
    activateRemoteStoreLicense: activateRemoteStoreLicense2
  };
};

// serverAppBootstrap.ts
import express from "express";
import cors from "cors";

// serverAuthAdminRoutes.ts
import bcrypt3 from "bcryptjs";
import fs2 from "node:fs";
import path3 from "node:path";
import jwt2 from "jsonwebtoken";

// serverDemoSeeder.ts
import bcrypt2 from "bcryptjs";
var DEMO_PASSWORD = "demo123";
var hash = (v) => bcrypt2.hashSync(v, 10);
var hashPin = (p) => bcrypt2.hashSync(p, 10);
var daysAgo = (n) => {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
var dateAgo = (n) => daysAgo(n).split("T")[0];
function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
var GT_CATEGORIES = ["Smartphones", "Laptops", "Accessories", "Tablets", "Audio"];
var GT_PRODUCTS = [
  // Each product has exactly ONE condition in its matrix
  { name: "iPhone 15 Pro Max 256GB", category: "Smartphones", price: 1199, cost: 950, matrix: { new: { stock: 8, price: 1199 } } },
  { name: "Samsung Galaxy S24 Ultra", category: "Smartphones", price: 1099, cost: 870, matrix: { new: { stock: 6, price: 1099 } } },
  { name: "Google Pixel 8 Pro", category: "Smartphones", price: 899, cost: 710, matrix: { new: { stock: 5, price: 899 } } },
  { name: 'MacBook Air 15" M3', category: "Laptops", price: 1299, cost: 1050, matrix: { new: { stock: 4, price: 1299 } } },
  { name: "Dell XPS 15 (i7, 32GB)", category: "Laptops", price: 1599, cost: 1280, matrix: { new: { stock: 3, price: 1599 } } },
  { name: "Lenovo ThinkPad X1 Carbon", category: "Laptops", price: 1249, cost: 990, matrix: { new: { stock: 5, price: 1249 } } },
  { name: 'iPad Pro 12.9" M2', category: "Tablets", price: 1099, cost: 880, matrix: { new: { stock: 6, price: 1099 } } },
  { name: "Samsung Galaxy Tab S9+", category: "Tablets", price: 799, cost: 630, matrix: { new: { stock: 4, price: 799 } } },
  { name: "AirPods Pro (2nd Gen)", category: "Audio", price: 249, cost: 185, matrix: { new: { stock: 12, price: 249 } } },
  { name: "Sony WH-1000XM5", category: "Audio", price: 349, cost: 265, matrix: { new: { stock: 8, price: 349 } } },
  { name: "USB-C Cable 6ft (3-Pack)", category: "Accessories", price: 19, cost: 7, stock: 60 },
  { name: "iPhone 15 Clear Case", category: "Accessories", price: 29, cost: 10, stock: 35 },
  { name: "Tempered Glass Screen Guard", category: "Accessories", price: 14, cost: 4, stock: 80 },
  { name: "Wireless Charging Pad 15W", category: "Accessories", price: 39, cost: 18, stock: 25 },
  { name: 'Laptop Sleeve 15"', category: "Accessories", price: 34, cost: 14, stock: 20 }
];
var SM_CATEGORIES = ["Beverages", "Pantry", "Household", "Snacks", "Personal Care", "Dairy & Eggs", "Frozen Foods", "Produce"];
var SM_PRODUCTS = [
  // Beverages
  { name: "Coca-Cola 2L", category: "Beverages", price: 2.79, cost: 1.5, stock: 120 },
  { name: "Pepsi 2L", category: "Beverages", price: 2.69, cost: 1.45, stock: 100 },
  { name: "Gatorade Thirst Quencher", category: "Beverages", price: 1.99, cost: 1.1, stock: 90 },
  { name: "Tropicana OJ 52oz", category: "Beverages", price: 4.99, cost: 3.1, stock: 60 },
  { name: "Dasani Water 24-Pack", category: "Beverages", price: 5.99, cost: 3.5, stock: 80 },
  { name: "Red Bull Energy 4-Pack", category: "Beverages", price: 9.99, cost: 6.5, stock: 45 },
  // Pantry
  { name: "Jasmine Rice 5lb", category: "Pantry", price: 6.99, cost: 4.5, stock: 75 },
  { name: "Barilla Pasta 1lb", category: "Pantry", price: 1.99, cost: 1.1, stock: 100 },
  { name: "Hunt's Tomato Sauce", category: "Pantry", price: 1.49, cost: 0.8, stock: 120 },
  { name: "Skippy Peanut Butter 16oz", category: "Pantry", price: 3.99, cost: 2.4, stock: 60 },
  { name: "Quaker Oats 42oz", category: "Pantry", price: 5.49, cost: 3.5, stock: 55 },
  { name: "Campbell's Tomato Soup", category: "Pantry", price: 1.39, cost: 0.75, stock: 90 },
  { name: "Heinz Ketchup 32oz", category: "Pantry", price: 3.99, cost: 2.2, stock: 70 },
  // Household
  { name: "Tide Pods 42-Count", category: "Household", price: 14.99, cost: 9.5, stock: 50 },
  { name: "Dawn Dish Soap 28oz", category: "Household", price: 3.99, cost: 2.2, stock: 65 },
  { name: "Bounty Paper Towels 6-Pack", category: "Household", price: 10.99, cost: 6.8, stock: 55 },
  { name: "Charmin Ultra Soft 12-Roll", category: "Household", price: 9.99, cost: 6, stock: 60 },
  { name: "Clorox Disinfectant 32oz", category: "Household", price: 4.99, cost: 2.8, stock: 45 },
  // Snacks
  { name: "Lay's Classic Chips 8oz", category: "Snacks", price: 4.49, cost: 2.6, stock: 55 },
  { name: "Oreo Cookies 14.3oz", category: "Snacks", price: 4.99, cost: 3, stock: 60 },
  { name: "Planters Mixed Nuts 10oz", category: "Snacks", price: 5.99, cost: 3.8, stock: 40 },
  { name: "Nature Valley Granola Bars", category: "Snacks", price: 4.49, cost: 2.8, stock: 50 },
  // Personal Care
  { name: "Dove Body Wash 22oz", category: "Personal Care", price: 6.99, cost: 4.2, stock: 45 },
  { name: "Colgate Total Toothpaste", category: "Personal Care", price: 4.99, cost: 2.9, stock: 55 },
  { name: "Head & Shoulders 13.5oz", category: "Personal Care", price: 7.99, cost: 4.8, stock: 40 },
  { name: "Gillette Mach3 Razors 4pk", category: "Personal Care", price: 11.99, cost: 7.5, stock: 30 },
  // Dairy & Eggs
  { name: "Whole Milk Gallon", category: "Dairy & Eggs", price: 4.29, cost: 2.7, stock: 40 },
  { name: "Greek Yogurt 32oz", category: "Dairy & Eggs", price: 5.99, cost: 3.8, stock: 35 },
  { name: "Large Eggs 1 Dozen", category: "Dairy & Eggs", price: 3.49, cost: 2.1, stock: 50 },
  { name: "Kraft American Cheese 16oz", category: "Dairy & Eggs", price: 4.99, cost: 3.2, stock: 40 },
  // Frozen
  { name: "DiGiorno Pizza (Pepperoni)", category: "Frozen Foods", price: 8.99, cost: 5.5, stock: 30 },
  { name: "Tyson Chicken Nuggets 5lb", category: "Frozen Foods", price: 10.99, cost: 7, stock: 25 },
  { name: "Ben & Jerry's Ice Cream", category: "Frozen Foods", price: 5.99, cost: 3.8, stock: 25 },
  // Produce
  { name: "Bananas (per bunch)", category: "Produce", price: 1.49, cost: 0.7, stock: 60 },
  { name: "Apples Gala (3lb bag)", category: "Produce", price: 4.99, cost: 2.8, stock: 45 },
  { name: "Baby Spinach 5oz", category: "Produce", price: 3.99, cost: 2.2, stock: 35 }
];
var GT_CUSTOMERS = [
  { name: "James Carter", phone: "(213) 555-0101", address: "1420 Sunset Blvd, Los Angeles, CA" },
  { name: "Emily Rodriguez", phone: "(212) 555-0142", address: "305 West 54th St, New York, NY" },
  { name: "Michael Thompson", phone: "(312) 555-0183", address: "820 N Michigan Ave, Chicago, IL" },
  { name: "Sarah Johnson", phone: "(713) 555-0224", address: "4501 Main St, Houston, TX" },
  { name: "David Kim", phone: "(415) 555-0265", address: "2100 Market St, San Francisco, CA" },
  { name: "Jessica Williams", phone: "(404) 555-0306", address: "750 Peachtree St, Atlanta, GA" },
  { name: "Ryan Martinez", phone: "(602) 555-0347", address: "220 E Roosevelt St, Phoenix, AZ" },
  { name: "Ashley Brown", phone: "(206) 555-0388", address: "1801 Pike Pl, Seattle, WA" },
  { name: "Brandon Lee", phone: "(617) 555-0429", address: "99 High St, Boston, MA" },
  { name: "Megan Davis", phone: "(303) 555-0470", address: "1600 Glenarm Pl, Denver, CO" }
];
var SM_CUSTOMERS = [
  { name: "Linda Harris", phone: "(503) 555-0110", address: "412 Oak Ave, Portland, OR" },
  { name: "Kevin Wilson", phone: "(702) 555-0151", address: "3200 Las Vegas Blvd, Las Vegas, NV" },
  { name: "Patricia Moore", phone: "(612) 555-0192", address: "900 Nicollet Mall, Minneapolis, MN" },
  { name: "Charles Jackson", phone: "(615) 555-0233", address: "1701 Broadway, Nashville, TN" },
  { name: "Jennifer Taylor", phone: "(512) 555-0274", address: "600 Congress Ave, Austin, TX" },
  { name: "Robert Anderson", phone: "(305) 555-0315", address: "801 Brickell Ave, Miami, FL" },
  { name: "Nancy Thomas", phone: "(215) 555-0356", address: "1500 Market St, Philadelphia, PA" },
  { name: "Daniel White", phone: "(314) 555-0397", address: "200 N Broadway, St. Louis, MO" }
];
async function seedDemoData(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id FROM stores WHERE name IN ('TechHub Electronics','FreshMart Grocery') LIMIT 1`
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { message: "Demo data already exists. Delete the demo stores first to re-seed." };
    }
    const pwHash = hash(DEMO_PASSWORD);
    const gtStore = await client.query(
      `INSERT INTO stores (name,mode,receipt_paper_size,license_status,currency_code,tax_enabled,tax_percentage,address,phone)
       VALUES ('TechHub Electronics','GADGET','A4','UNLICENSED','USD',0,0,'220 5th Ave, New York, NY 10001','(212) 555-7890') RETURNING id`
    );
    const gtId = Number(gtStore.rows[0].id);
    const gtOwner = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_owner',$2,'STORE_ADMIN',$3) RETURNING id`, [gtId, pwHash, hashPin("1000")]);
    const gtManager = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_manager',$2,'MANAGER',$3) RETURNING id`, [gtId, pwHash, hashPin("1234")]);
    const gtCashier = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_cashier',$2,'STAFF',$3) RETURNING id`, [gtId, pwHash, hashPin("5678")]);
    await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_accountant',$2,'ACCOUNTANT',$3)`, [gtId, pwHash, hashPin("3456")]);
    const gtOId = Number(gtOwner.rows[0].id), gtMId = Number(gtManager.rows[0].id), gtCId = Number(gtCashier.rows[0].id);
    const gtCatIds = {};
    for (const cat of GT_CATEGORIES) {
      const r = await client.query(`INSERT INTO categories (store_id,name) VALUES ($1,$2) ON CONFLICT (store_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [gtId, cat]);
      gtCatIds[cat] = Number(r.rows[0].id);
    }
    const gtPIds = [];
    for (const p of GT_PRODUCTS) {
      const matrix = "matrix" in p && p.matrix ? JSON.stringify(Object.fromEntries(Object.entries(p.matrix).map(([k, v]) => [k, { stock: v.stock, price: v.price, cost: p.cost }]))) : null;
      const r = await client.query(
        `INSERT INTO products (store_id,name,category,category_id,price,cost,stock,condition_matrix) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [gtId, p.name, p.category, gtCatIds[p.category], p.price, p.cost, p.stock ?? 0, matrix]
      );
      gtPIds.push(Number(r.rows[0].id));
    }
    const gtCustIds = [];
    for (const c of GT_CUSTOMERS) {
      const r = await client.query(`INSERT INTO customers (store_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id`, [gtId, c.name, c.phone, c.address]);
      gtCustIds.push(Number(r.rows[0].id));
    }
    for (let day = 29; day >= 0; day--) {
      for (let s = 0; s < rnd(2, 6); s++) {
        const pi = rnd(0, GT_PRODUCTS.length - 1);
        const prod = GT_PRODUCTS[pi];
        const cond = "matrix" in prod && prod.matrix ? Object.keys(prod.matrix)[0].toUpperCase() : null;
        const price = "matrix" in prod && prod.matrix ? prod.matrix[cond.toLowerCase()].price : prod.price;
        const qty = rnd(1, 2);
        const sub = price * qty;
        const pay = s % 3 === 0 ? { cash: sub, transfer: 0, pos: 0 } : s % 3 === 1 ? { cash: 0, transfer: sub, pos: 0 } : { cash: 0, transfer: 0, pos: sub };
        const custId = day % 3 === 0 ? gtCustIds[rnd(0, gtCustIds.length - 1)] : null;
        const userId = [gtOId, gtMId, gtCId][rnd(0, 2)];
        const sr = await client.query(
          `INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,customer_id,timestamp) VALUES ($1,$2,$2,$3,$4,'COMPLETED',$5,$6) RETURNING id`,
          [gtId, sub, userId, JSON.stringify(pay), custId, daysAgo(day)]
        );
        await client.query(
          `INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,cost_at_sale,condition) VALUES ($1,$2,$3,$4,$4,$5,$6,$7)`,
          [Number(sr.rows[0].id), gtPIds[pi], qty, price, sub, prod.cost, cond]
        );
      }
    }
    for (const [title, category, amount] of [
      ["Monthly Store Rent", "Rent", 8500],
      ["Electricity & Gas", "Utilities", 620],
      ["Internet & Phone", "Utilities", 180],
      ["Google Ads Campaign", "Marketing", 750],
      ["HVAC Service", "Maintenance", 320],
      ["Staff Team Lunch", "Staff Welfare", 210],
      ["Security System Monitoring", "Maintenance", 95],
      ["Store Cleaning Service", "Maintenance", 280],
      ["Business Insurance Premium", "Insurance", 415],
      ["Shipping Supplies", "Operations", 145]
    ])
      await client.query(`INSERT INTO expenses (store_id,title,category,amount,created_by,spent_at) VALUES ($1,$2,$3,$4,$5,$6)`, [gtId, title, category, amount, gtOId, daysAgo(rnd(1, 28))]);
    for (const [vendor, phone, item, qty, payout, selling, status, cond, quickCode] of [
      ["Jake's Pre-Owned Phones", "(646) 555-0011", "iPhone 14 Pro 128GB", 2, 720, 850, "approved", "Used", "11101"],
      ["Tech Resale Co.", "(718) 555-0022", "Samsung Galaxy S23 Ultra", 1, 550, 680, "approved", "Open Box", "22202"],
      ["Metro Device Exchange", "(347) 555-0033", 'MacBook Pro M2 14" 16GB', 1, 1400, 1699, "pending", "Used", "33303"],
      ["Rivera Electronics", "(312) 555-0141", "iPhone 13 Pro Max 256GB", 1, 580, 719, "approved", "Used", "44404"],
      ["Sunset Tech Trades", "(424) 555-0182", "iPad Air 5th Gen 64GB", 2, 390, 499, "approved", "Open Box", "55505"],
      ["Pacific Resellers", "(206) 555-0193", "Google Pixel 7 Pro 128GB", 1, 320, 429, "approved", "Used", "66606"],
      ["Midwest Device Hub", "(312) 555-0204", "Samsung Galaxy Z Flip5", 1, 560, 699, "approved", "Open Box", "77707"],
      ["Capital Gadget Exchange", "(202) 555-0215", 'MacBook Air 13" M1 8GB', 1, 680, 849, "approved", "Used", "88808"],
      ["Lone Star Tech", "(512) 555-0226", "Apple Watch Series 8 GPS 45mm", 2, 220, 299, "approved", "Open Box", "99909"]
    ])
      await client.query(
        `INSERT INTO consignment_items (store_id,quick_code,vendor_name,vendor_phone,item_name,quantity,agreed_payout,selling_price,status,public_specs,internal_condition,added_by,approved_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [gtId, quickCode, vendor, phone, item, qty, payout, selling, status, "{}", cond, gtCId, status !== "pending" ? gtMId : null, daysAgo(rnd(3, 15))]
      );
    let ti = 1;
    for (const [cn, ph, dev, br, issue, tech, st, est, fin, paid] of [
      ["James Carter", "(213) 555-0101", "iPhone 13 Pro", "Apple", "Cracked screen, touch unresponsive", "Mike's Repair Lab", "IN_REPAIR", 180, 0, 50],
      ["Emily Rodriguez", "(212) 555-0142", "Samsung Galaxy S22", "Samsung", "Battery drain, random shutdowns", "QuickFix NYC", "READY", 95, 95, 95],
      ["Michael Thompson", "(312) 555-0183", "MacBook Air M1", "Apple", "Keyboard liquid damage", "Mike's Repair Lab", "DIAGNOSING", 0, 0, 0],
      ["Sarah Johnson", "(713) 555-0224", "iPad Air 4th Gen", "Apple", "Charging port not working", "QuickFix NYC", "DELIVERED", 65, 65, 65],
      ["David Kim", "(415) 555-0265", "Dell XPS 13", "Dell", "Does not power on", "Bay Gadget Repairs", "AWAITING_PARTS", 145, 0, 30]
    ])
      await client.query(
        `INSERT INTO repair_tickets (store_id,ticket_number,customer_name,customer_phone,device_name,brand,issue_summary,technician_name,status,estimated_cost,final_cost,amount_paid,warranty_status,promised_date,created_by,updated_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NO_WARRANTY',$13,$14,$14,$15)`,
        [gtId, `TH-TKT-${String(ti++).padStart(4, "0")}`, cn, ph, dev, br, issue, tech, st, est, fin, paid, dateAgo(rnd(1, 10)), gtMId, daysAgo(rnd(1, 10))]
      );
    const layR = await client.query(
      `INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,sale_channel,customer_id,payment_plan,locked_until_paid,due_date,note,timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [gtId, 1299, 1299, gtMId, JSON.stringify({ cash: 300, transfer: 0, pos: 0 }), "PENDING", "LAYAWAY", gtCustIds[2], JSON.stringify({ type: "LAYAWAY", installment_count: 3, payment_frequency: "MONTHLY", deposit_paid: 300, balance_due: 999, schedule: [] }), 1, dateAgo(30), "Layaway \u2014 $300 down, $999 balance over 3 months", daysAgo(7)]
    );
    await client.query(`INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,condition) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [Number(layR.rows[0].id), gtPIds[3], 1, 1299, 1299, 1299, "NEW"]);
    const sup1 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'D&H Distributing','(800) 555-0300','orders@dandh.com','2525 N 7th St, Harrisburg, PA') RETURNING id`, [gtId]);
    const sup2 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'Ingram Micro','(800) 555-0400','trade@ingrammicro.com','3351 Michelson Dr, Irvine, CA') RETURNING id`, [gtId]);
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,created_at) VALUES ($1,$2,$3,$4,'ORDERED',$5,$6,$7,$8,$9,$10)`,
      [
        gtId,
        Number(sup1.rows[0].id),
        "D&H Distributing",
        `TH-PO-${Date.now()}`,
        JSON.stringify([{ name: "iPhone 15 Pro Max 256GB", qty: 5, unitCost: 950 }, { name: "AirPods Pro 2nd Gen", qty: 8, unitCost: 185 }]),
        5 * 950 + 8 * 185,
        "Q4 restocking order",
        dateAgo(7),
        gtMId,
        daysAgo(3)
      ]
    );
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,received_by,received_at,created_at) VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$9,$10,$11)`,
      [
        gtId,
        Number(sup2.rows[0].id),
        "Ingram Micro",
        `TH-PO-${Date.now() - 1e3}`,
        JSON.stringify([{ name: "USB-C Cable 6ft 3-Pack x 30", qty: 30, unitCost: 7 }, { name: "Tempered Glass Screen Guard x 50", qty: 50, unitCost: 4 }]),
        30 * 7 + 50 * 4,
        "Accessories restock",
        dateAgo(14),
        gtMId,
        daysAgo(10),
        daysAgo(12)
      ]
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'DAMAGED','DECREASE',60,2,58,'Screen protectors cracked during shipping',$4)`,
      [gtId, gtPIds[12], gtMId, daysAgo(5)]
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'RESTOCK','INCREASE',3,5,8,'New stock received from D&H',$4)`,
      [gtId, gtPIds[8], gtMId, daysAgo(9)]
    );
    for (const [text, priority, author] of [
      ["Received 2 iPhones for display consignment from Jake's. Logged and tested. Both in excellent condition.", "INFO", gtMId],
      ["IMPORTANT: MacBook Pro M2 demo unit (S/N MBA-2024-001) \u2014 DO NOT sell. For in-store display only.", "IMPORTANT", gtOId],
      ["Customer James Carter called about repair ticket TH-TKT-0001 \u2014 quoted 5\u20137 business days. Follow up Friday.", "IMPORTANT", gtCId],
      ["End of day register: $2,840 cash. $2,500 deposited to Chase. $340 kept in safe for change.", "INFO", gtCId]
    ])
      await client.query(
        `INSERT INTO handover_notes (store_id,author_id,note_text,priority,is_pinned,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gtId, author, text, priority, priority === "IMPORTANT" ? 1 : 0, daysAgo(rnd(0, 3))]
      );
    for (let day = 13; day >= 0; day--) {
      if (day % 7 === 0) continue;
      for (const uid of [gtMId, gtCId]) {
        const ci = new Date(daysAgo(day));
        ci.setHours(9, rnd(0, 15), 0, 0);
        const co = new Date(ci);
        co.setHours(18, rnd(0, 30), 0, 0);
        await client.query(
          `INSERT INTO staff_attendance (store_id,user_id,shift_date,clock_in_at,clock_out_at,total_minutes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [gtId, uid, dateAgo(day), ci.toISOString(), co.toISOString(), Math.round((co.getTime() - ci.getTime()) / 6e4)]
        );
      }
    }
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,0,$5)`, [gtId, gtMId, gtCId, "Ensure all display units are charged and powered on before opening. Update price tags for Galaxy S24 \u2014 new pricing effective today.", daysAgo(1)]);
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,1,$5)`, [gtId, gtCId, gtMId, "Done! Everything is set. A customer also asked about trade-in options for their old iPhone \u2014 should I refer them to you?", daysAgo(1)]);
    await client.query(
      `INSERT INTO market_collections (store_id,collector_name,phone,items,expected_return_date,tracking_code,status,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)`,
      [
        gtId,
        "Chris Hernandez",
        "(347) 555-0099",
        JSON.stringify([{ name: "Samsung Galaxy A54 (Demo Unit)", qty: 1, price: 449 }]),
        dateAgo(-3),
        `MC-TH-${Date.now()}`,
        "Sent with vendor for trade show display. Collect by end of week.",
        gtMId,
        daysAgo(2)
      ]
    );
    const saleIds = (await client.query(`SELECT id FROM sales WHERE store_id=$1 AND status='COMPLETED' ORDER BY id LIMIT 5`, [gtId])).rows.map((r) => Number(r.id));
    if (saleIds.length >= 3) {
      await client.query(
        `INSERT INTO sales_returns (sale_id,store_id,processed_by,returned_value,refund_amount,refund_method,return_type,restock_items,reason,items,created_at) VALUES ($1,$2,$3,$4,$4,'cash','REFUND',1,'Customer changed mind \u2014 purchased wrong model',$5,$6)`,
        [saleIds[2], gtId, gtMId, 249, JSON.stringify([{ product_name: "AirPods Pro (2nd Gen)", quantity: 1, price_at_sale: 249 }]), daysAgo(4)]
      );
    }
    const smStore = await client.query(
      `INSERT INTO stores (name,mode,receipt_paper_size,license_status,currency_code,tax_enabled,tax_percentage,address,phone)
       VALUES ('FreshMart Grocery','SUPERMARKET','THERMAL','UNLICENSED','USD',0,0,'1155 Oak St, Chicago, IL 60607','(312) 555-4321') RETURNING id`
    );
    const smId = Number(smStore.rows[0].id);
    const smOwner = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_owner',$2,'STORE_ADMIN',$3) RETURNING id`, [smId, pwHash, hashPin("5000")]);
    const smManager = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_manager',$2,'MANAGER',$3) RETURNING id`, [smId, pwHash, hashPin("2000")]);
    const smCashier = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_cashier',$2,'STAFF',$3) RETURNING id`, [smId, pwHash, hashPin("3000")]);
    await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_accountant',$2,'ACCOUNTANT',$3)`, [smId, pwHash, hashPin("4000")]);
    const smOId = Number(smOwner.rows[0].id), smMId = Number(smManager.rows[0].id), smCId = Number(smCashier.rows[0].id);
    const smCatIds = {};
    for (const cat of SM_CATEGORIES) {
      const r = await client.query(`INSERT INTO categories (store_id,name) VALUES ($1,$2) ON CONFLICT (store_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [smId, cat]);
      smCatIds[cat] = Number(r.rows[0].id);
    }
    const smPIds = [];
    for (const p of SM_PRODUCTS) {
      const r = await client.query(`INSERT INTO products (store_id,name,category,category_id,price,cost,stock) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [smId, p.name, p.category, smCatIds[p.category], p.price, p.cost, p.stock]);
      smPIds.push(Number(r.rows[0].id));
    }
    const smCustIds = [];
    for (const c of SM_CUSTOMERS) {
      const r = await client.query(`INSERT INTO customers (store_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id`, [smId, c.name, c.phone, c.address]);
      smCustIds.push(Number(r.rows[0].id));
    }
    for (let day = 29; day >= 0; day--) {
      for (let s = 0; s < rnd(6, 14); s++) {
        let sub = 0;
        const basket = [];
        for (let b = 0; b < rnd(2, 6); b++) {
          const pi = rnd(0, SM_PRODUCTS.length - 1);
          const qty = rnd(1, 4);
          sub += SM_PRODUCTS[pi].price * qty;
          basket.push({ id: smPIds[pi], price: SM_PRODUCTS[pi].price, qty, cost: SM_PRODUCTS[pi].cost });
        }
        sub = Math.round(sub * 100) / 100;
        const pay = s % 4 === 0 ? { cash: sub, transfer: 0, pos: 0 } : s % 4 === 1 ? { cash: 0, transfer: sub, pos: 0 } : s % 4 === 2 ? { cash: 0, transfer: 0, pos: sub } : { cash: Math.round(sub / 2 * 100) / 100, transfer: Math.round(sub / 2 * 100) / 100, pos: 0 };
        const custId = day % 4 === 0 ? smCustIds[rnd(0, smCustIds.length - 1)] : null;
        const userId = [smOId, smMId, smCId][rnd(0, 2)];
        const sr = await client.query(`INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,customer_id,timestamp) VALUES ($1,$2,$2,$3,$4,'COMPLETED',$5,$6) RETURNING id`, [smId, sub, userId, JSON.stringify(pay), custId, daysAgo(day)]);
        const sid = Number(sr.rows[0].id);
        for (const bi of basket)
          await client.query(`INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,cost_at_sale) VALUES ($1,$2,$3,$4,$4,$5,$6)`, [sid, bi.id, bi.qty, bi.price, Math.round(bi.price * bi.qty * 100) / 100, bi.cost]);
      }
    }
    for (const [title, category, amount] of [
      ["Monthly Store Lease", "Rent", 6200],
      ["Electricity", "Utilities", 980],
      ["Natural Gas", "Utilities", 310],
      ["Produce Spoilage Write-off", "Operations", 420],
      ["Staff Uniforms", "Staff Welfare", 380],
      ["POS Terminal Lease", "Equipment", 150],
      ["Refrigeration Service", "Maintenance", 560],
      ["Storefront Cleaning", "Maintenance", 200],
      ["Health Permit Renewal", "Operations", 275]
    ])
      await client.query(`INSERT INTO expenses (store_id,title,category,amount,created_by,spent_at) VALUES ($1,$2,$3,$4,$5,$6)`, [smId, title, category, amount, smOId, daysAgo(rnd(1, 28))]);
    const ssup1 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'Sysco Corporation','(800) 555-0800','orders@sysco.com','1390 Enclave Pkwy, Houston, TX') RETURNING id`, [smId]);
    const ssup2 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'US Foods','(800) 555-0900','trade@usfoods.com','9399 W Higgins Rd, Rosemont, IL') RETURNING id`, [smId]);
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,created_at) VALUES ($1,$2,$3,$4,'ORDERED',$5,$6,$7,$8,$9,$10)`,
      [
        smId,
        Number(ssup1.rows[0].id),
        "Sysco Corporation",
        `FM-PO-${Date.now()}`,
        JSON.stringify([{ name: "Jasmine Rice 5lb x 50 bags", qty: 50, unitCost: 4.5 }, { name: "Whole Milk Gallon x 48", qty: 48, unitCost: 2.7 }]),
        50 * 4.5 + 48 * 2.7,
        "Weekly grocery restocking",
        dateAgo(3),
        smMId,
        daysAgo(2)
      ]
    );
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,received_by,received_at,created_at) VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$9,$10,$11)`,
      [
        smId,
        Number(ssup2.rows[0].id),
        "US Foods",
        `FM-PO-${Date.now() - 2e3}`,
        JSON.stringify([{ name: "Tide Pods 42-Count x 12", qty: 12, unitCost: 9.5 }, { name: "Bounty Paper Towels 6-Pack x 20", qty: 20, unitCost: 6.8 }]),
        12 * 9.5 + 20 * 6.8,
        "Household products restock",
        dateAgo(10),
        smMId,
        daysAgo(8),
        daysAgo(9)
      ]
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'DAMAGED','DECREASE',120,6,114,'Broken Coca-Cola bottles \u2014 dropped in receiving area',$4)`,
      [smId, smPIds[0], smMId, daysAgo(4)]
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'COUNT','SET',75,0,70,'Cycle count \u2014 5-unit variance found in Rice aisle',$4)`,
      [smId, smPIds[6], smMId, daysAgo(7)]
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'RESTOCK','INCREASE',15,40,55,'New shipment received from Sysco',$4)`,
      [smId, smPIds[14], smMId, daysAgo(9)]
    );
    for (const [text, priority, author] of [
      ["Dairy cooler temperature alarm triggered at 6pm \u2014 maintenance called. Do NOT restock until temp is confirmed stable.", "IMPORTANT", smMId],
      ["Restocked Beverages and Snacks aisles. Coca-Cola and Lay's both running low \u2014 PO already submitted to Sysco.", "INFO", smCId],
      ["EOD cash: $1,842.50. Deposited $1,800 to Chase. $42.50 in petty cash.", "INFO", smCId],
      ["New vendor rep from Sysco visited \u2014 offered 8% discount on orders over $2,000. Owner has their contact card.", "INFO", smMId]
    ])
      await client.query(
        `INSERT INTO handover_notes (store_id,author_id,note_text,priority,is_pinned,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [smId, author, text, priority, priority === "IMPORTANT" ? 1 : 0, daysAgo(rnd(0, 3))]
      );
    for (let day = 13; day >= 0; day--) {
      if (day % 7 === 0) continue;
      for (const uid of [smMId, smCId]) {
        const ci = new Date(daysAgo(day));
        ci.setHours(7, rnd(30, 59), 0, 0);
        const co = new Date(ci);
        co.setHours(16, rnd(0, 30), 0, 0);
        await client.query(
          `INSERT INTO staff_attendance (store_id,user_id,shift_date,clock_in_at,clock_out_at,total_minutes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [smId, uid, dateAgo(day), ci.toISOString(), co.toISOString(), Math.round((co.getTime() - ci.getTime()) / 6e4)]
        );
      }
    }
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,0,$5)`, [smId, smMId, smCId, "Please do a full count on the Frozen Foods section first thing tomorrow. We need accurate numbers before the Sysco order.", daysAgo(1)]);
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,1,$5)`, [smId, smCId, smOId, "Counted \u2014 Frozen is fine except DiGiorno Pizza: only 4 left. Should I add to the PO?", daysAgo(1)]);
    await client.query(
      `INSERT INTO market_collections (store_id,collector_name,phone,items,expected_return_date,tracking_code,status,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)`,
      [
        smId,
        "Tom Bradley",
        "(773) 555-0077",
        JSON.stringify([{ name: "Assorted Beverages (24 cans)", qty: 24, price: 1.99 }]),
        dateAgo(-5),
        `MC-FM-${Date.now()}`,
        "Sent to community fundraiser event. Unsold stock returns Monday.",
        smMId,
        daysAgo(1)
      ]
    );
    const smSaleIds = (await client.query(`SELECT id FROM sales WHERE store_id=$1 AND status='COMPLETED' ORDER BY id LIMIT 5`, [smId])).rows.map((r) => Number(r.id));
    if (smSaleIds.length >= 3) {
      await client.query(
        `INSERT INTO sales_returns (sale_id,store_id,processed_by,returned_value,refund_amount,refund_method,return_type,restock_items,reason,items,created_at) VALUES ($1,$2,$3,$4,$4,'cash','REFUND',1,'Wrong product \u2014 customer returned unopened',$5,$6)`,
        [smSaleIds[2], smId, smMId, 2.79, JSON.stringify([{ product_name: "Coca-Cola 2L", quantity: 1, price_at_sale: 2.79 }]), daysAgo(3)]
      );
    }
    await client.query("COMMIT");
    return { message: "Demo data seeded! TechHub Electronics (Smart Retail) + FreshMart Grocery (Supermarket) are ready with 30 days of activity." };
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Demo seed failed: ${err.message}`);
  } finally {
    client.release();
  }
}

// serverAuthAdminRoutes.ts
var recoveryFlaggedIps = /* @__PURE__ */ new Set();
var recoveryFailedAttempts = /* @__PURE__ */ new Map();
var RECOVERY_MAX_ATTEMPTS = 3;
var RECOVERY_LOCKOUT_MS = 15 * 60 * 1e3;
var getRecoveryAuditPath = () => {
  const dataDir = String(process.env.GOODY_POS_DATA_DIR || "").trim() || process.cwd();
  return path3.join(dataDir, "recovery-audit.log");
};
var writeAuditLog = (line) => {
  try {
    const entry = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${line}
`;
    fs2.appendFileSync(getRecoveryAuditPath(), entry, "utf8");
  } catch {
  }
};
var registerAuthAdminRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  findStoreById: findStoreById2,
  findUserById: findUserById2,
  normalizeStaffAnnouncement: normalizeStaffAnnouncement2,
  safeJsonParse: safeJsonParse6,
  getLoginAttemptKey: getLoginAttemptKey2,
  getRemainingLockoutMs: getRemainingLockoutMs2,
  registerFailedLogin: registerFailedLogin2,
  clearLoginAttempt: clearLoginAttempt2,
  activateRemoteStoreLicense: activateRemoteStoreLicense2,
  markExpiredProformas: markExpiredProformas2,
  normalizePin: normalizePin2,
  hashPin: hashPin3,
  verifyPin: verifyPin2,
  resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
  LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
  LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
  JWT_SECRET: JWT_SECRET2,
  JWT_EXPIRY: JWT_EXPIRY2
}) => {
  app2.post("/api/auth/admin-reset", async (req, res) => {
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const recoveryCode = String(process.env.GOODY_POS_RECOVERY_CODE || "").trim();
    if (!recoveryCode) {
      writeAuditLog(`RECOVERY_DISABLED \u2014 attempt from ${ip}`);
      return res.status(403).json({ error: "Recovery is not enabled on this server." });
    }
    const attempt = recoveryFailedAttempts.get(ip);
    if (attempt && attempt.lockUntil > Date.now()) {
      const minsLeft = Math.ceil((attempt.lockUntil - Date.now()) / 6e4);
      writeAuditLog(`RECOVERY_BLOCKED \u2014 ${ip} is locked out (${minsLeft} min remaining)`);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minsLeft} minute(s).` });
    }
    const { code, newPassword, newUsername } = req.body;
    if (!code || String(code).trim() !== recoveryCode) {
      const current = recoveryFailedAttempts.get(ip) || { count: 0, lockUntil: 0 };
      current.count += 1;
      if (current.count >= RECOVERY_MAX_ATTEMPTS) {
        current.lockUntil = Date.now() + RECOVERY_LOCKOUT_MS;
        writeAuditLog(`RECOVERY_LOCKOUT \u2014 ${ip} locked out after ${current.count} failed attempts`);
      } else {
        writeAuditLog(`RECOVERY_FAILED \u2014 ${ip} wrong code (attempt ${current.count}/${RECOVERY_MAX_ATTEMPTS})`);
      }
      recoveryFailedAttempts.set(ip, current);
      recoveryFlaggedIps.add(ip);
      return res.status(401).json({ error: "Invalid recovery code." });
    }
    recoveryFailedAttempts.delete(ip);
    const hasNewPassword = newPassword && String(newPassword).length > 0;
    const hasNewUsername = newUsername && String(newUsername).trim().length > 0;
    if (!hasNewPassword && !hasNewUsername) {
      return res.status(400).json({ error: "Provide a new password, a new username, or both." });
    }
    if (hasNewPassword && String(newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (hasNewUsername) {
      const trimmed = String(newUsername).trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({ error: "Username must be 2\u2013100 characters." });
      }
      const currentAdminResult = await postgresPool2.query(
        `SELECT username FROM users WHERE role = 'SYSTEM_ADMIN' ORDER BY id ASC LIMIT 1`
      );
      const currentAdminUsername = String(currentAdminResult.rows[0]?.username ?? "").trim();
      const isReusingSameUsername = currentAdminUsername.length > 0 && currentAdminUsername.toLowerCase() === trimmed.toLowerCase();
      if (!isReusingSameUsername) {
        const conflict = await postgresPool2.query(
          `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND role != 'SYSTEM_ADMIN' LIMIT 1`,
          [trimmed]
        );
        if ((conflict.rowCount ?? 0) > 0) {
          return res.status(400).json({ error: "That username belongs to a store account. Choose a different username." });
        }
      }
    }
    try {
      const adminRow = await postgresPool2.query(
        `SELECT id FROM users WHERE role = 'SYSTEM_ADMIN' ORDER BY id ASC LIMIT 1`
      );
      if ((adminRow.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: "No SYSTEM_ADMIN account found." });
      }
      const adminId = adminRow.rows[0].id;
      const setClauses = [];
      const params = [];
      if (hasNewPassword) {
        params.push(bcrypt3.hashSync(String(newPassword), 10));
        setClauses.push(`password = $${params.length}`);
      }
      if (hasNewUsername) {
        params.push(String(newUsername).trim());
        setClauses.push(`username = $${params.length}`);
      }
      params.push(adminId);
      await postgresPool2.query(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length}`,
        params
      );
      const updatedRow = await postgresPool2.query(
        `SELECT username FROM users WHERE id = $1`,
        [adminId]
      );
      const finalUsername = updatedRow.rows[0]?.username ?? "SYSTEM_ADMIN";
      recoveryFlaggedIps.add(ip);
      writeAuditLog(`RECOVERY_SUCCESS \u2014 ${ip} reset SYSTEM_ADMIN account (username: ${finalUsername}, password_changed: ${hasNewPassword}, username_changed: ${hasNewUsername})`);
      res.json({ success: true, username: finalUsername });
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.toLowerCase().includes("unique")) {
        return res.status(400).json({ error: "That username belongs to a store account. Choose a different one." });
      }
      res.status(500).json({ error: msg || "Database error during reset." });
    }
  });
  app2.get("/api/admin/recovery-audit-log", authenticate2, authorize2(["SYSTEM_ADMIN"]), (_req, res) => {
    try {
      const logPath = getRecoveryAuditPath();
      if (!fs2.existsSync(logPath)) return res.json({ lines: [] });
      const raw = fs2.readFileSync(logPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean).reverse();
      res.json({ lines });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Could not read audit log." });
    }
  });
  app2.get("/api/public/store-announcement", async (req, res) => {
    const username = String(req.query.username || "").trim();
    if (!username) {
      return res.json({ active: false, message: null, updated_at: null });
    }
    try {
      const userResult = await postgresPool2.query(
        "SELECT store_id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
        [username]
      );
      const matchedUser = userResult.rows[0];
      if (!matchedUser?.store_id) {
        return res.json({ active: false, message: null, updated_at: null });
      }
      const store = await findStoreById2(matchedUser.store_id);
      if (!store) {
        return res.json({ active: false, message: null, updated_at: null });
      }
      const announcement = normalizeStaffAnnouncement2(store);
      return res.json({
        active: announcement.active,
        message: announcement.active ? announcement.text : null,
        updated_at: announcement.updated_at,
        store_name: store.name || null
      });
    } catch (err) {
      return res.json({ active: false, message: null, updated_at: null, error: err?.message || null });
    }
  });
  const getLicenseDeviceMismatchMessage = (store) => {
    if (!store) return null;
    const licenseStatus = String(store.license_status || "").trim().toUpperCase();
    const licensedDeviceName = String(store.license_device_name || "").trim();
    const hasActiveLicenseBinding = (Boolean(store.license_key) || licenseStatus === "ACTIVE") && licensedDeviceName;
    if (!hasActiveLicenseBinding || licensedDeviceName === LICENSE_DEVICE_NAME2) {
      return null;
    }
    return `This store license is already activated on ${licensedDeviceName}. This device is ${LICENSE_DEVICE_NAME2}. Ask the Super System Owner to reset or transfer the license before using this store here.`;
  };
  app2.get("/api/auth/verify", authenticate2, async (req, res) => {
    if (req.user?.role !== "SYSTEM_ADMIN") {
      const linkedStore = await findStoreById2(req.user?.store_id);
      const licenseMismatchMessage = getLicenseDeviceMismatchMessage(linkedStore);
      if (licenseMismatchMessage) {
        return res.status(403).json({ valid: false, error: licenseMismatchMessage });
      }
    }
    res.json({ valid: true, user: req.user });
  });
  app2.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const attemptKey = getLoginAttemptKey2(username, req.ip);
    const remainingLockoutMs = getRemainingLockoutMs2(attemptKey);
    if (remainingLockoutMs > 0) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${Math.ceil(remainingLockoutMs / 6e4)} minute(s).`
      });
    }
    const userResult = await postgresPool2.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [username]
    );
    const user = userResult.rows[0] || null;
    const passwordMatches = Boolean(user?.password) && bcrypt3.compareSync(password, user.password);
    if (!user || !passwordMatches) {
      const { remainingAttempts, lockUntil } = registerFailedLogin2(attemptKey);
      if (lockUntil > Date.now()) {
        return res.status(429).json({
          error: `Too many login attempts. Account locked for ${Math.ceil((lockUntil - Date.now()) / 6e4)} minute(s).`
        });
      }
      return res.status(401).json({
        error: `Invalid credentials.${remainingAttempts > 0 ? ` ${remainingAttempts} attempt(s) remaining before temporary lockout.` : ""}`
      });
    }
    clearLoginAttempt2(attemptKey);
    const loginIp = String(req.ip || req.socket?.remoteAddress || "unknown");
    if (recoveryFlaggedIps.has(loginIp)) {
      writeAuditLog(`FLAGGED_IP_LOGIN \u2014 ${loginIp} logged in as "${user.username}" (role: ${user.role}) \u2014 this IP previously attempted emergency recovery`);
    }
    if (user.role !== "SYSTEM_ADMIN") {
      const normalizedStoreId = Number(user.store_id || 0);
      const linkedStore = Number.isInteger(normalizedStoreId) && normalizedStoreId > 0 ? await findStoreById2(normalizedStoreId) : null;
      if (!linkedStore) {
        return res.status(403).json({
          error: "This store account is not linked to an active store yet. Ask the system admin to assign or recreate it."
        });
      }
      const licenseMismatchMessage = getLicenseDeviceMismatchMessage(linkedStore);
      if (licenseMismatchMessage) {
        return res.status(403).json({ error: licenseMismatchMessage });
      }
    }
    const token = jwt2.sign(
      { id: user.id, username: user.username, role: user.role, store_id: user.store_id },
      JWT_SECRET2,
      { expiresIn: JWT_EXPIRY2 }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, store_id: user.store_id } });
  });
  app2.get("/api/admin/stores", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    try {
      const stores = await coreReadRepository2.listAdminStores();
      res.json(stores.map((s) => {
        const customSpecs = safeJsonParse6(s.custom_specs, []);
        return {
          ...s,
          custom_specs: Array.isArray(customSpecs) ? customSpecs : []
        };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load stores" });
    }
  });
  app2.post("/api/admin/stores", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (req, res) => {
    const { name, mode } = req.body;
    const rawLicenseKey = String(req.body?.licenseKey ?? req.body?.license_key ?? "").trim();
    const normalizedLicenseKey = rawLicenseKey ? (() => {
      const compact = rawLicenseKey.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const prefixMatch = compact.match(/^[A-Z]{3}(?=[A-Z0-9]{5,}$)/);
      if (!prefixMatch) return compact.match(/.{1,5}/g)?.join("-") || rawLicenseKey.toUpperCase();
      const prefix = prefixMatch[0];
      const remainder = compact.slice(prefix.length);
      const groupedRemainder = remainder.match(/.{1,5}/g)?.join("-") || remainder;
      return groupedRemainder ? `${prefix}-${groupedRemainder}` : prefix;
    })() : "";
    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: "Store name required (max 255 chars)" });
    }
    if (!["SUPERMARKET", "GADGET"].includes(mode)) {
      return res.status(400).json({ error: "Invalid store mode. Must be SUPERMARKET or GADGET" });
    }
    if (LICENSE_REQUIRED_FOR_NEW_STORES2 && !normalizedLicenseKey) {
      return res.status(400).json({ error: "A one-time license key from the Super System Owner is required to deploy a new store." });
    }
    let licenseActivation = null;
    if (normalizedLicenseKey) {
      try {
        licenseActivation = await activateRemoteStoreLicense2({
          licenseKey: normalizedLicenseKey,
          storeName: String(name).trim(),
          storeMode: mode
        });
      } catch (err) {
        return res.status(400).json({ error: String(err?.message || err || "License activation failed") });
      }
    }
    try {
      const remoteLicense = licenseActivation?.license || null;
      const defaultPaperSize = mode === "GADGET" ? "A4" : "THERMAL";
      const insertResult = await postgresPool2.query(
        `INSERT INTO stores (
          name,
          mode,
          receipt_paper_size,
          license_key,
          license_status,
          license_plan,
          license_cache_token,
          license_activated_at,
          license_last_validated_at,
          license_device_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          name,
          mode,
          defaultPaperSize,
          remoteLicense?.licenseKey || null,
          remoteLicense?.status || "UNLICENSED",
          remoteLicense?.plan || null,
          licenseActivation?.cacheToken || null,
          remoteLicense?.activatedAt || null,
          remoteLicense?.lastValidatedAt || null,
          remoteLicense ? LICENSE_DEVICE_NAME2 : null
        ]
      );
      const storeId = Number(insertResult.rows[0]?.id);
      res.json({
        id: storeId,
        licenseActivated: Boolean(remoteLicense),
        license: remoteLicense
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.put("/api/admin/stores/:id/lock", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (req, res) => {
    const { is_locked } = req.body;
    const store = await findStoreById2(req.params.id);
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }
    await postgresPool2.query("UPDATE stores SET is_locked = $1 WHERE id = $2", [is_locked ? 1 : 0, store.id]);
    res.json({ success: true });
  });
  app2.delete("/api/admin/stores/:id", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (req, res) => {
    const storeId = Number(req.params.id);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({ error: "Invalid store id" });
    }
    const store = await coreReadRepository2.getStoreById(storeId);
    if (!store) {
      return res.json({ success: true, alreadyDeleted: true, message: "Store was already removed" });
    }
    try {
      await coreWriteRepository2.deleteStore({ storeId });
      res.json({ success: true, message: `Store ${store.name} deleted successfully` });
    } catch (err) {
      console.error("Failed to delete store:", err);
      res.status(500).json({ error: `Failed to delete store: ${err.message}` });
    }
  });
  app2.post("/api/admin/maintenance/mark-expired-proformas", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    try {
      await markExpiredProformas2();
      const countResult = await postgresPool2.query("SELECT COUNT(*) as count FROM pro_formas WHERE status = 'EXPIRED'");
      res.json({
        success: true,
        message: "Pro-forma expiry check completed",
        totalExpired: Number(countResult.rows[0]?.count || 0)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/users", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN", "MANAGER"]), async (req, res) => {
    try {
      const limit = 100;
      const offset = (parseInt(req.query.page || "1", 10) - 1) * limit;
      const users = await coreReadRepository2.listAdminUsers({
        viewerRole: String(req.user.role || ""),
        viewerStoreId: req.user.store_id == null ? null : Number(req.user.store_id),
        requestedStoreId: req.query.store_id == null || req.query.store_id === "" ? null : Number(req.query.store_id),
        limit,
        offset
      });
      res.json({ users, limit, offset, hasMore: users.length === limit });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load users" });
    }
  });
  app2.put("/api/admin/users/:id/password", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const hashedPassword = bcrypt3.hashSync(password, 10);
    const targetUserResult = await postgresPool2.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [req.params.id]);
    const targetUser = targetUserResult.rows[0] || null;
    if (!targetUser) return res.status(404).json({ error: "User not found" });
    if (String(targetUser.username || "").toLowerCase().startsWith("demo_")) {
      return res.status(403).json({ error: "Demo accounts cannot have their password changed." });
    }
    if (req.user.role === "SYSTEM_ADMIN") {
      await postgresPool2.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.params.id]);
    } else if (req.user.role === "STORE_ADMIN") {
      if (targetUser.store_id !== req.user.store_id) {
        return res.status(403).json({ error: "Forbidden: User belongs to another store" });
      }
      if (targetUser.role === "SYSTEM_ADMIN" || targetUser.role === "STORE_ADMIN") {
        return res.status(403).json({ error: "Forbidden: Cannot reset password for this role" });
      }
      await postgresPool2.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.params.id]);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ success: true });
  });
  app2.put("/api/admin/users/:id/pin", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const nextPin = normalizePin2(req.body?.pin ?? req.body?.newPin);
    if (!/^\d{4,6}$/.test(nextPin)) {
      return res.status(400).json({ error: "PIN must be 4-6 digits" });
    }
    const targetUser = await findUserById2(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (String(targetUser.username || "").toLowerCase().startsWith("demo_")) {
      return res.status(403).json({ error: "Demo accounts cannot have their PIN changed." });
    }
    if (req.user.role === "STORE_ADMIN") {
      if (targetUser.store_id !== req.user.store_id) {
        return res.status(403).json({ error: "Forbidden: User belongs to another store" });
      }
      if (!["MANAGER", "PROCUREMENT_OFFICER", "STAFF"].includes(String(targetUser.role || ""))) {
        return res.status(403).json({ error: "Forbidden: Store Owner can only reset staff, procurement, or manager PINs" });
      }
    }
    await postgresPool2.query("UPDATE users SET pin = $1 WHERE id = $2", [hashPin3(nextPin), targetUser.id]);
    res.json({ success: true });
  });
  app2.put("/api/auth/profile/password", authenticate2, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (String(req.user?.username || "").toLowerCase().startsWith("demo_")) {
      return res.status(403).json({ error: "Demo accounts cannot change their password." });
    }
    if (!["SYSTEM_ADMIN", "STORE_ADMIN", "MANAGER", "ACCOUNTANT", "PROCUREMENT_OFFICER"].includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: Role not authorized to change own password" });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must be different from current password" });
    }
    const user = await findUserById2(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!user.password || !bcrypt3.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: "Invalid current password" });
    }
    const hashedPassword = bcrypt3.hashSync(newPassword, 10);
    await postgresPool2.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.user.id]);
    res.json({ success: true });
  });
  app2.put("/api/auth/profile/pin", authenticate2, async (req, res) => {
    if (String(req.user?.username || "").toLowerCase().startsWith("demo_")) {
      return res.status(403).json({ error: "Demo accounts cannot change their PIN." });
    }
    const currentPin = normalizePin2(req.body?.currentPin);
    const newPin = normalizePin2(req.body?.newPin);
    const currentPassword = String(req.body?.currentPassword ?? "");
    if (!/^\d{4,6}$/.test(newPin)) {
      return res.status(400).json({ error: "New PIN must be 4-6 digits" });
    }
    const user = await findUserById2(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const hasExistingPin = Boolean(String(user.pin || "").trim());
    const canRecoverWithPassword = ["STORE_ADMIN", "SYSTEM_ADMIN"].includes(String(req.user?.role || ""));
    const hasCurrentPinInput = /^\d{4,6}$/.test(currentPin);
    const hasPasswordFallback = currentPassword.length > 0;
    if (hasExistingPin) {
      if (hasCurrentPinInput) {
        if (!verifyPin2(currentPin, String(user.pin || ""))) {
          return res.status(400).json({ error: "Current PIN is incorrect" });
        }
        if (currentPin === newPin) {
          return res.status(400).json({ error: "New PIN must be different from the current PIN" });
        }
      } else if (canRecoverWithPassword && hasPasswordFallback) {
        if (!user.password || !bcrypt3.compareSync(currentPassword, String(user.password || ""))) {
          return res.status(400).json({ error: "Login password is incorrect" });
        }
        if (verifyPin2(newPin, String(user.pin || ""))) {
          return res.status(400).json({ error: "New PIN must be different from the current PIN" });
        }
      } else {
        return res.status(400).json({
          error: canRecoverWithPassword ? "Enter your current PIN, or use your login password if you forgot it" : "Current PIN is required to change your PIN"
        });
      }
    }
    await postgresPool2.query("UPDATE users SET pin = $1 WHERE id = $2", [hashPin3(newPin), req.user.id]);
    res.json({ success: true });
  });
  app2.post("/api/auth/checkout-pin/verify", authenticate2, checkStoreLock2, async (req, res) => {
    const storeSettings = req.store || await findStoreById2(req.user.store_id);
    if (!storeSettings) {
      return res.status(404).json({ error: "Store not found" });
    }
    const isGadgetMode = String(storeSettings.mode || "").toUpperCase() === "GADGET";
    const pinCheckoutEnabled = isGadgetMode && Number(storeSettings?.pin_checkout_enabled ?? 1) === 1;
    if (!pinCheckoutEnabled) {
      return res.json({ success: true, required: false, user: req.user });
    }
    const normalizedCheckoutPin = normalizePin2(req.body?.pin);
    if (!/^\d{4,6}$/.test(normalizedCheckoutPin)) {
      return res.status(400).json({ error: "Checkout PIN must be 4-6 digits" });
    }
    const resolvedActor = await resolveCheckoutActorByPin2(req.user.store_id, normalizedCheckoutPin);
    if (!resolvedActor) {
      return res.status(400).json({ error: "Invalid checkout PIN for this store" });
    }
    res.json({
      success: true,
      required: true,
      user: {
        id: resolvedActor.id,
        username: resolvedActor.username,
        role: resolvedActor.role,
        store_id: resolvedActor.store_id ?? null
      }
    });
  });
  app2.post("/api/admin/users", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const { username, password, role, store_id, pin } = req.body;
    const normalizedUsername = String(username || "").trim();
    if (!normalizedUsername || normalizedUsername.length < 2 || normalizedUsername.length > 100) {
      return res.status(400).json({ error: "Username must be between 2 and 100 characters" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (pin && !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be 4-6 digits" });
    }
    const hashedPassword = bcrypt3.hashSync(password, 10);
    const hashedPin = pin ? hashPin3(pin) : null;
    const rawTargetStoreId = req.user.role === "SYSTEM_ADMIN" ? store_id : req.user.store_id;
    const targetStoreId = rawTargetStoreId == null || rawTargetStoreId === "" ? null : Number(rawTargetStoreId);
    const targetRole = req.user.role === "SYSTEM_ADMIN" ? role : role === "MANAGER" ? "MANAGER" : role === "ACCOUNTANT" ? "ACCOUNTANT" : role === "PROCUREMENT_OFFICER" ? "PROCUREMENT_OFFICER" : "STAFF";
    if (targetRole !== "SYSTEM_ADMIN" && targetStoreId === null) {
      return res.status(400).json({ error: "Select a store before creating a store owner or staff account." });
    }
    if (targetStoreId !== null) {
      if (!Number.isInteger(targetStoreId) || targetStoreId <= 0) {
        return res.status(400).json({ error: "Invalid store id" });
      }
      if (!await findStoreById2(targetStoreId)) {
        return res.status(404).json({ error: "Store not found" });
      }
    }
    const existingUsernameResult = await postgresPool2.query(
      "SELECT id, role, store_id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [normalizedUsername]
    );
    const existingUsername = existingUsernameResult.rows[0];
    if (existingUsername) {
      return res.status(400).json({ error: "Username already exists. Use a different store-owner or staff username." });
    }
    if (req.user.role === "SYSTEM_ADMIN" && targetRole === "STORE_ADMIN" && targetStoreId !== null) {
      const existingOwnerResult = await postgresPool2.query(
        `SELECT id, username FROM users WHERE store_id = $1 AND role = 'STORE_ADMIN' ORDER BY id ASC LIMIT 1`,
        [targetStoreId]
      );
      const existingOwner = existingOwnerResult.rows[0];
      if (existingOwner) {
        return res.status(400).json({
          error: `This store already has a store owner (${existingOwner.username}). Reset that account or remove it before creating another owner.`
        });
      }
    }
    try {
      const insertResult = await postgresPool2.query(
        "INSERT INTO users (username, password, role, store_id, pin) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [normalizedUsername, hashedPassword, targetRole, targetStoreId, hashedPin]
      );
      const userId = Number(insertResult.rows[0]?.id);
      res.json({ id: userId });
    } catch (err) {
      const errorMessage = String(err?.message || err || "Failed to create user");
      if (errorMessage.toLowerCase().includes("unique")) {
        return res.status(400).json({ error: "Username already exists. Use a different store-owner or staff username." });
      }
      res.status(400).json({ error: errorMessage });
    }
  });
  app2.delete("/api/admin/users/:id", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const user = await findUserById2(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (req.user.role !== "SYSTEM_ADMIN") {
      if (user.store_id !== req.user.store_id || user.role === "STORE_ADMIN") {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    try {
      await coreWriteRepository2.deleteUser({
        userId: Number(user.id),
        actorUserId: Number(req.user.id)
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete user:", err);
      const message = String(err?.message || "Failed to delete user");
      res.status(400).json({ error: message });
    }
  });
  app2.post("/api/admin/seed-demo", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    try {
      const result = await seedDemoData(postgresPool2);
      res.json(result);
    } catch (err) {
      console.error("Demo seed error:", err);
      res.status(500).json({ error: err.message });
    }
  });
};

// serverCatalogRoutes.ts
var registerCatalogRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  findStoreById: findStoreById2,
  safeJsonParse: safeJsonParse6,
  normalizeStoreDiscountCodes: normalizeStoreDiscountCodes2,
  normalizeStaffAnnouncement: normalizeStaffAnnouncement2,
  normalizeStoreSignatureImage: normalizeStoreSignatureImage3,
  clampChatCleanupReminderDay: clampChatCleanupReminderDay3,
  clampChatRetentionValue: clampChatRetentionValue3,
  normalizeChatRetentionUnit: normalizeChatRetentionUnit3,
  isChatCleanupReminderDue: isChatCleanupReminderDue2,
  getProductTotalStock: getProductTotalStock2,
  formatStockAdjustmentEntry: formatStockAdjustmentEntry2,
  normalizeRecountStatus: normalizeRecountStatus2,
  getAuditActorLabel: getAuditActorLabel2,
  logAuditEvent: logAuditEvent2,
  formatAuditCurrency: formatAuditCurrency2,
  normalizeProductBarcode: normalizeProductBarcode3,
  generateUniqueBarcode: generateUniqueBarcode2,
  generateUniqueQuickCode: generateUniqueQuickCode2,
  reconcileInventoryBatchQuantity: reconcileInventoryBatchQuantity2
}) => {
  app2.get("/api/products/reservation-check", authenticate2, async (req, res) => {
    const store_id = req.user.store_id;
    const { product_id, quantity } = req.query;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!product_id || !quantity) {
      return res.status(400).json({ error: "Product ID and quantity required" });
    }
    try {
      const product = (await postgresPool2.query("SELECT * FROM products WHERE id = $1 AND store_id = $2", [product_id, store_id])).rows[0] || null;
      if (!product) return res.status(404).json({ error: "Product not found" });
      const store = await findStoreById2(store_id);
      const productWithMode = { ...product, mode: product?.mode || store?.mode || null };
      const activeProformas = (await postgresPool2.query(`
        SELECT * FROM pro_formas
        WHERE store_id = $1 AND expiry_date > $2 AND status = 'PENDING'
      `, [store_id, now])).rows;
      let totalReserved = 0;
      const reservations = [];
      for (const p of activeProformas) {
        const items = JSON.parse(p.items);
        const item = items.find((i) => i.id === Number(product_id));
        if (item) {
          totalReserved += item.quantity;
          reservations.push({
            customer_name: p.customer_name || "Unknown Customer",
            expiry_date: p.expiry_date,
            reserved_quantity: item.quantity
          });
        }
      }
      const totalStock = Math.max(0, Number(getProductTotalStock2(productWithMode)) || 0);
      const requestedQuantity = Math.max(1, Number(quantity) || 0);
      const availableAfterReservations = totalStock - totalReserved;
      const hasActiveReservations = reservations.length > 0;
      const conflict = hasActiveReservations && requestedQuantity > availableAfterReservations;
      const outOfStock = requestedQuantity > Math.max(0, availableAfterReservations);
      res.json({
        conflict,
        outOfStock,
        hasActiveReservations,
        totalStock,
        totalReserved,
        availableAfterReservations,
        reservations
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/store/settings", authenticate2, async (req, res) => {
    try {
      const store = await coreReadRepository2.getStoreById(Number(req.user.store_id));
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      const customSpecs = safeJsonParse6(store.custom_specs, []);
      res.json({
        ...store,
        custom_specs: Array.isArray(customSpecs) ? customSpecs : [],
        discount_codes: normalizeStoreDiscountCodes2(store.discount_codes),
        staff_announcement_text: normalizeStaffAnnouncement2(store).text,
        staff_announcement_active: normalizeStaffAnnouncement2(store).active,
        staff_announcement_updated_at: normalizeStaffAnnouncement2(store).updated_at,
        currency_code: /^[A-Z]{3}$/.test(String(store.currency_code || "").toUpperCase()) ? String(store.currency_code).toUpperCase() : "USD",
        receipt_paper_size: store.receipt_paper_size || "A4",
        document_color: /^#([0-9A-Fa-f]{6})$/.test(String(store.document_color || "")) ? String(store.document_color).toUpperCase() : "#F4BD4A",
        show_store_name_on_documents: store.show_store_name_on_documents === true || Number(store.show_store_name_on_documents) === 1,
        signature_image: normalizeStoreSignatureImage3(store.signature_image),
        tax_enabled: Boolean(store.tax_enabled),
        tax_percentage: Math.max(0, Number(store.tax_percentage) || 0),
        receipt_header_note: String(store.receipt_header_note || ""),
        receipt_footer_note: String(store.receipt_footer_note || "Thank you for your business!"),
        receipt_show_bank_details: store.receipt_show_bank_details !== false && store.receipt_show_bank_details !== 0,
        default_missing_cost_to_price: store.default_missing_cost_to_price === true || Number(store.default_missing_cost_to_price) === 1,
        pin_checkout_enabled: store.pin_checkout_enabled !== 0,
        vendor_portal_enabled: store.vendor_portal_enabled === 1 || store.vendor_portal_enabled === true,
        chat_cleanup_reminders_enabled: store.chat_cleanup_reminders_enabled !== 0,
        chat_cleanup_reminder_day: clampChatCleanupReminderDay3(store.chat_cleanup_reminder_day),
        chat_retention_value: clampChatRetentionValue3(store.chat_retention_value),
        chat_retention_unit: normalizeChatRetentionUnit3(store.chat_retention_unit),
        last_chat_cleanup_at: store.last_chat_cleanup_at || null,
        chat_cleanup_reminder_due: isChatCleanupReminderDue2(store)
      });
    } catch (err) {
      console.error("Store settings read error:", err);
      res.status(500).json({ error: err.message || "Failed to load store settings" });
    }
  });
  app2.put("/api/store/settings", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const currentStore = await findStoreById2(req.user.store_id);
    if (!currentStore) {
      return res.status(404).json({ error: "Store not found" });
    }
    const payload = { ...currentStore, ...req.body || {} };
    const {
      name,
      logo,
      address,
      phone,
      custom_specs,
      bank_name,
      account_number,
      account_name,
      currency_code,
      receipt_paper_size,
      document_color,
      show_store_name_on_documents,
      signature_image,
      tax_enabled,
      tax_percentage,
      receipt_header_note,
      receipt_footer_note,
      receipt_show_bank_details,
      default_missing_cost_to_price,
      discount_codes,
      staff_announcement_text,
      staff_announcement_active,
      staff_announcement_updated_at,
      pin_checkout_enabled,
      vendor_portal_enabled,
      chat_cleanup_reminders_enabled,
      chat_cleanup_reminder_day,
      chat_retention_value,
      chat_retention_unit,
      last_chat_cleanup_at
    } = payload;
    let resolvedCustomSpecs = [];
    if (Array.isArray(custom_specs)) {
      resolvedCustomSpecs = custom_specs.map((entry) => String(entry || "").trim()).filter(Boolean);
    } else {
      try {
        const parsed = JSON.parse(String(custom_specs || "[]"));
        resolvedCustomSpecs = Array.isArray(parsed) ? parsed.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
      } catch {
        resolvedCustomSpecs = [];
      }
    }
    const resolvedCurrencyCode = /^[A-Z]{3}$/.test(String(currency_code || "").trim().toUpperCase()) ? String(currency_code).trim().toUpperCase() : "USD";
    const resolvedPaperSize = ["THERMAL", "THERMAL_58", "A4"].includes(receipt_paper_size) ? receipt_paper_size : "THERMAL";
    const resolvedDocumentColor = /^#([0-9A-Fa-f]{6})$/.test(String(document_color || "")) ? String(document_color).toUpperCase() : "#F4BD4A";
    const resolvedShowStoreNameOnDocuments = show_store_name_on_documents === true ? 1 : 0;
    const hasSignatureImageInput = signature_image != null && String(signature_image).trim() !== "";
    const resolvedSignatureImage = normalizeStoreSignatureImage3(signature_image);
    if (hasSignatureImageInput && !resolvedSignatureImage) {
      return res.status(400).json({ error: "Invalid signature image. Please upload a PNG, JPG, or JPEG around 900 \xD7 260 px." });
    }
    const resolvedTaxEnabled = tax_enabled ? 1 : 0;
    const resolvedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));
    const resolvedReceiptHeaderNote = String(receipt_header_note || "").trim();
    const resolvedReceiptFooterNote = String(receipt_footer_note || "").trim() || "Thank you for your business!";
    const resolvedShowBankDetails = receipt_show_bank_details === false ? 0 : 1;
    const resolvedDefaultMissingCost = default_missing_cost_to_price ? 1 : 0;
    const resolvedDiscountCodes = normalizeStoreDiscountCodes2(discount_codes);
    const resolvedAnnouncementText = String(staff_announcement_text || "").trim().slice(0, 240);
    const resolvedAnnouncementActive = Boolean(resolvedAnnouncementText) && staff_announcement_active !== false ? 1 : 0;
    const resolvedAnnouncementUpdatedAt = resolvedAnnouncementText ? String(staff_announcement_updated_at || (/* @__PURE__ */ new Date()).toISOString()) : null;
    const resolvedPinCheckoutEnabled = pin_checkout_enabled === false ? 0 : 1;
    const resolvedVendorPortalEnabled = vendor_portal_enabled === true ? 1 : 0;
    const resolvedChatCleanupRemindersEnabled = chat_cleanup_reminders_enabled === false ? 0 : 1;
    const resolvedChatCleanupReminderDay = clampChatCleanupReminderDay3(chat_cleanup_reminder_day);
    const resolvedChatRetentionValue = clampChatRetentionValue3(chat_retention_value);
    const resolvedChatRetentionUnit = normalizeChatRetentionUnit3(chat_retention_unit);
    const resolvedLastChatCleanupAt = last_chat_cleanup_at ? String(last_chat_cleanup_at) : null;
    try {
      await coreWriteRepository2.updateStoreSettings({
        storeId: Number(req.user.store_id),
        name: String(name || currentStore.name || "").trim() || String(currentStore.name || "Store"),
        logo: logo || null,
        signatureImage: resolvedSignatureImage,
        address: address || null,
        phone: phone || null,
        customSpecs: resolvedCustomSpecs,
        bankName: bank_name || null,
        accountNumber: account_number || null,
        accountName: account_name || null,
        currencyCode: resolvedCurrencyCode,
        receiptPaperSize: resolvedPaperSize,
        documentColor: resolvedDocumentColor,
        showStoreNameOnDocuments: resolvedShowStoreNameOnDocuments,
        taxEnabled: resolvedTaxEnabled,
        taxPercentage: resolvedTaxPercentage,
        receiptHeaderNote: resolvedReceiptHeaderNote,
        receiptFooterNote: resolvedReceiptFooterNote,
        receiptShowBankDetails: resolvedShowBankDetails,
        defaultMissingCostToPrice: resolvedDefaultMissingCost,
        discountCodes: resolvedDiscountCodes,
        staffAnnouncementText: resolvedAnnouncementText,
        staffAnnouncementActive: resolvedAnnouncementActive,
        staffAnnouncementUpdatedAt: resolvedAnnouncementUpdatedAt,
        pinCheckoutEnabled: resolvedPinCheckoutEnabled,
        vendorPortalEnabled: resolvedVendorPortalEnabled,
        chatCleanupRemindersEnabled: resolvedChatCleanupRemindersEnabled,
        chatCleanupReminderDay: resolvedChatCleanupReminderDay,
        chatRetentionValue: resolvedChatRetentionValue,
        chatRetentionUnit: resolvedChatRetentionUnit,
        lastChatCleanupAt: resolvedLastChatCleanupAt
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Store settings update error:", err);
      res.status(500).json({ error: err.message || "Failed to save store settings" });
    }
  });
  app2.get("/api/vendor-portal/config", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const store = await coreReadRepository2.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      const baseUrl = buildVendorPortalBaseUrl(req);
      const path7 = `/vendor-portal/${storeId}`;
      res.json({
        enabled: store.vendor_portal_enabled === 1 || store.vendor_portal_enabled === true,
        portal_url: baseUrl ? `${baseUrl}${path7}` : path7,
        store_id: storeId
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load vendor portal config" });
    }
  });
  app2.put("/api/vendor-portal/config", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    try {
      const enabled = req.body?.enabled === true ? 1 : 0;
      const storeId = Number(req.user.store_id);
      await postgresPool2.query("UPDATE stores SET vendor_portal_enabled = $1 WHERE id = $2", [enabled, storeId]);
      const baseUrl = buildVendorPortalBaseUrl(req);
      const path7 = `/vendor-portal/${storeId}`;
      res.json({
        success: true,
        enabled: enabled === 1,
        portal_url: baseUrl ? `${baseUrl}${path7}` : path7
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to update vendor portal config" });
    }
  });
  app2.get("/api/vendor-portal/:storeId/profile", async (req, res) => {
    try {
      const storeId = Math.max(0, Number(req.params.storeId || 0) || 0);
      const vid = String(req.query?.vid || "").trim();
      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({ error: "Invalid store id." });
      }
      if (!/^\d{3,}$/.test(vid)) {
        return res.status(400).json({ error: "Enter a valid vendor id." });
      }
      const storeRow = (await postgresPool2.query(
        "SELECT id, name, currency_code, vendor_portal_enabled FROM stores WHERE id = $1 LIMIT 1",
        [storeId]
      )).rows[0];
      if (!storeRow) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (!(storeRow.vendor_portal_enabled === 1 || storeRow.vendor_portal_enabled === true)) {
        return res.status(403).json({ error: "Vendor portal is currently disabled by this store." });
      }
      const consignmentRows = (await postgresPool2.query(`
        SELECT id, quick_code, vendor_name, vendor_phone, vendor_address, item_name, imei_serial, quantity, status, agreed_payout, selling_price, public_specs, updated_at
        FROM consignment_items
        WHERE store_id = $1
      `, [storeId])).rows;
      const toExpandedVendorSignature = (name, phone, address) => {
        const normalizedName = String(name || "").trim().toLowerCase();
        const normalizedPhone = String(phone || "").trim().toLowerCase();
        const normalizedAddress = String(address || "").trim().toLowerCase();
        return [normalizedName, normalizedPhone, normalizedAddress].filter(Boolean).join("|") || "unknown-vendor";
      };
      const getVendorIdCandidates = (row) => {
        const legacySignature = getVendorSignature(row?.vendor_name, null, null);
        const expandedSignature = toExpandedVendorSignature(row?.vendor_name, row?.vendor_phone, row?.vendor_address);
        const candidates = /* @__PURE__ */ new Set();
        candidates.add(calculateVendorIdFromSignature(legacySignature));
        candidates.add(calculateVendorIdFromSignature(expandedSignature));
        return candidates;
      };
      const targetRow = consignmentRows.find((row) => {
        return getVendorIdCandidates(row).has(vid);
      });
      if (!targetRow) {
        return res.status(404).json({ error: "Vendor profile not found for that id." });
      }
      const normalizedTargetVendorName = normalizeVendorKey(targetRow.vendor_name);
      const vendorRows = consignmentRows.filter((row) => normalizeVendorKey(row.vendor_name) === normalizedTargetVendorName);
      let soldUnits = 0;
      let soldAmount = 0;
      let returnedUnits = 0;
      let activeUnits = 0;
      let collectedRecords = 0;
      let collectedUnits = 0;
      const items = vendorRows.sort((a, b) => Number(new Date(b.updated_at || 0).getTime()) - Number(new Date(a.updated_at || 0).getTime())).map((row) => {
        const specs = parsePublicSpecs(row.public_specs);
        const itemSoldQty = Math.max(0, Math.trunc(Number(specs?.__sold_quantity_total || 0) || 0));
        const itemSoldAmount = Math.max(0, Number(specs?.__sold_amount_total || 0) || 0);
        const itemReturnedQty = Math.max(0, Math.trunc(Number(specs?.__returned_quantity_total || 0) || 0));
        const itemQuantity = Math.max(0, Math.trunc(Number(row.quantity || 0) || 0));
        const status = normalizeConsignmentStatus(row.status);
        if (status === "approved" || status === "pending") {
          activeUnits += itemQuantity;
        }
        if (status === "returned") {
          collectedRecords += 1;
          collectedUnits += itemQuantity;
        }
        soldUnits += itemSoldQty;
        soldAmount += itemSoldAmount;
        returnedUnits += itemReturnedQty;
        return {
          id: Number(row.id || 0),
          quick_code: String(row.quick_code || "").trim(),
          item_name: String(row.item_name || "Item"),
          imei_serial: String(row.imei_serial || ""),
          status,
          quantity: itemQuantity,
          sold_quantity: itemSoldQty,
          sold_amount: Number(itemSoldAmount.toFixed(2)),
          returned_quantity: itemReturnedQty,
          returned_reason: String(specs?.__last_returned_reason || "").trim(),
          return_history: Array.isArray(specs?.__return_history) ? specs.__return_history : [],
          agreed_payout: Math.max(0, Number(row.agreed_payout || 0) || 0),
          selling_price: Math.max(0, Number(row.selling_price || 0) || 0),
          updated_at: row.updated_at || null
        };
      });
      const payableRows = (await postgresPool2.query(`
        SELECT
          vp.id,
          vp.item_name,
          vp.amount_due,
          vp.status,
          vp.note,
          vp.created_at,
          vp.settled_at,
          COALESCE(
            vp.source_type,
            CASE
              WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'consignment_item')::boolean, false) THEN 'CONSIGNMENT'
              WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'sourced_item')::boolean, false) THEN 'SOURCED'
              ELSE 'SOURCED'
            END,
            'SOURCED'
          ) AS source_type,
          s.timestamp as sale_timestamp
        FROM vendor_payables vp
        LEFT JOIN sales s ON s.id = vp.sale_id
        LEFT JOIN sale_items si ON si.id = vp.sale_item_id
        WHERE vp.store_id = $1
          AND LOWER(COALESCE(vp.vendor_name, '')) = LOWER($2)
        ORDER BY vp.created_at DESC, vp.id DESC
        LIMIT 50
      `, [storeId, String(targetRow.vendor_name || "")])).rows;
      const pendingPayout = payableRows.filter((row) => String(row.status || "").toUpperCase() !== "SETTLED").reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const settledPayout = payableRows.filter((row) => String(row.status || "").toUpperCase() === "SETTLED").reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const sourcedPayout = payableRows.filter((row) => String(row.source_type || "SOURCED").toUpperCase() === "SOURCED").reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const consignmentPayout = payableRows.filter((row) => String(row.source_type || "SOURCED").toUpperCase() === "CONSIGNMENT").reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const returnRows = (await postgresPool2.query(`
        SELECT id, sale_id, returned_value, refund_amount, refund_method, return_type, reason, created_at, items
        FROM sales_returns
        WHERE store_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 250
      `, [storeId])).rows;
      const customerReturns = [];
      returnRows.forEach((row) => {
        let parsedItems = [];
        if (Array.isArray(row?.items)) {
          parsedItems = row.items;
        } else {
          try {
            const parsed = JSON.parse(String(row?.items || "[]"));
            parsedItems = Array.isArray(parsed) ? parsed : [];
          } catch {
            parsedItems = [];
          }
        }
        parsedItems.forEach((item) => {
          const specs = item?.specs_at_sale && typeof item.specs_at_sale === "object" ? item.specs_at_sale : (() => {
            try {
              const parsed = JSON.parse(String(item?.specs_at_sale || "{}"));
              return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch {
              return {};
            }
          })();
          const sourceType = String(item?.item_source || "").toUpperCase();
          const candidateVendorName = sourceType === "SOURCED" ? String(item?.sourced_vendor_name || specs?.sourced_vendor_name || "") : String(specs?.vendor_name || item?.vendor_name || "");
          if (!candidateVendorName) return;
          if (normalizeVendorKey(candidateVendorName) !== normalizedTargetVendorName) {
            return;
          }
          customerReturns.push({
            return_id: Number(row?.id || 0),
            sale_id: Number(row?.sale_id || 0),
            item_name: String(item?.name || item?.product_name || specs?.consignment_item_name || "Vendor Item"),
            quantity: Math.max(0, Math.trunc(Number(item?.quantity || 0) || 0)),
            returned_value: Math.max(0, Number(item?.subtotal || 0) || 0),
            refund_amount: Math.max(0, Number(row?.refund_amount || 0) || 0),
            refund_method: String(row?.refund_method || "cash").toLowerCase(),
            return_type: String(row?.return_type || "REFUND").toUpperCase(),
            reason: String(row?.reason || "").trim(),
            created_at: row?.created_at || null
          });
        });
      });
      const customerReturnedUnits = customerReturns.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0) || 0), 0);
      const collectedUnitsTotal = Math.max(0, collectedUnits + customerReturnedUnits);
      const collectedRecordsTotal = Math.max(0, collectedRecords + customerReturns.length);
      res.json({
        store: {
          id: Number(storeRow.id || storeId),
          name: String(storeRow.name || "Store"),
          currency_code: /^[A-Z]{3}$/.test(String(storeRow.currency_code || "").toUpperCase()) ? String(storeRow.currency_code).toUpperCase() : "USD"
        },
        vendor: {
          id: vid,
          name: String(targetRow.vendor_name || "Unknown Vendor"),
          phone: String(targetRow.vendor_phone || "").trim(),
          address: String(targetRow.vendor_address || "").trim()
        },
        summary: {
          total_records: items.length,
          active_units: activeUnits,
          collected_records: collectedRecordsTotal,
          collected_units: collectedUnitsTotal,
          sold_units: soldUnits,
          sold_amount: Number(soldAmount.toFixed(2)),
          returned_units: returnedUnits,
          customer_return_events: customerReturns.length,
          customer_returned_units: customerReturnedUnits,
          pending_payout: Number(pendingPayout.toFixed(2)),
          settled_payout: Number(settledPayout.toFixed(2)),
          sourced_payout: Number(sourcedPayout.toFixed(2)),
          consignment_payout: Number(consignmentPayout.toFixed(2)),
          total_payout_generated: Number((pendingPayout + settledPayout).toFixed(2))
        },
        items,
        customer_returns: customerReturns,
        activities: payableRows.map((row) => ({
          id: Number(row.id || 0),
          item_name: String(row.item_name || "Item"),
          amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
          source_type: String(row.source_type || "SOURCED").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : "SOURCED",
          status: String(row.status || "UNPAID").toUpperCase(),
          note: row.note || null,
          sale_timestamp: row.sale_timestamp || null,
          created_at: row.created_at || null,
          settled_at: row.settled_at || null
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load vendor profile." });
    }
  });
  app2.get("/api/products", authenticate2, checkStoreLock2, async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const normalizedSearch = rawSearch.toLowerCase();
      const requestedCategory = typeof req.query.category === "string" ? req.query.category.trim() : "";
      const requestedStockStatus = typeof req.query.stock_status === "string" ? req.query.stock_status.trim().toLowerCase() : "all";
      const sortBy = typeof req.query.sort === "string" ? req.query.sort : "recent";
      const hasPaginationQuery = req.query.limit !== void 0 || req.query.offset !== void 0;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 60));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const productQuery = await coreReadRepository2.listProducts({
        storeId,
        search: normalizedSearch,
        category: requestedCategory,
        stockStatus: requestedStockStatus,
        sortBy,
        limit,
        offset,
        paginate: hasPaginationQuery
      });
      const products = productQuery.rows;
      const openCollections = await coreReadRepository2.listOpenMarketCollections(storeId);
      const onCollectionMap = /* @__PURE__ */ new Map();
      openCollections.forEach((row) => {
        safeJsonParse6(row?.items, []).forEach((item) => {
          const productId = Number(item?.product_id) || 0;
          const quantity = Math.max(0, Number(item?.quantity) || 0);
          if (productId > 0 && quantity > 0) {
            onCollectionMap.set(productId, (onCollectionMap.get(productId) || 0) + quantity);
          }
        });
      });
      const canViewCostFields = ["STORE_ADMIN", "SYSTEM_ADMIN", "ACCOUNTANT", "PROCUREMENT_OFFICER"].includes(String(req.user?.role || ""));
      const storeRow = (await postgresPool2.query("SELECT mode FROM stores WHERE id = $1 LIMIT 1", [storeId])).rows[0];
      const isSupermarketMode = String(storeRow?.mode || "").toUpperCase() === "SUPERMARKET";
      const formattedProducts = products.map((p) => {
        const onCollectionQuantity = onCollectionMap.get(Number(p.id)) || 0;
        const parsedConditionMatrix = isSupermarketMode ? null : typeof p.condition_matrix === "string" ? safeJsonParse6(p.condition_matrix, null) : p.condition_matrix || null;
        const sanitizedConditionMatrix = !isSupermarketMode && !canViewCostFields && parsedConditionMatrix ? Object.fromEntries(Object.entries(parsedConditionMatrix).map(([key, value]) => [
          key,
          {
            ...value,
            cost: null,
            cost_price: null,
            costPrice: null
          }
        ])) : parsedConditionMatrix;
        return {
          ...p,
          cost: canViewCostFields ? Number(p.cost || 0) || 0 : null,
          category: p.category_name || p.category || "General",
          category_id: p.category_id || null,
          specs: typeof p.specs === "string" ? safeJsonParse6(p.specs, {}) : p.specs || {},
          condition_matrix: sanitizedConditionMatrix,
          on_collection_quantity: onCollectionQuantity,
          inventory_status: onCollectionQuantity > 0 ? "ON_COLLECTION" : "AVAILABLE"
        };
      });
      if (hasPaginationQuery) {
        return res.json({
          items: formattedProducts,
          total: Number(productQuery.total || 0),
          limit,
          offset
        });
      }
      res.json(formattedProducts);
    } catch (err) {
      console.error("Products read error:", err);
      res.status(500).json({ error: err.message || "Failed to load products" });
    }
  });
  const normalizeConsignmentStatus = (value) => {
    const status = String(value || "").trim().toLowerCase();
    if (["approved", "rejected", "sold", "returned"].includes(status)) {
      return status;
    }
    return "pending";
  };
  const getVendorSignature = (name, _phone, _address) => {
    const normalizedName = String(name || "").trim().toLowerCase();
    return normalizedName || "unknown-vendor";
  };
  const calculateVendorIdFromSignature = (signature) => {
    let hash2 = 0;
    for (let i = 0; i < signature.length; i += 1) {
      hash2 = (hash2 * 31 + signature.charCodeAt(i)) % 9e4;
    }
    return String(hash2 + 1e4).padStart(5, "0");
  };
  const normalizeVendorKey = (value) => String(value || "").trim().toLowerCase();
  const buildVendorPortalBaseUrl = (req) => {
    const origin = String(req.headers?.origin || "").trim();
    if (origin) return origin;
    const host = String(req.get?.("host") || "").trim();
    if (!host) return "";
    const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    return `${protocol}://${host}`;
  };
  const parsePublicSpecs = (value) => {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value || "{}"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const getConditionMatrixTotalStock = (publicSpecs) => {
    const matrix = publicSpecs && typeof publicSpecs === "object" ? publicSpecs.__condition_matrix : null;
    if (!matrix || typeof matrix !== "object") {
      return 0;
    }
    return ["new", "open_box", "used"].map((key) => Math.max(0, Math.trunc(Number(matrix?.[key]?.stock || 0) || 0))).reduce((sum, value) => sum + value, 0);
  };
  const resolveConsignmentInventoryState = (row, publicSpecs) => {
    const normalizedStatus = normalizeConsignmentStatus(row?.status);
    const rawQuantity = Math.max(0, Math.trunc(Number(row?.quantity || 0) || 0));
    const matrixQuantity = getConditionMatrixTotalStock(publicSpecs);
    const effectiveQuantity = Math.max(rawQuantity, matrixQuantity);
    let nextStatus = normalizedStatus;
    if (normalizedStatus === "approved" || normalizedStatus === "sold") {
      nextStatus = effectiveQuantity <= 0 ? "sold" : "approved";
    }
    return {
      rawQuantity,
      effectiveQuantity,
      normalizedStatus,
      nextStatus
    };
  };
  const normalizeProductChangeRequestStatus = (value) => {
    const status = String(value || "").trim().toUpperCase();
    if (status === "APPROVED" || status === "REJECTED") return status;
    return "PENDING";
  };
  const parseProductChangePayload = (value) => {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value || "{}"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const resolveCategoryForProductPayload = async (storeId, rawCategory, rawCategoryId) => {
    let categoryName = String(rawCategory || "").trim() || null;
    let selectedCategoryId = Number(rawCategoryId || 0) || null;
    if (selectedCategoryId != null) {
      const byId = (await postgresPool2.query("SELECT id, name FROM categories WHERE store_id = $1 AND id = $2 LIMIT 1", [storeId, selectedCategoryId])).rows[0];
      if (byId) {
        categoryName = byId.name;
      } else {
        selectedCategoryId = null;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool2.query("SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1", [storeId, categoryName])).rows[0];
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool2.query("INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id", [storeId, categoryName, null]);
      selectedCategoryId = Number(inserted.rows[0]?.id || 0) || null;
    }
    return { categoryName, selectedCategoryId };
  };
  const applyProductChangeRequest = async (requestRow, _reviewer) => {
    const payload = parseProductChangePayload(requestRow?.payload);
    const storeId = Number(requestRow?.store_id || 0);
    const requestType = String(requestRow?.request_type || "").trim().toUpperCase();
    const name = String(payload?.name || "").trim();
    const thumbnail = payload?.thumbnail || null;
    const specs = payload?.specs && typeof payload.specs === "object" ? payload.specs : {};
    const conditionMatrix = payload?.condition_matrix && typeof payload.condition_matrix === "object" ? payload.condition_matrix : null;
    const price = Math.max(0, Number(payload?.price || 0) || 0);
    const stock = Math.max(0, Math.trunc(Number(payload?.stock || 0) || 0));
    const cost = Math.max(0, Number(payload?.cost || 0) || 0);
    const normalizedBarcode = normalizeProductBarcode3(payload?.barcode);
    if (!name || name.length > 255) {
      throw new Error("Requested product has invalid name.");
    }
    if (requestType === "CREATE") {
      if (normalizedBarcode) {
        const existingBarcode = (await postgresPool2.query("SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1", [storeId, normalizedBarcode])).rows[0];
        if (existingBarcode) {
          throw new Error("Cannot approve request: barcode already exists for another product.");
        }
      }
      const resolvedBarcode = normalizedBarcode || await generateUniqueBarcode2(storeId);
      if (!resolvedBarcode) {
        throw new Error("Failed to generate unique barcode during approval.");
      }
      const quickCode = await generateUniqueQuickCode2();
      if (!quickCode) {
        throw new Error("Failed to generate unique quick code during approval.");
      }
      const { categoryName: categoryName2, selectedCategoryId: selectedCategoryId2 } = await resolveCategoryForProductPayload(storeId, payload?.category, payload?.category_id);
      const insertResult = await postgresPool2.query(`
        INSERT INTO products (store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `, [
        storeId,
        name,
        resolvedBarcode,
        categoryName2 || null,
        selectedCategoryId2,
        thumbnail,
        quickCode,
        JSON.stringify(specs || {}),
        JSON.stringify(conditionMatrix),
        price,
        stock,
        cost,
        (/* @__PURE__ */ new Date()).toISOString()
      ]);
      const productId2 = Number(insertResult.rows[0].id);
      return { productId: productId2, action: "CREATE", barcode: resolvedBarcode, quickCode };
    }
    if (requestType !== "UPDATE") {
      throw new Error("Unsupported product change request type.");
    }
    const productId = Number(requestRow?.product_id || 0);
    if (!productId) {
      throw new Error("Request is missing product reference.");
    }
    const existingProduct = (await postgresPool2.query("SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, storeId])).rows[0] || null;
    if (!existingProduct) {
      throw new Error("Cannot approve request: product no longer exists.");
    }
    if (normalizedBarcode) {
      const conflictingProduct = (await postgresPool2.query("SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1", [storeId, normalizedBarcode, productId])).rows[0];
      if (conflictingProduct) {
        throw new Error("Cannot approve request: barcode already exists for another product.");
      }
    }
    const { categoryName, selectedCategoryId } = await resolveCategoryForProductPayload(storeId, payload?.category, payload?.category_id);
    await postgresPool2.query(`
      UPDATE products
      SET name = $1, barcode = $2, category = $3, category_id = $4, thumbnail = $5, specs = $6, condition_matrix = $7, price = $8, stock = $9, cost = $10
      WHERE id = $11 AND store_id = $12
    `, [
      name,
      normalizedBarcode || null,
      categoryName || null,
      selectedCategoryId,
      thumbnail,
      JSON.stringify(specs || {}),
      JSON.stringify(conditionMatrix),
      price,
      stock,
      cost,
      productId,
      storeId
    ]);
    if (conditionMatrix) {
      for (const conditionKey of ["new", "used", "open_box"]) {
        await reconcileInventoryBatchQuantity2({
          productId,
          storeId,
          condition: conditionKey,
          targetStock: Number(conditionMatrix?.[conditionKey]?.stock || 0) || 0
        });
      }
    } else {
      await reconcileInventoryBatchQuantity2({
        productId,
        storeId,
        condition: null,
        targetStock: stock
      });
    }
    return { productId, action: "UPDATE", barcode: normalizedBarcode || null, quickCode: String(existingProduct.quick_code || "") };
  };
  app2.get("/api/pos/search-items", authenticate2, checkStoreLock2, async (req, res) => {
    try {
      const rows = await coreReadRepository2.searchUnifiedPosCatalog({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === "string" ? req.query.search.trim() : "",
        limit: Math.max(1, Math.min(300, Number(req.query.limit) || 120))
      });
      const items = rows.map((row) => {
        const sourceType = String(row.source_type || "INVENTORY").toUpperCase();
        const isConsignment = sourceType === "CONSIGNMENT";
        const specs = parsePublicSpecs(row.specs);
        const consignmentMatrixQuantity = isConsignment ? getConditionMatrixTotalStock(specs) : 0;
        const normalizedConsignmentQuantity = isConsignment ? Math.max(
          0,
          Math.trunc(Number(row.consignment_quantity || row.stock || 0) || 0),
          consignmentMatrixQuantity
        ) : 0;
        return {
          id: Number(row.id),
          name: String(row.name || "").trim(),
          barcode: String(row.barcode || "").trim(),
          quick_code: String(row.quick_code || "").trim(),
          thumbnail: String(row.thumbnail || "").trim(),
          price: Number(row.price || 0) || 0,
          stock: isConsignment ? normalizedConsignmentQuantity : Number(row.stock || 0) || 0,
          mode: "GADGET",
          specs,
          condition_matrix: row.condition_matrix ? parsePublicSpecs(row.condition_matrix) : null,
          is_consignment: isConsignment,
          consignment_item_id: isConsignment ? Number(row.consignment_item_id || 0) || null : null,
          vendor_name: isConsignment ? String(row.vendor_name || "").trim() : "",
          imei_serial: isConsignment ? String(row.imei_serial || "").trim() : "",
          internal_condition: isConsignment ? String(row.internal_condition || "").trim() : "",
          consignment_quantity: normalizedConsignmentQuantity,
          agreed_payout: isConsignment ? Math.max(0, Number(row.agreed_payout || 0) || 0) : 0,
          item_source: isConsignment ? "CONSIGNMENT" : "INVENTORY"
        };
      }).filter((item) => item.name);
      res.json(items);
    } catch (err) {
      console.error("Unified POS search error:", err);
      res.status(500).json({ error: err.message || "Failed to search POS catalog" });
    }
  });
  app2.get("/api/consignment-items", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    try {
      const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const normalizedSearch = rawSearch.toLowerCase();
      const statusQuery = typeof req.query.status === "string" ? req.query.status.trim() : "all";
      const isVendorIdSearch = /^\d{3,}$/.test(rawSearch);
      const rows = await coreReadRepository2.listConsignmentItems({
        storeId: Number(req.user.store_id),
        search: isVendorIdSearch ? "" : rawSearch,
        status: statusQuery
      });
      let normalizedRows = rows.map((row) => {
        const publicSpecs = parsePublicSpecs(row.public_specs);
        const state = resolveConsignmentInventoryState(row, publicSpecs);
        return {
          ...row,
          quantity: state.effectiveQuantity,
          agreed_payout: Math.max(0, Number(row.agreed_payout || 0) || 0),
          selling_price: Math.max(0, Number(row.selling_price || 0) || 0),
          public_specs: publicSpecs,
          status: state.nextStatus,
          __needs_heal: state.rawQuantity !== state.effectiveQuantity || state.normalizedStatus !== state.nextStatus
        };
      });
      if (isVendorIdSearch) {
        normalizedRows = normalizedRows.filter((row) => {
          const vendorId = calculateVendorIdFromSignature(getVendorSignature(row.vendor_name, row.vendor_phone, row.vendor_address));
          if (vendorId.includes(rawSearch)) return true;
          const haystack = [
            row.item_name,
            row.vendor_name,
            row.quick_code,
            row.imei_serial,
            row.vendor_phone,
            row.vendor_address
          ].map((entry) => String(entry || "").toLowerCase()).join(" ");
          return haystack.includes(normalizedSearch);
        });
      }
      const rowsToHeal = normalizedRows.filter((entry) => entry.__needs_heal && Number(entry.id || 0) > 0);
      if (rowsToHeal.length > 0) {
        await Promise.all(rowsToHeal.map((entry) => postgresPool2.query(
          "UPDATE consignment_items SET quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4",
          [
            Math.max(0, Math.trunc(Number(entry.quantity || 0) || 0)),
            String(entry.status || "pending"),
            Number(entry.id),
            Number(req.user.store_id)
          ]
        )));
      }
      res.json(normalizedRows.map(({ __needs_heal, ...entry }) => entry));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load consignment items" });
    }
  });
  app2.get("/api/consignment-vendors", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    try {
      const rows = (await postgresPool2.query(`
        SELECT vendor_name, vendor_phone, vendor_address, MAX(updated_at) AS last_used_at
        FROM consignment_items
        WHERE store_id = $1
          AND TRIM(COALESCE(vendor_name, '')) != ''
        GROUP BY vendor_name, vendor_phone, vendor_address
        ORDER BY LOWER(vendor_name) ASC, MAX(updated_at) DESC
      `, [Number(req.user.store_id)])).rows;
      res.json(rows.map((row) => ({
        vendor_name: String(row.vendor_name || "").trim(),
        vendor_phone: String(row.vendor_phone || "").trim(),
        vendor_address: String(row.vendor_address || "").trim(),
        last_used_at: row.last_used_at || null
      })).filter((row) => row.vendor_name));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load saved vendors" });
    }
  });
  app2.get("/api/consignment-vendor-bank-details", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    try {
      const vendorName = String(req.query?.vendor_name || "").trim();
      if (vendorName.length < 2) {
        return res.status(400).json({ error: "Vendor name is required." });
      }
      const row = (await postgresPool2.query(`
        SELECT vendor_name, bank_name, account_number, account_name, bank_note, updated_at
        FROM consignment_vendor_bank_details
        WHERE store_id = $1 AND vendor_key = $2
        LIMIT 1
      `, [Number(req.user.store_id), normalizeVendorKey(vendorName)])).rows[0];
      res.json({
        vendor_name: vendorName,
        bank_name: String(row?.bank_name || "").trim(),
        account_number: String(row?.account_number || "").trim(),
        account_name: String(row?.account_name || "").trim(),
        bank_note: String(row?.bank_note || "").trim(),
        updated_at: row?.updated_at || null
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load vendor bank details" });
    }
  });
  app2.put("/api/consignment-vendor-bank-details", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    try {
      const vendorName = String(req.body?.vendor_name || "").trim();
      const bankName = String(req.body?.bank_name || "").trim().slice(0, 120);
      const accountNumber = String(req.body?.account_number || "").trim().slice(0, 40);
      const accountName = String(req.body?.account_name || "").trim().slice(0, 120);
      const bankNote = String(req.body?.bank_note || "").trim().slice(0, 240);
      if (vendorName.length < 2) {
        return res.status(400).json({ error: "Vendor name is required." });
      }
      const result = await postgresPool2.query(`
        INSERT INTO consignment_vendor_bank_details (
          store_id, vendor_name, vendor_key, bank_name, account_number, account_name, bank_note, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (store_id, vendor_key)
        DO UPDATE SET
          vendor_name = EXCLUDED.vendor_name,
          bank_name = EXCLUDED.bank_name,
          account_number = EXCLUDED.account_number,
          account_name = EXCLUDED.account_name,
          bank_note = EXCLUDED.bank_note,
          updated_at = CURRENT_TIMESTAMP
        RETURNING vendor_name, bank_name, account_number, account_name, bank_note, updated_at
      `, [
        Number(req.user.store_id),
        vendorName,
        normalizeVendorKey(vendorName),
        bankName || null,
        accountNumber || null,
        accountName || null,
        bankNote || null
      ]);
      const row = result.rows[0];
      res.json({
        vendor_name: String(row?.vendor_name || vendorName).trim(),
        bank_name: String(row?.bank_name || "").trim(),
        account_number: String(row?.account_number || "").trim(),
        account_name: String(row?.account_name || "").trim(),
        bank_note: String(row?.bank_note || "").trim(),
        updated_at: row?.updated_at || null
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to save vendor bank details" });
    }
  });
  app2.post("/api/consignment-items", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const payload = req.body || {};
    const vendorName = String(payload.vendor_name || "").trim();
    const vendorPhone = String(payload.vendor_phone || "").trim();
    const vendorAddress = String(payload.vendor_address || "").trim();
    const itemName = String(payload.item_name || "").trim();
    const imeiSerial = String(payload.imei_serial || "").trim();
    const quickCode = String(payload.quick_code || "").trim().toUpperCase().replace(/\s+/g, "");
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 0) || 1));
    const agreedPayout = Math.max(0, Number(payload.agreed_payout || 0) || 0);
    const sellingPrice = Math.max(0, Number(payload.selling_price || 0) || 0);
    const internalCondition = String(payload.internal_condition || "").trim() || null;
    const publicSpecs = parsePublicSpecs(payload.public_specs);
    if (vendorName.length < 2) {
      return res.status(400).json({ error: "Vendor name is required." });
    }
    if (itemName.length < 2) {
      return res.status(400).json({ error: "Item name is required." });
    }
    if (agreedPayout <= 0 || sellingPrice <= 0) {
      return res.status(400).json({ error: "Agreed payout and selling price must be greater than zero." });
    }
    try {
      const created = await coreWriteRepository2.createConsignmentItem({
        storeId: Number(req.user.store_id),
        quickCode: quickCode || null,
        vendorName,
        vendorPhone: vendorPhone || null,
        vendorAddress: vendorAddress || null,
        itemName,
        imeiSerial: imeiSerial || null,
        quantity,
        agreedPayout,
        sellingPrice,
        publicSpecs,
        internalCondition,
        addedBy: Number(req.user.id)
      });
      logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "CONSIGNMENT_ADD",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} added consignment item ${itemName} from ${vendorName}.`,
        newValue: {
          consignment_item_id: Number(created?.id || 0),
          quick_code: created?.quick_code || null,
          imei_serial: created?.imei_serial || null,
          agreed_payout: agreedPayout,
          selling_price: sellingPrice
        }
      });
      res.json({
        ...created,
        quantity: Math.max(0, Math.trunc(Number(created?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(created?.public_specs),
        status: normalizeConsignmentStatus(created?.status)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to create consignment item" });
    }
  });
  app2.put("/api/consignment-items/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    const payload = req.body || {};
    const vendorName = String(payload.vendor_name || "").trim();
    const vendorPhone = String(payload.vendor_phone || "").trim();
    const vendorAddress = String(payload.vendor_address || "").trim();
    const itemName = String(payload.item_name || "").trim();
    const imeiSerial = String(payload.imei_serial || "").trim();
    const quickCode = String(payload.quick_code || "").trim().toUpperCase().replace(/\s+/g, "");
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 0) || 1));
    const agreedPayout = Math.max(0, Number(payload.agreed_payout || 0) || 0);
    const sellingPrice = Math.max(0, Number(payload.selling_price || 0) || 0);
    const internalCondition = String(payload.internal_condition || "").trim() || null;
    const publicSpecs = parsePublicSpecs(payload.public_specs);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    if (vendorName.length < 2 || itemName.length < 2) {
      return res.status(400).json({ error: "Vendor and item name are required." });
    }
    try {
      const existing = await coreReadRepository2.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      const existingPublicSpecs = parsePublicSpecs(existing.public_specs);
      const preservedInternalFields = Object.fromEntries(
        Object.entries(existingPublicSpecs).filter(([key]) => key.startsWith("__") && key !== "__condition_matrix")
      );
      const mergedPublicSpecs = { ...publicSpecs, ...preservedInternalFields };
      const updated = await coreWriteRepository2.updateConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        quickCode: quickCode || null,
        vendorName,
        vendorPhone: vendorPhone || null,
        vendorAddress: vendorAddress || null,
        itemName,
        imeiSerial: imeiSerial || null,
        quantity,
        agreedPayout,
        sellingPrice,
        publicSpecs: mergedPublicSpecs,
        internalCondition
      });
      logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "CONSIGNMENT_EDIT",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} edited consignment item ${itemName}; status moved to pending approval.`,
        oldValue: {
          status: normalizeConsignmentStatus(existing?.status),
          selling_price: Number(existing?.selling_price || 0) || 0
        },
        newValue: {
          status: "pending",
          selling_price: sellingPrice,
          agreed_payout: agreedPayout
        }
      });
      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to update consignment item" });
    }
  });
  app2.post("/api/consignment-items/:id/approve", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    try {
      const updated = await coreWriteRepository2.reviewConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        reviewerId: Number(req.user.id),
        action: "APPROVE"
      });
      if (!updated) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      res.json({
        ...updated,
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to approve consignment item" });
    }
  });
  app2.post("/api/consignment-items/:id/reject", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    try {
      const updated = await coreWriteRepository2.reviewConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        reviewerId: Number(req.user.id),
        action: "REJECT"
      });
      if (!updated) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      res.json({
        ...updated,
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to reject consignment item" });
    }
  });
  app2.post("/api/consignment-items/:id/return", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    const requestedReturnQuantity = Math.max(1, Math.trunc(Number(req.body?.quantity || 0) || 1));
    const collectionReason = String(req.body?.reason || "").trim().slice(0, 200);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    try {
      const existing = await coreReadRepository2.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      const publicSpecs = parsePublicSpecs(existing.public_specs);
      const state = resolveConsignmentInventoryState(existing, publicSpecs);
      if (state.nextStatus === "sold" || state.effectiveQuantity <= 0) {
        return res.status(400).json({ error: "Sold items cannot be returned to vendor." });
      }
      if (state.nextStatus === "rejected" || state.nextStatus === "returned") {
        return res.status(400).json({ error: "This item is not available for return-to-vendor updates." });
      }
      if (requestedReturnQuantity > state.effectiveQuantity) {
        return res.status(400).json({ error: `Only ${state.effectiveQuantity} unit(s) are available to return.` });
      }
      const nextQuantity = Math.max(0, state.effectiveQuantity - requestedReturnQuantity);
      const nextStatus = nextQuantity <= 0 ? "returned" : "approved";
      const matrix = publicSpecs && typeof publicSpecs === "object" ? publicSpecs.__condition_matrix : null;
      const currentReturnedTotal = Math.max(0, Math.trunc(Number(publicSpecs?.__returned_quantity_total || 0) || 0));
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      publicSpecs.__returned_quantity_total = currentReturnedTotal + requestedReturnQuantity;
      publicSpecs.__last_returned_quantity = requestedReturnQuantity;
      publicSpecs.__last_returned_at = nowIso;
      if (collectionReason) {
        publicSpecs.__last_returned_reason = collectionReason;
      } else {
        delete publicSpecs.__last_returned_reason;
      }
      const existingHistory = Array.isArray(publicSpecs.__return_history) ? publicSpecs.__return_history : [];
      existingHistory.push({
        quantity: requestedReturnQuantity,
        reason: collectionReason || null,
        at: nowIso,
        by: req.user.username || null
      });
      publicSpecs.__return_history = existingHistory;
      if (matrix && typeof matrix === "object") {
        let remainingToDeduct = requestedReturnQuantity;
        for (const key of ["new", "open_box", "used"]) {
          if (remainingToDeduct <= 0) break;
          const stock = Math.max(0, Math.trunc(Number(matrix?.[key]?.stock || 0) || 0));
          if (stock <= 0) continue;
          const deduction = Math.min(stock, remainingToDeduct);
          matrix[key] = {
            ...typeof matrix[key] === "object" ? matrix[key] : {},
            stock: stock - deduction
          };
          remainingToDeduct -= deduction;
        }
      }
      const updated = (await postgresPool2.query(`
        UPDATE consignment_items
        SET quantity = $1,
            status = $2,
            public_specs = $3::jsonb,
            approved_by = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5 AND store_id = $6
        RETURNING *
      `, [
        nextQuantity,
        nextStatus,
        JSON.stringify(publicSpecs || {}),
        Number(req.user.id),
        consignmentItemId,
        Number(req.user.store_id)
      ])).rows[0];
      if (!updated) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "CONSIGNMENT_RETURN",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} returned ${requestedReturnQuantity} unit(s) of consignment item ${existing.item_name || `#${consignmentItemId}`} to vendor ${existing.vendor_name || "N/A"}${collectionReason ? `. Reason: ${collectionReason}` : ""}.`,
        oldValue: {
          status: state.nextStatus,
          quantity: state.effectiveQuantity,
          quick_code: existing.quick_code || null
        },
        newValue: {
          status: nextStatus,
          quantity: nextQuantity,
          returned_quantity: requestedReturnQuantity,
          consignment_item_id: consignmentItemId
        }
      });
      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to return consignment item to vendor" });
    }
  });
  app2.post("/api/consignment-items/:id/recalculate-sold", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    try {
      const existing = await coreReadRepository2.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      let netSoldQty;
      let netSoldAmount;
      const manualQty = req.body?.soldQty;
      const manualAmount = req.body?.soldAmount;
      if (manualQty !== void 0 && manualQty !== null) {
        netSoldQty = Math.max(0, Math.trunc(Number(manualQty) || 0));
        netSoldAmount = Math.max(0, Number(manualAmount ?? 0) || 0);
      } else {
        const salesRows = (await postgresPool2.query(`
          SELECT si.id, si.quantity, si.subtotal, si.price_at_sale
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE s.store_id = $1
            AND (si.specs_at_sale::jsonb->>'consignment_item_id')::int = $2
        `, [Number(req.user.store_id), consignmentItemId])).rows;
        const totalSoldQty = salesRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
        const totalSoldAmount = salesRows.reduce((sum, row) => {
          const subtotal = Math.max(0, Number(row.subtotal) || 0);
          return sum + (subtotal > 0 ? subtotal : Math.max(0, Number(row.price_at_sale) || 0) * Math.max(0, Number(row.quantity) || 0));
        }, 0);
        const returnRows = (await postgresPool2.query(`
          SELECT sr.items FROM sales_returns sr WHERE sr.store_id = $1
        `, [Number(req.user.store_id)])).rows;
        let totalReturnedQty = 0;
        let totalReturnedAmount = 0;
        for (const row of returnRows) {
          const items = safeJsonParse6(row.items, []);
          for (const item of items) {
            const itemConsignmentId = Math.max(0, Number(item?.consignment_item_id || 0) || 0);
            if (itemConsignmentId === consignmentItemId) {
              totalReturnedQty += Math.max(0, Number(item.quantity) || 0);
              totalReturnedAmount += Math.max(0, Number(item.subtotal) || 0);
            }
          }
        }
        netSoldQty = Math.max(0, totalSoldQty - totalReturnedQty);
        netSoldAmount = Number(Math.max(0, totalSoldAmount - totalReturnedAmount).toFixed(2));
      }
      const publicSpecs = parsePublicSpecs(existing.public_specs);
      publicSpecs.__sold_quantity_total = netSoldQty;
      publicSpecs.__sold_amount_total = netSoldAmount;
      if (netSoldQty > 0 && !publicSpecs.__last_sold_at) {
        publicSpecs.__last_sold_at = existing.updated_at || (/* @__PURE__ */ new Date()).toISOString();
      }
      const updated = (await postgresPool2.query(`
        UPDATE consignment_items
        SET public_specs = $1::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
        RETURNING *
      `, [
        JSON.stringify(publicSpecs),
        consignmentItemId,
        Number(req.user.store_id)
      ])).rows[0];
      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
        recalculated: { soldQty: netSoldQty, soldAmount: netSoldAmount }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to recalculate sold stats" });
    }
  });
  app2.delete("/api/consignment-vendors", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const vendorName = String(req.query?.vendor_name || "").trim();
    if (vendorName.length < 2) {
      return res.status(400).json({ error: "vendor_name query param is required." });
    }
    try {
      const storeId = Number(req.user.store_id);
      const rows = (await postgresPool2.query(
        "SELECT id, quantity FROM consignment_items WHERE store_id = $1 AND LOWER(TRIM(vendor_name)) = LOWER($2)",
        [storeId, vendorName]
      )).rows;
      if (rows.length === 0) {
        return res.json({ deleted: true, vendor_name: vendorName, deleted_count: 0 });
      }
      const hasActiveStock = rows.some((row) => {
        const qty = Math.max(0, Math.trunc(Number(row.quantity || 0) || 0));
        return qty > 0;
      });
      if (hasActiveStock) {
        return res.status(409).json({ error: "Cannot delete this vendor \u2014 one or more of their items still have stock (quantity > 0). Reduce quantity to 0 first." });
      }
      const ids = rows.map((r) => Number(r.id));
      await postgresPool2.query(
        `DELETE FROM consignment_items WHERE store_id = $1 AND id = ANY($2::int[])`,
        [storeId, ids]
      );
      logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "CONSIGNMENT_VENDOR_DELETE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} deleted all consignment items (${ids.length}) for vendor "${vendorName}".`,
        oldValue: { vendor_name: vendorName, deleted_count: ids.length },
        newValue: null
      });
      res.json({ deleted: true, vendor_name: vendorName, deleted_count: ids.length });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to delete vendor." });
    }
  });
  app2.delete("/api/consignment-items/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: "Invalid consignment item ID." });
    }
    try {
      const existing = await coreReadRepository2.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: "Consignment item not found." });
      }
      const currentQty = Math.max(0, Math.trunc(Number(existing.quantity || 0) || 0));
      if (currentQty > 0) {
        return res.status(409).json({ error: "Cannot delete an item that still has stock. Reduce quantity to 0 first." });
      }
      await postgresPool2.query(
        "DELETE FROM consignment_items WHERE id = $1 AND store_id = $2",
        [consignmentItemId, Number(req.user.store_id)]
      );
      res.json({ deleted: true, id: consignmentItemId });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to delete consignment item." });
    }
  });
  app2.get("/api/inventory/daily-summary", authenticate2, checkStoreLock2, async (req, res) => {
    const getLocalDateKey = (date = /* @__PURE__ */ new Date()) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const requestedDate = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : getLocalDateKey();
    const requestedDays = Math.max(7, Math.min(21, Number(req.query.days) || 14));
    try {
      const summary = await coreReadRepository2.getInventoryDailySummary(Number(req.user.store_id), requestedDate, requestedDays);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load inventory summary" });
    }
  });
  app2.get("/api/stock-adjustments", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    try {
      const rows = await coreReadRepository2.listStockAdjustments({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === "string" ? req.query.search.trim() : "",
        typeFilter: typeof req.query.type === "string" ? req.query.type.trim() : "",
        productIdFilter: Number(req.query.productId)
      });
      res.json(rows.map((row) => formatStockAdjustmentEntry2(row)));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load stock adjustments" });
    }
  });
  app2.post("/api/stock-adjustments", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const productId = Number(req.body?.product_id);
    const rawQuantity = Number(req.body?.quantity);
    const condition = req.body?.condition;
    const note = String(req.body?.note || "").trim().slice(0, 500);
    const adjustmentMode = ["INCREASE", "DECREASE", "SET"].includes(String(req.body?.adjustment_mode || "").toUpperCase()) ? String(req.body?.adjustment_mode || "").toUpperCase() : "DECREASE";
    const adjustmentType = ["DAMAGED", "LOST", "FOUND", "MANUAL", "INTERNAL_USE", "RESTOCK", "COUNT"].includes(String(req.body?.adjustment_type || "").toUpperCase()) ? String(req.body?.adjustment_type || "").toUpperCase() : "MANUAL";
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Select a valid product to adjust." });
    }
    if (!Number.isFinite(rawQuantity) || rawQuantity < 0) {
      return res.status(400).json({ error: "Enter a valid quantity for this stock adjustment." });
    }
    if (adjustmentMode !== "SET" && rawQuantity <= 0) {
      return res.status(400).json({ error: "Quantity must be greater than zero." });
    }
    try {
      const createdAdjustment = await coreWriteRepository2.createStockAdjustment({
        storeId,
        productId,
        rawQuantity,
        condition,
        note: note || null,
        adjustmentMode,
        adjustmentType,
        userId: Number(req.user.id),
        userRole: String(req.user.role || "")
      });
      const nextStatus = normalizeRecountStatus2(createdAdjustment?.recount_status);
      const isPendingRecount = nextStatus === "PENDING";
      const actionDescription = isPendingRecount ? `${getAuditActorLabel2(req.user.role)} ${req.user.username} submitted a stock recount for ${createdAdjustment?.product_name || `Product #${productId}`} and is awaiting approval.` : `${getAuditActorLabel2(req.user.role)} ${req.user.username} adjusted ${createdAdjustment?.product_name || `Product #${productId}`} stock from ${Number(createdAdjustment?.quantity_before || 0) || 0} to ${Number(createdAdjustment?.quantity_after || 0) || 0}${createdAdjustment?.condition ? ` (${String(createdAdjustment.condition).replace(/_/g, " ")})` : ""}.`;
      logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "STOCK_ADJUST",
        description: actionDescription,
        oldValue: {
          quantity_before: Number(createdAdjustment?.quantity_before || 0) || 0,
          adjustment_type: createdAdjustment?.adjustment_type || adjustmentType
        },
        newValue: {
          quantity_after: Number(createdAdjustment?.quantity_after || 0) || 0,
          quantity_change: Number(createdAdjustment?.quantity_change || 0) || 0,
          recount_status: nextStatus,
          note: createdAdjustment?.note || note || null
        }
      });
      res.json({ success: true, adjustment: formatStockAdjustmentEntry2(createdAdjustment) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to save stock adjustment" });
    }
  });
  app2.post("/api/stock-adjustments/:id/approve", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const adjustmentId = Number(req.params.id);
    const approvalNote = String(req.body?.approval_note || "").trim().slice(0, 500);
    if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
      return res.status(400).json({ error: "Invalid stock count record." });
    }
    try {
      const approvedAdjustment = await coreWriteRepository2.reviewStockAdjustment({
        storeId,
        adjustmentId,
        approvalNote: approvalNote || null,
        approvedBy: Number(req.user.id),
        action: "APPROVE"
      });
      logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "STOCK_ADJUST",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} approved stock recount #${adjustmentId} for ${approvedAdjustment?.product_name || "inventory item"}.`,
        oldValue: { recount_status: "PENDING" },
        newValue: {
          recount_status: "APPROVED",
          quantity_after: Number(approvedAdjustment?.quantity_after || 0) || 0,
          approval_note: approvalNote || null
        }
      });
      res.json({ success: true, adjustment: formatStockAdjustmentEntry2(approvedAdjustment) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to approve stock recount" });
    }
  });
  app2.post("/api/stock-adjustments/:id/reject", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const adjustmentId = Number(req.params.id);
    const approvalNote = String(req.body?.approval_note || "").trim().slice(0, 500);
    if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
      return res.status(400).json({ error: "Invalid stock count record." });
    }
    try {
      const rejectedAdjustment = await coreWriteRepository2.reviewStockAdjustment({
        storeId,
        adjustmentId,
        approvalNote: approvalNote || null,
        approvedBy: Number(req.user.id),
        action: "REJECT"
      });
      logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "STOCK_ADJUST",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} rejected stock recount #${adjustmentId} for ${rejectedAdjustment?.product_name || "inventory item"}.`,
        oldValue: { recount_status: "PENDING" },
        newValue: {
          recount_status: "REJECTED",
          approval_note: approvalNote || null
        }
      });
      res.json({ success: true, adjustment: formatStockAdjustmentEntry2(rejectedAdjustment) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to reject stock recount" });
    }
  });
  app2.post("/api/products", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const { name, barcode, category, category_id, thumbnail, specs, condition_matrix, price, stock, cost } = req.body;
    const canEditCost = ["STORE_ADMIN", "SYSTEM_ADMIN"].includes(String(req.user?.role || ""));
    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: "Product name required (max 255 chars)" });
    }
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ error: "Selling price must be zero or greater." });
    }
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: "Stock must be a positive integer" });
    }
    const normalizedCost = canEditCost ? Number(cost ?? 0) : 0;
    if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
      return res.status(400).json({ error: "Cost must be zero or greater." });
    }
    const storeForMode = (await postgresPool2.query("SELECT mode FROM stores WHERE id = $1 LIMIT 1", [req.user.store_id])).rows[0];
    const isSupermarketStore = String(storeForMode?.mode || "").toUpperCase() === "SUPERMARKET";
    let normalizedConditionMatrix = isSupermarketStore ? null : condition_matrix || null;
    if (!isSupermarketStore && condition_matrix) {
      const requiredConditions = ["new", "used", "open_box"];
      normalizedConditionMatrix = {};
      for (const cond of requiredConditions) {
        const slot = condition_matrix[cond];
        if (!slot || typeof slot.price !== "number" || typeof slot.stock !== "number") {
          return res.status(400).json({ error: `Invalid condition_matrix for ${cond}. Must have price and stock.` });
        }
        const slotPrice = Math.max(0, Number(slot.price) || 0);
        const slotStock = Math.max(0, Number(slot.stock) || 0);
        const slotCost = canEditCost ? Math.max(0, Number(slot.cost ?? slot.cost_price ?? slot.costPrice ?? 0) || 0) : 0;
        if ((slotStock > 0 || slotCost > 0) && slotPrice <= 0) {
          return res.status(400).json({ error: `Selling price is required for ${cond.replace("_", " ")} items.` });
        }
        normalizedConditionMatrix[cond] = {
          ...slot,
          price: slotPrice,
          stock: slotStock,
          cost: slotCost
        };
      }
    }
    const hasAnyConditionPricing = Boolean(normalizedConditionMatrix) && ["new", "used", "open_box"].some((cond) => Number(normalizedConditionMatrix?.[cond]?.price || 0) > 0);
    const hasValidMainPrice = Number(price) > 0;
    if (!hasValidMainPrice && !hasAnyConditionPricing) {
      return res.status(400).json({ error: "Selling price must be greater than zero. Condition-based pricing can be an alternative for gadgets." });
    }
    const normalizedBarcode = normalizeProductBarcode3(barcode);
    if (normalizedBarcode) {
      const existingBarcode = (await postgresPool2.query("SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1", [req.user.store_id, normalizedBarcode])).rows[0];
      if (existingBarcode) {
        return res.status(400).json({ error: "Barcode already exists for another product in this store" });
      }
    }
    const isStaffRequest = String(req.user?.role || "").toUpperCase() === "STAFF";
    if (isStaffRequest) {
      try {
        const requestPayload = {
          name,
          barcode: normalizedBarcode || null,
          category: category || null,
          category_id: category_id || null,
          thumbnail: thumbnail || null,
          specs: specs || {},
          condition_matrix: normalizedConditionMatrix,
          price,
          stock,
          cost: normalizedCost
        };
        const requestResult = await postgresPool2.query(`
          INSERT INTO product_change_requests (store_id, request_type, product_id, payload, status, requested_by)
          VALUES ($1, 'CREATE', NULL, $2, 'PENDING', $3)
          RETURNING id
        `, [
          req.user.store_id,
          JSON.stringify(requestPayload),
          Number(req.user.id)
        ]);
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: "PRODUCT_CHANGE_REQUEST",
          description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} submitted a product create request for ${name}.`,
          newValue: {
            request_id: Number(requestResult.rows[0]?.id || 0),
            request_type: "CREATE",
            name,
            price,
            stock
          }
        });
        return res.json({
          pendingApproval: true,
          request_id: Number(requestResult.rows[0]?.id || 0),
          message: "Product request submitted for manager approval."
        });
      } catch (err) {
        return res.status(400).json({ error: err.message || "Failed to submit product approval request" });
      }
    }
    const resolvedBarcode = normalizedBarcode || await generateUniqueBarcode2(req.user.store_id);
    if (!resolvedBarcode) {
      return res.status(500).json({ error: "Failed to generate unique barcode" });
    }
    const quick_code = await generateUniqueQuickCode2();
    if (!quick_code) {
      return res.status(500).json({ error: "Failed to generate unique quick code" });
    }
    let categoryName = category || null;
    let selectedCategoryId = category_id || null;
    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool2.query("SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2)", [req.user.store_id, categoryName.trim()])).rows[0];
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool2.query("INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id", [req.user.store_id, categoryName.trim(), null]);
      selectedCategoryId = inserted.rows[0]?.id || selectedCategoryId;
    }
    try {
      const result = await postgresPool2.query(`
        INSERT INTO products (store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `, [
        req.user.store_id,
        name,
        resolvedBarcode,
        categoryName || null,
        selectedCategoryId,
        thumbnail || null,
        quick_code,
        JSON.stringify(specs || {}),
        JSON.stringify(normalizedConditionMatrix),
        price,
        stock,
        normalizedCost,
        (/* @__PURE__ */ new Date()).toISOString()
      ]);
      const productId = Number(result.rows[0].id);
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "PRODUCT_ADD",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} added new product ${name} at ${formatAuditCurrency2(price)} with opening stock ${Number(stock) || 0}.`,
        newValue: {
          productId,
          name,
          price,
          stock,
          barcode: resolvedBarcode
        }
      });
      res.json({
        id: productId,
        quick_code,
        barcode: resolvedBarcode,
        autoGeneratedBarcode: !normalizedBarcode
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.put("/api/products/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const { name, barcode, category, category_id, thumbnail, specs, condition_matrix, price, stock, cost } = req.body;
    const productId = Number(req.params.id);
    const canEditCost = ["STORE_ADMIN", "SYSTEM_ADMIN"].includes(String(req.user?.role || ""));
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: "Product name required (max 255 chars)" });
    }
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ error: "Selling price must be zero or greater." });
    }
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: "Stock must be a positive integer" });
    }
    const existingProduct = (await postgresPool2.query("SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, req.user.store_id])).rows[0] || null;
    if (!existingProduct) {
      return res.status(404).json({ error: "Product not found" });
    }
    const normalizedCost = canEditCost ? Number(cost ?? existingProduct.cost ?? 0) : Number(existingProduct.cost || 0);
    if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
      return res.status(400).json({ error: "Cost must be zero or greater." });
    }
    const storeForModePut = (await postgresPool2.query("SELECT mode FROM stores WHERE id = $1 LIMIT 1", [req.user.store_id])).rows[0];
    const isSupermarketStorePut = String(storeForModePut?.mode || "").toUpperCase() === "SUPERMARKET";
    const existingMatrix = safeJsonParse6(existingProduct.condition_matrix, {});
    let normalizedConditionMatrix = isSupermarketStorePut ? null : condition_matrix || null;
    if (!isSupermarketStorePut && condition_matrix) {
      const requiredConditions = ["new", "used", "open_box"];
      normalizedConditionMatrix = {};
      for (const cond of requiredConditions) {
        const slot = condition_matrix[cond];
        if (!slot || typeof slot.price !== "number" || typeof slot.stock !== "number") {
          return res.status(400).json({ error: `Invalid condition_matrix for ${cond}. Must have price and stock.` });
        }
        const slotPrice = Math.max(0, Number(slot.price) || 0);
        const slotStock = Math.max(0, Number(slot.stock) || 0);
        const preservedCost = Math.max(0, Number(existingMatrix?.[cond]?.cost ?? 0) || 0);
        const slotCost = canEditCost ? Math.max(0, Number(slot.cost ?? slot.cost_price ?? slot.costPrice ?? preservedCost) || 0) : preservedCost;
        if ((slotStock > 0 || slotCost > 0) && slotPrice <= 0) {
          return res.status(400).json({ error: `Selling price is required for ${cond.replace("_", " ")} items.` });
        }
        normalizedConditionMatrix[cond] = {
          ...slot,
          price: slotPrice,
          stock: slotStock,
          cost: slotCost
        };
      }
    }
    const hasAnyConditionPricing = Boolean(normalizedConditionMatrix) && ["new", "used", "open_box"].some((cond) => Number(normalizedConditionMatrix?.[cond]?.price || 0) > 0);
    const hasValidMainPrice = Number(price) > 0;
    if (!hasValidMainPrice && !hasAnyConditionPricing) {
      return res.status(400).json({ error: "Selling price must be greater than zero. Condition-based pricing can be an alternative for gadgets." });
    }
    const normalizedBarcode = normalizeProductBarcode3(barcode);
    if (normalizedBarcode) {
      const conflictingProduct = (await postgresPool2.query("SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1", [req.user.store_id, normalizedBarcode, productId])).rows[0];
      if (conflictingProduct) {
        return res.status(400).json({ error: "Barcode already exists for another product in this store" });
      }
    }
    let categoryName = category || null;
    let selectedCategoryId = category_id || null;
    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool2.query("SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2)", [req.user.store_id, categoryName.trim()])).rows[0];
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool2.query("INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id", [req.user.store_id, categoryName.trim(), null]);
      selectedCategoryId = inserted.rows[0]?.id || selectedCategoryId;
    }
    try {
      await postgresPool2.query(`
        UPDATE products SET name = $1, barcode = $2, category = $3, category_id = $4, thumbnail = $5, specs = $6, condition_matrix = $7, price = $8, stock = $9, cost = $10
        WHERE id = $11 AND store_id = $12
      `, [
        name,
        normalizedBarcode || null,
        categoryName || null,
        selectedCategoryId,
        thumbnail || null,
        JSON.stringify(specs || {}),
        JSON.stringify(normalizedConditionMatrix),
        price,
        stock,
        normalizedCost,
        productId,
        req.user.store_id
      ]);
      if (normalizedConditionMatrix) {
        for (const conditionKey of ["new", "used", "open_box"]) {
          await reconcileInventoryBatchQuantity2({
            productId,
            storeId: Number(req.user.store_id),
            condition: conditionKey,
            targetStock: Number(normalizedConditionMatrix?.[conditionKey]?.stock || 0) || 0
          });
        }
      } else {
        await reconcileInventoryBatchQuantity2({
          productId,
          storeId: Number(req.user.store_id),
          condition: null,
          targetStock: Number(stock || 0) || 0
        });
      }
      const actorLabel = getAuditActorLabel2(req.user.role);
      const baseProductName = String(existingProduct.name || name || `Product #${productId}`);
      const auditEntries = [];
      if (Number(existingProduct.price || 0) !== Number(price || 0)) {
        auditEntries.push({
          actionType: "PRICE_CHANGE",
          description: `${actorLabel} ${req.user.username} changed ${baseProductName} price from ${formatAuditCurrency2(existingProduct.price)} to ${formatAuditCurrency2(price)}.`,
          oldValue: { price: Number(existingProduct.price || 0) || 0 },
          newValue: { price: Number(price || 0) || 0 }
        });
      }
      if (Number(existingProduct.stock || 0) !== Number(stock || 0)) {
        auditEntries.push({
          actionType: "STOCK_ADJUST",
          description: `${actorLabel} ${req.user.username} changed ${baseProductName} stock from ${Number(existingProduct.stock || 0) || 0} to ${Number(stock || 0) || 0} via inventory edit.`,
          oldValue: { stock: Number(existingProduct.stock || 0) || 0 },
          newValue: { stock: Number(stock || 0) || 0 }
        });
      }
      if (normalizedConditionMatrix) {
        ["new", "open_box", "used"].forEach((conditionKey) => {
          const previousSlot = existingMatrix?.[conditionKey] || {};
          const nextSlot = normalizedConditionMatrix?.[conditionKey] || {};
          const conditionLabel = conditionKey.replace(/_/g, " ");
          const beforePrice = Number(previousSlot?.price || 0) || 0;
          const afterPrice = Number(nextSlot?.price || 0) || 0;
          const beforeStock = Number(previousSlot?.stock || 0) || 0;
          const afterStock = Number(nextSlot?.stock || 0) || 0;
          if (beforePrice !== afterPrice) {
            auditEntries.push({
              actionType: "PRICE_CHANGE",
              description: `${actorLabel} ${req.user.username} changed ${baseProductName} (${conditionLabel}) price from ${formatAuditCurrency2(beforePrice)} to ${formatAuditCurrency2(afterPrice)}.`,
              oldValue: { condition: conditionKey, price: beforePrice },
              newValue: { condition: conditionKey, price: afterPrice }
            });
          }
          if (beforeStock !== afterStock) {
            auditEntries.push({
              actionType: "STOCK_ADJUST",
              description: `${actorLabel} ${req.user.username} changed ${baseProductName} (${conditionLabel}) stock from ${beforeStock} to ${afterStock}.`,
              oldValue: { condition: conditionKey, stock: beforeStock },
              newValue: { condition: conditionKey, stock: afterStock }
            });
          }
        });
      }
      if (!auditEntries.length) {
        auditEntries.push({
          actionType: "PRODUCT_UPDATE",
          description: `${actorLabel} ${req.user.username} updated ${baseProductName} details.`,
          oldValue: { name: existingProduct.name, category: existingProduct.category },
          newValue: { name, category: categoryName || existingProduct.category || null }
        });
      }
      for (const entry of auditEntries) {
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: entry.actionType,
          description: entry.description,
          oldValue: entry.oldValue,
          newValue: entry.newValue
        });
      }
      res.json({ success: true, barcode: normalizedBarcode || null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.get("/api/product-change-requests", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const requestedStatus = normalizeProductChangeRequestStatus(req.query.status);
    const isStaff = req.user.role === "STAFF";
    try {
      let query = `
        SELECT pcr.*, requester.username AS requested_by_username, reviewer.username AS reviewed_by_username
        FROM product_change_requests pcr
        LEFT JOIN users requester ON requester.id = pcr.requested_by
        LEFT JOIN users reviewer ON reviewer.id = pcr.reviewed_by
        WHERE pcr.store_id = $1 AND pcr.status = $2
      `;
      const params = [Number(req.user.store_id), requestedStatus];
      if (isStaff) {
        query += ` AND pcr.requested_by = $3`;
        params.push(Number(req.user.id));
      }
      query += ` ORDER BY pcr.created_at DESC, pcr.id DESC`;
      const rows = (await postgresPool2.query(query, params)).rows;
      res.json(rows.map((row) => ({
        ...row,
        payload: parseProductChangePayload(row.payload)
      })));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load product change requests" });
    }
  });
  app2.post("/api/product-change-requests/:id/approve", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ error: "Invalid request ID." });
    }
    try {
      const requestRow = (await postgresPool2.query(`
        SELECT * FROM product_change_requests
        WHERE id = $1 AND store_id = $2 AND status = 'PENDING'
        LIMIT 1
      `, [requestId, Number(req.user.store_id)])).rows[0] || null;
      if (!requestRow) {
        return res.status(404).json({ error: "Pending product change request not found." });
      }
      const payloadOverride = parseProductChangePayload(req.body?.payload);
      const hasPayloadOverride = payloadOverride && typeof payloadOverride === "object" && Object.keys(payloadOverride).length > 0;
      const effectiveRequestRow = hasPayloadOverride ? { ...requestRow, payload: payloadOverride } : requestRow;
      const applied = await applyProductChangeRequest(effectiveRequestRow, req.user);
      await postgresPool2.query(`
        UPDATE product_change_requests
        SET status = 'APPROVED',
            reviewed_by = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            review_note = $2,
            product_id = COALESCE(product_id, $3),
            payload = COALESCE($6::jsonb, payload)
        WHERE id = $4 AND store_id = $5
      `, [
        Number(req.user.id),
        String(req.body?.note || "").trim() || null,
        Number(applied.productId || 0) || null,
        requestId,
        Number(req.user.store_id),
        hasPayloadOverride ? JSON.stringify(payloadOverride) : null
      ]);
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "PRODUCT_CHANGE_APPROVE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} approved product ${String(applied.action || "").toLowerCase()} request #${requestId}.`,
        newValue: {
          request_id: requestId,
          request_type: requestRow.request_type,
          product_id: applied.productId,
          barcode: applied.barcode || null,
          reviewer_edited_payload: hasPayloadOverride
        }
      });
      res.json({ success: true, request_id: requestId, product_id: applied.productId, action: applied.action });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to approve product change request" });
    }
  });
  app2.post("/api/product-change-requests/:id/reject", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ error: "Invalid request ID." });
    }
    try {
      const requestRow = (await postgresPool2.query(`
        SELECT * FROM product_change_requests
        WHERE id = $1 AND store_id = $2 AND status = 'PENDING'
        LIMIT 1
      `, [requestId, Number(req.user.store_id)])).rows[0] || null;
      if (!requestRow) {
        return res.status(404).json({ error: "Pending product change request not found." });
      }
      const reviewNote = String(req.body?.note || "").trim() || null;
      await postgresPool2.query(`
        UPDATE product_change_requests
        SET status = 'REJECTED',
            reviewed_by = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            review_note = $2
        WHERE id = $3 AND store_id = $4
      `, [Number(req.user.id), reviewNote, requestId, Number(req.user.store_id)]);
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "PRODUCT_CHANGE_REJECT",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} rejected product change request #${requestId}.`,
        newValue: {
          request_id: requestId,
          request_type: requestRow.request_type,
          review_note: reviewNote
        }
      });
      res.json({ success: true, request_id: requestId });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to reject product change request" });
    }
  });
  app2.delete("/api/products/:id", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const productId = Number(req.params.id);
    const existingProduct = (await postgresPool2.query("SELECT id, name, price, stock FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL", [productId, req.user.store_id])).rows[0] || null;
    await postgresPool2.query("UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2", [productId, req.user.store_id]);
    if (existingProduct) {
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "DELETE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} deleted ${existingProduct.name || `Product #${req.params.id}`} from inventory.`,
        oldValue: existingProduct,
        newValue: { deleted: true }
      });
    }
    res.json({ success: true });
  });
  app2.post("/api/import/products", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: "No product rows provided for import" });
    }
    try {
      const result = await coreWriteRepository2.importProducts({
        storeId: Number(req.user.store_id),
        rows
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to import products" });
    }
  });
  app2.post("/api/import/customers", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: "No customer rows provided for import" });
    }
    try {
      const result = await coreWriteRepository2.importCustomers({
        storeId: Number(req.user.store_id),
        rows
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to import customers" });
    }
  });
  app2.post("/api/import/sales", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: "No sales rows provided for import" });
    }
    try {
      const result = await coreWriteRepository2.importSales({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        rows
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to import sales" });
    }
  });
  app2.get("/api/categories", authenticate2, async (req, res) => {
    try {
      const categories = await coreReadRepository2.listCategories(Number(req.user.store_id));
      res.json(categories);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load categories" });
    }
  });
  app2.post("/api/categories", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), async (req, res) => {
    const { name, description } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Category name is required" });
    }
    try {
      const category = await coreWriteRepository2.createCategory({
        storeId: Number(req.user.store_id),
        name: name.trim(),
        description: description || null
      });
      res.json({ id: Number(category?.id || 0), name: category?.name || name.trim(), description: category?.description || null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.put("/api/categories/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), async (req, res) => {
    const { name, description } = req.body;
    const categoryId = Number(req.params.id);
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Category name is required" });
    }
    try {
      const category = await coreWriteRepository2.updateCategory({
        storeId: Number(req.user.store_id),
        categoryId,
        name: name.trim(),
        description: description || null
      });
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json({ success: true, category });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.delete("/api/categories/:id", authenticate2, authorize2(["STORE_ADMIN"]), async (req, res) => {
    const categoryId = Number(req.params.id);
    const usage = (await postgresPool2.query("SELECT COUNT(*) as count FROM products WHERE store_id = $1 AND category_id = $2", [req.user.store_id, categoryId])).rows[0];
    if (Number(usage?.count ?? 0) > 0) {
      return res.status(400).json({ error: "Category is in use by products and cannot be deleted" });
    }
    await coreWriteRepository2.deleteCategory({ categoryId, storeId: Number(req.user.store_id) });
    res.json({ success: true });
  });
  app2.get("/api/admin/inventory/deleted", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    try {
      const products = await coreReadRepository2.listDeletedProducts();
      res.json(products.map((p) => ({
        ...p,
        specs: p.specs ? safeJsonParse6(p.specs, {}) : {},
        condition_matrix: p.condition_matrix ? safeJsonParse6(p.condition_matrix, null) : null
      })));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load deleted inventory" });
    }
  });
  app2.post("/api/admin/inventory/restore/:id", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (req, res) => {
    const productId = Number(req.params.id);
    await coreWriteRepository2.restoreDeletedProduct({ productId });
    res.json({ success: true });
  });
  app2.post("/api/pos/hold", authenticate2, checkStoreLock2, async (req, res) => {
    const { customer_name, note, cart_data } = req.body;
    const hold = await coreWriteRepository2.createActiveHold({
      storeId: Number(req.user.store_id),
      userId: Number(req.user.id),
      staffName: req.user.username,
      customerName: customer_name || null,
      note: note || null,
      cartData: cart_data
    });
    res.json({ id: Number(hold?.id || 0) });
  });
  app2.get("/api/pos/holds", authenticate2, checkStoreLock2, async (req, res) => {
    try {
      const holds = await coreReadRepository2.listActiveHolds(Number(req.user.store_id));
      res.json(holds.map((h) => ({ ...h, cart_data: safeJsonParse6(h.cart_data, []) })));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load held carts" });
    }
  });
  app2.delete("/api/pos/holds/:id", authenticate2, checkStoreLock2, async (req, res) => {
    const holdId = Number(req.params.id);
    await coreWriteRepository2.deleteActiveHold({ holdId, storeId: Number(req.user.store_id) });
    res.json({ success: true });
  });
  app2.delete("/api/admin/holds/clear", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    await coreWriteRepository2.clearActiveHolds();
    res.json({ success: true });
  });
};

// serverOperationsRoutes.ts
var registerOperationsRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  normalizePhone: normalizePhone4,
  safeJsonParse: safeJsonParse6,
  resolveTrackedCost: resolveTrackedCost5,
  normalizeCollectionCondition: normalizeCollectionCondition6,
  normalizeSaleChannel: normalizeSaleChannel2,
  normalizePaymentFrequency: normalizePaymentFrequency2,
  getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
  buildLayawayPaymentPlan: buildLayawayPaymentPlan2,
  formatSaleResponse: formatSaleResponse2,
  formatMarketCollection: formatMarketCollection2,
  formatRepairTicket: formatRepairTicket2,
  formatInventoryBatch: formatInventoryBatch2,
  formatPurchaseOrder: formatPurchaseOrder2,
  normalizeBatchCode: normalizeBatchCode3,
  normalizeBatchExpiryDate: normalizeBatchExpiryDate3,
  generateUniqueRepairTicketNumber: generateUniqueRepairTicketNumber2,
  generateUniquePurchaseOrderNumber: generateUniquePurchaseOrderNumber2,
  getAuditActorLabel: getAuditActorLabel2,
  logAuditEvent: logAuditEvent2,
  logSystemActivity: logSystemActivity2,
  formatAuditCurrency: formatAuditCurrency2,
  collectUnusedMediaCleanupStats: collectUnusedMediaCleanupStats2,
  createSafetySnapshot: createSafetySnapshot2
}) => {
  const normalizeStoredPhone2 = (value) => {
    const raw = String(value ?? "").trim();
    const digits = normalizePhone4(raw);
    return raw.startsWith("+") && digits ? `+${digits}` : digits;
  };
  app2.post("/api/pro-formas", authenticate2, async (req, res) => {
    const {
      customer_id,
      customer_name,
      customer_phone,
      customer_address,
      items,
      subtotal,
      tax_amount,
      tax_percentage,
      total,
      expiry_hours,
      expiry_date: req_expiry_date
    } = req.body;
    const store_id = req.user.store_id;
    if (!items || !total || !expiry_hours && !req_expiry_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const parsedExpiryHours = Number(expiry_hours);
    if (!req_expiry_date && (!Number.isFinite(parsedExpiryHours) || parsedExpiryHours <= 0)) {
      return res.status(400).json({ error: "expiry_hours must be a positive number" });
    }
    const expiry_date = req_expiry_date || new Date(Date.now() + parsedExpiryHours * 60 * 60 * 1e3).toISOString();
    try {
      const normalizedTaxAmount = Math.max(0, Number(tax_amount) || 0);
      const normalizedSubtotal = typeof subtotal === "number" && subtotal >= 0 ? subtotal : Math.max(0, Number(total) - normalizedTaxAmount);
      const normalizedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));
      const result = await postgresPool2.query(`
        INSERT INTO pro_formas (store_id, customer_id, customer_name, customer_phone, customer_address, items, subtotal, tax_amount, tax_percentage, total, expiry_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        store_id,
        customer_id || null,
        customer_name || null,
        normalizeStoredPhone2(customer_phone) || null,
        customer_address || null,
        JSON.stringify(items),
        normalizedSubtotal,
        normalizedTaxAmount,
        normalizedTaxPercentage,
        total,
        expiry_date
      ]);
      const proFormaId = Number(result.rows[0]?.id || 0);
      res.json({ success: true, id: proFormaId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/pro-formas", authenticate2, async (req, res) => {
    const store_id = Number(req.user.store_id);
    try {
      const proformas = await coreReadRepository2.listProformas(store_id);
      res.json(proformas.map((p) => ({
        ...p,
        customer_name: p.customer_name || p.linked_customer_name || "Walk-in Customer",
        customer_phone: p.customer_phone || p.linked_customer_phone || "",
        customer_address: p.customer_address || p.linked_customer_address || "",
        items: JSON.parse(String(p.items || "[]"))
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.put("/api/pro-formas/:id/status", authenticate2, async (req, res) => {
    const store_id = req.user.store_id;
    const { status } = req.body;
    const proFormaId = Number(req.params.id);
    const VALID_PRO_FORMA_STATUSES = ["PENDING", "COMPLETED", "EXPIRED", "CANCELLED"];
    if (!Number.isInteger(proFormaId) || proFormaId <= 0) {
      return res.status(400).json({ error: "Invalid pro-forma id" });
    }
    if (!status || !VALID_PRO_FORMA_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_PRO_FORMA_STATUSES.join(", ")}` });
    }
    try {
      await postgresPool2.query(`
        UPDATE pro_formas
        SET status = $1
        WHERE id = $2 AND store_id = $3
      `, [status, proFormaId, store_id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.delete("/api/pro-formas/:id", authenticate2, async (req, res) => {
    const store_id = req.user.store_id;
    const proFormaId = Number(req.params.id);
    if (!Number.isInteger(proFormaId) || proFormaId <= 0) {
      return res.status(400).json({ error: "Invalid pro-forma id" });
    }
    try {
      await coreWriteRepository2.deleteProForma({
        proFormaId,
        storeId: Number(store_id)
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/pro-formas/active", authenticate2, async (req, res) => {
    const store_id = req.user.store_id;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const activeProformas = (await postgresPool2.query(`
        SELECT p.*, c.name as linked_customer_name, c.phone as linked_customer_phone, c.address as linked_customer_address
        FROM pro_formas p
        LEFT JOIN customers c ON p.customer_id = c.id
        WHERE p.store_id = $1 AND p.expiry_date > $2
      `, [store_id, now])).rows;
      res.json(activeProformas.map((p) => ({
        ...p,
        customer_name: p.customer_name || p.linked_customer_name || "Walk-in Customer",
        customer_phone: p.customer_phone || p.linked_customer_phone || "",
        customer_address: p.customer_address || p.linked_customer_address || "",
        items: JSON.parse(p.items)
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/market-collections", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const rows = await coreReadRepository2.listMarketCollections({ storeId });
      res.json(rows.map((row) => formatMarketCollection2(row)));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load market collections" });
    }
  });
  app2.post("/api/market-collections", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const collectorName = String(req.body?.collector_name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const expectedReturnDate = String(req.body?.expected_return_date || "").trim();
    const note = String(req.body?.note || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (collectorName.length < 2) {
      return res.status(400).json({ error: "Collector name is required" });
    }
    if (phone.length < 7) {
      return res.status(400).json({ error: "Collector phone number is required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedReturnDate)) {
      return res.status(400).json({ error: "Expected return/payment date is required" });
    }
    if (!items.length) {
      return res.status(400).json({ error: "Select at least one inventory item for this collection" });
    }
    try {
      const storeSettings = (await postgresPool2.query("SELECT default_missing_cost_to_price FROM stores WHERE id = $1", [storeId])).rows[0];
      const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;
      const normalizedItems = [];
      for (const [index, rawItem] of items.entries()) {
        const quantity = Math.max(0, Number(rawItem?.quantity) || 0);
        const consignmentItemId = Number(rawItem?.consignment_item_id) || 0;
        if (consignmentItemId > 0) {
          const ci = (await postgresPool2.query(
            `SELECT * FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1`,
            [consignmentItemId, storeId]
          )).rows[0];
          if (!ci) throw new Error(`Consignment item #${index + 1} not found.`);
          if (!["approved", "available"].includes(String(ci.status || "").toLowerCase())) {
            throw new Error(`${ci.item_name} is not available for collection (status: ${ci.status}).`);
          }
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for ${ci.item_name}.`);
          const ciPublicSpecs = safeJsonParse6(typeof ci.public_specs === "string" ? ci.public_specs : JSON.stringify(ci.public_specs || {}), {});
          const ciMatrix = ciPublicSpecs?.__condition_matrix;
          const ciHasMatrix = ciMatrix && typeof ciMatrix === "object" && Object.keys(ciMatrix).length > 0;
          const ciCondition = normalizeCollectionCondition6(rawItem?.condition);
          const ciConditionKey = String(ciCondition || "").toLowerCase();
          let availableQty;
          let unitPrice;
          let unitPayout;
          if (ciHasMatrix && ciConditionKey && ciMatrix?.[ciConditionKey]) {
            availableQty = Number(ciMatrix[ciConditionKey]?.stock || 0);
            unitPrice = Number(ciMatrix[ciConditionKey]?.price || ci.selling_price || 0);
            unitPayout = Number(ciMatrix[ciConditionKey]?.payout || ci.agreed_payout || 0);
          } else {
            availableQty = Number(ci.quantity || 0);
            unitPrice = Number(ci.selling_price || 0);
            unitPayout = Number(ci.agreed_payout || 0);
          }
          if (quantity > availableQty) throw new Error(`Only ${availableQty} unit(s) of ${ci.item_name} available.`);
          normalizedItems.push({
            consignment_item_id: consignmentItemId,
            product_id: null,
            name: String(ci.item_name || `Item ${index + 1}`),
            quantity,
            condition: ciHasMatrix ? ciCondition : null,
            price_at_collection: unitPrice,
            cost_at_collection: unitPayout,
            subtotal: Number((unitPrice * quantity).toFixed(2)),
            category: "Consignment",
            specs_at_collection: {},
            vendor_name: ci.vendor_name || null
          });
        } else {
          const productId = Number(rawItem?.product_id);
          const product = (await postgresPool2.query(`
            SELECT p.*, COALESCE(c.name, p.category, 'General') as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = $1 AND p.store_id = $2 AND p.deleted_at IS NULL
            LIMIT 1
          `, [productId, storeId])).rows[0];
          if (!product) throw new Error(`Selected item #${index + 1} is no longer available in inventory.`);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for ${product.name}.`);
          const normalizedCondition = normalizeCollectionCondition6(rawItem?.condition);
          let availableStock = Number(product.stock || 0);
          let unitPrice = Number(product.price || 0);
          if (product.condition_matrix) {
            const matrix = safeJsonParse6(product.condition_matrix, {});
            const conditionKey = String(normalizedCondition || "").toLowerCase();
            if (!conditionKey || !matrix?.[conditionKey]) throw new Error(`Choose a valid condition for ${product.name}.`);
            availableStock = Number(matrix?.[conditionKey]?.stock || 0);
            unitPrice = Number(matrix?.[conditionKey]?.price || product.price || 0);
          }
          if (quantity > availableStock) throw new Error(`Only ${availableStock} unit(s) of ${product.name} are available right now.`);
          const resolvedCost = resolveTrackedCost5({ product, condition: normalizedCondition, sellingPrice: unitPrice, fallbackToSelling: allowCostFallback });
          normalizedItems.push({
            product_id: productId,
            consignment_item_id: null,
            name: String(product.name || `Item ${index + 1}`),
            quantity,
            condition: normalizedCondition,
            price_at_collection: unitPrice,
            cost_at_collection: Number(resolvedCost.cost || 0),
            subtotal: Number((unitPrice * quantity).toFixed(2)),
            category: product.category_name || "General",
            specs_at_collection: safeJsonParse6(product.specs, {})
          });
        }
      }
      const createdCollection = await coreWriteRepository2.createMarketCollection({
        storeId,
        collectorName,
        phone,
        expectedReturnDate,
        note: note || null,
        createdBy: Number(req.user.id),
        items: normalizedItems
      });
      res.json({ success: true, collection: formatMarketCollection2(createdCollection) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to save market collection" });
    }
  });
  app2.post("/api/market-collections/:id/mark-sold", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return res.status(400).json({ error: "Invalid collection id" });
    }
    try {
      const collection = (await postgresPool2.query("SELECT * FROM market_collections WHERE id = $1 AND store_id = $2 LIMIT 1", [collectionId, storeId])).rows[0];
      if (!collection) {
        return res.status(404).json({ error: "Collection entry not found" });
      }
      if (String(collection.status || "").toUpperCase() !== "OPEN") {
        return res.status(400).json({ error: "Only open collections can be marked as sold" });
      }
      const formattedCollection = formatMarketCollection2(collection);
      const saleSubtotal = Number(formattedCollection.total_value || 0);
      if (saleSubtotal <= 0) {
        return res.status(400).json({ error: "This collection has no billable items to convert into a sale" });
      }
      const soldResult = await coreWriteRepository2.markMarketCollectionSold({
        storeId,
        collectionId,
        soldBy: Number(req.user.id),
        collection: formattedCollection
      });
      res.json({ success: true, saleId: soldResult.saleId, collection: formatMarketCollection2(soldResult.updatedCollection) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to mark collection as sold" });
    }
  });
  app2.post("/api/market-collections/:id/return", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return res.status(400).json({ error: "Invalid collection id" });
    }
    try {
      const collection = (await postgresPool2.query("SELECT * FROM market_collections WHERE id = $1 AND store_id = $2 LIMIT 1", [collectionId, storeId])).rows[0];
      if (!collection) {
        return res.status(404).json({ error: "Collection entry not found" });
      }
      if (String(collection.status || "").toUpperCase() !== "OPEN") {
        return res.status(400).json({ error: "Only open collections can be returned to inventory" });
      }
      const formattedCollection = formatMarketCollection2(collection);
      const updatedCollection = await coreWriteRepository2.returnMarketCollection({
        storeId,
        collectionId,
        collection: formattedCollection
      });
      res.json({ success: true, collection: formatMarketCollection2(updatedCollection) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to return collection items to inventory" });
    }
  });
  app2.get("/api/repairs", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const rows = await coreReadRepository2.listRepairTickets(storeId);
      res.json(rows.map((row) => formatRepairTicket2(row)));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load repair tickets" });
    }
  });
  app2.post("/api/repairs", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const customerName = String(req.body?.customer_name || "").trim();
    const customerPhone = normalizeStoredPhone2(req.body?.customer_phone || "");
    const deviceName = String(req.body?.device_name || "").trim();
    const brand = String(req.body?.brand || "").trim();
    const model = String(req.body?.model || "").trim();
    const imeiSerial = String(req.body?.imei_serial || "").trim();
    const issueSummary = String(req.body?.issue_summary || "").trim();
    const accessories = String(req.body?.accessories || "").trim();
    const purchaseReference = String(req.body?.purchase_reference || "").trim();
    const technicianName = String(req.body?.technician_name || "").trim();
    const intakeNotes = String(req.body?.intake_notes || "").trim();
    const internalNotes = String(req.body?.internal_notes || "").trim();
    const promisedDate = String(req.body?.promised_date || "").trim();
    const estimatedCost = Math.max(0, Number(req.body?.estimated_cost || 0) || 0);
    const warrantyStatus = String(req.body?.warranty_status || "NO_WARRANTY").trim().toUpperCase();
    const allowedWarrantyStatuses = ["IN_WARRANTY", "OUT_OF_WARRANTY", "NO_WARRANTY"];
    if (customerName.length < 2) {
      return res.status(400).json({ error: "Customer name is required" });
    }
    if (deviceName.length < 2) {
      return res.status(400).json({ error: "Device name is required" });
    }
    if (issueSummary.length < 3) {
      return res.status(400).json({ error: "Describe the issue before saving this repair ticket" });
    }
    if (promisedDate && !/^\d{4}-\d{2}-\d{2}$/.test(promisedDate)) {
      return res.status(400).json({ error: "Promised date must use YYYY-MM-DD format" });
    }
    if (!allowedWarrantyStatuses.includes(warrantyStatus)) {
      return res.status(400).json({ error: "Invalid warranty status selected" });
    }
    try {
      const ticketNumber = await generateUniqueRepairTicketNumber2(storeId);
      if (!ticketNumber) {
        return res.status(500).json({ error: "Failed to generate a repair ticket number" });
      }
      const result = await postgresPool2.query(`
        INSERT INTO repair_tickets (
          store_id, ticket_number, customer_name, customer_phone, device_name, brand, model,
          imei_serial, issue_summary, accessories, purchase_reference, warranty_status,
          technician_name, intake_notes, internal_notes, estimated_cost, final_cost,
          amount_paid, status, promised_date, created_by, updated_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, 0, 'RECEIVED', $17, $18, $19, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        storeId,
        ticketNumber,
        customerName,
        customerPhone || null,
        deviceName,
        brand || null,
        model || null,
        imeiSerial || null,
        issueSummary,
        accessories || null,
        purchaseReference || null,
        warrantyStatus,
        technicianName || null,
        intakeNotes || null,
        internalNotes || null,
        estimatedCost,
        promisedDate || null,
        req.user.id,
        req.user.id
      ]);
      const repairTicketId = Number(result.rows[0]?.id || 0);
      if (typeof coreWriteRepository2?.mirrorRepairTicketRecord === "function") {
        await coreWriteRepository2.mirrorRepairTicketRecord({ repairTicketId });
      }
      await logAuditEvent2({
        storeId,
        userId: req.user.id,
        userName: req.user.username,
        actionType: "REPAIR_UPDATE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} created repair ticket ${ticketNumber} for ${customerName} (${deviceName}).`,
        newValue: { ticketNumber, customerName, deviceName, status: "RECEIVED" }
      });
      const created = (await postgresPool2.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.id = $1 AND rt.store_id = $2
      `, [repairTicketId, storeId])).rows[0];
      res.json({ success: true, ticket: formatRepairTicket2(created) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to create repair ticket" });
    }
  });
  app2.patch("/api/repairs/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const repairId = Number(req.params.id);
    if (!Number.isInteger(repairId) || repairId <= 0) {
      return res.status(400).json({ error: "Invalid repair ticket id" });
    }
    try {
      const existing = (await postgresPool2.query("SELECT * FROM repair_tickets WHERE id = $1 AND store_id = $2 LIMIT 1", [repairId, storeId])).rows[0];
      if (!existing) {
        return res.status(404).json({ error: "Repair ticket not found" });
      }
      const allowedStatuses = ["RECEIVED", "DIAGNOSING", "AWAITING_PARTS", "IN_REPAIR", "READY", "DELIVERED", "CANCELLED"];
      const nextStatus = req.body?.status ? String(req.body.status).trim().toUpperCase() : String(existing.status || "RECEIVED").toUpperCase();
      if (!allowedStatuses.includes(nextStatus)) {
        return res.status(400).json({ error: "Invalid repair status" });
      }
      const technicianName = req.body?.technician_name != null ? String(req.body.technician_name || "").trim() : String(existing.technician_name || "").trim();
      const internalNotes = req.body?.internal_notes != null ? String(req.body.internal_notes || "").trim() : String(existing.internal_notes || "").trim();
      const issueSummary = req.body?.issue_summary != null ? String(req.body.issue_summary || "").trim() : String(existing.issue_summary || "").trim();
      const estimatedCost = req.body?.estimated_cost != null ? Math.max(0, Number(req.body.estimated_cost || 0) || 0) : Math.max(0, Number(existing.estimated_cost || 0) || 0);
      const finalCost = req.body?.final_cost != null ? Math.max(0, Number(req.body.final_cost || 0) || 0) : Math.max(0, Number(existing.final_cost || 0) || 0);
      const amountPaid = req.body?.amount_paid != null ? Math.max(0, Number(req.body.amount_paid || 0) || 0) : Math.max(0, Number(existing.amount_paid || 0) || 0);
      await postgresPool2.query(`
        UPDATE repair_tickets
        SET status = $1, technician_name = $2, internal_notes = $3, issue_summary = $4, estimated_cost = $5, final_cost = $6, amount_paid = $7,
            updated_by = $8, updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE WHEN $9 IN ('DELIVERED', 'CANCELLED') THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END
        WHERE id = $10 AND store_id = $11
      `, [
        nextStatus,
        technicianName || null,
        internalNotes || null,
        issueSummary || String(existing.issue_summary || "").trim(),
        estimatedCost,
        finalCost,
        amountPaid,
        req.user.id,
        nextStatus,
        repairId,
        storeId
      ]);
      if (typeof coreWriteRepository2?.mirrorRepairTicketRecord === "function") {
        await coreWriteRepository2.mirrorRepairTicketRecord({ repairTicketId: repairId });
      }
      await logAuditEvent2({
        storeId,
        userId: req.user.id,
        userName: req.user.username,
        actionType: "REPAIR_UPDATE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} updated repair ticket ${existing.ticket_number || `#${repairId}`} to ${nextStatus}.`,
        oldValue: { status: existing.status, technician_name: existing.technician_name, final_cost: existing.final_cost, amount_paid: existing.amount_paid },
        newValue: { status: nextStatus, technician_name: technicianName, final_cost: finalCost, amount_paid: amountPaid }
      });
      const updated = (await postgresPool2.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.id = $1 AND rt.store_id = $2
      `, [repairId, storeId])).rows[0];
      res.json({ success: true, ticket: formatRepairTicket2(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to update repair ticket" });
    }
  });
  app2.get("/api/layaways", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const rows = await coreReadRepository2.listLayawayPlans(storeId);
      const plans = await Promise.all(rows.map(async (row) => {
        const formatted = await formatSaleResponse2(row);
        return {
          ...formatted,
          items: await coreReadRepository2.getSaleItemsForInvoice(Number(row.id))
        };
      }));
      res.json({
        plans,
        summary: {
          activeCount: plans.filter((entry) => String(entry.status || "").toUpperCase() === "PENDING").length,
          overdueCount: plans.filter((entry) => Boolean(entry.is_due_overdue)).length,
          lockedCount: plans.filter((entry) => Boolean(entry.locked_until_paid)).length,
          outstandingBalance: plans.reduce((sum, entry) => sum + (Number(entry.amount_due || 0) || 0), 0)
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load layaway plans" });
    }
  });
  app2.post("/api/layaways", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const saleChannel = normalizeSaleChannel2(req.body?.sale_channel || "LAYAWAY");
    const dueDate = String(req.body?.due_date || "").trim();
    const note = String(req.body?.note || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const installmentCount = Math.max(1, Math.min(24, Number(req.body?.installment_count) || 1));
    const paymentFrequency = normalizePaymentFrequency2(req.body?.payment_frequency);
    const customerName = String(req.body?.customer_name || "").trim();
    const customerPhoneDigits = normalizePhone4(req.body?.customer_phone);
    const customerPhone = normalizeStoredPhone2(req.body?.customer_phone);
    const customerAddress = String(req.body?.customer_address || "").trim();
    const requestedCustomerId = Number(req.body?.customer_id) || null;
    const paymentMethods = {
      cash: Math.max(0, Number(req.body?.payment_methods?.cash) || 0),
      transfer: Math.max(0, Number(req.body?.payment_methods?.transfer) || 0),
      pos: Math.max(0, Number(req.body?.payment_methods?.pos) || 0)
    };
    if (!["LAYAWAY", "INSTALLMENT"].includes(saleChannel)) {
      return res.status(400).json({ error: "Choose either Layaway or Installment for this payment plan." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return res.status(400).json({ error: "A valid first due date is required." });
    }
    if (!items.length) {
      return res.status(400).json({ error: "Add at least one inventory item to this plan." });
    }
    if (!requestedCustomerId && customerName.length < 2) {
      return res.status(400).json({ error: "Customer name is required for layaway plans." });
    }
    if (!requestedCustomerId && customerPhoneDigits.length < 7) {
      return res.status(400).json({ error: "Customer phone number is required for payment reminders." });
    }
    try {
      const storeSettings = (await postgresPool2.query("SELECT default_missing_cost_to_price FROM stores WHERE id = $1", [storeId])).rows[0];
      const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;
      const normalizedItems = [];
      for (const [index, rawItem] of items.entries()) {
        const productId = Number(rawItem?.product_id);
        const quantity = Math.max(1, Number(rawItem?.quantity) || 1);
        const product = (await postgresPool2.query(`
          SELECT p.*, COALESCE(c.name, p.category, 'General') as category_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.id = $1 AND p.store_id = $2 AND p.deleted_at IS NULL
          LIMIT 1
        `, [productId, storeId])).rows[0];
        if (!product) {
          throw new Error(`Selected item #${index + 1} is no longer available in inventory.`);
        }
        const condition = normalizeCollectionCondition6(rawItem?.condition);
        let unitPrice = Number(product.price || 0);
        let availableStock = Number(product.stock || 0);
        if (product.condition_matrix) {
          const matrix = safeJsonParse6(product.condition_matrix, {});
          const key = String(condition || "").toLowerCase();
          if (!key || !matrix?.[key]) {
            throw new Error(`Choose a valid condition for ${product.name}.`);
          }
          unitPrice = Number(matrix?.[key]?.price || product.price || 0);
          availableStock = Number(matrix?.[key]?.stock || 0);
        }
        if (quantity > availableStock) {
          throw new Error(`Only ${availableStock} unit(s) of ${product.name} are available for this plan.`);
        }
        const resolvedCost = resolveTrackedCost5({
          product,
          condition,
          sellingPrice: unitPrice,
          fallbackToSelling: allowCostFallback
        });
        normalizedItems.push({
          product_id: productId,
          quantity,
          name: String(product.name || `Item ${index + 1}`),
          condition,
          price_at_sale: Number(unitPrice || 0),
          subtotal: Number((unitPrice * quantity).toFixed(2)),
          cost_at_sale: Number(resolvedCost.cost || 0),
          specs_at_sale: safeJsonParse6(product.specs, {}),
          imei_serial: String(rawItem?.imei_serial || "").trim() || null
        });
      }
      const subtotal = Number(normalizedItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0).toFixed(2));
      const amountPaid = getTotalPaidFromPaymentMethods3(paymentMethods);
      if (amountPaid > subtotal + 0.01) {
        return res.status(400).json({ error: "The amount paid cannot be more than the plan total." });
      }
      const paymentPlan = buildLayawayPaymentPlan2({
        saleChannel,
        total: subtotal,
        amountPaid,
        firstDueDate: dueDate,
        installmentCount,
        paymentFrequency,
        note
      });
      const amountDue = Math.max(0, Number((subtotal - amountPaid).toFixed(2)) || 0);
      const nextStatus = amountDue <= 0 ? "COMPLETED" : "PENDING";
      const nextLockedUntilPaid = amountDue > 0 ? 1 : 0;
      const saleNoteParts = [saleChannel === "INSTALLMENT" ? "Installment plan" : "Layaway plan", note].filter(Boolean);
      const createdSale = await coreWriteRepository2.createLayawaySale({
        storeId,
        requestedCustomerId,
        customerName,
        customerPhone,
        customerAddress: customerAddress || null,
        subtotal,
        paymentMethods,
        nextStatus,
        saleChannel,
        paymentPlan,
        nextLockedUntilPaid,
        dueDate,
        note: saleNoteParts.join(" \u2022 ") || null,
        userId: Number(req.user.id),
        items: normalizedItems
      });
      await logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "LAYAWAY_CREATE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} created ${saleChannel === "INSTALLMENT" ? "an installment" : "a layaway"} plan for ${createdSale.customer_name || customerName}.`,
        newValue: {
          saleId: createdSale.id,
          saleChannel,
          dueDate,
          total: subtotal,
          amountPaid,
          amountDue
        }
      });
      res.json({
        success: true,
        sale: {
          ...await formatSaleResponse2(createdSale),
          items: await coreReadRepository2.getSaleItemsForInvoice(Number(createdSale.id))
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to create layaway plan" });
    }
  });
  app2.get("/api/reminders/daily", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const { pendingSales, marketCollections: marketCollectionRows } = await coreReadRepository2.getDailyReminders(storeId);
      const outstandingSales = (await Promise.all(pendingSales.map((sale) => formatSaleResponse2(sale)))).filter((sale) => Number(sale.amount_due || 0) > 0).map((sale) => ({
        ...sale,
        is_overdue: sale.due_date ? (/* @__PURE__ */ new Date(`${String(sale.due_date).slice(0, 10)}T23:59:59`)).getTime() < Date.now() : false
      }));
      const marketCollections = marketCollectionRows.map((entry) => formatMarketCollection2(entry));
      res.json({
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        totalCount: outstandingSales.length + marketCollections.length,
        outstandingCount: outstandingSales.length,
        collectionCount: marketCollections.length,
        overdueOutstandingCount: outstandingSales.filter((sale) => Boolean(sale.is_overdue)).length,
        overdueCollectionCount: marketCollections.filter((entry) => Boolean(entry.is_overdue)).length,
        outstandingSales,
        marketCollections
      });
    } catch (err) {
      console.error("Daily reminder error:", err);
      res.status(500).json({ error: err.message || "Failed to load daily reminders" });
    }
  });
  app2.get("/api/expenses", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), async (req, res) => {
    const storeId = Number(req.user.store_id);
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const expenses = await coreReadRepository2.listExpenses(storeId, from, to);
    const totalExpenses = expenses.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    const categoryBreakdown = Object.values(
      expenses.reduce((acc, entry) => {
        const category = String(entry.category || "General").trim() || "General";
        if (!acc[category]) {
          acc[category] = { category, total: 0, count: 0 };
        }
        acc[category].total += Number(entry.amount) || 0;
        acc[category].count += 1;
        return acc;
      }, {})
    ).sort((a, b) => b.total - a.total);
    res.json({
      expenses: expenses.map((entry) => ({
        ...entry,
        amount: Number(entry.amount) || 0,
        category: entry.category || "General"
      })),
      summary: {
        totalExpenses,
        count: expenses.length,
        categoryBreakdown
      }
    });
  });
  app2.post("/api/expenses", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), checkStoreLock2, async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const category = String(req.body?.category || "General").trim() || "General";
    const amount = Number(req.body?.amount);
    const note = String(req.body?.note || "").trim() || null;
    const spentAt = String(req.body?.spent_at || (/* @__PURE__ */ new Date()).toISOString()).trim();
    if (!title) {
      return res.status(400).json({ error: "Expense title is required" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Expense amount must be greater than zero" });
    }
    try {
      const expense = await coreWriteRepository2.createExpense({
        storeId: Number(req.user.store_id),
        title,
        category,
        amount,
        note,
        spentAt,
        createdBy: Number(req.user.id)
      });
      await logSystemActivity2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        action: "EXPENSE_CREATE",
        details: { expenseId: Number(expense?.id || 0), amount, category }
      });
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "EXPENSE_ADD",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} recorded an expense of ${formatAuditCurrency2(amount)} for ${title}.`,
        newValue: {
          expenseId: Number(expense?.id || 0),
          title,
          category,
          amount,
          note,
          spent_at: spentAt
        }
      });
      res.json({
        id: Number(expense?.id || 0),
        title: expense?.title || title,
        category: expense?.category || category,
        amount: Number(expense?.amount || amount),
        note: expense?.note ?? note,
        spent_at: expense?.spent_at || spentAt,
        created_by: Number(expense?.created_by || req.user.id),
        created_by_username: req.user.username
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to create expense" });
    }
  });
  app2.delete("/api/expenses/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), checkStoreLock2, async (req, res) => {
    try {
      const removed = await coreWriteRepository2.deleteExpense({
        expenseId: Number(req.params.id),
        storeId: Number(req.user.store_id)
      });
      if (removed.changes > 0 && removed.expense) {
        await logSystemActivity2({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          action: "EXPENSE_DELETE",
          details: { expenseId: Number(removed.expense.id), amount: Number(removed.expense.amount || 0) }
        });
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: "DELETE",
          description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} deleted expense #${removed.expense.id} (${removed.expense.title || "Expense"}).`,
          oldValue: removed.expense,
          newValue: { deleted: true }
        });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to delete expense" });
    }
  });
  app2.post("/api/system-health/optimize", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      await createSafetySnapshot2("pre-maintenance");
      const mediaStats = await collectUnusedMediaCleanupStats2();
      const databaseRecoveredBytes = 0;
      const spaceRecoveredBytes = mediaStats.deletedBytes;
      await logSystemActivity2({
        storeId,
        userId: req.user.id,
        action: "SYSTEM_OPTIMIZE",
        details: {
          databaseRecoveredBytes,
          deletedMediaFiles: mediaStats.deletedFiles,
          deletedMediaBytes: mediaStats.deletedBytes
        }
      });
      res.json({
        success: true,
        spaceRecoveredBytes,
        spaceRecoveredMb: Number((spaceRecoveredBytes / (1024 * 1024)).toFixed(2)),
        databaseRecoveredBytes,
        media: mediaStats,
        database: null,
        message: `Optimization Complete! ${Number((spaceRecoveredBytes / (1024 * 1024)).toFixed(2))}MB of space recovered.`
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to optimize the system database" });
    }
  });
  app2.post("/api/system-health/clear-expired-proformas", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const deletedCount = await coreWriteRepository2.clearExpiredProformas({ storeId });
      await logSystemActivity2({
        storeId,
        userId: req.user.id,
        action: "CLEAR_EXPIRED_PROFORMAS",
        details: { deletedCount }
      });
      res.json({ success: true, deletedCount });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to clear expired pro-formas" });
    }
  });
  app2.post("/api/system-health/clear-old-activity-logs", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    try {
      const deletedCount = await coreWriteRepository2.clearOldActivityLogs({ storeId });
      await logSystemActivity2({
        storeId,
        userId: req.user.id,
        action: "CLEAR_OLD_ACTIVITY_LOGS",
        details: { deletedCount }
      });
      res.json({ success: true, deletedCount });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to clear old activity logs" });
    }
  });
  app2.get("/api/suppliers", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    try {
      const suppliers = await coreReadRepository2.listSuppliers(Number(req.user.store_id));
      res.json({
        suppliers: suppliers.map((supplier) => ({
          ...supplier,
          pending_orders: Number(supplier.pending_orders || 0) || 0
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load suppliers" });
    }
  });
  app2.post("/api/suppliers", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim() || null;
    const email = String(req.body?.email || "").trim() || null;
    const address = String(req.body?.address || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;
    if (!name) {
      return res.status(400).json({ error: "Supplier name is required" });
    }
    try {
      const result = await postgresPool2.query(`
        INSERT INTO suppliers (store_id, name, phone, email, address, note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING id
      `, [req.user.store_id, name, phone, email, address, note]);
      const supplierId = Number(result.rows[0]?.id || 0);
      const supplier = (await postgresPool2.query("SELECT * FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1", [supplierId, req.user.store_id])).rows[0];
      res.json({ success: true, supplier });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to save supplier" });
    }
  });
  app2.get("/api/purchase-orders", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const statusFilter = String(req.query.status || "").trim().toUpperCase();
      const search = String(req.query.search || "").trim().toLowerCase();
      const rows = await coreReadRepository2.listPurchaseOrders(storeId, statusFilter, search);
      const orders = rows.map((row) => formatPurchaseOrder2(row));
      const openOrders = orders.filter((order) => order.status === "ORDERED");
      res.json({
        orders,
        summary: {
          openOrders: openOrders.length,
          receivedOrders: orders.filter((order) => order.status === "RECEIVED").length,
          cancelledOrders: orders.filter((order) => order.status === "CANCELLED").length,
          pendingUnits: openOrders.reduce((sum, order) => sum + (Number(order.total_quantity || 0) || 0), 0),
          pendingValue: openOrders.reduce((sum, order) => sum + (Number(order.subtotal || 0) || 0), 0)
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load purchase orders" });
    }
  });
  app2.post("/api/purchase-orders", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const supplierId = Number(req.body?.supplier_id);
    const expectedDate = String(req.body?.expected_date || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      return res.status(400).json({ error: "Select a valid supplier before saving this order" });
    }
    if (!rawItems.length) {
      return res.status(400).json({ error: "Add at least one product to this purchase order" });
    }
    const supplier = (await postgresPool2.query("SELECT * FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1", [supplierId, storeId])).rows[0];
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }
    try {
      const normalizedItems = [];
      for (const [index, item] of rawItems.entries()) {
        const productId = Number(item?.product_id);
        const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
        const unitCost = Math.max(0, Number(item?.unit_cost) || 0);
        const condition = item?.condition ? normalizeCollectionCondition6(item.condition) : null;
        const batchCode = normalizeBatchCode3(item?.batch_code);
        const expiryDate = normalizeBatchExpiryDate3(item?.expiry_date);
        if (!Number.isInteger(productId) || productId <= 0) {
          throw new Error(`Line ${index + 1}: select a valid product.`);
        }
        if (quantity <= 0) {
          throw new Error(`Line ${index + 1}: quantity must be greater than zero.`);
        }
        const product = (await postgresPool2.query("SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, storeId])).rows[0];
        if (!product) {
          throw new Error(`Line ${index + 1}: product not found.`);
        }
        if (product.condition_matrix && !condition) {
          throw new Error(`Line ${index + 1}: choose a condition for ${product.name}.`);
        }
        normalizedItems.push({
          product_id: productId,
          product_name: product.name,
          quantity,
          unit_cost: unitCost,
          line_total: Number((unitCost * quantity).toFixed(2)),
          condition,
          batch_code: batchCode,
          expiry_date: expiryDate
        });
      }
      const subtotal = normalizedItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
      const orderNumber = await generateUniquePurchaseOrderNumber2(storeId);
      if (!orderNumber) {
        return res.status(500).json({ error: "Failed to generate a unique purchase order number" });
      }
      const result = await postgresPool2.query(`
        INSERT INTO purchase_orders (
          store_id, supplier_id, supplier_name, order_number, status, items,
          subtotal, note, expected_date, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, 'ORDERED', $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        storeId,
        supplierId,
        supplier.name,
        orderNumber,
        JSON.stringify(normalizedItems),
        subtotal,
        note,
        expectedDate,
        req.user.id
      ]);
      const orderId = Number(result.rows[0]?.id || 0);
      const order = (await postgresPool2.query(`
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE po.id = $1 AND po.store_id = $2
        LIMIT 1
      `, [orderId, storeId])).rows[0];
      res.json({ success: true, order: formatPurchaseOrder2(order) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to save purchase order" });
    }
  });
  app2.post("/api/purchase-orders/:id/receive", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "Invalid purchase order id" });
    }
    try {
      const receivedResult = await coreWriteRepository2.receivePurchaseOrder({
        storeId,
        orderId,
        receivedBy: Number(req.user.id)
      });
      res.json({ success: true, order: formatPurchaseOrder2(receivedResult.orderRow) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to receive purchase order" });
    }
  });
  app2.post("/api/purchase-orders/:id/cancel", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "Invalid purchase order id" });
    }
    const order = (await postgresPool2.query("SELECT * FROM purchase_orders WHERE id = $1 AND store_id = $2 LIMIT 1", [orderId, req.user.store_id])).rows[0];
    if (!order) {
      return res.status(404).json({ error: "Purchase order not found" });
    }
    if (String(order.status || "").toUpperCase() === "RECEIVED") {
      return res.status(400).json({ error: "Received purchase orders cannot be cancelled" });
    }
    await postgresPool2.query(`
      UPDATE purchase_orders
      SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND store_id = $2
    `, [orderId, req.user.store_id]);
    res.json({ success: true });
  });
  app2.get("/api/inventory/batches", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "PROCUREMENT_OFFICER"]), checkStoreLock2, async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const statusFilter = String(req.query.status || "all").trim().toLowerCase();
      const search = String(req.query.search || "").trim().toLowerCase();
      const productId = Number(req.query.product_id || req.query.productId || 0);
      const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = await coreReadRepository2.listInventoryBatches(storeId);
      const filtered = rows.map((row) => formatInventoryBatch2(row)).filter((row) => {
        if (productId > 0 && Number(row.product_id) !== productId) return false;
        if (search) {
          const haystack = `${row.product_name || ""} ${row.batch_code || ""} ${row.supplier_name || ""} ${row.note || ""}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        if (statusFilter === "expired") return row.status === "EXPIRED";
        if (statusFilter === "expiring") return row.status === "EXPIRING_SOON" || row.status === "EXPIRED" || typeof row.days_until_expiry === "number" && row.days_until_expiry <= days;
        if (statusFilter === "active") return ["ACTIVE", "EXPIRING_SOON", "NO_EXPIRY"].includes(String(row.status));
        return true;
      });
      const paginated = filtered.slice(offset, offset + limit);
      res.json({
        batches: paginated,
        summary: {
          total: filtered.length,
          expiringSoon: filtered.filter((row) => row.status === "EXPIRING_SOON").length,
          expired: filtered.filter((row) => row.status === "EXPIRED").length,
          openQuantity: filtered.reduce((sum, row) => sum + (Number(row.quantity_remaining || 0) || 0), 0)
        },
        limit,
        offset
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load inventory batches" });
    }
  });
};

// serverSalesReportingRoutes.ts
import fs3 from "fs";
import path4 from "path";

// serverVendorPayableRules.ts
var computePayableAfterReturn = (input) => {
  const currentAmountDue = Math.max(0, Number(input.currentAmountDue || 0) || 0);
  const returnCostValue = Math.max(0, Number(input.returnCostValue || 0) || 0);
  const nextAmountDue = Math.max(0, Number((currentAmountDue - returnCostValue).toFixed(2)) || 0);
  const nextStatus = nextAmountDue <= 9e-3 ? "SETTLED" : "UNPAID";
  return { nextAmountDue, nextStatus };
};
var logVendorPayableMutation = (payload) => {
  const event = {
    type: "vendor_payable_mutation",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...payload
  };
  console.info(`[vendor_payable_mutation] ${JSON.stringify(event)}`);
};

// serverSalesReportingRoutes.ts
var registerSalesReportingRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  uploadsDir: uploadsDir2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  findStoreById: findStoreById2,
  safeJsonParse: safeJsonParse6,
  normalizePhone: normalizePhone4,
  normalizeSaleChannel: normalizeSaleChannel2,
  normalizePin: normalizePin2,
  resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
  getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
  getSaleReturnsMeta: getSaleReturnsMeta2,
  formatSaleResponse: formatSaleResponse2,
  formatSaleReturnEntry: formatSaleReturnEntry2,
  formatMarketCollection: formatMarketCollection2,
  getAuditActorLabel: getAuditActorLabel2,
  formatAuditCurrency: formatAuditCurrency2,
  logSystemActivity: logSystemActivity2,
  logAuditEvent: logAuditEvent2,
  HIGH_RISK_AUDIT_ACTIONS: HIGH_RISK_AUDIT_ACTIONS2,
  toFiniteNumberOrNull: toFiniteNumberOrNull6,
  resolveTrackedCost: resolveTrackedCost5,
  getMissingCostPriceLabels: getMissingCostPriceLabels2,
  getProductTotalStock: getProductTotalStock2
}) => {
  const normalizeStoredPhone2 = (value) => {
    const raw = String(value ?? "").trim();
    const digits = normalizePhone4(raw);
    return raw.startsWith("+") && digits ? `+${digits}` : digits;
  };
  const getVendorSignature = (name, _phone, _address) => {
    const normalizedName = String(name || "").trim().toLowerCase();
    return normalizedName || "unknown-vendor";
  };
  const calculateVendorIdFromSignature = (signature) => {
    let hash2 = 0;
    for (let i = 0; i < signature.length; i += 1) {
      hash2 = (hash2 * 31 + signature.charCodeAt(i)) % 9e4;
    }
    return String(hash2 + 1e4).padStart(5, "0");
  };
  const resolveRetentionWindow = (modeRaw, fromRaw, toRaw) => {
    const mode = String(modeRaw || "").trim().toUpperCase();
    const customFrom = String(fromRaw || "").trim();
    const customTo = String(toRaw || "").trim();
    if (mode === "ONE_YEAR") {
      const end = /* @__PURE__ */ new Date();
      end.setFullYear(end.getFullYear() - 1);
      end.setHours(0, 0, 0, 0);
      return {
        mode: "ONE_YEAR",
        fromIso: null,
        toIso: end.toISOString(),
        label: `Before ${end.toISOString().slice(0, 10)}`
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      throw new Error("Custom retention requires valid from/to dates in YYYY-MM-DD format.");
    }
    const fromDate = /* @__PURE__ */ new Date(`${customFrom}T00:00:00.000Z`);
    const toDateInclusive = /* @__PURE__ */ new Date(`${customTo}T23:59:59.999Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDateInclusive.getTime())) {
      throw new Error("Invalid custom retention date range.");
    }
    if (fromDate.getTime() > toDateInclusive.getTime()) {
      throw new Error("Custom retention start date must be before end date.");
    }
    return {
      mode: "CUSTOM",
      fromIso: fromDate.toISOString(),
      toIso: toDateInclusive.toISOString(),
      label: `${customFrom} to ${customTo}`
    };
  };
  const retentionPredicate = (columnName, fromIso, toIso) => {
    if (fromIso) {
      return {
        sql: `${columnName} BETWEEN $2::timestamptz AND $3::timestamptz`,
        params: [fromIso, toIso]
      };
    }
    return {
      sql: `${columnName} < $2::timestamptz`,
      params: [toIso]
    };
  };
  const resolveRetentionStoreId = (req) => {
    const rawStoreId = req.user.role === "SYSTEM_ADMIN" ? req.body?.storeId : req.user.store_id;
    const storeId = Number(rawStoreId);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new Error("Store ID required");
    }
    return storeId;
  };
  const resolveRetentionRequestContext = (req) => {
    const storeId = resolveRetentionStoreId(req);
    const windowRange = resolveRetentionWindow(req.body?.mode, req.body?.fromDate, req.body?.toDate);
    return { storeId, windowRange };
  };
  app2.get("/api/dashboard/activity-feed", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "PROCUREMENT_OFFICER", "STAFF"]), async (req, res) => {
    const limit = Math.min(12, Math.max(4, Number(req.query.limit) || 8));
    try {
      const { saleRows, stockRows, expenseRows } = await coreReadRepository2.getDashboardActivityFeed({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        role: String(req.user.role || "STAFF"),
        limit
      });
      const items = [
        ...saleRows.map((row) => ({
          id: `sale-${row.id}`,
          type: "sale",
          title: String(row.status || "").toUpperCase() === "PENDING" ? "Pending sale recorded" : "Sale completed",
          detail: `${row.customer_name || "Walk-in Customer"} \u2022 ${row.user_username || "Staff"}`,
          timestamp: row.timestamp,
          amount: Number(row.total || 0) || 0,
          href: "/invoices"
        })),
        ...stockRows.map((row) => ({
          id: `stock-${row.id}`,
          type: "stock",
          title: `${String(row.adjustment_mode || "UPDATE").replace(/_/g, " ")} stock update`,
          detail: `${row.product_name || "Product"} \u2022 ${row.user_username || "Staff"} \u2022 ${Number(row.quantity_change || 0) > 0 ? "+" : ""}${Number(row.quantity_change || 0)} unit(s)`,
          timestamp: row.created_at,
          amount: Math.abs(Number(row.cost_impact || 0) || 0),
          href: "/inventory"
        })),
        ...expenseRows.map((row) => ({
          id: `expense-${row.id}`,
          type: "expense",
          title: "Expense recorded",
          detail: `${row.title || "General expense"} \u2022 ${row.user_username || "Staff"}`,
          timestamp: row.created_at,
          amount: Number(row.amount || 0) || 0,
          href: "/expenses"
        }))
      ].sort((a, b) => new Date(String(b.timestamp || 0)).getTime() - new Date(String(a.timestamp || 0)).getTime()).slice(0, limit);
      res.json({ items });
    } catch (err) {
      console.error("Dashboard activity feed error:", err);
      res.status(500).json({ error: err.message || "Failed to load dashboard activity feed" });
    }
  });
  app2.get("/api/sales/pending", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "STAFF"]), checkStoreLock2, async (req, res) => {
    try {
      const sales = await coreReadRepository2.listPendingSales(Number(req.user.store_id));
      res.json(await Promise.all(sales.map((sale) => formatSaleResponse2(sale))));
    } catch (err) {
      console.error("Pending sales read error:", err);
      res.status(500).json({ error: err.message || "Failed to load pending sales" });
    }
  });
  const confirmPendingSaleReceipt = async (saleId, storeId) => {
    const sale = (await postgresPool2.query("SELECT * FROM sales WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL", [saleId, storeId])).rows[0];
    if (!sale) {
      throw new Error("Sale not found");
    }
    const formattedSale = await formatSaleResponse2(sale);
    if ((formattedSale.amount_due || 0) > 0) {
      throw new Error("Outstanding balance remains. Record payment before confirming this sale.");
    }
    await postgresPool2.query("UPDATE sales SET status = 'COMPLETED' WHERE id = $1 AND store_id = $2", [saleId, storeId]);
    return { ...formattedSale, status: "COMPLETED" };
  };
  app2.put("/api/sales/:id/confirm", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    try {
      const saleId = Number(req.params.id);
      const confirmedSale = await confirmPendingSaleReceipt(saleId, Number(req.user.store_id));
      res.json({ success: true, sale: confirmedSale });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to confirm sale receipt" });
    }
  });
  app2.post("/api/sales/:id/verify", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    try {
      const saleId = Number(req.params.id);
      const confirmedSale = await confirmPendingSaleReceipt(saleId, Number(req.user.store_id));
      res.json({ success: true, sale: confirmedSale });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to verify sale" });
    }
  });
  app2.post("/api/sales/:id/settle", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const saleId = Number(req.params.id);
    const incomingPayments = req.body?.payment_methods || {};
    const note = String(req.body?.note || "").trim();
    const dueDate = String(req.body?.due_date || "").trim() || null;
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }
    const sale = (await postgresPool2.query("SELECT * FROM sales WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL", [saleId, req.user.store_id])).rows[0];
    if (!sale) {
      return res.status(404).json({ error: "Sale not found" });
    }
    const existingPayments = safeJsonParse6(sale.payment_methods, {});
    const nextPayments = {
      cash: Math.max(0, Number(existingPayments.cash) || 0) + Math.max(0, Number(incomingPayments.cash) || 0),
      transfer: Math.max(0, Number(existingPayments.transfer) || 0) + Math.max(0, Number(incomingPayments.transfer) || 0),
      pos: Math.max(0, Number(existingPayments.pos) || 0) + Math.max(0, Number(incomingPayments.pos) || 0)
    };
    const returnMeta = await getSaleReturnsMeta2(saleId);
    const returnedAmount = Math.max(0, Number(returnMeta?.returned_amount || 0));
    const amountPaid = getTotalPaidFromPaymentMethods3(nextPayments);
    const netTotal = Math.max(0, Number((Number(sale.total || 0) - returnedAmount).toFixed(2)) || 0);
    const amountDue = Math.max(0, Number((netTotal - amountPaid).toFixed(2)) || 0);
    const nextStatus = amountDue <= 0 ? "COMPLETED" : "PENDING";
    const mergedNote = [String(sale.note || "").trim(), note].filter(Boolean).join(" \u2022 ");
    const saleChannel = normalizeSaleChannel2(sale.sale_channel);
    const nextLockedUntilPaid = saleChannel === "STANDARD" ? 0 : amountDue > 0 ? 1 : 0;
    await postgresPool2.query(`
      UPDATE sales
      SET payment_methods = $1, status = $2, due_date = $3, note = $4, locked_until_paid = $5
      WHERE id = $6 AND store_id = $7
    `, [JSON.stringify(nextPayments), nextStatus, dueDate || sale.due_date || null, mergedNote || null, nextLockedUntilPaid, saleId, req.user.store_id]);
    const updatedSale = (await postgresPool2.query(`
      SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE s.id = $1 AND s.store_id = $2
    `, [saleId, req.user.store_id])).rows[0];
    res.json({ success: true, sale: await formatSaleResponse2(updatedSale) });
  });
  app2.post("/api/sales", authenticate2, checkStoreLock2, async (req, res) => {
    const {
      subtotal,
      discount_amount,
      discount_type,
      discount_value,
      discount_note,
      show_discount_on_invoice,
      tax_amount,
      tax_percentage,
      total,
      payment_methods,
      items,
      status,
      pdf_path,
      customer_id,
      due_date,
      note,
      checkout_pin
    } = req.body;
    if (typeof total !== "number" || total <= 0) {
      return res.status(400).json({ error: "Total must be a positive number" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "At least one item required" });
    }
    if (!payment_methods || typeof payment_methods.cash !== "number" && typeof payment_methods.transfer !== "number" && typeof payment_methods.pos !== "number") {
      return res.status(400).json({ error: "Payment methods must include at least cash, transfer, or pos amount" });
    }
    for (const item of items) {
      const isSourced = Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === "SOURCED");
      if (!isSourced && typeof item.product_id !== "number" || typeof item.quantity !== "number" || item.quantity <= 0) {
        return res.status(400).json({ error: "Invalid item: quantity is required, and product_id is required for inventory items." });
      }
      if (typeof item.price_at_sale !== "number" || item.price_at_sale < 0) {
        return res.status(400).json({ error: "Invalid item price" });
      }
      if (isSourced && String(item?.name || "").trim().length < 2) {
        return res.status(400).json({ error: "Sourced items must include a valid item name." });
      }
      if (isSourced && String(item?.sourced_vendor_name || "").trim().length < 2) {
        return res.status(400).json({ error: "Sourced items must include a vendor name or shop reference." });
      }
    }
    const normalizedTaxAmount = Math.max(0, Number(tax_amount) || 0);
    const normalizedSubtotal = typeof subtotal === "number" && subtotal >= 0 ? subtotal : Math.max(0, total - normalizedTaxAmount);
    const normalizedDiscountAmount = Math.min(normalizedSubtotal, Math.max(0, Number(discount_amount) || 0));
    const normalizedDiscountType = ["PERCENTAGE", "FIXED"].includes(String(discount_type || "").toUpperCase()) ? String(discount_type).toUpperCase() : null;
    const normalizedDiscountValue = Math.max(0, Number(discount_value) || 0);
    const normalizedDiscountNote = String(discount_note || "").trim() || null;
    const normalizedShowDiscountOnInvoice = show_discount_on_invoice !== false;
    const normalizedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));
    const storeSettings = req.store || await findStoreById2(req.user.store_id);
    if (!storeSettings) {
      return res.status(404).json({ error: "Store not found" });
    }
    const isGadgetMode = String(storeSettings.mode || "").toUpperCase() === "GADGET";
    const pinCheckoutEnabled = isGadgetMode && Number(storeSettings?.pin_checkout_enabled ?? 1) === 1;
    const normalizedCheckoutPin = normalizePin2(checkout_pin);
    let saleActor = req.user;
    if (pinCheckoutEnabled) {
      if (!/^\d{4,6}$/.test(normalizedCheckoutPin)) {
        return res.status(400).json({ error: "Checkout PIN is required for Gadget Mode sales" });
      }
      const resolvedActor = await resolveCheckoutActorByPin2(req.user.store_id, normalizedCheckoutPin);
      if (!resolvedActor) {
        return res.status(400).json({ error: "Invalid checkout PIN for this store" });
      }
      saleActor = resolvedActor;
    }
    const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;
    try {
      const { saleId } = await coreWriteRepository2.createSale({
        storeId: Number(req.user.store_id),
        saleActorId: Number(saleActor.id),
        subtotal: normalizedSubtotal,
        discountAmount: normalizedDiscountAmount,
        discountType: normalizedDiscountType,
        discountValue: normalizedDiscountValue,
        showDiscountOnInvoice: normalizedShowDiscountOnInvoice,
        discountNote: normalizedDiscountNote,
        taxAmount: normalizedTaxAmount,
        taxPercentage: normalizedTaxPercentage,
        total,
        paymentMethods: payment_methods,
        items,
        status: ["COMPLETED", "PENDING"].includes(status) ? status : "COMPLETED",
        pdfPath: pdf_path || null,
        customerId: customer_id || null,
        dueDate: due_date || null,
        note: note ? String(note).trim() : null,
        allowCostFallback
      });
      if (normalizedDiscountAmount > 0) {
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: "DISCOUNT",
          description: `${getAuditActorLabel2(saleActor.role)} ${saleActor.username} gave ${formatAuditCurrency2(normalizedDiscountAmount)} discount on Sale #${saleId}.`,
          oldValue: { saleId, subtotal: normalizedSubtotal },
          newValue: {
            discount_amount: normalizedDiscountAmount,
            discount_type: normalizedDiscountType,
            discount_note: normalizedDiscountNote,
            total
          }
        });
      }
      const sourcedItems = items.filter((item) => Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === "SOURCED")).map((item) => ({
        name: String(item?.name || "").trim() || "Sourced Item",
        vendor: String(item?.sourced_vendor_name || "").trim() || "Unknown Vendor",
        vendor_reference: String(item?.sourced_vendor_reference || "").trim() || null,
        vendor_cost_price: Math.max(0, Number(item?.sourced_cost_price ?? item?.cost_at_sale ?? 0) || 0),
        quantity: Math.max(1, Number(item?.quantity || 1) || 1),
        selling_price: Math.max(0, Number(item?.price_at_sale || 0) || 0)
      }));
      if (sourcedItems.length > 0) {
        const totalVendorDebt = sourcedItems.reduce((sum, item) => sum + item.vendor_cost_price * item.quantity, 0);
        const vendorLabels = Array.from(new Set(sourcedItems.map((item) => String(item.vendor || "").trim()).filter(Boolean))).join(", ");
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: "SOURCED_SALE",
          description: `${getAuditActorLabel2(saleActor.role)} ${saleActor.username} sold ${sourcedItems.length} sourced item(s) from ${vendorLabels || "a vendor"} with vendor debt of ${formatAuditCurrency2(totalVendorDebt)}.`,
          newValue: {
            saleId,
            sourced_items: sourcedItems,
            vendor_debt_total: totalVendorDebt
          }
        });
      }
      const markupItems = items.filter((item) => {
        const basePrice = Number(item.base_price_at_sale ?? item.price_at_sale ?? 0);
        const salePrice = Number(item.price_at_sale || 0);
        return salePrice > basePrice + 1e-3;
      });
      if (markupItems.length > 0) {
        const totalMarkup = markupItems.reduce((sum, item) => {
          const basePrice = Number(item.base_price_at_sale ?? item.price_at_sale ?? 0);
          const salePrice = Number(item.price_at_sale || 0);
          const qty = Math.max(1, Number(item.quantity || 1));
          return sum + Math.max(0, (salePrice - basePrice) * qty);
        }, 0);
        await logAuditEvent2({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: "PRICE_MARKUP",
          description: `${getAuditActorLabel2(saleActor.role)} ${saleActor.username} completed Sale #${saleId} with a price markup of ${formatAuditCurrency2(totalMarkup)} across ${markupItems.length} item(s).`,
          newValue: {
            saleId,
            total_markup: totalMarkup,
            markup_items: markupItems.map((item) => ({
              name: String(item.name || "").trim() || "Item",
              base_price: Number(item.base_price_at_sale ?? item.price_at_sale ?? 0),
              sale_price: Number(item.price_at_sale || 0),
              quantity: Math.max(1, Number(item.quantity || 1))
            }))
          }
        });
      }
      res.json({
        id: saleId,
        recorded_by: {
          id: Number(saleActor.id),
          username: String(saleActor.username || req.user.username),
          role: String(saleActor.role || req.user.role)
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.get("/api/sales", authenticate2, async (req, res) => {
    try {
      const hasPaginationQuery = req.query.limit !== void 0 || req.query.offset !== void 0;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const result = await coreReadRepository2.listSales({
        storeId: Number(req.user.store_id),
        customerId: Number(req.query.customerId || 0),
        search: typeof req.query.search === "string" ? req.query.search : "",
        status: typeof req.query.status === "string" ? req.query.status : "",
        limit,
        offset,
        paginate: hasPaginationQuery
      });
      const formattedSales = await Promise.all(result.rows.map((sale) => formatSaleResponse2(sale)));
      if (hasPaginationQuery) {
        return res.json({
          items: formattedSales,
          total: Number(result.total || 0),
          limit: result.limit,
          offset: result.offset
        });
      }
      res.json(formattedSales);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load sales" });
    }
  });
  app2.get("/api/sales/:id/details", authenticate2, async (req, res) => {
    try {
      const saleId = Number(req.params.id);
      const storeId = Number(req.user.store_id);
      const { sale, items, returns } = await coreReadRepository2.getSaleDetails(storeId, saleId);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      res.json({
        ...await formatSaleResponse2(sale),
        items,
        returns: returns.map((row) => formatSaleReturnEntry2(row))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load sale details" });
    }
  });
  app2.get("/api/returns", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), async (req, res) => {
    try {
      const rows = await coreReadRepository2.listReturns({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === "string" ? req.query.search : "",
        returnType: typeof req.query.type === "string" ? req.query.type : ""
      });
      res.json(rows.map((row) => formatSaleReturnEntry2(row)));
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load returns" });
    }
  });
  app2.post("/api/sales/:id/returns", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const saleId = Number(req.params.id);
    const normalizedReason = String(req.body?.reason || "").trim();
    const normalizedNote = String(req.body?.note || "").trim();
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const normalizedReturnType = ["REFUND", "EXCHANGE", "RETURN_ONLY"].includes(String(req.body?.return_type || "").toUpperCase()) ? String(req.body?.return_type || "").toUpperCase() : "REFUND";
    const normalizedRefundMethod = ["cash", "transfer", "pos", "store_credit", "other"].includes(String(req.body?.refund_method || "").toLowerCase()) ? String(req.body?.refund_method || "").toLowerCase() : "cash";
    const normalizedRestockItems = req.body?.restock_items !== false;
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }
    if (normalizedReason.length < 3) {
      return res.status(400).json({ error: "Please provide a clear reason for this return." });
    }
    if (!requestedItems.length) {
      return res.status(400).json({ error: "Select at least one item to return." });
    }
    try {
      const result = await coreWriteRepository2.processSaleReturn({
        storeId: Number(req.user.store_id),
        saleId,
        processedBy: Number(req.user.id),
        requestedItems,
        reason: normalizedReason,
        note: normalizedNote || null,
        refundAmount: Math.max(0, Number(req.body?.refund_amount) || 0),
        returnType: normalizedReturnType,
        refundMethod: normalizedRefundMethod,
        restockItems: normalizedRestockItems
      });
      const saleDetails = await coreReadRepository2.getSaleDetails(Number(req.user.store_id), saleId);
      res.json({
        success: true,
        return: formatSaleReturnEntry2(result.createdReturn),
        sale: {
          ...await formatSaleResponse2(result.updatedSale),
          items: saleDetails.items,
          returns: saleDetails.returns.map((row) => formatSaleReturnEntry2(row))
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to process return" });
    }
  });
  app2.get("/api/vendor-payables", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const statusFilter = String(req.query.status || "ALL").trim().toUpperCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const queryParams = [storeId];
    const statusCondition = statusFilter !== "ALL" ? `AND UPPER(COALESCE(vp.status, 'UNPAID')) = $${queryParams.push(statusFilter)}` : "";
    const rows = (await postgresPool2.query(`
      SELECT
        vp.*,
        COALESCE(
          vp.source_type,
          CASE
            WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'consignment_item')::boolean, false) THEN 'CONSIGNMENT'
            WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'sourced_item')::boolean, false) THEN 'SOURCED'
            ELSE 'SOURCED'
          END,
          'SOURCED'
        ) AS source_type,
        cvbd.bank_name AS vendor_bank_name,
        cvbd.account_number AS vendor_account_number,
        cvbd.account_name AS vendor_account_name,
        cvbd.bank_note AS vendor_bank_note,
        s.timestamp as sale_timestamp
      FROM vendor_payables vp
      LEFT JOIN sales s ON s.id = vp.sale_id
      LEFT JOIN sale_items si ON si.id = vp.sale_item_id
      LEFT JOIN consignment_vendor_bank_details cvbd
        ON cvbd.store_id = vp.store_id
       AND cvbd.vendor_key = LOWER(TRIM(COALESCE(vp.vendor_name, '')))
      WHERE vp.store_id = $1
      ${statusCondition}
      ORDER BY vp.created_at DESC, vp.id DESC
    `, queryParams)).rows;
    const rowsWithVendorId = rows.map((row) => {
      const vendorId = calculateVendorIdFromSignature(getVendorSignature(row.vendor_name, null, null));
      return {
        ...row,
        vendor_id: vendorId
      };
    });
    const filtered = rowsWithVendorId.filter((row) => {
      if (!search) {
        return true;
      }
      return [
        String(row.vendor_name || ""),
        String(row.vendor_reference || ""),
        String(row.item_name || ""),
        String(row.source_type || ""),
        String(row.vendor_id || ""),
        `sale ${row.sale_id}`
      ].some((value) => value.toLowerCase().includes(search));
    });
    const summary = filtered.reduce((acc, row) => {
      const amountDue = Math.max(0, Number(row.amount_due || 0) || 0);
      acc.totalRecords += 1;
      acc.totalAmountDue += amountDue;
      if (String(row.status || "").toUpperCase() === "UNPAID") {
        acc.unpaidAmount += amountDue;
      }
      return acc;
    }, {
      totalRecords: 0,
      totalAmountDue: 0,
      unpaidAmount: 0
    });
    res.json({
      records: filtered.map((row) => ({
        ...row,
        status: String(row.status || "UNPAID").toUpperCase() === "SETTLED" ? "SETTLED" : "UNPAID",
        amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
        source_type: String(row.source_type || "SOURCED").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : "SOURCED"
      })),
      summary
    });
  });
  app2.patch("/api/vendor-payables/:id/status", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), checkStoreLock2, async (req, res) => {
    const payableId = Number(req.params.id);
    const nextStatus = String(req.body?.status || "").trim().toUpperCase() === "SETTLED" ? "SETTLED" : "UNPAID";
    const note = String(req.body?.note || "").trim() || null;
    if (!Number.isInteger(payableId) || payableId <= 0) {
      return res.status(400).json({ error: "Invalid payable id" });
    }
    const row = (await postgresPool2.query("SELECT * FROM vendor_payables WHERE id = $1 AND store_id = $2 LIMIT 1", [payableId, Number(req.user.store_id)])).rows[0];
    if (!row) {
      return res.status(404).json({ error: "Vendor payable record not found" });
    }
    const currentAmountDue = Math.max(0, Number(row.amount_due || 0) || 0);
    const normalized = computePayableAfterReturn({
      currentAmountDue,
      returnCostValue: nextStatus === "SETTLED" ? currentAmountDue : 0,
      currentStatus: String(row.status || "UNPAID")
    });
    const finalAmountDue = nextStatus === "SETTLED" ? 0 : normalized.nextAmountDue;
    await postgresPool2.query(`
      UPDATE vendor_payables
      SET status = $1,
          amount_due = $2,
          settled_at = CASE WHEN $1 = 'SETTLED' THEN CURRENT_TIMESTAMP ELSE NULL END,
          note = $3
      WHERE id = $4 AND store_id = $5
    `, [nextStatus, finalAmountDue, note, payableId, Number(req.user.store_id)]);
    await logAuditEvent2({
      storeId: Number(req.user.store_id),
      userId: Number(req.user.id),
      userName: req.user.username,
      actionType: "VENDOR_PAYABLE_UPDATE",
      description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} marked vendor payable #${payableId} as ${nextStatus}.`,
      oldValue: {
        status: String(row.status || "UNPAID").toUpperCase(),
        amount_due: Math.max(0, Number(row.amount_due || 0) || 0)
      },
      newValue: {
        status: nextStatus,
        amount_due: finalAmountDue
      }
    });
    logVendorPayableMutation({
      action: "status_changed",
      storeId: Number(req.user.store_id),
      saleId: Number(row.sale_id || 0) || void 0,
      saleItemId: Number(row.sale_item_id || 0) || void 0,
      payableId,
      sourceType: String(row.source_type || "SOURCED").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : "SOURCED",
      previousAmountDue: currentAmountDue,
      nextAmountDue: finalAmountDue,
      previousStatus: String(row.status || "UNPAID").toUpperCase(),
      nextStatus,
      actorUserId: Number(req.user.id || 0) || void 0
    });
    res.json({
      success: true,
      record: {
        ...row,
        status: nextStatus,
        amount_due: finalAmountDue,
        note,
        settled_at: nextStatus === "SETTLED" ? (/* @__PURE__ */ new Date()).toISOString() : null
      }
    });
  });
  app2.get("/api/sourced-items", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "STAFF"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const search = String(req.query.search || "").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const offset = (page - 1) * limit;
    const baseQuery = `
      WITH sourced AS (
        SELECT
          si.id,
          si.sale_id,
          si.quantity,
          si.price_at_sale,
          si.subtotal,
          si.cost_at_sale,
          si.imei_serial,
          si.specs_at_sale,
          s.timestamp AS sale_timestamp,
          s.status AS sale_status,
          s.deleted_at AS sale_deleted_at,
          u.username AS sold_by_username,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_vendor_name'), '')) AS owner_name,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_vendor_reference'), '')) AS owner_reference,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_item_name'), '')) AS item_name,
          COALESCE((si.specs_at_sale::jsonb ->> 'sourced_item')::boolean, false) AS is_sourced,
          GREATEST(1, COALESCE(si.quantity, 0)) AS quantity_normalized,
          GREATEST(0, COALESCE(si.price_at_sale, 0)) AS unit_price_normalized,
          GREATEST(0, COALESCE(si.subtotal, 0)) AS subtotal_normalized,
          GREATEST(0, COALESCE((si.specs_at_sale::jsonb ->> 'sourced_cost_price')::numeric, si.cost_at_sale, 0)) AS owner_unit_cost_normalized
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.store_id = $1
      ), filtered AS (
        SELECT
          id,
          sale_id,
          sale_timestamp,
          sold_by_username,
          COALESCE(NULLIF(item_name, ''), 'Sourced Item') AS item_name,
          COALESCE(NULLIF(imei_serial, ''), '') AS imei_serial,
          quantity_normalized AS quantity,
          unit_price_normalized AS unit_price,
          subtotal_normalized AS subtotal,
          COALESCE(NULLIF(owner_name, ''), 'Unknown Owner') AS owner_name,
          COALESCE(NULLIF(owner_reference, ''), '') AS owner_reference,
          owner_unit_cost_normalized AS owner_unit_cost,
          ROUND((owner_unit_cost_normalized * quantity_normalized)::numeric, 2) AS owner_total_cost,
          ROUND((subtotal_normalized - (owner_unit_cost_normalized * quantity_normalized))::numeric, 2) AS gross_profit
        FROM sourced
        WHERE is_sourced
          AND UPPER(COALESCE(sale_status, '')) = 'COMPLETED'
          AND sale_deleted_at IS NULL
          AND (
            $2 = '' OR
            LOWER(COALESCE(item_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(imei_serial, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(owner_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(owner_reference, '')) LIKE '%' || $2 || '%' OR
            LOWER('sale ' || sale_id::text) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(sold_by_username, '')) LIKE '%' || $2 || '%'
          )
      )
    `;
    const summaryQuery = await postgresPool2.query(`
      ${baseQuery}
      SELECT
        COUNT(*)::int AS total_records,
        COALESCE(SUM(quantity), 0)::numeric AS total_units,
        COALESCE(SUM(subtotal), 0)::numeric AS total_sales_value,
        COALESCE(SUM(owner_total_cost), 0)::numeric AS total_owner_cost,
        COALESCE(SUM(gross_profit), 0)::numeric AS total_gross_profit
      FROM filtered
    `, [storeId, search]);
    const pageRows = await postgresPool2.query(`
      ${baseQuery}
      SELECT *
      FROM filtered
      ORDER BY sale_timestamp DESC, id DESC
      LIMIT $3 OFFSET $4
    `, [storeId, search, limit, offset]);
    const summaryRow = summaryQuery.rows[0] || {};
    res.json({
      records: pageRows.rows.map((row) => ({
        id: Number(row.id),
        sale_id: Number(row.sale_id),
        sale_timestamp: row.sale_timestamp,
        sold_by_username: String(row.sold_by_username || "Unknown Staff").trim() || "Unknown Staff",
        item_name: String(row.item_name || "Sourced Item").trim() || "Sourced Item",
        imei_serial: String(row.imei_serial || "").trim(),
        quantity: Number(row.quantity || 0) || 0,
        unit_price: Number(row.unit_price || 0) || 0,
        subtotal: Number(row.subtotal || 0) || 0,
        owner_name: String(row.owner_name || "Unknown Owner").trim() || "Unknown Owner",
        owner_reference: String(row.owner_reference || "").trim(),
        owner_unit_cost: Number(row.owner_unit_cost || 0) || 0,
        owner_total_cost: Number(row.owner_total_cost || 0) || 0,
        gross_profit: Number(row.gross_profit || 0) || 0
      })),
      summary: {
        total_records: Number(summaryRow.total_records || 0) || 0,
        total_units: Number(summaryRow.total_units || 0) || 0,
        total_sales_value: Number(summaryRow.total_sales_value || 0) || 0,
        total_owner_cost: Number(summaryRow.total_owner_cost || 0) || 0,
        total_gross_profit: Number(summaryRow.total_gross_profit || 0) || 0
      },
      page,
      limit
    });
  });
  app2.get("/api/system-logs", authenticate2, authorize2(["STORE_ADMIN"]), async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const { rows, total } = await coreReadRepository2.listSystemLogs({
        storeId: Number(req.user.store_id),
        staffName: typeof req.query.staffName === "string" ? req.query.staffName.trim() : "",
        actionType: typeof req.query.actionType === "string" ? req.query.actionType.trim() : "",
        todayOnly: ["1", "true", "yes"].includes(String(req.query.todayOnly || "").toLowerCase()),
        highRiskOnly: ["1", "true", "yes"].includes(String(req.query.highRiskOnly || "").toLowerCase()),
        limit,
        offset,
        highRiskActions: HIGH_RISK_AUDIT_ACTIONS2
      });
      res.json({
        logs: rows.map((row) => ({
          ...row,
          is_high_risk: HIGH_RISK_AUDIT_ACTIONS2.includes(String(row.action_type || "").toUpperCase())
        })),
        total,
        limit,
        offset,
        highRiskActions: HIGH_RISK_AUDIT_ACTIONS2
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load system logs" });
    }
  });
  app2.get("/api/system-logs/summary", authenticate2, authorize2(["STORE_ADMIN"]), async (req, res) => {
    try {
      const { todayStats, recentHighRisk } = await coreReadRepository2.getSystemLogsSummary(Number(req.user.store_id));
      res.json({
        totalToday: Number(todayStats?.totalToday || 0) || 0,
        priceChangesToday: Number(todayStats?.priceChangesToday || 0) || 0,
        discountsToday: Number(todayStats?.discountsToday || 0) || 0,
        stockAdjustmentsToday: Number(todayStats?.stockAdjustmentsToday || 0) || 0,
        highRiskCount: Number(todayStats?.highRiskCount || 0) || 0,
        recentHighRisk
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load system log summary" });
    }
  });
  app2.delete("/api/system-logs", authenticate2, authorize2(["STORE_ADMIN"]), async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "No log IDs provided." });
      }
      const safeIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (safeIds.length === 0) return res.status(400).json({ error: "Invalid IDs." });
      const result = await postgresPool2.query(
        `DELETE FROM system_logs WHERE store_id = $1 AND id = ANY($2::int[])`,
        [storeId, safeIds]
      );
      res.json({ deleted: result.rowCount || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to delete logs" });
    }
  });
  app2.get("/api/audit-flags", authenticate2, authorize2(["STORE_ADMIN", "SYSTEM_ADMIN", "ACCOUNTANT"]), async (req, res) => {
    try {
      const flags = await coreReadRepository2.listAuditFlags(Number(req.user.store_id));
      res.json({
        flags: flags.map((flag) => ({
          ...flag,
          sale_total: Number(flag.sale_total || 0) || 0,
          discount_amount: Number(flag.discount_amount || 0) || 0
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load audit flags" });
    }
  });
  app2.put("/api/audit-flags/:id/resolve", authenticate2, authorize2(["STORE_ADMIN"]), async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const flagId = Number(req.params.id);
      if (!Number.isInteger(flagId) || flagId <= 0) {
        return res.status(400).json({ error: "Invalid flag id" });
      }
      const result = await postgresPool2.query(
        `UPDATE transaction_flags
         SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $1
         WHERE id = $2 AND store_id = $3 AND status = 'OPEN'
         RETURNING id`,
        [Number(req.user.id), flagId, storeId]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Flag not found or already resolved" });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to resolve flag" });
    }
  });
  app2.post("/api/sales/:id/flag", authenticate2, authorize2(["STORE_ADMIN", "SYSTEM_ADMIN", "ACCOUNTANT"]), async (req, res) => {
    const storeId = Number(req.user.store_id);
    const saleId = Number(req.params.id);
    const issueType = String(req.body?.issue_type || "CHECK_REQUIRED").trim().toUpperCase() || "CHECK_REQUIRED";
    const note = String(req.body?.note || "").trim();
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }
    if (!note) {
      return res.status(400).json({ error: "Please add a note for the owner before flagging this transaction." });
    }
    const sale = await coreReadRepository2.getSaleById(storeId, saleId);
    if (!sale) {
      return res.status(404).json({ error: "Sale not found" });
    }
    const createdFlag = await coreWriteRepository2.createTransactionFlag({
      storeId,
      saleId,
      flaggedBy: Number(req.user.id),
      issueType,
      note
    });
    await logSystemActivity2({
      storeId,
      userId: req.user.id,
      action: "FLAG_TRANSACTION",
      details: { saleId, issueType }
    });
    await logAuditEvent2({
      storeId,
      userId: Number(req.user.id),
      userName: req.user.username,
      actionType: "AUDIT_FLAG",
      description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} flagged Sale #${saleId} for owner review (${issueType.replace(/_/g, " ")}).`,
      newValue: { saleId, issueType, note }
    });
    res.json({ success: true, id: Number(createdFlag?.id || 0) });
  });
  app2.post("/api/sales/:id/void", authenticate2, authorize2(["STORE_ADMIN", "SYSTEM_ADMIN", "MANAGER"]), async (req, res) => {
    const { reason } = req.body;
    if (!reason || typeof reason !== "string" || reason.length < 3) {
      return res.status(400).json({ error: "Void reason required (min 3 characters)" });
    }
    try {
      const voidedSale = await coreWriteRepository2.voidSale({
        storeId: Number(req.user.store_id),
        saleId: Number(req.params.id),
        voidedBy: Number(req.user.id),
        reason
      });
      await logAuditEvent2({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "DELETE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} voided Sale #${voidedSale.saleId} worth ${formatAuditCurrency2(voidedSale.total)}.`,
        oldValue: { saleId: voidedSale.saleId, status: voidedSale.previousStatus, total: voidedSale.total },
        newValue: { status: "VOIDED", reason }
      });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app2.get("/api/admin/store/export", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const rawStoreId = req.user.role === "SYSTEM_ADMIN" ? req.query.storeId : req.user.store_id;
    if (!rawStoreId) return res.status(400).json({ error: "Store ID required" });
    const storeId = Number(rawStoreId);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({ error: "Invalid store id" });
    }
    try {
      const exported = await coreReadRepository2.exportStoreData(storeId);
      if (!exported.store) {
        return res.status(404).json({ error: "Store not found" });
      }
      res.json({
        version: "1.7",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        ...exported
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/store/import", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const storeId = req.user.role === "SYSTEM_ADMIN" ? req.body.storeId : req.user.store_id;
    if (!storeId) return res.status(400).json({ error: "Store ID required" });
    const { data, mode } = req.body;
    if (!data) return res.status(400).json({ error: "No data provided" });
    const importMode = mode === "merge" ? "merge" : "replace";
    try {
      await coreWriteRepository2.importStoreData({
        storeId: Number(storeId),
        actorUserId: Number(req.user.id),
        data,
        mode: importMode
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Import error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/store/import/precheck", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const { data } = req.body || {};
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "No data provided for precheck" });
    }
    try {
      const products = Array.isArray(data.products) ? data.products : [];
      const categories = Array.isArray(data.categories) ? data.categories : [];
      const users = Array.isArray(data.users) ? data.users : [];
      const customers = Array.isArray(data.customers) ? data.customers : [];
      const sales = Array.isArray(data.sales) ? data.sales : [];
      const saleItems = Array.isArray(data.saleItems) ? data.saleItems : [];
      const salesReturns = Array.isArray(data.salesReturns) ? data.salesReturns : [];
      const handoverNotes = Array.isArray(data.handoverNotes) ? data.handoverNotes : Array.isArray(data.handover_notes) ? data.handover_notes : [];
      const categoryIds = new Set(categories.map((c) => Number(c?.id)).filter((id) => Number.isInteger(id) && id > 0));
      const userIds = new Set(users.map((u) => Number(u?.id)).filter((id) => Number.isInteger(id) && id > 0));
      const customerIds = new Set(customers.map((c) => Number(c?.id)).filter((id) => Number.isInteger(id) && id > 0));
      const productIds = new Set(products.map((p) => Number(p?.id)).filter((id) => Number.isInteger(id) && id > 0));
      const saleIds = new Set(sales.map((s) => Number(s?.id)).filter((id) => Number.isInteger(id) && id > 0));
      const barcodeCounts = /* @__PURE__ */ new Map();
      products.forEach((p) => {
        const barcode = String(p?.barcode || "").trim();
        if (!barcode) return;
        barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
      });
      const duplicateBarcodes = Array.from(barcodeCounts.entries()).filter(([, count]) => count > 1).map(([barcode, count]) => ({ barcode, count }));
      const missingCategoryRefs = products.filter((p) => {
        const categoryId = Number(p?.category_id);
        return Number.isInteger(categoryId) && categoryId > 0 && !categoryIds.has(categoryId);
      }).length;
      const missingSaleUserRefs = sales.filter((s) => {
        const userId = Number(s?.user_id);
        return Number.isInteger(userId) && userId > 0 && !userIds.has(userId);
      }).length;
      const missingSaleCustomerRefs = sales.filter((s) => {
        const customerId = Number(s?.customer_id);
        return Number.isInteger(customerId) && customerId > 0 && !customerIds.has(customerId);
      }).length;
      const missingSaleItemSaleRefs = saleItems.filter((si) => {
        const saleId = Number(si?.sale_id);
        return Number.isInteger(saleId) && saleId > 0 && !saleIds.has(saleId);
      }).length;
      const missingSaleItemProductRefs = saleItems.filter((si) => {
        const productId = Number(si?.product_id);
        return Number.isInteger(productId) && productId > 0 && !productIds.has(productId);
      }).length;
      const booleanInIntegerFields = {
        storeFlags: ["show_store_name_on_documents", "tax_enabled", "receipt_show_bank_details", "default_missing_cost_to_price", "pin_checkout_enabled", "chat_cleanup_reminders_enabled"].filter((field) => typeof data?.store?.[field] === "boolean").length,
        saleLedgerLocks: sales.filter((s) => typeof s?.is_ledger_locked === "boolean").length,
        returnRestockFlags: salesReturns.filter((entry) => typeof entry?.restock_items === "boolean").length,
        handoverPinnedFlags: handoverNotes.filter((entry) => typeof entry?.is_pinned === "boolean").length
      };
      const warnings = [];
      if (duplicateBarcodes.length > 0) warnings.push(`Duplicate barcode values found (${duplicateBarcodes.length}).`);
      if (missingCategoryRefs > 0) warnings.push(`Products referencing missing categories (${missingCategoryRefs}).`);
      if (missingSaleUserRefs > 0) warnings.push(`Sales referencing missing users (${missingSaleUserRefs}).`);
      if (missingSaleCustomerRefs > 0) warnings.push(`Sales referencing missing customers (${missingSaleCustomerRefs}).`);
      if (missingSaleItemSaleRefs > 0 || missingSaleItemProductRefs > 0) {
        warnings.push(`Sale items with broken sale/product references (${missingSaleItemSaleRefs + missingSaleItemProductRefs}).`);
      }
      const booleanTypeMismatches = Object.values(booleanInIntegerFields).reduce((sum, value) => sum + Number(value || 0), 0);
      if (booleanTypeMismatches > 0) warnings.push(`Boolean values found in integer-backed fields (${booleanTypeMismatches}); import will normalize them.`);
      res.json({
        ok: true,
        summary: {
          stores: data?.store ? 1 : 0,
          users: users.length,
          categories: categories.length,
          products: products.length,
          customers: customers.length,
          sales: sales.length,
          saleItems: saleItems.length,
          salesReturns: salesReturns.length
        },
        warnings,
        diagnostics: {
          duplicateBarcodes: duplicateBarcodes.slice(0, 8),
          missingCategoryRefs,
          missingSaleUserRefs,
          missingSaleCustomerRefs,
          missingSaleItemSaleRefs,
          missingSaleItemProductRefs,
          booleanInIntegerFields
        }
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Precheck failed" });
    }
  });
  app2.post("/api/admin/store/retention/preview", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);
      const predicates = {
        sales: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso),
        expenses: retentionPredicate("spent_at", windowRange.fromIso, windowRange.toIso),
        stockAdjustments: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        messages: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        handover: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        attendance: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        repairs: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        collections: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        logs: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso),
        activityLogs: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        proformas: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        holds: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso)
      };
      const salesRows = await postgresPool2.query(`SELECT id FROM sales WHERE store_id = $1 AND ${predicates.sales.sql}`, [storeId, ...predicates.sales.params]);
      const saleIds = salesRows.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
      const [
        saleItemsCount,
        vendorPayablesCount,
        returnsCount,
        flagsCount,
        expensesCount,
        stockAdjustmentsCount,
        messagesCount,
        handoverCount,
        attendanceCount,
        repairsCount,
        collectionsCount,
        systemLogsCount,
        activityLogsCount,
        proformasCount,
        holdsCount
      ] = await Promise.all([
        saleIds.length > 0 ? postgresPool2.query("SELECT COUNT(*)::int AS count FROM sale_items WHERE sale_id = ANY($1::int[])", [saleIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
        saleIds.length > 0 ? postgresPool2.query("SELECT COUNT(*)::int AS count FROM vendor_payables WHERE sale_id = ANY($1::int[])", [saleIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
        saleIds.length > 0 ? postgresPool2.query("SELECT COUNT(*)::int AS count FROM sales_returns WHERE sale_id = ANY($1::int[])", [saleIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
        saleIds.length > 0 ? postgresPool2.query("SELECT COUNT(*)::int AS count FROM transaction_flags WHERE sale_id = ANY($1::int[])", [saleIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM expenses WHERE store_id = $1 AND ${predicates.expenses.sql}`, [storeId, ...predicates.expenses.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM stock_adjustments WHERE store_id = $1 AND ${predicates.stockAdjustments.sql}`, [storeId, ...predicates.stockAdjustments.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM internal_messages WHERE store_id = $1 AND ${predicates.messages.sql}`, [storeId, ...predicates.messages.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM handover_notes WHERE store_id = $1 AND ${predicates.handover.sql}`, [storeId, ...predicates.handover.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM staff_attendance WHERE store_id = $1 AND ${predicates.attendance.sql}`, [storeId, ...predicates.attendance.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM repair_tickets WHERE store_id = $1 AND ${predicates.repairs.sql}`, [storeId, ...predicates.repairs.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM market_collections WHERE store_id = $1 AND ${predicates.collections.sql}`, [storeId, ...predicates.collections.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM system_logs WHERE store_id = $1 AND ${predicates.logs.sql}`, [storeId, ...predicates.logs.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM system_activity_logs WHERE store_id = $1 AND ${predicates.activityLogs.sql}`, [storeId, ...predicates.activityLogs.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM pro_formas WHERE store_id = $1 AND ${predicates.proformas.sql}`, [storeId, ...predicates.proformas.params]),
        postgresPool2.query(`SELECT COUNT(*)::int AS count FROM active_holds WHERE store_id = $1 AND ${predicates.holds.sql}`, [storeId, ...predicates.holds.params])
      ]);
      const counts = {
        sales: saleIds.length,
        sale_items: Number(saleItemsCount.rows[0]?.count || 0) || 0,
        vendor_payables: Number(vendorPayablesCount.rows[0]?.count || 0) || 0,
        sales_returns: Number(returnsCount.rows[0]?.count || 0) || 0,
        transaction_flags: Number(flagsCount.rows[0]?.count || 0) || 0,
        expenses: Number(expensesCount.rows[0]?.count || 0) || 0,
        stock_adjustments: Number(stockAdjustmentsCount.rows[0]?.count || 0) || 0,
        internal_messages: Number(messagesCount.rows[0]?.count || 0) || 0,
        handover_notes: Number(handoverCount.rows[0]?.count || 0) || 0,
        staff_attendance: Number(attendanceCount.rows[0]?.count || 0) || 0,
        repair_tickets: Number(repairsCount.rows[0]?.count || 0) || 0,
        market_collections: Number(collectionsCount.rows[0]?.count || 0) || 0,
        system_logs: Number(systemLogsCount.rows[0]?.count || 0) || 0,
        system_activity_logs: Number(activityLogsCount.rows[0]?.count || 0) || 0,
        pro_formas: Number(proformasCount.rows[0]?.count || 0) || 0,
        active_holds: Number(holdsCount.rows[0]?.count || 0) || 0
      };
      const totalRows = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
      res.json({
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso
        },
        counts,
        totalRows
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || "Failed to preview retention cleanup" });
    }
  });
  app2.post("/api/admin/store/retention/activity-summary", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);
      const salesPredicate = retentionPredicate("s.timestamp", windowRange.fromIso, windowRange.toIso);
      const expensePredicate = retentionPredicate("spent_at", windowRange.fromIso, windowRange.toIso);
      const [storeRowResult, salesSummaryResult, expenseSummaryResult, topProductsResult, topStaffResult] = await Promise.all([
        postgresPool2.query("SELECT id, name, address, phone FROM stores WHERE id = $1 LIMIT 1", [storeId]),
        postgresPool2.query(`
          SELECT
            COUNT(*)::int AS sales_count,
            COALESCE(SUM(s.total), 0)::numeric AS sales_total,
            COALESCE(SUM(s.discount_amount), 0)::numeric AS discount_total,
            COALESCE(SUM(s.tax_amount), 0)::numeric AS tax_total
          FROM sales s
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
        `, [storeId, ...salesPredicate.params]),
        postgresPool2.query(`
          SELECT
            COUNT(*)::int AS expense_count,
            COALESCE(SUM(amount), 0)::numeric AS expense_total
          FROM expenses
          WHERE store_id = $1
            AND ${expensePredicate.sql}
        `, [storeId, ...expensePredicate.params]),
        postgresPool2.query(`
          SELECT p.name, SUM(si.quantity)::int AS quantity, COALESCE(SUM(si.subtotal), 0)::numeric AS revenue
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
          GROUP BY p.name
          ORDER BY quantity DESC, revenue DESC
          LIMIT 10
        `, [storeId, ...salesPredicate.params]),
        postgresPool2.query(`
          SELECT COALESCE(u.username, 'Unknown') AS username, COUNT(*)::int AS sales_count, COALESCE(SUM(s.total), 0)::numeric AS sales_total
          FROM sales s
          LEFT JOIN users u ON u.id = s.user_id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
          GROUP BY COALESCE(u.username, 'Unknown')
          ORDER BY sales_count DESC, sales_total DESC
          LIMIT 10
        `, [storeId, ...salesPredicate.params])
      ]);
      const normalizedTopProducts = (topProductsResult.rows || []).map((row) => {
        const rawName = String(row?.name || "").trim();
        const normalizedName = rawName === "__SOURCED_PLACEHOLDER__" ? "Sourced Item" : rawName === "__CONSIGNMENT_PLACEHOLDER__" ? "Consignment Item" : rawName;
        return {
          ...row,
          name: normalizedName || "Product"
        };
      });
      res.json({
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso
        },
        store: storeRowResult.rows[0] || null,
        totals: {
          sales_count: Number(salesSummaryResult.rows[0]?.sales_count || 0) || 0,
          sales_total: Number(salesSummaryResult.rows[0]?.sales_total || 0) || 0,
          discount_total: Number(salesSummaryResult.rows[0]?.discount_total || 0) || 0,
          tax_total: Number(salesSummaryResult.rows[0]?.tax_total || 0) || 0,
          expense_count: Number(expenseSummaryResult.rows[0]?.expense_count || 0) || 0,
          expense_total: Number(expenseSummaryResult.rows[0]?.expense_total || 0) || 0
        },
        topProducts: normalizedTopProducts,
        topStaff: topStaffResult.rows
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || "Failed to build retention activity summary" });
    }
  });
  app2.post("/api/admin/store/retention/delete", authenticate2, authorize2(["SYSTEM_ADMIN", "STORE_ADMIN"]), async (req, res) => {
    const backupDownloaded = req.body?.backupDownloaded === true;
    const reportDownloaded = req.body?.reportDownloaded === true;
    const confirmationText = String(req.body?.confirmationText || "").trim().toUpperCase();
    if (!backupDownloaded || !reportDownloaded) {
      return res.status(400).json({ error: "Download JSON backup and activity PDF before deletion." });
    }
    if (confirmationText !== "DELETE STORE DATA") {
      return res.status(400).json({ error: "Confirmation text mismatch. Type DELETE STORE DATA to continue." });
    }
    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);
      const predicates = {
        sales: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso),
        expenses: retentionPredicate("spent_at", windowRange.fromIso, windowRange.toIso),
        stockAdjustments: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        messages: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        handover: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        attendance: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        repairs: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        collections: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        logs: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso),
        activityLogs: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        proformas: retentionPredicate("created_at", windowRange.fromIso, windowRange.toIso),
        holds: retentionPredicate("timestamp", windowRange.fromIso, windowRange.toIso)
      };
      const deletedCounts = {};
      await postgresPool2.query("BEGIN");
      try {
        const salesRows = await postgresPool2.query(`SELECT id FROM sales WHERE store_id = $1 AND ${predicates.sales.sql}`, [storeId, ...predicates.sales.params]);
        const saleIds = salesRows.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
        if (saleIds.length > 0) {
          const deleteFlags = await postgresPool2.query("DELETE FROM transaction_flags WHERE sale_id = ANY($1::int[])", [saleIds]);
          const deleteReturns = await postgresPool2.query("DELETE FROM sales_returns WHERE sale_id = ANY($1::int[])", [saleIds]);
          const deletePayables = await postgresPool2.query("DELETE FROM vendor_payables WHERE sale_id = ANY($1::int[])", [saleIds]);
          const deleteItems = await postgresPool2.query("DELETE FROM sale_items WHERE sale_id = ANY($1::int[])", [saleIds]);
          const deleteSales = await postgresPool2.query("DELETE FROM sales WHERE id = ANY($1::int[])", [saleIds]);
          deletedCounts.transaction_flags = deleteFlags.rowCount || 0;
          deletedCounts.sales_returns = deleteReturns.rowCount || 0;
          deletedCounts.vendor_payables = deletePayables.rowCount || 0;
          deletedCounts.sale_items = deleteItems.rowCount || 0;
          deletedCounts.sales = deleteSales.rowCount || 0;
        } else {
          deletedCounts.transaction_flags = 0;
          deletedCounts.sales_returns = 0;
          deletedCounts.vendor_payables = 0;
          deletedCounts.sale_items = 0;
          deletedCounts.sales = 0;
        }
        const deleteExpenses = await postgresPool2.query(`DELETE FROM expenses WHERE store_id = $1 AND ${predicates.expenses.sql}`, [storeId, ...predicates.expenses.params]);
        const deleteStockAdjustments = await postgresPool2.query(`DELETE FROM stock_adjustments WHERE store_id = $1 AND ${predicates.stockAdjustments.sql}`, [storeId, ...predicates.stockAdjustments.params]);
        const deleteMessages = await postgresPool2.query(`DELETE FROM internal_messages WHERE store_id = $1 AND ${predicates.messages.sql}`, [storeId, ...predicates.messages.params]);
        const deleteHandover = await postgresPool2.query(`DELETE FROM handover_notes WHERE store_id = $1 AND ${predicates.handover.sql}`, [storeId, ...predicates.handover.params]);
        const deleteAttendance = await postgresPool2.query(`DELETE FROM staff_attendance WHERE store_id = $1 AND ${predicates.attendance.sql}`, [storeId, ...predicates.attendance.params]);
        const deleteRepairs = await postgresPool2.query(`DELETE FROM repair_tickets WHERE store_id = $1 AND ${predicates.repairs.sql}`, [storeId, ...predicates.repairs.params]);
        const deleteCollections = await postgresPool2.query(`DELETE FROM market_collections WHERE store_id = $1 AND ${predicates.collections.sql}`, [storeId, ...predicates.collections.params]);
        const deleteSystemLogs = await postgresPool2.query(`DELETE FROM system_logs WHERE store_id = $1 AND ${predicates.logs.sql}`, [storeId, ...predicates.logs.params]);
        const deleteActivityLogs = await postgresPool2.query(`DELETE FROM system_activity_logs WHERE store_id = $1 AND ${predicates.activityLogs.sql}`, [storeId, ...predicates.activityLogs.params]);
        const deleteProformas = await postgresPool2.query(`DELETE FROM pro_formas WHERE store_id = $1 AND ${predicates.proformas.sql}`, [storeId, ...predicates.proformas.params]);
        const deleteHolds = await postgresPool2.query(`DELETE FROM active_holds WHERE store_id = $1 AND ${predicates.holds.sql}`, [storeId, ...predicates.holds.params]);
        deletedCounts.expenses = deleteExpenses.rowCount || 0;
        deletedCounts.stock_adjustments = deleteStockAdjustments.rowCount || 0;
        deletedCounts.internal_messages = deleteMessages.rowCount || 0;
        deletedCounts.handover_notes = deleteHandover.rowCount || 0;
        deletedCounts.staff_attendance = deleteAttendance.rowCount || 0;
        deletedCounts.repair_tickets = deleteRepairs.rowCount || 0;
        deletedCounts.market_collections = deleteCollections.rowCount || 0;
        deletedCounts.system_logs = deleteSystemLogs.rowCount || 0;
        deletedCounts.system_activity_logs = deleteActivityLogs.rowCount || 0;
        deletedCounts.pro_formas = deleteProformas.rowCount || 0;
        deletedCounts.active_holds = deleteHolds.rowCount || 0;
        await postgresPool2.query("COMMIT");
      } catch (deleteErr) {
        await postgresPool2.query("ROLLBACK");
        throw deleteErr;
      }
      const totalDeleted = Object.values(deletedCounts).reduce((sum, value) => sum + Number(value || 0), 0);
      await logAuditEvent2({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: "DELETE",
        description: `${getAuditActorLabel2(req.user.role)} ${req.user.username} deleted store activity data (${windowRange.label}).`,
        newValue: {
          mode: windowRange.mode,
          from: windowRange.fromIso,
          to: windowRange.toIso,
          deletedCounts,
          totalDeleted
        }
      });
      res.json({
        success: true,
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso
        },
        deletedCounts,
        totalDeleted
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || "Failed to delete retention data" });
    }
  });
  app2.get("/api/customers", authenticate2, async (req, res) => {
    try {
      const customers = await coreReadRepository2.listCustomers(Number(req.user.store_id), "name");
      res.json(customers);
    } catch (err) {
      console.error("Customers read error:", err);
      res.status(500).json({ error: err.message || "Failed to load customers" });
    }
  });
  app2.get("/api/customers/search", authenticate2, async (req, res) => {
    const normalizedPhone = normalizePhone4(req.query.phone);
    if (!normalizedPhone) return res.status(400).json({ error: "Phone number required" });
    try {
      const customers = await coreReadRepository2.listCustomers(Number(req.user.store_id), "created_desc");
      const customer = customers.find((entry) => normalizePhone4(entry.phone) === normalizedPhone);
      res.json(customer || null);
    } catch (err) {
      console.error("Customer search error:", err);
      res.status(500).json({ error: err.message || "Failed to search customers" });
    }
  });
  app2.get("/api/customers/phone-suggestions", authenticate2, async (req, res) => {
    const normalizedPrefix = normalizePhone4(req.query.prefix);
    if (!normalizedPrefix || normalizedPrefix.length < 5) return res.json([]);
    try {
      const suggestions = (await coreReadRepository2.listCustomers(Number(req.user.store_id), "created_desc")).map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone })).filter((customer) => normalizePhone4(customer.phone).startsWith(normalizedPrefix)).slice(0, 10);
      res.json(suggestions);
    } catch (err) {
      console.error("Customer phone suggestions error:", err);
      res.status(500).json({ error: err.message || "Failed to load phone suggestions" });
    }
  });
  app2.post("/api/customers", authenticate2, checkStoreLock2, async (req, res) => {
    const { name, phone, address } = req.body;
    const rawPhone = String(phone ?? "").trim();
    const normalizedPhone = normalizePhone4(rawPhone);
    const storedPhone = normalizeStoredPhone2(rawPhone);
    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: "Customer name required (max 255 chars)" });
    }
    if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({ error: "Phone number required (7-15 digits)" });
    }
    if (address && address.length > 500) {
      return res.status(400).json({ error: "Address too long (max 500 chars)" });
    }
    try {
      const existingCustomers = await coreReadRepository2.listCustomers(Number(req.user.store_id), "created_desc");
      const existingCustomer = existingCustomers.find((customer2) => normalizePhone4(customer2.phone) === normalizedPhone);
      if (existingCustomer) {
        return res.status(400).json({ error: "A customer with this phone number already exists" });
      }
      let customerCode = "";
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 10) {
        customerCode = Math.floor(1e5 + Math.random() * 9e5).toString();
        const existing = (await postgresPool2.query("SELECT id FROM customers WHERE customer_code = $1", [customerCode])).rows[0];
        if (!existing) isUnique = true;
        attempts += 1;
      }
      if (!isUnique) {
        return res.status(500).json({ error: "Failed to generate unique customer code" });
      }
      const customer = await coreWriteRepository2.createCustomer({
        storeId: Number(req.user.store_id),
        name: String(name).trim(),
        phone: storedPhone,
        address: address || null,
        customerCode
      });
      res.json({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        customer_code: customer.customer_code
      });
    } catch (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "A customer with this phone number already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });
  app2.put("/api/customers/:id", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const customerId = Number(req.params.id);
    const storeId = Number(req.user.store_id);
    const { name, phone, address } = req.body ?? {};
    const rawPhone = String(phone ?? "").trim();
    const normalizedPhone = normalizePhone4(rawPhone);
    const storedPhone = normalizeStoredPhone2(rawPhone);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "Invalid customer id" });
    }
    if (!String(name || "").trim() || String(name || "").trim().length > 255) {
      return res.status(400).json({ error: "Customer name required (max 255 chars)" });
    }
    if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({ error: "Phone number required (7-15 digits)" });
    }
    if (address && String(address).length > 500) {
      return res.status(400).json({ error: "Address too long (max 500 chars)" });
    }
    try {
      const updatedCustomer = await coreWriteRepository2.updateCustomer({
        storeId,
        customerId,
        name: String(name).trim(),
        phone: storedPhone,
        address: String(address ?? "").trim() || null
      });
      res.json({
        id: updatedCustomer?.id,
        name: updatedCustomer?.name,
        phone: updatedCustomer?.phone,
        address: updatedCustomer?.address,
        customer_code: updatedCustomer?.customer_code
      });
    } catch (err) {
      const message = String(err?.message || "Failed to update customer");
      if (message.includes("Customer not found")) {
        return res.status(404).json({ error: message });
      }
      if (message.includes("already exists") || message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "A customer with this phone number already exists" });
      }
      console.error("Customer update error:", err);
      res.status(500).json({ error: message });
    }
  });
  app2.delete("/api/customers/:id", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const customerId = Number(req.params.id);
    const storeId = Number(req.user.store_id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "Invalid customer id" });
    }
    try {
      const result = await coreWriteRepository2.deleteCustomer({ storeId, customerId });
      res.json(result);
    } catch (err) {
      const message = String(err?.message || "Failed to delete customer");
      if (message.includes("Customer not found")) {
        return res.status(404).json({ error: message });
      }
      if (message.includes("invoice history")) {
        return res.status(400).json({ error: message });
      }
      console.error("Customer delete error:", err);
      res.status(500).json({ error: message });
    }
  });
  app2.get("/api/customers/stats", authenticate2, async (req, res) => {
    try {
      const stats = await coreReadRepository2.getCustomerStats(Number(req.user.store_id));
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load customer stats" });
    }
  });
  app2.get("/api/customers/:id/invoices", authenticate2, async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const customerId = Number(req.params.id);
      const { customer, sales } = await coreReadRepository2.getCustomerInvoices(storeId, customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const invoices = await Promise.all(sales.map(async (sale) => ({
        ...await formatSaleResponse2(sale),
        items: await coreReadRepository2.getSaleItemsForInvoice(Number(sale.id))
      })));
      res.json({
        customer,
        invoices
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load customer invoices" });
    }
  });
  app2.get("/api/reports/z-report", authenticate2, async (req, res) => {
    try {
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const sales = await coreReadRepository2.listZReportSales(Number(req.user.store_id), today);
      const summary = sales.reduce((acc, sale) => {
        const pm = safeJsonParse6(sale.payment_methods, {});
        acc.cash += Number(pm?.cash || 0) || 0;
        acc.transfer += Number(pm?.transfer || 0) || 0;
        acc.pos += Number(pm?.pos || 0) || 0;
        acc.total += Number(sale.total || 0) || 0;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0 });
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load z-report" });
    }
  });
  app2.get("/api/reports/my-sales-chart", authenticate2, async (req, res) => {
    try {
      const userId = Number(req.user.id);
      const storeId = Number(req.user.store_id);
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      const toDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const selectedDate = toDateKey(today);
      const startDateObj = new Date(today);
      startDateObj.setDate(startDateObj.getDate() - 6);
      const startDate = toDateKey(startDateObj);
      const { salesRows } = await coreReadRepository2.getMySalesChartData(storeId, userId, startDate, selectedDate);
      const todaySales = salesRows.filter((sale) => String(sale.sale_date) === selectedDate);
      const summary = todaySales.reduce((acc, sale) => {
        const pm = safeJsonParse6(sale.payment_methods, {});
        acc.cash += Number(pm?.cash) || 0;
        acc.transfer += Number(pm?.transfer) || 0;
        acc.pos += Number(pm?.pos) || 0;
        acc.total += Number(sale.total) || 0;
        acc.count += 1;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0, count: 0 });
      const trendMap = /* @__PURE__ */ new Map();
      for (const row of salesRows) {
        const key = String(row.sale_date || "");
        const current = trendMap.get(key) || { sales_count: 0, total: 0 };
        current.sales_count += 1;
        current.total += Number(row.total) || 0;
        trendMap.set(key, current);
      }
      const trend = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(startDateObj);
        date.setDate(startDateObj.getDate() + index);
        const key = toDateKey(date);
        const existing = trendMap.get(key);
        return {
          date: key,
          label: date.toLocaleDateString("en-US", { weekday: "short" }),
          total: Number(existing?.total) || 0,
          count: Number(existing?.sales_count) || 0
        };
      });
      res.json({
        ...summary,
        trend
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load staff sales chart" });
    }
  });
  app2.get("/api/reports/financial-ledger", authenticate2, authorize2(["STORE_ADMIN", "SYSTEM_ADMIN", "ACCOUNTANT"]), async (req, res) => {
    try {
      const storeId = Number(req.user.role === "SYSTEM_ADMIN" ? req.query.storeId || req.user.store_id : req.user.store_id);
      const period = String(req.query.period || "daily").trim().toLowerCase() === "monthly" ? "monthly" : "daily";
      const requestedFrom = String(req.query.from || "").trim();
      const requestedTo = String(req.query.to || "").trim();
      const today = /* @__PURE__ */ new Date();
      const defaultFromDate = /* @__PURE__ */ new Date();
      defaultFromDate.setDate(today.getDate() - 29);
      const toDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const from = /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom) ? requestedFrom : toDateKey(defaultFromDate);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(requestedTo) ? requestedTo : toDateKey(today);
      const { storeSettings, rows, totalExpenses } = await coreReadRepository2.getFinancialLedgerData(storeId, from, to);
      const costFallbackEnabled = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;
      const buckets = /* @__PURE__ */ new Map();
      const getBucket = (timestamp) => {
        const date = new Date(String(timestamp || (/* @__PURE__ */ new Date()).toISOString()));
        const key = period === "monthly" ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : toDateKey(date);
        if (!buckets.has(key)) {
          buckets.set(key, {
            key,
            label: period === "monthly" ? date.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            totalSales: 0,
            totalCost: 0,
            totalDiscounts: 0,
            taxCollected: 0,
            cashTotal: 0,
            transferTotal: 0,
            moniepointTotal: 0,
            seenSales: /* @__PURE__ */ new Set()
          });
        }
        return buckets.get(key);
      };
      rows.forEach((row) => {
        const bucket = getBucket(String(row.timestamp || (/* @__PURE__ */ new Date()).toISOString()));
        const saleId = Number(row.sale_id) || 0;
        if (saleId > 0 && !bucket.seenSales.has(saleId)) {
          bucket.seenSales.add(saleId);
          bucket.totalSales += Number(row.total || 0) || 0;
          bucket.totalDiscounts += Number(row.discount_amount || 0) || 0;
          bucket.taxCollected += Number(row.tax_amount || 0) || 0;
          const methods = safeJsonParse6(row.payment_methods, {});
          bucket.cashTotal += Number(methods?.cash || 0) || 0;
          bucket.transferTotal += Number(methods?.transfer || 0) || 0;
          bucket.moniepointTotal += Number(methods?.pos || 0) || 0;
        }
        const quantity = Math.max(0, Number(row.quantity) || 0);
        if (!quantity) {
          return;
        }
        const sellingPrice = Math.max(0, Number(row.price_at_sale || 0));
        const explicitCostAtSale = toFiniteNumberOrNull6(row.cost_at_sale);
        let resolvedCost = null;
        if (explicitCostAtSale != null && (explicitCostAtSale > 0 || sellingPrice <= 0)) {
          resolvedCost = explicitCostAtSale;
        } else {
          const resolved = resolveTrackedCost5({
            product: {
              cost: row.product_cost,
              price: row.product_price,
              condition_matrix: row.condition_matrix
            },
            condition: row.condition,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled
          });
          resolvedCost = resolved.cost;
        }
        bucket.totalCost += (Number(resolvedCost || 0) || 0) * quantity;
      });
      const ledger = Array.from(buckets.values()).sort((a, b) => String(a.key).localeCompare(String(b.key))).map((bucket) => {
        const businessRevenue = Number((bucket.totalSales - bucket.taxCollected).toFixed(2)) || 0;
        return {
          date: bucket.key,
          label: bucket.label,
          totalSales: Number(bucket.totalSales.toFixed(2)) || 0,
          totalCost: Number(bucket.totalCost.toFixed(2)) || 0,
          totalDiscounts: Number(bucket.totalDiscounts.toFixed(2)) || 0,
          netProfit: Number((businessRevenue - bucket.totalCost).toFixed(2)) || 0,
          moniepointTotal: Number(bucket.moniepointTotal.toFixed(2)) || 0,
          cashTotal: Number(bucket.cashTotal.toFixed(2)) || 0,
          transferTotal: Number(bucket.transferTotal.toFixed(2)) || 0,
          taxCollected: Number(bucket.taxCollected.toFixed(2)) || 0,
          businessRevenue,
          transactionCount: bucket.seenSales.size
        };
      });
      const summary = ledger.reduce((acc, row) => {
        acc.totalSales += Number(row.totalSales || 0);
        acc.totalCost += Number(row.totalCost || 0);
        acc.totalDiscounts += Number(row.totalDiscounts || 0);
        acc.netProfit += Number(row.netProfit || 0);
        acc.cashTotal += Number(row.cashTotal || 0);
        acc.moniepointTotal += Number(row.moniepointTotal || 0);
        acc.transferTotal += Number(row.transferTotal || 0);
        acc.taxCollected += Number(row.taxCollected || 0);
        acc.businessRevenue += Number(row.businessRevenue || 0);
        acc.transactionCount += Number(row.transactionCount || 0);
        return acc;
      }, {
        totalSales: 0,
        totalCost: 0,
        totalDiscounts: 0,
        netProfit: 0,
        cashTotal: 0,
        moniepointTotal: 0,
        transferTotal: 0,
        taxCollected: 0,
        businessRevenue: 0,
        transactionCount: 0
      });
      summary.totalExpenses = Number(totalExpenses.toFixed(2)) || 0;
      summary.trueNetProfit = Number((summary.netProfit - summary.totalExpenses).toFixed(2)) || 0;
      res.json({
        period,
        from,
        to,
        vatEnabled: Number(storeSettings?.tax_enabled || 0) === 1,
        vatPercentage: Number(storeSettings?.tax_percentage || 0) || 0,
        ledger,
        summary
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load financial ledger" });
    }
  });
  app2.get("/api/reports/staff-sales-chart", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const requestedDate = String(req.query.date || "");
      const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const selectedDateObj = /* @__PURE__ */ new Date(`${selectedDate}T00:00:00`);
      if (Number.isNaN(selectedDateObj.getTime())) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      }
      const startDateObj = new Date(selectedDateObj);
      startDateObj.setDate(startDateObj.getDate() - (days - 1));
      const toDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const startDate = toDateKey(startDateObj);
      const { staffUsers, salesRows } = await coreReadRepository2.getStaffSalesChartData(storeId, startDate, selectedDate);
      const selectedMap = /* @__PURE__ */ new Map();
      const trendMap = /* @__PURE__ */ new Map();
      for (const row of salesRows) {
        const rowUserId = Number(row.user_id) || 0;
        const rowDate = String(row.sale_date || "");
        const rowTotal = Number(row.total) || 0;
        const methods = safeJsonParse6(row.payment_methods, {});
        const trendKey = `${rowUserId}:${rowDate}`;
        const existingTrend = trendMap.get(trendKey) || { sales_count: 0, total: 0 };
        existingTrend.sales_count += 1;
        existingTrend.total += rowTotal;
        trendMap.set(trendKey, existingTrend);
        if (rowDate === selectedDate) {
          const existingSelected = selectedMap.get(rowUserId) || { sales_count: 0, total: 0, cash: 0, transfer: 0, pos: 0 };
          existingSelected.sales_count += 1;
          existingSelected.total += rowTotal;
          existingSelected.cash += Number(methods?.cash) || 0;
          existingSelected.transfer += Number(methods?.transfer) || 0;
          existingSelected.pos += Number(methods?.pos) || 0;
          selectedMap.set(rowUserId, existingSelected);
        }
      }
      const staff = staffUsers.map((member) => {
        const daily = selectedMap.get(Number(member.id));
        const trend = Array.from({ length: days }, (_, index) => {
          const date = new Date(startDateObj);
          date.setDate(startDateObj.getDate() + index);
          const key = toDateKey(date);
          const point = trendMap.get(`${member.id}:${key}`);
          return {
            date: key,
            label: date.toLocaleDateString("en-US", { weekday: "short" }),
            total: Number(point?.total) || 0,
            count: Number(point?.sales_count) || 0
          };
        });
        return {
          id: member.id,
          username: member.username,
          role: member.role,
          selectedDateTotal: Number(daily?.total) || 0,
          selectedDateCount: Number(daily?.sales_count) || 0,
          cash: Number(daily?.cash) || 0,
          transfer: Number(daily?.transfer) || 0,
          pos: Number(daily?.pos) || 0,
          trend
        };
      }).sort((a, b) => b.selectedDateTotal - a.selectedDateTotal || a.username.localeCompare(b.username));
      const summary = staff.reduce((acc, member) => {
        acc.total += member.selectedDateTotal;
        acc.count += member.selectedDateCount;
        if (member.selectedDateCount > 0) {
          acc.activeStaff += 1;
        }
        return acc;
      }, { total: 0, count: 0, activeStaff: 0 });
      res.json({ selectedDate, days, summary, staff });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load staff sales chart" });
    }
  });
  app2.get("/api/reports/staff-sales-history/:userId", authenticate2, authorize2(["STORE_ADMIN", "MANAGER", "ACCOUNTANT"]), async (req, res) => {
    try {
      const storeId = Number(req.user.store_id);
      const userId = Number(req.params.userId);
      const requestedDate = String(req.query.date || "");
      const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid team member user id" });
      }
      const selectedDateObj = /* @__PURE__ */ new Date(`${selectedDate}T00:00:00`);
      if (Number.isNaN(selectedDateObj.getTime())) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      }
      const startDateObj = new Date(selectedDateObj);
      startDateObj.setDate(startDateObj.getDate() - (days - 1));
      const toDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const startDate = toDateKey(startDateObj);
      const { member, salesRows, recentSales } = await coreReadRepository2.getStaffSalesHistoryData(storeId, userId, selectedDate, startDate, limit);
      if (!member) {
        return res.status(404).json({ error: "Team member not found" });
      }
      const selectedSales = salesRows.filter((sale) => String(sale.sale_date) === selectedDate);
      const summary = selectedSales.reduce((acc, sale) => {
        const pm = safeJsonParse6(sale.payment_methods, {});
        acc.cash += Number(pm?.cash) || 0;
        acc.transfer += Number(pm?.transfer) || 0;
        acc.pos += Number(pm?.pos) || 0;
        acc.total += Number(sale.total) || 0;
        acc.count += 1;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0, count: 0 });
      const trendMap = /* @__PURE__ */ new Map();
      for (const row of salesRows) {
        const rowDate = String(row.sale_date || "");
        const current = trendMap.get(rowDate) || { sales_count: 0, total: 0 };
        current.sales_count += 1;
        current.total += Number(row.total) || 0;
        trendMap.set(rowDate, current);
      }
      const trend = Array.from({ length: days }, (_, index) => {
        const date = new Date(startDateObj);
        date.setDate(startDateObj.getDate() + index);
        const key = toDateKey(date);
        const point = trendMap.get(key);
        return {
          date: key,
          label: date.toLocaleDateString("en-US", { weekday: "short" }),
          total: Number(point?.total) || 0,
          count: Number(point?.sales_count) || 0
        };
      });
      res.json({
        staff: member,
        selectedDate,
        days,
        summary,
        trend,
        sales: await Promise.all(recentSales.map((sale) => formatSaleResponse2(sale)))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load staff sales history" });
    }
  });
  app2.get("/api/analytics", authenticate2, async (req, res) => {
    const store_id = req.user.store_id;
    try {
      const storeSettings = (await postgresPool2.query(`
        SELECT COALESCE(default_missing_cost_to_price, 0) as default_missing_cost_to_price
        FROM stores
        WHERE id = $1
      `, [store_id])).rows[0];
      const costFallbackEnabled = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;
      const missingCostRegistry = /* @__PURE__ */ new Map();
      const registerMissingCost = ({
        productId,
        name,
        condition,
        stockUnits = 0,
        soldUnits = 0,
        price = 0,
        basePrice = 0,
        conditionMatrix = null
      }) => {
        const normalizedCondition = String(condition || "STANDARD").replace(/_/g, " ").toUpperCase();
        const key = `${productId}:${normalizedCondition}`;
        const current = missingCostRegistry.get(key) || {
          id: productId,
          name,
          condition: normalizedCondition,
          stockUnits: 0,
          soldUnits: 0,
          price: 0,
          basePrice: 0,
          conditionMatrix: null
        };
        current.stockUnits += Math.max(0, Number(stockUnits) || 0);
        current.soldUnits += Math.max(0, Number(soldUnits) || 0);
        current.price = Math.max(Number(current.price || 0) || 0, Math.max(0, Number(price) || 0));
        current.basePrice = Math.max(Number(current.basePrice || 0) || 0, Math.max(0, Number(basePrice) || 0));
        current.conditionMatrix = current.conditionMatrix || conditionMatrix;
        missingCostRegistry.set(key, current);
      };
      const products = (await postgresPool2.query(`
        SELECT p.id, p.name, p.stock, CAST(p.cost AS REAL) as cost, CAST(p.price AS REAL) as price, p.condition_matrix, COALESCE(s.mode, 'SUPERMARKET') as mode
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.store_id = $1 AND p.deleted_at IS NULL
      `, [store_id])).rows;
      let totalItems = 0;
      let totalCost = 0;
      let potentialRevenue = 0;
      for (const product of products) {
        const isGadgetMode = String(product.mode || "SUPERMARKET").toUpperCase() === "GADGET" && Boolean(product.condition_matrix);
        if (isGadgetMode) {
          const matrix = safeJsonParse6(product.condition_matrix, {});
          for (const conditionKey of ["new", "open_box", "used"]) {
            const slot = matrix?.[conditionKey] || {};
            const units = Math.max(0, Number(slot.stock || 0));
            const sellingPrice = Math.max(0, Number(slot.price ?? product.price ?? 0) || 0);
            if (units <= 0) continue;
            totalItems += units;
            potentialRevenue += sellingPrice * units;
            const resolvedCost = resolveTrackedCost5({
              product,
              condition: conditionKey,
              sellingPrice,
              fallbackToSelling: costFallbackEnabled
            });
            if (resolvedCost.cost != null) {
              totalCost += Number(resolvedCost.cost || 0) * units;
            } else if (!costFallbackEnabled) {
              registerMissingCost({
                productId: Number(product.id),
                name: String(product.name || `Product #${product.id}`),
                condition: conditionKey,
                stockUnits: units,
                price: sellingPrice,
                basePrice: Number(product.price || 0) || 0,
                conditionMatrix: product.condition_matrix
              });
            }
          }
        } else {
          const units = Math.max(0, Number(product.stock || 0));
          const sellingPrice = Math.max(0, Number(product.price || 0));
          if (units <= 0) continue;
          totalItems += units;
          potentialRevenue += sellingPrice * units;
          const resolvedCost = resolveTrackedCost5({
            product,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled
          });
          if (resolvedCost.cost != null) {
            totalCost += Number(resolvedCost.cost || 0) * units;
          } else if (!costFallbackEnabled) {
            registerMissingCost({
              productId: Number(product.id),
              name: String(product.name || `Product #${product.id}`),
              stockUnits: units,
              price: sellingPrice,
              basePrice: Number(product.price || 0) || 0,
              conditionMatrix: product.condition_matrix
            });
          }
        }
      }
      const openCollectionRows = (await postgresPool2.query(`
        SELECT *
        FROM market_collections
        WHERE store_id = $1 AND status = 'OPEN'
        ORDER BY expected_return_date ASC, created_at DESC
      `, [store_id])).rows;
      const collectionInsights = openCollectionRows.reduce((summary, row) => {
        const collection = formatMarketCollection2(row);
        summary.totalQuantity += Number(collection.total_quantity || 0);
        summary.totalValue += Number(collection.total_value || 0);
        summary.totalCost += Number(collection.total_cost || 0);
        if (collection.is_overdue) {
          summary.overdueCollections.push({
            id: Number(collection.id),
            collector_name: collection.collector_name,
            tracking_code: collection.tracking_code,
            expected_return_date: collection.expected_return_date,
            total_quantity: Number(collection.total_quantity || 0),
            total_value: Number(collection.total_value || 0)
          });
        }
        return summary;
      }, {
        totalQuantity: 0,
        totalValue: 0,
        totalCost: 0,
        overdueCollections: []
      });
      const inventoryMetrics = {
        totalItems: Math.max(totalItems, 0),
        totalCost: Math.max(totalCost + collectionInsights.totalCost, 0),
        potentialRevenue: Math.max(potentialRevenue + collectionInsights.totalValue, 0)
      };
      const saleItems = (await postgresPool2.query(`
        SELECT
          si.id,
          si.product_id,
          si.quantity,
          si.price_at_sale,
          si.cost_at_sale,
          si.condition,
          p.name as product_name,
          p.cost as product_cost,
          p.price as product_price,
          p.condition_matrix
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN products p ON si.product_id = p.id
        WHERE s.store_id = $1
          AND s.status != 'VOIDED'
          AND s.deleted_at IS NULL
      `, [store_id])).rows;
      const returnRows = (await postgresPool2.query("SELECT items FROM sales_returns WHERE store_id = $1", [store_id])).rows;
      const returnedQuantityBySaleItem = /* @__PURE__ */ new Map();
      for (const row of returnRows) {
        const items = safeJsonParse6(row?.items, []);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const saleItemId = Number(item?.sale_item_id || item?.id) || 0;
          const quantity = Math.max(0, Number(item?.quantity) || 0);
          if (!saleItemId || !quantity) continue;
          returnedQuantityBySaleItem.set(saleItemId, (returnedQuantityBySaleItem.get(saleItemId) || 0) + quantity);
        }
      }
      let grossProfit = 0;
      let netProfit = 0;
      let expensesTotal = 0;
      let netProfitAfterExpenses = 0;
      let pendingReceivables = 0;
      let pendingReceivableCount = 0;
      let topCustomers = [];
      let imeiAgingPercentage = 0;
      let trackedProfitItems = 0;
      let excludedProfitItemsCount = 0;
      let defaultedCostItemCount = 0;
      for (const row of saleItems) {
        const soldQuantity = Math.max(0, Number(row.quantity) || 0);
        const returnedQuantity = Math.min(soldQuantity, Math.max(0, Number(returnedQuantityBySaleItem.get(Number(row.id)) || 0)));
        const netSoldQuantity = soldQuantity - returnedQuantity;
        if (netSoldQuantity <= 0) continue;
        const rowConditionMatrix = safeJsonParse6(row.condition_matrix, {});
        const rowConditionKey = String(row.condition || "").toLowerCase().replace(/\s+/g, "_");
        const conditionSellingPrice = Math.max(0, Number(rowConditionMatrix?.[rowConditionKey]?.price || 0) || 0);
        const sellingPrice = Math.max(0, Number(row.price_at_sale || conditionSellingPrice || row.product_price || 0) || 0);
        const explicitCostAtSale = toFiniteNumberOrNull6(row.cost_at_sale);
        let resolvedCost = null;
        let usedSellingDefault = false;
        if (explicitCostAtSale != null && (explicitCostAtSale > 0 || sellingPrice <= 0)) {
          resolvedCost = explicitCostAtSale;
        } else {
          const resolved = resolveTrackedCost5({
            product: {
              cost: row.product_cost,
              price: row.product_price,
              condition_matrix: row.condition_matrix
            },
            condition: row.condition,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled
          });
          resolvedCost = resolved.cost;
          usedSellingDefault = resolved.usedSellingDefault;
          if (resolved.missing && !costFallbackEnabled) {
            registerMissingCost({
              productId: Number(row.product_id) || 0,
              name: String(row.product_name || `Product #${row.product_id}`),
              condition: row.condition || null,
              soldUnits: netSoldQuantity,
              price: sellingPrice,
              basePrice: Number(row.product_price || 0) || 0,
              conditionMatrix: row.condition_matrix
            });
          }
        }
        if (resolvedCost == null) {
          excludedProfitItemsCount += 1;
          continue;
        }
        if (usedSellingDefault) {
          defaultedCostItemCount += 1;
        }
        grossProfit += (sellingPrice - resolvedCost) * netSoldQuantity;
        trackedProfitItems += 1;
      }
      grossProfit = Number(grossProfit.toFixed(2)) || 0;
      netProfit = grossProfit;
      const expenseData = (await postgresPool2.query(`
        SELECT COALESCE(SUM(amount), 0) as totalExpenses
        FROM expenses
        WHERE store_id = $1
      `, [store_id])).rows[0];
      expensesTotal = Number(expenseData?.totalExpenses) || 0;
      netProfitAfterExpenses = Number((grossProfit - expensesTotal).toFixed(2)) || 0;
      const pendingReceivableRows = (await postgresPool2.query(`
        SELECT total, payment_methods
        FROM sales
        WHERE store_id = $1 AND status = 'PENDING' AND deleted_at IS NULL
      `, [store_id])).rows;
      pendingReceivableCount = pendingReceivableRows.length;
      pendingReceivables = pendingReceivableRows.reduce((sum, sale) => {
        const amountDue = Math.max(0, Number(sale?.total || 0) - getTotalPaidFromPaymentMethods3(sale?.payment_methods));
        return sum + amountDue;
      }, 0);
      if (req.user.role === "STORE_ADMIN" || req.user.role === "ACCOUNTANT") {
        topCustomers = (await postgresPool2.query(`
          SELECT c.name, SUM(s.total) as total_spend
          FROM sales s
          JOIN customers c ON s.customer_id = c.id
          WHERE s.store_id = $1 AND s.status != 'VOIDED'
          GROUP BY c.id, c.name
          ORDER BY total_spend DESC
          LIMIT 5
        `, [store_id])).rows;
        imeiAgingPercentage = 15;
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const todaySalesData = (await postgresPool2.query(`
        SELECT SUM(total) as todaySales
        FROM sales
        WHERE store_id = $1 AND DATE(timestamp) = $2 AND status != 'VOIDED'
      `, [store_id, today])).rows[0];
      const todaySales = Number(todaySalesData?.todaySales) || 0;
      const allProductsForStock = (await postgresPool2.query(`
        SELECT p.id, p.name, p.stock, p.price, p.category, p.condition_matrix, COALESCE(c.name, p.category, 'General') as category_name, COALESCE(s.mode, 'SUPERMARKET') as mode
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.store_id = $1 AND p.deleted_at IS NULL
      `, [store_id])).rows;
      const recentProductSales = (await postgresPool2.query(`
        SELECT si.product_id, COALESCE(SUM(si.quantity), 0) as sold_quantity, COALESCE(SUM(si.subtotal), SUM(si.price_at_sale * si.quantity), 0) as revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.store_id = $1
          AND s.status != 'VOIDED'
          AND s.deleted_at IS NULL
          AND DATE(s.timestamp) >= CURRENT_DATE - INTERVAL '13 days'
        GROUP BY si.product_id
      `, [store_id])).rows;
      const recentSalesMap = new Map(recentProductSales.map((row) => [
        Number(row.product_id),
        {
          sold_quantity: Number(row.sold_quantity) || 0,
          revenue: Number(row.revenue) || 0
        }
      ]));
      const productSignals = allProductsForStock.map((product) => {
        const currentStock = getProductTotalStock2(product);
        const salesInfo = recentSalesMap.get(Number(product.id)) || { sold_quantity: 0, revenue: 0 };
        const averageDailySales = Number(salesInfo.sold_quantity || 0) / 14;
        const daysLeft = averageDailySales > 0 ? currentStock / averageDailySales : null;
        const suggestedReorder = averageDailySales > 0 ? Math.max(0, Math.ceil(averageDailySales * 14 - currentStock)) : 0;
        return {
          id: Number(product.id),
          name: product.name,
          category: product.category_name || "General",
          stock: currentStock,
          sold_quantity: Number(salesInfo.sold_quantity) || 0,
          revenue: Number(salesInfo.revenue) || 0,
          averageDailySales,
          daysLeft,
          suggestedReorder
        };
      });
      const lowStockItems = productSignals.filter((product) => product.stock < 3).map((product) => ({ name: product.name, stock: product.stock })).slice(0, 5);
      const topSellingProducts = productSignals.filter((product) => product.sold_quantity > 0).sort((a, b) => b.sold_quantity - a.sold_quantity || b.revenue - a.revenue).slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        quantity: product.sold_quantity,
        revenue: product.revenue,
        stock: product.stock
      }));
      const restockSuggestions = productSignals.filter((product) => product.sold_quantity > 0 && (product.stock <= 5 || product.daysLeft !== null && product.daysLeft <= 7 || product.suggestedReorder > 0)).sort((a, b) => (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) || b.sold_quantity - a.sold_quantity).slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        stock: product.stock,
        quantity: product.sold_quantity,
        avgDailySales: Number(product.averageDailySales.toFixed(2)),
        daysLeft: product.daysLeft === null ? null : Number(product.daysLeft.toFixed(1)),
        suggestedReorder: Math.max(1, product.suggestedReorder || Math.ceil(product.averageDailySales * 7))
      }));
      const salesToday = (await postgresPool2.query(`
        SELECT payment_methods FROM sales
        WHERE store_id = $1 AND DATE(timestamp) = $2 AND status != 'VOIDED'
      `, [store_id, today])).rows;
      let cash = 0;
      let transfer = 0;
      let pos = 0;
      for (const s of salesToday) {
        const pm = JSON.parse(s.payment_methods);
        cash += pm.cash || 0;
        transfer += pm.transfer || 0;
        pos += pm.pos || 0;
      }
      const paymentSplit = [
        { name: "Cash", value: cash },
        { name: "Transfer", value: transfer },
        { name: "POS", value: pos }
      ];
      const salesTrendRows = (await postgresPool2.query(`
        SELECT DATE(timestamp) AS day, SUM(total) AS total
        FROM sales
        WHERE store_id = $1
          AND status != 'VOIDED'
          AND timestamp >= CURRENT_DATE - INTERVAL '6 days'
          AND timestamp < CURRENT_DATE + INTERVAL '1 day'
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp)
      `, [store_id])).rows;
      const trendMap = new Map(salesTrendRows.map((r) => [String(r.day).slice(0, 10), Number(r.total || 0)]));
      const filledTrendRows = [];
      for (let i = 6; i >= 0; i--) {
        const d = /* @__PURE__ */ new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        filledTrendRows.push({ day: key, total: trendMap.get(key) ?? 0 });
      }
      const salesTrendRowsFilled = filledTrendRows;
      const salesTrend = salesTrendRowsFilled.map((row) => ({
        date: new Date(row.day).toLocaleDateString("en-US", { weekday: "short" }),
        total: Number(row.total || 0) || 0
      }));
      const categoryTrend = (await postgresPool2.query(`
        SELECT COALESCE(c.name, p.category, 'Uncategorized') as category, SUM(si.quantity) as quantity
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE s.store_id = $1 AND s.status != 'VOIDED'
        GROUP BY COALESCE(c.name, p.category, 'Uncategorized')
        ORDER BY quantity DESC
        LIMIT 5
      `, [store_id])).rows;
      const missingCostItems = Array.from(missingCostRegistry.values()).map((item) => {
        const priceLabels = getMissingCostPriceLabels2({
          price: item.price,
          condition: item.condition,
          productPrice: item.basePrice,
          conditionMatrix: item.conditionMatrix
        });
        return {
          id: item.id,
          name: item.name,
          condition: item.condition,
          stockUnits: item.stockUnits,
          soldUnits: item.soldUnits,
          price: item.price,
          priceLabel: priceLabels.primaryLabel,
          conditionPricesLabel: priceLabels.allConditionsLabel
        };
      }).sort((a, b) => b.soldUnits - a.soldUnits || b.stockUnits - a.stockUnits || a.name.localeCompare(b.name));
      res.json({
        totalItems: inventoryMetrics.totalItems || 0,
        totalCost: inventoryMetrics.totalCost || 0,
        potentialRevenue: inventoryMetrics.potentialRevenue || 0,
        grossProfit,
        netProfit,
        expensesTotal,
        netProfitAfterExpenses,
        pendingReceivables,
        pendingReceivableCount,
        outOnCollectionCount: collectionInsights.totalQuantity,
        outOnCollectionValue: collectionInsights.totalValue,
        overdueCollections: collectionInsights.overdueCollections,
        topCustomers,
        imeiAgingPercentage,
        todaySales,
        dailyTarget: 1e5,
        lowStockItems,
        topSellingProducts,
        restockSuggestions,
        paymentSplit,
        salesTrend,
        categoryTrend,
        costFallbackEnabled,
        missingCostItems,
        missingCostItemCount: missingCostItems.length,
        excludedProfitItemsCount,
        defaultedCostItemCount,
        trackedProfitItems
      });
    } catch (err) {
      console.error("Analytics Error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/sales/:id/pdf", authenticate2, async (req, res) => {
    const saleId = Number(req.params.id);
    const { pdf_data, filename } = req.body;
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "Invalid sale id" });
    }
    if (!pdf_data || !filename) {
      return res.status(400).json({ error: "Missing data" });
    }
    const sale = (await postgresPool2.query("SELECT id, pdf_path FROM sales WHERE id = $1 AND store_id = $2", [saleId, req.user.store_id])).rows[0];
    if (!sale) {
      return res.status(404).json({ error: "Sale not found" });
    }
    const baseFilename = path4.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.pdf$/i, "");
    const safeFilename = `${baseFilename}-${Date.now()}.pdf`;
    const rawPdfData = String(pdf_data || "").trim();
    let pdfBase64 = "";
    if (/^data:application\/pdf/i.test(rawPdfData)) {
      const base64MarkerIndex = rawPdfData.indexOf("base64,");
      if (base64MarkerIndex === -1) {
        return res.status(400).json({ error: "Invalid PDF data format" });
      }
      pdfBase64 = rawPdfData.slice(base64MarkerIndex + "base64,".length).trim();
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(rawPdfData)) {
      pdfBase64 = rawPdfData.replace(/\s+/g, "");
    } else {
      return res.status(400).json({ error: "Invalid PDF data format" });
    }
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid PDF payload" });
    }
    if (!pdfBuffer.length) {
      return res.status(400).json({ error: "Empty PDF payload" });
    }
    if (pdfBuffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "PDF payload too large. Please keep invoices under 10MB." });
    }
    const filePath = path4.join(uploadsDir2, safeFilename);
    fs3.writeFileSync(filePath, pdfBuffer);
    const previousPdfPath = String(sale.pdf_path || "").trim();
    if (previousPdfPath.startsWith("/uploads/invoices/")) {
      const previousFilename = path4.basename(previousPdfPath);
      const previousFilePath = path4.join(uploadsDir2, previousFilename);
      if (previousFilename && previousFilename !== safeFilename && fs3.existsSync(previousFilePath)) {
        try {
          fs3.unlinkSync(previousFilePath);
        } catch (cleanupError) {
          console.warn("Previous invoice PDF cleanup skipped:", cleanupError);
        }
      }
    }
    await postgresPool2.query("UPDATE sales SET pdf_path = $1 WHERE id = $2 AND store_id = $3", [`/uploads/invoices/${safeFilename}`, saleId, req.user.store_id]);
    res.json({ success: true, path: `/uploads/invoices/${safeFilename}` });
  });
};

// serverStaffCommunicationRoutes.ts
var registerStaffCommunicationRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  clampChatRetentionValue: clampChatRetentionValue3,
  normalizeChatRetentionUnit: normalizeChatRetentionUnit3,
  isChatCleanupReminderDue: isChatCleanupReminderDue2,
  formatHandoverNoteRecord: formatHandoverNoteRecord2,
  normalizeHandoverPriority: normalizeHandoverPriority3,
  formatAttendanceEntry: formatAttendanceEntry2,
  getShiftDateKey: getShiftDateKey2,
  getAttendanceDurationMinutes: getAttendanceDurationMinutes2
}) => {
  const teamRoles = ["STORE_ADMIN", "MANAGER", "ACCOUNTANT", "PROCUREMENT_OFFICER", "STAFF"];
  app2.get("/api/internal-messages/contacts", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);
    try {
      const contacts = await coreReadRepository2.listInternalMessageContacts(storeId, currentUserId);
      res.json({ contacts });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load chat contacts" });
    }
  });
  app2.get("/api/internal-messages", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);
    const withUserId = Number(req.query.with_user_id || req.query.recipient_id || 0);
    if (!Number.isInteger(withUserId) || withUserId <= 0) {
      return res.status(400).json({ error: "Select a valid team member to open the conversation" });
    }
    try {
      const { contact, unreadMessageIds, messages } = await coreReadRepository2.getInternalConversation(storeId, currentUserId, withUserId);
      if (!contact) {
        return res.status(404).json({ error: "Team member not found for this store" });
      }
      if (unreadMessageIds.length) {
        await coreWriteRepository2.markInternalMessagesRead({
          storeId,
          senderId: withUserId,
          recipientId: currentUserId
        });
      }
      res.json({
        contact,
        messages: messages.map((message) => ({
          ...message,
          is_read: Number(message?.is_read || 0) === 1,
          message_text: String(message?.message_text || "")
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load chat messages" });
    }
  });
  app2.post("/api/internal-messages", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const senderId = Number(req.user.id);
    const recipientId = Number(req.body?.recipient_id || 0);
    const rawMessage = String(req.body?.message || req.body?.message_text || "");
    const messageText = rawMessage.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!Number.isInteger(recipientId) || recipientId <= 0) {
      return res.status(400).json({ error: "Choose a valid team member to receive this message" });
    }
    if (recipientId === senderId) {
      return res.status(400).json({ error: "You cannot message yourself here" });
    }
    if (!messageText) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (messageText.length > 4e3) {
      return res.status(400).json({ error: "Message is too long. Keep it under 4000 characters." });
    }
    try {
      const contacts = await coreReadRepository2.listInternalMessageContacts(storeId, senderId);
      const recipient = contacts.find((contact) => Number(contact.id) === recipientId);
      if (!recipient) {
        return res.status(404).json({ error: "Selected team member was not found in this store" });
      }
      const createdMessage = await coreWriteRepository2.createInternalMessage({
        storeId,
        senderId,
        recipientId,
        messageText
      });
      res.json({
        success: true,
        message: {
          ...createdMessage,
          is_read: Number(createdMessage?.is_read || 0) === 1,
          message_text: String(createdMessage?.message_text || "")
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to send internal message" });
    }
  });
  app2.post("/api/internal-messages/cleanup", authenticate2, authorize2(["STORE_ADMIN"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const olderThanValue = clampChatRetentionValue3(req.body?.older_than_value ?? req.body?.retention_value);
    const olderThanUnit = normalizeChatRetentionUnit3(req.body?.older_than_unit ?? req.body?.retention_unit);
    const isDryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    try {
      if (isDryRun) {
        const cutoffInterval = `${olderThanValue} ${olderThanUnit}`;
        const dryRunResult = await postgresPool2.query(
          `SELECT id FROM internal_messages WHERE store_id = $1 AND created_at < NOW() - CAST($2 AS INTERVAL)`,
          [storeId, cutoffInterval]
        );
        const store = await coreReadRepository2.getStoreById(storeId);
        return res.json({
          success: true,
          dryRun: true,
          deletedCount: 0,
          wouldDeleteCount: dryRunResult.rows.length,
          olderThanValue,
          olderThanUnit,
          last_chat_cleanup_at: store?.last_chat_cleanup_at || null,
          reminderDue: isChatCleanupReminderDue2(store)
        });
      }
      const result = await coreWriteRepository2.cleanupInternalMessages({
        storeId,
        olderThanValue,
        olderThanUnit
      });
      res.json({
        success: true,
        dryRun: false,
        deletedCount: result.deletedCount,
        wouldDeleteCount: result.wouldDeleteCount,
        olderThanValue,
        olderThanUnit,
        last_chat_cleanup_at: result.store?.last_chat_cleanup_at || (/* @__PURE__ */ new Date()).toISOString(),
        reminderDue: isChatCleanupReminderDue2(result.store)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to clear old internal chat history" });
    }
  });
  app2.get("/api/handover-notes", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    try {
      const notes = await coreReadRepository2.listHandoverNotes(storeId, limit);
      res.json({
        notes: notes.map((note) => formatHandoverNoteRecord2(note, req.user)),
        limit
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load handover notes" });
    }
  });
  app2.post("/api/handover-notes", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const authorId = Number(req.user.id);
    const noteText = String(req.body?.note ?? req.body?.note_text ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const priority = normalizeHandoverPriority3(req.body?.priority);
    const canPin = ["STORE_ADMIN", "MANAGER"].includes(String(req.user.role || ""));
    const isPinned = canPin && (req.body?.is_pinned === true || req.body?.is_pinned === 1 || req.body?.isPinned === true);
    if (!noteText) {
      return res.status(400).json({ error: "Add a short handover note before saving" });
    }
    if (noteText.length > 600) {
      return res.status(400).json({ error: "Keep handover notes under 600 characters" });
    }
    try {
      const createdNote = await coreWriteRepository2.createHandoverNote({
        storeId,
        authorId,
        noteText,
        priority,
        isPinned
      });
      res.json({
        success: true,
        note: formatHandoverNoteRecord2(createdNote, req.user)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to save handover note" });
    }
  });
  app2.put("/api/handover-notes/:id/pin", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const noteId = Number(req.params.id);
    if (!Number.isInteger(noteId) || noteId <= 0) {
      return res.status(400).json({ error: "Invalid handover note id" });
    }
    try {
      const updatedNote = await coreWriteRepository2.updateHandoverNotePin({
        storeId,
        noteId,
        isPinned: req.body?.is_pinned === true || req.body?.is_pinned === 1 || req.body?.isPinned === true
      });
      if (!updatedNote) {
        return res.status(404).json({ error: "Handover note not found" });
      }
      res.json({
        success: true,
        note: formatHandoverNoteRecord2(updatedNote, req.user)
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to update handover note" });
    }
  });
  app2.delete("/api/handover-notes/:id", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const noteId = Number(req.params.id);
    if (!Number.isInteger(noteId) || noteId <= 0) {
      return res.status(400).json({ error: "Invalid handover note id" });
    }
    try {
      const noteResult = await postgresPool2.query(
        "SELECT * FROM handover_notes WHERE id = $1 AND store_id = $2 LIMIT 1",
        [noteId, storeId]
      );
      const note = noteResult.rows[0];
      if (!note) {
        return res.status(404).json({ error: "Handover note not found" });
      }
      const canDelete = Number(note.author_id) === Number(req.user.id) || ["STORE_ADMIN", "MANAGER"].includes(String(req.user.role || ""));
      if (!canDelete) {
        return res.status(403).json({ error: "You can only delete your own handover notes" });
      }
      await coreWriteRepository2.deleteHandoverNote({ noteId, storeId });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to delete handover note" });
    }
  });
  app2.get("/api/attendance", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);
    const selectedDate = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? String(req.query.date) : getShiftDateKey2();
    const isLeadership = ["STORE_ADMIN", "MANAGER"].includes(String(req.user.role || ""));
    try {
      const { currentSession, myEntries, teamEntries } = await coreReadRepository2.getAttendanceOverview(storeId, currentUserId, selectedDate, isLeadership);
      const formattedTeamEntries = teamEntries.map((entry) => formatAttendanceEntry2(entry));
      res.json({
        selected_date: selectedDate,
        current_session: currentSession ? formatAttendanceEntry2(currentSession) : null,
        my_entries: myEntries.map((entry) => formatAttendanceEntry2(entry)),
        team_entries: formattedTeamEntries,
        summary: {
          present_count: new Set(formattedTeamEntries.map((entry) => Number(entry.user_id))).size,
          open_count: formattedTeamEntries.filter((entry) => entry.is_open).length,
          clocked_out_count: formattedTeamEntries.filter((entry) => !entry.is_open).length,
          total_hours: Number(formattedTeamEntries.reduce((sum, entry) => sum + (Number(entry.total_hours || 0) || 0), 0).toFixed(2))
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load attendance data" });
    }
  });
  app2.post("/api/attendance/clock-in", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const note = String(req.body?.note || "").trim().slice(0, 240) || null;
    try {
      const result = await coreWriteRepository2.createAttendanceClockIn({
        storeId,
        userId,
        note,
        shiftDate: getShiftDateKey2()
      });
      if (result.existingOpenSession) {
        return res.status(400).json({ error: "You already have an active shift. Please clock out first." });
      }
      res.json({ success: true, entry: formatAttendanceEntry2(result.entry) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to clock in" });
    }
  });
  app2.post("/api/attendance/clock-out", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const note = String(req.body?.note || "").trim().slice(0, 240);
    try {
      const attendanceState = await coreReadRepository2.getAttendanceOverview(storeId, userId, getShiftDateKey2(), false);
      const openSession = attendanceState.currentSession;
      if (!openSession) {
        return res.status(400).json({ error: "There is no active shift to clock out from." });
      }
      const totalMinutes = getAttendanceDurationMinutes2(openSession.clock_in_at, (/* @__PURE__ */ new Date()).toISOString());
      const mergedNote = [String(openSession.note || "").trim(), note].filter(Boolean).join(" \u2022 ").slice(0, 240) || null;
      const result = await coreWriteRepository2.clockOutAttendance({
        storeId,
        userId,
        note: mergedNote,
        totalMinutes
      });
      if (!result.entry) {
        return res.status(400).json({ error: "There is no active shift to clock out from." });
      }
      res.json({ success: true, entry: formatAttendanceEntry2(result.entry) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Failed to clock out" });
    }
  });
  app2.get("/api/attendance/history", authenticate2, authorize2(teamRoles), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "8"), 10)));
    try {
      const result = await coreReadRepository2.getAttendanceHistory(storeId, userId, page, limit);
      res.json({
        entries: result.rows.map((entry) => formatAttendanceEntry2(entry)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit)
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to load attendance history" });
    }
  });
  app2.delete("/api/attendance/clear", authenticate2, authorize2(["STORE_ADMIN", "MANAGER"]), checkStoreLock2, async (req, res) => {
    const storeId = Number(req.user.store_id);
    const scope = String(req.body?.scope || "");
    const date = String(req.body?.date || "").trim();
    if (!["day", "month", "year"].includes(scope)) {
      return res.status(400).json({ error: "Invalid scope. Must be day, month, or year." });
    }
    if (scope === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD for day scope." });
    }
    if (scope === "month" && !/^\d{4}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM for month scope." });
    }
    if (scope === "year" && !/^\d{4}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date. Use YYYY for year scope." });
    }
    try {
      const deleted = await coreWriteRepository2.clearAttendanceHistory(storeId, scope, date);
      res.json({ success: true, deleted });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to clear attendance history" });
    }
  });
};

// serverSystemRoutes.ts
var registerSystemRoutes = ({
  app: app2,
  postgresPool: postgresPool2,
  APP_VERSION: APP_VERSION2,
  authenticate: authenticate2,
  authorize: authorize2,
  LICENSE_API_BASE_URL: LICENSE_API_BASE_URL2,
  LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
  LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
  checkLicenseServiceConnection: checkLicenseServiceConnection2
}) => {
  app2.get("/api/health", async (_req, res) => {
    try {
      const [storesResult, usersResult] = await Promise.all([
        postgresPool2.query("SELECT COUNT(*) as count FROM stores"),
        postgresPool2.query("SELECT COUNT(*) as count FROM users")
      ]);
      const storeCount = Number(storesResult.rows[0]?.count || 0);
      const userCount = Number(usersResult.rows[0]?.count || 0);
      res.json({
        ok: true,
        status: "ok",
        environment: process.env.NODE_ENV || "development",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        stores: storeCount,
        users: userCount
      });
    } catch (err) {
      res.status(500).json({ ok: false, status: "error", error: err?.message || "Health check failed" });
    }
  });
  app2.get("/api/app/version", (_req, res) => {
    try {
      res.json({
        version: APP_VERSION2,
        name: "GoodyPOS",
        environment: process.env.NODE_ENV || "development",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Version check failed" });
    }
  });
  app2.get("/api/license/status", authenticate2, authorize2(["SYSTEM_ADMIN"]), async (_req, res) => {
    try {
      const storesResult = await postgresPool2.query(`
        SELECT id, name, mode, license_key, license_status, license_plan, license_activated_at, license_last_validated_at
        FROM stores
        ORDER BY created_at DESC, id DESC
      `);
      const stores = storesResult.rows;
      const connection = await checkLicenseServiceConnection2();
      res.json({
        ok: true,
        configured: connection.configured,
        connected: connection.connected,
        serviceStatusCode: connection.statusCode,
        connectionError: connection.error,
        requiredForNewStores: LICENSE_REQUIRED_FOR_NEW_STORES2,
        activationRequiresInternet: true,
        activationMode: "ONLINE_ONLY_FIRST_ACTIVATION",
        deviceName: LICENSE_DEVICE_NAME2,
        serviceUrl: LICENSE_API_BASE_URL2 || null,
        stores: stores.map((store) => ({
          ...store,
          license_key_masked: store.license_key ? `${String(store.license_key).slice(0, 7)}\u2022\u2022\u2022\u2022${String(store.license_key).slice(-4)}` : null
        }))
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || "License status check failed" });
    }
  });
};

// serverAppBootstrap.ts
var createConfiguredApp = ({
  PORT: PORT2,
  LAN_IP: LAN_IP2
}) => {
  const app2 = express();
  const configuredCorsOrigins = String(process.env.CORS_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const nearbyDevPorts = Array.from(/* @__PURE__ */ new Set([PORT2, PORT2 + 1, PORT2 + 2, PORT2 + 3, PORT2 + 4, 5173]));
  const allowedCorsOrigins = /* @__PURE__ */ new Set([
    ...configuredCorsOrigins,
    ...nearbyDevPorts.flatMap((port) => [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://${LAN_IP2}:${port}`
    ])
  ]);
  const vercelDeploymentHost = String(process.env.VERCEL_URL || "").trim().replace(/^https?:\/\//i, "");
  const vercelDeploymentOrigin = vercelDeploymentHost ? `https://${vercelDeploymentHost}` : "";
  app2.disable("x-powered-by");
  app2.use((req, res, next) => {
    const requestOrigin = String(req.headers.origin || "").trim();
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
    const requestProtocol = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")).split(",")[0].trim() || "http";
    const sameHostOrigin = requestHost ? `${requestProtocol}://${requestHost}` : "";
    const isAllowedOrigin = !requestOrigin || allowedCorsOrigins.has(requestOrigin) || vercelDeploymentOrigin && requestOrigin === vercelDeploymentOrigin || sameHostOrigin && requestOrigin === sameHostOrigin || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(requestOrigin);
    return cors({
      origin(origin, callback) {
        if (!origin || isAllowedOrigin) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS origin not allowed"));
      },
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204
    })(req, res, next);
  });
  app2.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ extended: true, limit: "50mb" }));
  return app2;
};
var registerApplicationRoutes = ({
  app: app2,
  db: _db,
  postgresPool: postgresPool2,
  uploadsDir: uploadsDir2,
  APP_VERSION: APP_VERSION2,
  authenticate: authenticate2,
  authorize: authorize2,
  checkStoreLock: checkStoreLock2,
  coreReadRepository: coreReadRepository2,
  coreWriteRepository: coreWriteRepository2,
  findStoreById: findStoreById2,
  findUserById: findUserById2,
  normalizePhone: normalizePhone4,
  safeJsonParse: safeJsonParse6,
  normalizeStaffAnnouncement: normalizeStaffAnnouncement2,
  normalizeStoreDiscountCodes: normalizeStoreDiscountCodes2,
  normalizeStoreSignatureImage: normalizeStoreSignatureImage3,
  clampChatCleanupReminderDay: clampChatCleanupReminderDay3,
  clampChatRetentionValue: clampChatRetentionValue3,
  normalizeChatRetentionUnit: normalizeChatRetentionUnit3,
  isChatCleanupReminderDue: isChatCleanupReminderDue2,
  formatHandoverNoteRecord: formatHandoverNoteRecord2,
  getAttendanceDurationMinutes: getAttendanceDurationMinutes2,
  getShiftDateKey: getShiftDateKey2,
  formatAttendanceEntry: formatAttendanceEntry2,
  normalizeHandoverPriority: normalizeHandoverPriority3,
  normalizeBatchCode: normalizeBatchCode3,
  normalizeBatchExpiryDate: normalizeBatchExpiryDate3,
  normalizeCollectionCondition: normalizeCollectionCondition6,
  normalizePaymentFrequency: normalizePaymentFrequency2,
  normalizeSaleChannel: normalizeSaleChannel2,
  normalizeRecountStatus: normalizeRecountStatus2,
  normalizeProductBarcode: normalizeProductBarcode3,
  normalizePin: normalizePin2,
  hashPin: hashPin3,
  verifyPin: verifyPin2,
  resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
  resolveTrackedCost: resolveTrackedCost5,
  getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
  getProductTotalStock: getProductTotalStock2,
  getSaleReturnsMeta: getSaleReturnsMeta2,
  getMissingCostPriceLabels: getMissingCostPriceLabels2,
  getAuditActorLabel: getAuditActorLabel2,
  logAuditEvent: logAuditEvent2,
  logSystemActivity: logSystemActivity2,
  formatAuditCurrency: formatAuditCurrency2,
  toFiniteNumberOrNull: toFiniteNumberOrNull6,
  buildLayawayPaymentPlan: buildLayawayPaymentPlan2,
  formatInventoryBatch: formatInventoryBatch2,
  formatStockAdjustmentEntry: formatStockAdjustmentEntry2,
  formatPurchaseOrder: formatPurchaseOrder2,
  formatMarketCollection: formatMarketCollection2,
  formatRepairTicket: formatRepairTicket2,
  formatSaleReturnEntry: formatSaleReturnEntry2,
  formatSaleResponse: formatSaleResponse2,
  HIGH_RISK_AUDIT_ACTIONS: HIGH_RISK_AUDIT_ACTIONS2,
  getLoginAttemptKey: getLoginAttemptKey2,
  getRemainingLockoutMs: getRemainingLockoutMs2,
  registerFailedLogin: registerFailedLogin2,
  clearLoginAttempt: clearLoginAttempt2,
  LICENSE_API_BASE_URL: LICENSE_API_BASE_URL2,
  LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
  LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
  JWT_SECRET: JWT_SECRET2,
  JWT_EXPIRY: JWT_EXPIRY2,
  checkLicenseServiceConnection: checkLicenseServiceConnection2,
  activateRemoteStoreLicense: activateRemoteStoreLicense2,
  markExpiredProformas: markExpiredProformas2,
  startScheduledMaintenance: startScheduledMaintenance2,
  generateUniqueQuickCode: generateUniqueQuickCode2,
  generateUniqueBarcode: generateUniqueBarcode2,
  reconcileInventoryBatchQuantity: reconcileInventoryBatchQuantity2,
  generateUniquePurchaseOrderNumber: generateUniquePurchaseOrderNumber2,
  generateUniqueRepairTicketNumber: generateUniqueRepairTicketNumber2,
  collectUnusedMediaCleanupStats: collectUnusedMediaCleanupStats2,
  createSafetySnapshot: createSafetySnapshot2
}) => {
  registerSystemRoutes({
    app: app2,
    postgresPool: postgresPool2,
    APP_VERSION: APP_VERSION2,
    authenticate: authenticate2,
    authorize: authorize2,
    LICENSE_API_BASE_URL: LICENSE_API_BASE_URL2,
    LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
    LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
    checkLicenseServiceConnection: checkLicenseServiceConnection2
  });
  startScheduledMaintenance2();
  registerOperationsRoutes({
    app: app2,
    postgresPool: postgresPool2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2,
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    normalizePhone: normalizePhone4,
    safeJsonParse: safeJsonParse6,
    resolveTrackedCost: resolveTrackedCost5,
    normalizeCollectionCondition: normalizeCollectionCondition6,
    normalizeSaleChannel: normalizeSaleChannel2,
    normalizePaymentFrequency: normalizePaymentFrequency2,
    getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
    buildLayawayPaymentPlan: buildLayawayPaymentPlan2,
    formatSaleResponse: formatSaleResponse2,
    formatMarketCollection: formatMarketCollection2,
    formatRepairTicket: formatRepairTicket2,
    formatInventoryBatch: formatInventoryBatch2,
    formatPurchaseOrder: formatPurchaseOrder2,
    normalizeBatchCode: normalizeBatchCode3,
    normalizeBatchExpiryDate: normalizeBatchExpiryDate3,
    generateUniqueRepairTicketNumber: generateUniqueRepairTicketNumber2,
    generateUniquePurchaseOrderNumber: generateUniquePurchaseOrderNumber2,
    getAuditActorLabel: getAuditActorLabel2,
    logAuditEvent: logAuditEvent2,
    logSystemActivity: logSystemActivity2,
    formatAuditCurrency: formatAuditCurrency2,
    collectUnusedMediaCleanupStats: collectUnusedMediaCleanupStats2,
    createSafetySnapshot: createSafetySnapshot2
  });
  registerAuthAdminRoutes({
    app: app2,
    postgresPool: postgresPool2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2,
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    findStoreById: findStoreById2,
    findUserById: findUserById2,
    normalizeStaffAnnouncement: normalizeStaffAnnouncement2,
    safeJsonParse: safeJsonParse6,
    getLoginAttemptKey: getLoginAttemptKey2,
    getRemainingLockoutMs: getRemainingLockoutMs2,
    registerFailedLogin: registerFailedLogin2,
    clearLoginAttempt: clearLoginAttempt2,
    activateRemoteStoreLicense: activateRemoteStoreLicense2,
    markExpiredProformas: markExpiredProformas2,
    normalizePin: normalizePin2,
    hashPin: hashPin3,
    verifyPin: verifyPin2,
    resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
    LICENSE_REQUIRED_FOR_NEW_STORES: LICENSE_REQUIRED_FOR_NEW_STORES2,
    LICENSE_DEVICE_NAME: LICENSE_DEVICE_NAME2,
    JWT_SECRET: JWT_SECRET2,
    JWT_EXPIRY: JWT_EXPIRY2
  });
  registerStaffCommunicationRoutes({
    app: app2,
    postgresPool: postgresPool2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2,
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    clampChatRetentionValue: clampChatRetentionValue3,
    normalizeChatRetentionUnit: normalizeChatRetentionUnit3,
    isChatCleanupReminderDue: isChatCleanupReminderDue2,
    formatHandoverNoteRecord: formatHandoverNoteRecord2,
    normalizeHandoverPriority: normalizeHandoverPriority3,
    formatAttendanceEntry: formatAttendanceEntry2,
    getShiftDateKey: getShiftDateKey2,
    getAttendanceDurationMinutes: getAttendanceDurationMinutes2
  });
  registerCatalogRoutes({
    app: app2,
    postgresPool: postgresPool2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2,
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    findStoreById: findStoreById2,
    safeJsonParse: safeJsonParse6,
    normalizeStoreDiscountCodes: normalizeStoreDiscountCodes2,
    normalizeStaffAnnouncement: normalizeStaffAnnouncement2,
    normalizeStoreSignatureImage: normalizeStoreSignatureImage3,
    clampChatCleanupReminderDay: clampChatCleanupReminderDay3,
    clampChatRetentionValue: clampChatRetentionValue3,
    normalizeChatRetentionUnit: normalizeChatRetentionUnit3,
    isChatCleanupReminderDue: isChatCleanupReminderDue2,
    getProductTotalStock: getProductTotalStock2,
    formatStockAdjustmentEntry: formatStockAdjustmentEntry2,
    normalizeRecountStatus: normalizeRecountStatus2,
    getAuditActorLabel: getAuditActorLabel2,
    logAuditEvent: logAuditEvent2,
    formatAuditCurrency: formatAuditCurrency2,
    normalizeProductBarcode: normalizeProductBarcode3,
    generateUniqueBarcode: generateUniqueBarcode2,
    generateUniqueQuickCode: generateUniqueQuickCode2,
    reconcileInventoryBatchQuantity: reconcileInventoryBatchQuantity2
  });
  registerSalesReportingRoutes({
    app: app2,
    postgresPool: postgresPool2,
    uploadsDir: uploadsDir2,
    authenticate: authenticate2,
    authorize: authorize2,
    checkStoreLock: checkStoreLock2,
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    findStoreById: findStoreById2,
    safeJsonParse: safeJsonParse6,
    normalizePhone: normalizePhone4,
    normalizeSaleChannel: normalizeSaleChannel2,
    normalizePin: normalizePin2,
    resolveCheckoutActorByPin: resolveCheckoutActorByPin2,
    getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
    getSaleReturnsMeta: getSaleReturnsMeta2,
    formatSaleResponse: formatSaleResponse2,
    formatSaleReturnEntry: formatSaleReturnEntry2,
    formatMarketCollection: formatMarketCollection2,
    getAuditActorLabel: getAuditActorLabel2,
    formatAuditCurrency: formatAuditCurrency2,
    logSystemActivity: logSystemActivity2,
    logAuditEvent: logAuditEvent2,
    HIGH_RISK_AUDIT_ACTIONS: HIGH_RISK_AUDIT_ACTIONS2,
    toFiniteNumberOrNull: toFiniteNumberOrNull6,
    resolveTrackedCost: resolveTrackedCost5,
    getMissingCostPriceLabels: getMissingCostPriceLabels2,
    getProductTotalStock: getProductTotalStock2
  });
};

// serverConfig.ts
var createServerConfig = ({
  dataRootDir: dataRootDir2,
  isDesktopRuntime: isDesktopRuntime2,
  nodeEnv,
  resolveJwtSecret: resolveJwtSecret2
}) => {
  const JWT_SECRET2 = resolveJwtSecret2({
    isDesktopRuntime: isDesktopRuntime2,
    dataRootDir: dataRootDir2,
    nodeEnv
  });
  if (!JWT_SECRET2) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  return {
    PORT: parseInt(process.env.PORT || "3000", 10),
    HOST: process.env.HOST || "0.0.0.0",
    APP_VERSION: process.env.npm_package_version || "1.6.0",
    JWT_SECRET: JWT_SECRET2,
    JWT_EXPIRY: "24h",
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1e3
  };
};

// serverReadRepository.ts
var createCoreReadRepository = ({ postgresPool: postgresPool2 }) => {
  return {
    async getStoreById(storeId) {
      const result = await postgresPool2.query("SELECT * FROM stores WHERE id = $1 LIMIT 1", [storeId]);
      return result.rows[0] || null;
    },
    async listCustomers(storeId, orderBy = "name") {
      const orderClause = orderBy === "created_desc" ? "created_at DESC, id DESC" : "name ASC, id ASC";
      const result = await postgresPool2.query(`SELECT * FROM customers WHERE store_id = $1 ORDER BY ${orderClause}`, [storeId]);
      return result.rows;
    },
    async listPendingSales(storeId) {
      const result = await postgresPool2.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.store_id = $1 AND s.status = 'PENDING' AND s.deleted_at IS NULL
        ORDER BY s.timestamp DESC
      `, [storeId]);
      return result.rows;
    },
    async listOpenMarketCollections(storeId) {
      const result = await postgresPool2.query(`
        SELECT items
        FROM market_collections
        WHERE store_id = $1 AND status = 'OPEN'
      `, [storeId]);
      return result.rows;
    },
    async listProducts(options) {
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const normalizedSearch = rawSearch.toLowerCase();
      const requestedCategory = typeof options.category === "string" ? options.category.trim() : "";
      const requestedStockStatus = typeof options.stockStatus === "string" ? options.stockStatus.trim().toLowerCase() : "all";
      const sortBy = typeof options.sortBy === "string" ? options.sortBy : "recent";
      const paginate = Boolean(options.paginate);
      const limit = Math.max(1, Math.min(500, Number(options.limit) || 60));
      const offset = Math.max(0, Number(options.offset) || 0);
      const orderByClause = (() => {
        if (sortBy === "price-low") return `COALESCE(p.price, 0) ASC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === "price-high") return `COALESCE(p.price, 0) DESC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === "category-az") return `LOWER(COALESCE(c.name, p.category, 'General')) ASC, LOWER(COALESCE(p.name, '')) ASC`;
        if (sortBy === "category-za") return `LOWER(COALESCE(c.name, p.category, 'General')) DESC, LOWER(COALESCE(p.name, '')) ASC`;
        return `COALESCE(p.created_at, '1970-01-01 00:00:00') DESC, p.id DESC`;
      })();
      const filters = ["p.store_id = $1", "p.deleted_at IS NULL"];
      const params = [options.storeId];
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
      if (requestedCategory && requestedCategory !== "all") {
        filters.push(`LOWER(COALESCE(c.name, p.category, 'General')) = $${nextParam}`);
        params.push(requestedCategory.toLowerCase());
        nextParam += 1;
      }
      if (requestedStockStatus === "out") {
        filters.push(`COALESCE(p.stock, 0) <= 0`);
      } else if (requestedStockStatus === "low") {
        filters.push(`COALESCE(p.stock, 0) > 0 AND COALESCE(p.stock, 0) < 5`);
      } else if (requestedStockStatus === "healthy") {
        filters.push(`COALESCE(p.stock, 0) >= 5`);
      }
      const fromClause = `
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${filters.join(" AND ")}
      `;
      const query = `
        SELECT p.*, COALESCE(c.name, p.category) as category_name
        ${fromClause}
        ORDER BY ${orderByClause}
        ${paginate ? `LIMIT $${nextParam} OFFSET $${nextParam + 1}` : ""}
      `;
      const rows = (await postgresPool2.query(query, paginate ? [...params, limit, offset] : params)).rows;
      const total = paginate ? Number(((await postgresPool2.query(`SELECT COUNT(*)::int as total ${fromClause}`, params)).rows[0] || {}).total || 0) : null;
      return {
        rows,
        total,
        limit,
        offset
      };
    },
    async searchUnifiedPosCatalog(options) {
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const searchLower = rawSearch.toLowerCase();
      const limit = Math.max(1, Math.min(300, Number(options.limit) || 120));
      const params = [options.storeId];
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
      const result = await postgresPool2.query(query, hasSearch ? params : [options.storeId, "", ""]);
      return result.rows;
    },
    async listConsignmentItems(options) {
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const search = rawSearch.toLowerCase();
      const statusFilter = String(options.status || "").trim().toLowerCase();
      const filters = ["ci.store_id = $1"];
      const params = [options.storeId];
      let nextParam = 2;
      if (statusFilter && statusFilter !== "all") {
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
      const result = await postgresPool2.query(`
        SELECT ci.*, adder.username as added_by_username, approver.username as approved_by_username
        FROM consignment_items ci
        LEFT JOIN users adder ON adder.id = ci.added_by
        LEFT JOIN users approver ON approver.id = ci.approved_by
        WHERE ${filters.join(" AND ")}
        ORDER BY ci.updated_at DESC, ci.id DESC
      `, params);
      return result.rows;
    },
    async getConsignmentItemById(storeId, consignmentItemId) {
      const result = await postgresPool2.query(`
        SELECT ci.*, adder.username as added_by_username, approver.username as approved_by_username
        FROM consignment_items ci
        LEFT JOIN users adder ON adder.id = ci.added_by
        LEFT JOIN users approver ON approver.id = ci.approved_by
        WHERE ci.store_id = $1 AND ci.id = $2
        LIMIT 1
      `, [storeId, consignmentItemId]);
      return result.rows[0] || null;
    },
    async listProformas(storeId) {
      const result = await postgresPool2.query(`
        SELECT p.*, c.name as linked_customer_name, c.phone as linked_customer_phone, c.address as linked_customer_address
        FROM pro_formas p
        LEFT JOIN customers c ON p.customer_id = c.id
        WHERE p.store_id = $1
        ORDER BY p.created_at DESC
      `, [storeId]);
      return result.rows;
    },
    async listRepairTickets(storeId) {
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
      const result = await postgresPool2.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.store_id = $1
        ORDER BY ${orderClause}
      `, [storeId]);
      return result.rows;
    },
    async listExpenses(storeId, from, to) {
      const filters = ["e.store_id = $1"];
      const params = [storeId];
      let nextParam = 2;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ""))) {
        filters.push(`DATE(e.spent_at) >= DATE($${nextParam})`);
        params.push(String(from));
        nextParam += 1;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to || ""))) {
        filters.push(`DATE(e.spent_at) <= DATE($${nextParam})`);
        params.push(String(to));
        nextParam += 1;
      }
      const result = await postgresPool2.query(`
        SELECT e.*, u.username as created_by_username
        FROM expenses e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE ${filters.join(" AND ")}
        ORDER BY e.spent_at DESC, e.id DESC
      `, params);
      return result.rows;
    },
    async listInternalMessageContacts(storeId, currentUserId) {
      const result = await postgresPool2.query(`
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
      return result.rows;
    },
    async listAdminStores() {
      const result = await postgresPool2.query(`
        SELECT s.*, u.username as owner_username, u.id as owner_id
        FROM stores s
        LEFT JOIN users u ON s.id = u.store_id AND u.role = 'STORE_ADMIN'
        ORDER BY s.id ASC
      `);
      return result.rows;
    },
    async listAdminUsers(options) {
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
      const offset = Math.max(0, Number(options.offset) || 0);
      const isSystemAdmin = String(options.viewerRole || "") === "SYSTEM_ADMIN";
      const requestedStoreId = options.requestedStoreId == null ? null : Number(options.requestedStoreId);
      const effectiveStoreId = isSystemAdmin ? requestedStoreId != null && Number.isInteger(requestedStoreId) && requestedStoreId > 0 ? requestedStoreId : null : options.viewerStoreId == null ? null : Number(options.viewerStoreId);
      if (!isSystemAdmin && (effectiveStoreId == null || !Number.isInteger(effectiveStoreId) || effectiveStoreId <= 0)) {
        return [];
      }
      const filters = [];
      const params = [];
      let nextParam = 1;
      if (effectiveStoreId != null && Number.isInteger(effectiveStoreId) && effectiveStoreId > 0) {
        filters.push(`store_id = $${nextParam}`);
        params.push(effectiveStoreId);
        nextParam += 1;
      }
      const result = await postgresPool2.query(`
        SELECT id, username, role, store_id
        FROM users
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY LOWER(COALESCE(username, '')) ASC, id ASC
        LIMIT $${nextParam} OFFSET $${nextParam + 1}
      `, [...params, limit, offset]);
      return result.rows;
    },
    async listSuppliers(storeId) {
      const result = await postgresPool2.query(`
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
      return result.rows;
    },
    async listPurchaseOrders(storeId, statusFilter = "", search = "") {
      const normalizedStatus = String(statusFilter || "").trim().toUpperCase();
      const normalizedSearch = String(search || "").trim().toLowerCase();
      const filters = ["po.store_id = $1"];
      const params = [storeId];
      let nextParam = 2;
      if (normalizedStatus && ["ORDERED", "RECEIVED", "CANCELLED"].includes(normalizedStatus)) {
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
      const result = await postgresPool2.query(`
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE ${filters.join(" AND ")}
        ORDER BY po.created_at DESC, po.id DESC
      `, params);
      return result.rows;
    },
    async listInventoryBatches(storeId) {
      const result = await postgresPool2.query(`
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
      return result.rows;
    },
    async getInternalConversation(storeId, currentUserId, withUserId) {
      const contactResult = await postgresPool2.query(`
        SELECT id, username, role
        FROM users
        WHERE id = $1 AND store_id = $2 AND role IN ('STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF')
        LIMIT 1
      `, [withUserId, storeId]);
      const contact = contactResult.rows[0] || null;
      const unreadResult = await postgresPool2.query(`
        SELECT id
        FROM internal_messages
        WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
      `, [storeId, withUserId, currentUserId]);
      const messagesResult = await postgresPool2.query(`
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
        unreadMessageIds: unreadResult.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0),
        messages: messagesResult.rows
      };
    },
    async listZReportSales(storeId, selectedDate) {
      const result = await postgresPool2.query(`
        SELECT total, payment_methods
        FROM sales
        WHERE store_id = $1
          AND status != 'VOIDED'
          AND deleted_at IS NULL
          AND DATE(timestamp) = DATE($2)
        ORDER BY timestamp ASC, id ASC
      `, [storeId, selectedDate]);
      return result.rows;
    },
    async getMySalesChartData(storeId, userId, startDate, selectedDate) {
      const result = await postgresPool2.query(`
        SELECT total, payment_methods, DATE(timestamp)::text AS sale_date
        FROM sales
        WHERE store_id = $1
          AND user_id = $2
          AND status != 'VOIDED'
          AND deleted_at IS NULL
          AND DATE(timestamp) BETWEEN DATE($3) AND DATE($4)
        ORDER BY timestamp ASC, id ASC
      `, [storeId, userId, startDate, selectedDate]);
      return { salesRows: result.rows };
    },
    async getFinancialLedgerData(storeId, from, to) {
      const [storeSettingsResult, rowsResult, totalExpensesResult] = await Promise.all([
        postgresPool2.query(`
          SELECT COALESCE(default_missing_cost_to_price, 0) as default_missing_cost_to_price,
                 COALESCE(tax_enabled, 0) as tax_enabled,
                 COALESCE(tax_percentage, 0) as tax_percentage
          FROM stores
          WHERE id = $1
          LIMIT 1
        `, [storeId]),
        postgresPool2.query(`
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
        postgresPool2.query(`
          SELECT COALESCE(SUM(amount), 0) as total
          FROM expenses
          WHERE store_id = $1
            AND DATE(spent_at) BETWEEN DATE($2) AND DATE($3)
        `, [storeId, from, to])
      ]);
      return {
        storeSettings: storeSettingsResult.rows[0] || null,
        rows: rowsResult.rows,
        totalExpenses: Number(totalExpensesResult.rows[0]?.total || 0) || 0
      };
    },
    async getStaffSalesChartData(storeId, startDate, selectedDate) {
      const [staffUsersResult, salesRowsResult] = await Promise.all([
        postgresPool2.query(`
          SELECT id, username, role
          FROM users
          WHERE store_id = $1 AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
          ORDER BY CASE role WHEN 'STORE_ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, LOWER(COALESCE(username, '')) ASC
        `, [storeId]),
        postgresPool2.query(`
          SELECT user_id, total, payment_methods, DATE(timestamp)::text AS sale_date
          FROM sales
          WHERE store_id = $1
            AND status != 'VOIDED'
            AND deleted_at IS NULL
            AND DATE(timestamp) BETWEEN DATE($2) AND DATE($3)
          ORDER BY timestamp ASC, id ASC
        `, [storeId, startDate, selectedDate])
      ]);
      return {
        staffUsers: staffUsersResult.rows,
        salesRows: salesRowsResult.rows
      };
    },
    async getStaffSalesHistoryData(storeId, userId, selectedDate, startDate, limit) {
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const memberResult = await postgresPool2.query(`
        SELECT id, username, role, store_id
        FROM users
        WHERE id = $1 AND store_id = $2 AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
        LIMIT 1
      `, [userId, storeId]);
      const member = memberResult.rows[0] || null;
      if (!member) {
        return { member: null, salesRows: [], recentSales: [] };
      }
      const [salesRowsResult, recentSalesResult] = await Promise.all([
        postgresPool2.query(`
          SELECT total, payment_methods, DATE(timestamp)::text AS sale_date
          FROM sales
          WHERE store_id = $1
            AND user_id = $2
            AND status != 'VOIDED'
            AND deleted_at IS NULL
            AND DATE(timestamp) BETWEEN DATE($3) AND DATE($4)
          ORDER BY timestamp ASC, id ASC
        `, [storeId, userId, startDate, selectedDate]),
        postgresPool2.query(`
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
        `, [storeId, userId, selectedDate, normalizedLimit])
      ]);
      return {
        member,
        salesRows: salesRowsResult.rows,
        recentSales: recentSalesResult.rows
      };
    },
    async getCustomerById(storeId, customerId) {
      const result = await postgresPool2.query("SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1", [customerId, storeId]);
      return result.rows[0] || null;
    },
    async getCustomerStats(storeId) {
      const result = await postgresPool2.query(`
        SELECT
          c.*,
          COUNT(s.id) as purchase_count,
          COALESCE(SUM(s.total), 0) as total_investment,
          MAX(s.timestamp) as last_visit,
          COALESCE((
            SELECT SUM(GREATEST(0, s2.total - COALESCE(s2.amount_paid, s2.total)))
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
      return result.rows;
    },
    async listSales(options) {
      const customerId = Number(options.customerId || 0);
      const hasCustomerFilter = Number.isFinite(customerId) && customerId > 0;
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const search = rawSearch.toLowerCase();
      const numericSearch = rawSearch.replace(/\D+/g, "");
      const statusFilter = typeof options.status === "string" ? options.status.trim().toUpperCase() : "";
      const paginate = Boolean(options.paginate);
      const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
      const offset = Math.max(0, Number(options.offset) || 0);
      const filters = ["s.store_id = $1"];
      const params = [options.storeId];
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
        WHERE ${filters.join(" AND ")}
      `;
      const rows = (await postgresPool2.query(`
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
          COALESCE((SELECT SUM(sr.returned_value) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returned_amount,
          COALESCE((SELECT SUM(sr.refund_amount) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as refunded_amount,
          COALESCE((SELECT COUNT(*) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returns_count
        ${fromClause}
        ORDER BY s.timestamp DESC
        ${paginate ? `LIMIT $${nextParam} OFFSET $${nextParam + 1}` : ""}
      `, paginate ? [...params, limit, offset] : params)).rows;
      const total = paginate ? Number(((await postgresPool2.query(`SELECT COUNT(*)::int as total ${fromClause}`, params)).rows[0] || {}).total || 0) : null;
      return { rows, total, limit, offset };
    },
    async getSaleById(storeId, saleId) {
      const result = await postgresPool2.query(`
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
    async getSaleReturnsMeta(saleId) {
      const result = await postgresPool2.query(`
        SELECT
          COUNT(*) as returns_count,
          COALESCE(SUM(returned_value), 0) as returned_amount,
          COALESCE(SUM(refund_amount), 0) as refunded_amount
        FROM sales_returns
        WHERE sale_id = $1
      `, [saleId]);
      return result.rows[0] || null;
    },
    async getSaleReturnsForSale(saleId) {
      const result = await postgresPool2.query(`
        SELECT sr.*, u.username as processed_by_username
        FROM sales_returns sr
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE sr.sale_id = $1
        ORDER BY sr.created_at DESC, sr.id DESC
      `, [saleId]);
      return result.rows;
    },
    async getSaleItemsForInvoice(saleId) {
      const normalizeSaleItemSpecs = (value) => {
        let specs = {};
        try {
          specs = value && typeof value === "object" ? value : JSON.parse(String(value || "{}"));
        } catch {
          specs = {};
        }
        const sourced = Boolean(specs?.sourced_item);
        const consignment = Boolean(specs?.consignment_item);
        const consignmentItemId = Math.max(0, Number(specs?.consignment_item_id || 0) || 0);
        const consignmentItemName = consignment ? String(specs?.consignment_item_name || specs?.item_name || "").trim() : "";
        return {
          specs,
          isSourced: sourced,
          isConsignment: consignment,
          sourcedItemName: sourced ? String(specs?.sourced_item_name || "").trim() : "",
          sourcedVendorName: sourced ? String(specs?.sourced_vendor_name || "").trim() : "",
          sourcedVendorReference: sourced ? String(specs?.sourced_vendor_reference || "").trim() : "",
          sourcedCostPrice: sourced ? Math.max(0, Number(specs?.sourced_cost_price || 0) || 0) : null,
          consignmentItemId,
          consignmentItemName
        };
      };
      const items = (await postgresPool2.query(`
        SELECT si.*, p.name as product_name, p.quick_code as product_quick_code, p.specs as product_specs, COALESCE(c.name, p.category, 'General') as category_name
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE si.sale_id = $1
        ORDER BY si.id ASC
      `, [saleId])).rows;
      const returnRows = (await postgresPool2.query("SELECT items FROM sales_returns WHERE sale_id = $1 ORDER BY id ASC", [saleId])).rows;
      const parsedSpecsBySaleItemId = /* @__PURE__ */ new Map();
      const consignmentItemIds = /* @__PURE__ */ new Set();
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
      const consignmentNameById = /* @__PURE__ */ new Map();
      if (consignmentItemIds.size > 0) {
        const ids = Array.from(consignmentItemIds.values());
        const consignmentRows = (await postgresPool2.query(
          "SELECT id, item_name FROM consignment_items WHERE id = ANY($1::int[])",
          [ids]
        )).rows;
        consignmentRows.forEach((row) => {
          consignmentNameById.set(Number(row.id), String(row.item_name || "").trim());
        });
      }
      const returnedQuantityBySaleItem = /* @__PURE__ */ new Map();
      for (const row of returnRows) {
        let parsedItems = [];
        try {
          parsedItems = Array.isArray(row?.items) ? row.items : JSON.parse(String(row?.items || "[]"));
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
        const productName = String(item.product_name || "").trim();
        const isPlaceholderProduct = productName === "__CONSIGNMENT_PLACEHOLDER__" || productName === "__SOURCED_PLACEHOLDER__";
        const resolvedName = parsed.isSourced ? parsed.sourcedItemName || productName || `Product #${item.product_id}` : parsed.isConsignment ? parsed.consignmentItemName || consignmentNameById.get(parsed.consignmentItemId) || (!isPlaceholderProduct ? productName : "") || `Consignment Item #${parsed.consignmentItemId || item.product_id}` : productName || `Product #${item.product_id}`;
        return {
          ...item,
          product_name: resolvedName,
          item_source: parsed.isSourced ? "SOURCED" : parsed.isConsignment ? "CONSIGNMENT" : "INVENTORY",
          sourced_vendor_name: parsed.sourcedVendorName || null,
          sourced_vendor_reference: parsed.sourcedVendorReference || null,
          quantity: soldQuantity,
          returned_quantity: returnedQuantity,
          returnable_quantity: Math.max(0, soldQuantity - returnedQuantity),
          subtotal: Number(item?.subtotal ?? Number(item?.price_at_sale || 0) * soldQuantity) || 0,
          price_at_sale: Number(item?.price_at_sale || 0) || 0,
          cost_at_sale: parsed.isSourced ? parsed.sourcedCostPrice : item.cost_at_sale == null ? null : Number(item.cost_at_sale || 0),
          specs_at_sale: parsed.specs
        };
      });
    },
    async getSaleDetails(storeId, saleId) {
      const [sale, items, returns] = await Promise.all([
        this.getSaleById(storeId, saleId),
        this.getSaleItemsForInvoice(saleId),
        this.getSaleReturnsForSale(saleId)
      ]);
      return { sale, items, returns };
    },
    async getCustomerInvoices(storeId, customerId) {
      const [customer, salesResult] = await Promise.all([
        this.getCustomerById(storeId, customerId),
        this.listSales({ storeId, customerId })
      ]);
      return {
        customer,
        sales: salesResult.rows
      };
    },
    async listReturns(options) {
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const search = rawSearch.toLowerCase();
      const typeFilter = typeof options.returnType === "string" ? options.returnType.trim().toUpperCase() : "";
      const filters = ["sr.store_id = $1"];
      const params = [options.storeId];
      let nextParam = 2;
      if (typeFilter && ["REFUND", "EXCHANGE", "RETURN_ONLY"].includes(typeFilter)) {
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
      const result = await postgresPool2.query(`
        SELECT sr.*, u.username as processed_by_username, c.name as customer_name, c.phone as customer_phone
        FROM sales_returns sr
        LEFT JOIN sales s ON sr.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE ${filters.join(" AND ")}
        ORDER BY sr.created_at DESC, sr.id DESC
      `, params);
      return result.rows;
    },
    async listMarketCollections(options) {
      const normalizedStatus = String(options.status || "").trim().toUpperCase();
      const shouldFilterStatus = ["OPEN", "SOLD", "RETURNED"].includes(normalizedStatus);
      const params = [options.storeId];
      const filters = ["mc.store_id = $1"];
      if (shouldFilterStatus) {
        filters.push("UPPER(mc.status) = $2");
        params.push(normalizedStatus);
      }
      const result = await postgresPool2.query(`
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE ${filters.join(" AND ")}
        ORDER BY CASE mc.status WHEN 'OPEN' THEN 0 WHEN 'SOLD' THEN 1 ELSE 2 END, mc.created_at DESC, mc.id DESC
      `, params);
      return result.rows;
    },
    async listLayawayPlans(storeId) {
      const result = await postgresPool2.query(`
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
      return result.rows;
    },
    async getDailyReminders(storeId) {
      const [pendingSales, marketCollections] = await Promise.all([
        postgresPool2.query(`
          SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
          FROM sales s
          LEFT JOIN users u ON s.user_id = u.id
          LEFT JOIN customers c ON s.customer_id = c.id
          WHERE s.store_id = $1 AND s.status = 'PENDING' AND s.deleted_at IS NULL
          ORDER BY COALESCE(s.due_date, s.timestamp) ASC, s.timestamp DESC
        `, [storeId]).then((result) => result.rows),
        this.listMarketCollections({ storeId, status: "OPEN" })
      ]);
      return { pendingSales, marketCollections };
    },
    async listCategories(storeId) {
      const result = await postgresPool2.query(`
        SELECT *
        FROM categories
        WHERE store_id = $1
        ORDER BY LOWER(COALESCE(name, '')) ASC, id ASC
      `, [storeId]);
      return result.rows;
    },
    async listDeletedProducts() {
      const result = await postgresPool2.query(`
        SELECT *
        FROM products
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC, id DESC
      `);
      return result.rows;
    },
    async listActiveHolds(storeId) {
      const result = await postgresPool2.query(`
        SELECT *
        FROM active_holds
        WHERE store_id = $1
        ORDER BY timestamp DESC, id DESC
      `, [storeId]);
      return result.rows;
    },
    async getInventoryDailySummary(storeId, requestedDate, requestedDays) {
      const getLocalDateKey = (date = /* @__PURE__ */ new Date()) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const getAddedUnitsForDate = async (dateValue) => {
        const productsForDate = (await postgresPool2.query(`
          SELECT stock, condition_matrix
          FROM products
          WHERE store_id = $1
            AND deleted_at IS NULL
            AND DATE(COALESCE(created_at, CURRENT_TIMESTAMP)) = DATE($2)
        `, [storeId, dateValue])).rows;
        return productsForDate.reduce((sum, product) => {
          if (product.condition_matrix) {
            try {
              const matrix = typeof product.condition_matrix === "string" ? JSON.parse(product.condition_matrix) : product.condition_matrix;
              return sum + Number(matrix?.new?.stock || 0) + Number(matrix?.open_box?.stock || 0) + Number(matrix?.used?.stock || 0);
            } catch {
              return sum + (Number(product.stock) || 0);
            }
          }
          return sum + (Number(product.stock) || 0);
        }, 0);
      };
      const getSoldUnitsForDate = async (dateValue) => {
        const soldResult = (await postgresPool2.query(`
          SELECT COALESCE(SUM(si.quantity), 0) as count
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND DATE(s.timestamp) = DATE($2)
        `, [storeId, dateValue])).rows[0];
        return Number(soldResult?.count) || 0;
      };
      const baseDate = /* @__PURE__ */ new Date(`${requestedDate}T12:00:00`);
      const trend = await Promise.all(Array.from({ length: requestedDays }, async (_, index) => {
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() - (requestedDays - 1 - index));
        const dateStr = getLocalDateKey(date);
        return {
          date: dateStr,
          label: date.toLocaleDateString("en-US", { weekday: "short" }),
          added: await getAddedUnitsForDate(dateStr),
          sold: await getSoldUnitsForDate(dateStr)
        };
      }));
      return {
        selectedDate: requestedDate,
        addedToday: await getAddedUnitsForDate(requestedDate),
        soldToday: await getSoldUnitsForDate(requestedDate),
        trend
      };
    },
    async listStockAdjustments(options) {
      const rawSearch = typeof options.search === "string" ? options.search.trim() : "";
      const search = rawSearch.toLowerCase();
      const typeFilter = typeof options.typeFilter === "string" ? options.typeFilter.trim().toUpperCase() : "";
      const productIdFilter = Number(options.productIdFilter);
      const filters = ["sa.store_id = $1"];
      const params = [options.storeId];
      let nextParam = 2;
      if (typeFilter && ["DAMAGED", "LOST", "FOUND", "MANUAL", "INTERNAL_USE", "RESTOCK", "COUNT"].includes(typeFilter)) {
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
      const result = await postgresPool2.query(`
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE ${filters.join(" AND ")}
        ORDER BY sa.created_at DESC, sa.id DESC
      `, params);
      return result.rows;
    },
    async getDashboardActivityFeed(options) {
      const role = String(options.role || "STAFF").toUpperCase();
      const restrictToOwnActivity = role === "STAFF";
      const canViewExpenses = ["STORE_ADMIN", "MANAGER", "ACCOUNTANT"].includes(role);
      const limit = Math.min(12, Math.max(4, Number(options.limit) || 8));
      const [saleRowsResult, stockRowsResult, expenseRowsResult] = await Promise.all([
        restrictToOwnActivity ? postgresPool2.query(`
              SELECT s.id, s.total, s.status, s.sale_channel, s.timestamp, u.username as user_username, c.name as customer_name
              FROM sales s
              LEFT JOIN users u ON s.user_id = u.id
              LEFT JOIN customers c ON s.customer_id = c.id
              WHERE s.store_id = $1 AND s.deleted_at IS NULL AND s.user_id = $2
              ORDER BY s.timestamp DESC, s.id DESC
              LIMIT $3
            `, [options.storeId, options.userId, limit]) : postgresPool2.query(`
              SELECT s.id, s.total, s.status, s.sale_channel, s.timestamp, u.username as user_username, c.name as customer_name
              FROM sales s
              LEFT JOIN users u ON s.user_id = u.id
              LEFT JOIN customers c ON s.customer_id = c.id
              WHERE s.store_id = $1 AND s.deleted_at IS NULL
              ORDER BY s.timestamp DESC, s.id DESC
              LIMIT $2
            `, [options.storeId, limit]),
        restrictToOwnActivity ? postgresPool2.query(`
              SELECT sa.id, sa.adjustment_mode, sa.quantity_change, sa.cost_impact, sa.created_at,
                     p.name as product_name, u.username as user_username
              FROM stock_adjustments sa
              LEFT JOIN products p ON sa.product_id = p.id
              LEFT JOIN users u ON sa.adjusted_by = u.id
              WHERE sa.store_id = $1 AND sa.adjusted_by = $2
              ORDER BY sa.created_at DESC, sa.id DESC
              LIMIT $3
            `, [options.storeId, options.userId, limit]) : postgresPool2.query(`
              SELECT sa.id, sa.adjustment_mode, sa.quantity_change, sa.cost_impact, sa.created_at,
                     p.name as product_name, u.username as user_username
              FROM stock_adjustments sa
              LEFT JOIN products p ON sa.product_id = p.id
              LEFT JOIN users u ON sa.adjusted_by = u.id
              WHERE sa.store_id = $1
              ORDER BY sa.created_at DESC, sa.id DESC
              LIMIT $2
            `, [options.storeId, limit]),
        canViewExpenses ? postgresPool2.query(`
              SELECT e.id, e.title, e.amount, e.created_at, u.username as user_username
              FROM expenses e
              LEFT JOIN users u ON e.created_by = u.id
              WHERE e.store_id = $1
              ORDER BY e.created_at DESC, e.id DESC
              LIMIT $2
            `, [options.storeId, limit]) : Promise.resolve({ rows: [] })
      ]);
      return {
        saleRows: saleRowsResult.rows,
        stockRows: stockRowsResult.rows,
        expenseRows: expenseRowsResult.rows
      };
    },
    async listSystemLogs(options) {
      const staffName = String(options.staffName || "").trim().toLowerCase();
      const actionType = String(options.actionType || "").trim().toUpperCase();
      const todayOnly = Boolean(options.todayOnly);
      const highRiskOnly = Boolean(options.highRiskOnly);
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 20));
      const offset = Math.max(0, Number(options.offset) || 0);
      const highRiskActions = Array.isArray(options.highRiskActions) ? options.highRiskActions.map((action) => String(action || "").trim().toUpperCase()).filter(Boolean) : [];
      const filters = ["store_id = $1"];
      const params = [options.storeId];
      let nextParam = 2;
      if (staffName) {
        filters.push(`LOWER(COALESCE(user_name, '')) LIKE $${nextParam}`);
        params.push(`%${staffName}%`);
        nextParam += 1;
      }
      if (actionType && actionType !== "ALL") {
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
      const whereClause = filters.join(" AND ");
      const [dataResult, countResult] = await Promise.all([
        postgresPool2.query(`
          SELECT id, user_id, user_name, action_type, description, old_value, new_value, timestamp
          FROM system_logs
          WHERE ${whereClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT $${nextParam} OFFSET $${nextParam + 1}
        `, [...params, limit, offset]),
        postgresPool2.query(`
          SELECT COUNT(*)::int AS total
          FROM system_logs
          WHERE ${whereClause}
        `, params)
      ]);
      return {
        rows: dataResult.rows,
        total: Number(countResult.rows[0]?.total || 0)
      };
    },
    async getSystemLogsSummary(storeId) {
      const [todayStatsResult, recentHighRiskResult] = await Promise.all([
        postgresPool2.query(`
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
        postgresPool2.query(`
          SELECT id, user_name, action_type, description, timestamp
          FROM system_logs
          WHERE store_id = $1
            AND UPPER(action_type) IN ('PRICE_CHANGE', 'DELETE', 'STOCK_ADJUST')
          ORDER BY timestamp DESC, id DESC
          LIMIT 6
        `, [storeId])
      ]);
      return {
        todayStats: todayStatsResult.rows[0] || null,
        recentHighRisk: recentHighRiskResult.rows
      };
    },
    async listAuditFlags(storeId) {
      const result = await postgresPool2.query(`
        SELECT tf.*, u.username as flagged_by_username, s.total as sale_total, s.discount_amount, s.timestamp as sale_timestamp
        FROM transaction_flags tf
        LEFT JOIN users u ON tf.flagged_by = u.id
        LEFT JOIN sales s ON tf.sale_id = s.id
        WHERE tf.store_id = $1
        ORDER BY CASE tf.status WHEN 'OPEN' THEN 0 ELSE 1 END, tf.created_at DESC, tf.id DESC
      `, [storeId]);
      return result.rows;
    },
    async exportStoreData(storeId) {
      const fetchAllRows = async (queryText, params = [], batchSize = 1e3) => {
        const rows = [];
        for (let offset = 0; ; offset += batchSize) {
          const batch = await postgresPool2.query(`${queryText} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, batchSize, offset]);
          rows.push(...batch.rows);
          if (batch.rows.length < batchSize) {
            break;
          }
        }
        return rows;
      };
      const storeResult = await postgresPool2.query("SELECT * FROM stores WHERE id = $1 LIMIT 1", [storeId]);
      const usersResult = await fetchAllRows("SELECT * FROM users WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const categoriesResult = await fetchAllRows("SELECT * FROM categories WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const productsResult = await fetchAllRows("SELECT * FROM products WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const stockAdjustmentsResult = await fetchAllRows("SELECT * FROM stock_adjustments WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const salesResult = await fetchAllRows("SELECT * FROM sales WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const saleItemsResult = await fetchAllRows("SELECT * FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1) ORDER BY id ASC", [storeId]);
      const salesReturnsResult = await fetchAllRows("SELECT * FROM sales_returns WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const transactionFlagsResult = await fetchAllRows("SELECT * FROM transaction_flags WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const holdsResult = await fetchAllRows("SELECT * FROM active_holds WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const customersResult = await fetchAllRows("SELECT * FROM customers WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const suppliersResult = await fetchAllRows("SELECT * FROM suppliers WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const purchaseOrdersResult = await fetchAllRows("SELECT * FROM purchase_orders WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const inventoryBatchesResult = await fetchAllRows("SELECT * FROM inventory_batches WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const proformasResult = await fetchAllRows("SELECT * FROM pro_formas WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const expensesResult = await fetchAllRows("SELECT * FROM expenses WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const internalMessagesResult = await fetchAllRows("SELECT * FROM internal_messages WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const handoverNotesResult = await fetchAllRows("SELECT * FROM handover_notes WHERE store_id = $1 ORDER BY is_pinned DESC, created_at DESC, id DESC", [storeId]);
      const staffAttendanceResult = await fetchAllRows("SELECT * FROM staff_attendance WHERE store_id = $1 ORDER BY shift_date DESC, clock_in_at DESC, id DESC", [storeId]);
      const repairTicketsResult = await fetchAllRows("SELECT * FROM repair_tickets WHERE store_id = $1 ORDER BY id ASC", [storeId]);
      const marketCollectionsResult = await fetchAllRows("SELECT * FROM market_collections WHERE store_id = $1 ORDER BY id ASC", [storeId]);
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
        marketCollections: marketCollectionsResult
      };
    },
    async listHandoverNotes(storeId, limit) {
      const result = await postgresPool2.query(`
        SELECT n.*, u.username as author_username, u.role as author_role
        FROM handover_notes n
        LEFT JOIN users u ON n.author_id = u.id
        WHERE n.store_id = $1
        ORDER BY n.is_pinned DESC, n.created_at DESC, n.id DESC
        LIMIT $2
      `, [storeId, limit]);
      return result.rows;
    },
    async getAttendanceOverview(storeId, currentUserId, selectedDate, isLeadership) {
      const currentSessionResult = await postgresPool2.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2 AND sa.clock_out_at IS NULL
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT 1
      `, [storeId, currentUserId]);
      const myEntriesResult = await postgresPool2.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT 14
      `, [storeId, currentUserId]);
      const teamEntriesResult = isLeadership ? await postgresPool2.query(`
            SELECT sa.*, u.username as user_name, u.role
            FROM staff_attendance sa
            LEFT JOIN users u ON sa.user_id = u.id
            WHERE sa.store_id = $1 AND sa.shift_date = $2
            ORDER BY CASE WHEN sa.clock_out_at IS NULL THEN 0 ELSE 1 END, sa.clock_in_at DESC, sa.id DESC
          `, [storeId, selectedDate]) : { rows: [] };
      return {
        currentSession: currentSessionResult.rows[0] || null,
        myEntries: myEntriesResult.rows,
        teamEntries: teamEntriesResult.rows
      };
    },
    async getAttendanceHistory(storeId, userId, page, limit) {
      const offset = (page - 1) * limit;
      const countResult = await postgresPool2.query(
        "SELECT COUNT(*) FROM staff_attendance WHERE store_id = $1 AND user_id = $2",
        [storeId, userId]
      );
      const total = Number(countResult.rows[0]?.count || 0);
      const rowsResult = await postgresPool2.query(`
        SELECT sa.*, u.username as user_name, u.role
        FROM staff_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.store_id = $1 AND sa.user_id = $2
        ORDER BY sa.clock_in_at DESC, sa.id DESC
        LIMIT $3 OFFSET $4
      `, [storeId, userId, limit, offset]);
      return { rows: rowsResult.rows, total, page, limit };
    }
  };
};

// serverWriteRepository.settings.ts
var withPostgresTransaction = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      attempt += 1;
      const isUniqueViolation6 = error instanceof Error && "code" in error && error.code === "23505";
      if (isUniqueViolation6 && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};
var getSingleQueryRow = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var getQueryRows = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows;
};
var deleteStoreCascade = async (client, storeId) => {
  await client.query("DELETE FROM sales_returns WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)", [storeId]);
  await client.query("DELETE FROM transaction_flags WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)", [storeId]);
  await client.query("DELETE FROM vendor_payables WHERE store_id = $1 OR sale_id IN (SELECT id FROM sales WHERE store_id = $1)", [storeId]);
  await client.query("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)", [storeId]);
  await client.query("DELETE FROM stock_adjustments WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM staff_attendance WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM inventory_batches WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM purchase_orders WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM market_collections WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM repair_tickets WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM expenses WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM pro_formas WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM active_holds WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM system_activity_logs WHERE store_id = $1", [storeId]);
  try {
    await client.query("DELETE FROM system_logs WHERE store_id = $1", [storeId]);
  } catch {
  }
  await client.query("DELETE FROM internal_messages WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM handover_notes WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM consignment_vendor_bank_details WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM consignment_items WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM product_change_requests WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM sales WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM products WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM categories WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM customers WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM suppliers WHERE store_id = $1", [storeId]);
  await client.query(
    "UPDATE consignment_items SET added_by = NULL WHERE added_by IN (SELECT id FROM users WHERE store_id = $1)",
    [storeId]
  );
  await client.query("DELETE FROM users WHERE store_id = $1", [storeId]);
  await client.query("DELETE FROM stores WHERE id = $1", [storeId]);
};
var createSettingsWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async updateStoreSettings(input) {
    const result = await postgresPool2.query(`
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
      input.storeId
    ]);
    return result.rows[0] || null;
  },
  async deleteStore(input) {
    await withPostgresTransaction(postgresPool2, async (client) => {
      await deleteStoreCascade(client, input.storeId);
    });
    return input.storeId;
  },
  async deleteStoreRecord(storeId) {
    await withPostgresTransaction(postgresPool2, async (client) => {
      await deleteStoreCascade(client, storeId);
    });
    return storeId;
  },
  async deleteUser(input) {
    let deletedUserId = null;
    await withPostgresTransaction(postgresPool2, async (client) => {
      const existingUser = await getSingleQueryRow(
        client,
        "SELECT id, store_id, role FROM users WHERE id = $1 LIMIT 1",
        [input.userId]
      );
      if (!existingUser) return;
      const actorUserId = Number(input.actorUserId || 0) > 0 ? Number(input.actorUserId) : null;
      const fallbackCandidates = await getQueryRows(
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
        [Number(existingUser.id), actorUserId ?? -1, existingUser.store_id ?? -1]
      );
      const fallbackUserId = Number(fallbackCandidates[0]?.id || 0) || null;
      const referenceCounts = await Promise.all([
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM sales WHERE user_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM sales_returns WHERE processed_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM stock_adjustments WHERE adjusted_by = $1 OR approved_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM active_holds WHERE user_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM internal_messages WHERE sender_id = $1 OR recipient_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM handover_notes WHERE author_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM expenses WHERE created_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM system_activity_logs WHERE user_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM transaction_flags WHERE flagged_by = $1 OR resolved_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM purchase_orders WHERE created_by = $1 OR received_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM market_collections WHERE created_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM repair_tickets WHERE created_by = $1 OR updated_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM staff_attendance WHERE user_id = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM consignment_items WHERE added_by = $1 OR approved_by = $1", [Number(existingUser.id)]),
        getSingleQueryRow(client, "SELECT COUNT(*) as count FROM product_change_requests WHERE requested_by = $1 OR reviewed_by = $1", [Number(existingUser.id)])
      ]);
      let systemLogsCount = 0;
      try {
        const systemLogsRow = await getSingleQueryRow(client, "SELECT COUNT(*) as count FROM system_logs WHERE user_id = $1", [Number(existingUser.id)]);
        systemLogsCount = Number(systemLogsRow?.count || 0);
      } catch {
        systemLogsCount = 0;
      }
      const totalReferences = referenceCounts.reduce((sum, row) => sum + Number(row?.count || 0), 0) + systemLogsCount;
      if (totalReferences > 0 && !fallbackUserId) {
        throw new Error("This user still owns sales, stock, attendance, messaging, or audit history. Add another admin or staff account first, then retry the deletion.");
      }
      if (fallbackUserId) {
        const fromUserId = Number(existingUser.id);
        await client.query("UPDATE sales SET user_id = $1 WHERE user_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE sales_returns SET processed_by = $1 WHERE processed_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE stock_adjustments SET adjusted_by = $1 WHERE adjusted_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE stock_adjustments SET approved_by = $1 WHERE approved_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE active_holds SET user_id = $1 WHERE user_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE internal_messages SET sender_id = $1 WHERE sender_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE internal_messages SET recipient_id = $1 WHERE recipient_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE handover_notes SET author_id = $1 WHERE author_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE expenses SET created_by = $1 WHERE created_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE system_activity_logs SET user_id = $1 WHERE user_id = $2", [fallbackUserId, fromUserId]);
        try {
          await client.query("UPDATE system_logs SET user_id = $1 WHERE user_id = $2", [fallbackUserId, fromUserId]);
        } catch {
        }
        await client.query("UPDATE transaction_flags SET flagged_by = $1 WHERE flagged_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE transaction_flags SET resolved_by = $1 WHERE resolved_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE purchase_orders SET created_by = $1 WHERE created_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE purchase_orders SET received_by = $1 WHERE received_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE market_collections SET created_by = $1 WHERE created_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE repair_tickets SET created_by = $1 WHERE created_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE repair_tickets SET updated_by = $1 WHERE updated_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE staff_attendance SET user_id = $1 WHERE user_id = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE consignment_items SET added_by = $1 WHERE added_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE consignment_items SET approved_by = $1 WHERE approved_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE product_change_requests SET requested_by = $1 WHERE requested_by = $2", [fallbackUserId, fromUserId]);
        await client.query("UPDATE product_change_requests SET reviewed_by = $1 WHERE reviewed_by = $2", [fallbackUserId, fromUserId]);
      }
      await client.query("DELETE FROM users WHERE id = $1", [Number(existingUser.id)]);
      deletedUserId = Number(existingUser.id);
    });
    return deletedUserId;
  }
});

// serverWriteRepository.customers.ts
var isUniqueViolation = (error) => error instanceof Error && "code" in error && error.code === "23505";
var withPostgresTransaction2 = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
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
var normalizePhone = (value) => String(value ?? "").replace(/\D/g, "");
var getSingleQueryRow2 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var createCustomersWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createCustomer(input) {
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    let createdCustomer = null;
    await withPostgresTransaction2(postgresPool2, async (client) => {
      const duplicateCustomer = await getSingleQueryRow2(
        client,
        `SELECT id FROM customers
         WHERE store_id = $1
           AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
         LIMIT 1`,
        [input.storeId, normalizePhone(input.phone)]
      );
      if (duplicateCustomer) {
        throw new Error("A customer with this phone number already exists");
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
        createdAt
      ]);
      createdCustomer = result.rows[0] || null;
    });
    return createdCustomer || {
      store_id: input.storeId,
      name: input.name,
      phone: input.phone,
      address: input.address || null,
      customer_code: input.customerCode,
      created_at: createdAt
    };
  },
  async updateCustomer(input) {
    let updatedCustomer = null;
    await withPostgresTransaction2(postgresPool2, async (client) => {
      const existingCustomer = await getSingleQueryRow2(
        client,
        "SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1",
        [input.customerId, input.storeId]
      );
      if (!existingCustomer) {
        throw new Error("Customer not found");
      }
      const duplicateCustomer = await getSingleQueryRow2(
        client,
        `SELECT id FROM customers
         WHERE store_id = $1
           AND id <> $2
           AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $3
         LIMIT 1`,
        [input.storeId, input.customerId, normalizePhone(input.phone)]
      );
      if (duplicateCustomer) {
        throw new Error("A customer with this phone number already exists");
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
        input.storeId
      ]);
      updatedCustomer = result.rows[0] || existingCustomer;
    });
    return updatedCustomer;
  },
  async deleteCustomer(input) {
    await withPostgresTransaction2(postgresPool2, async (client) => {
      const existingCustomer = await getSingleQueryRow2(
        client,
        "SELECT * FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1",
        [input.customerId, input.storeId]
      );
      if (!existingCustomer) {
        throw new Error("Customer not found");
      }
      const outstandingRow = await getSingleQueryRow2(client, `
        SELECT COALESCE(SUM(GREATEST(0, total - COALESCE(amount_paid, total))), 0)::numeric as outstanding
        FROM sales
        WHERE store_id = $1 AND customer_id = $2 AND status IN ('PENDING', 'LAYAWAY', 'INSTALLMENT')
      `, [input.storeId, input.customerId]);
      if (Number(outstandingRow?.outstanding || 0) > 0) {
        throw new Error("This customer has an outstanding balance and cannot be deleted.");
      }
      await client.query("UPDATE pro_formas SET customer_id = NULL WHERE store_id = $1 AND customer_id = $2", [input.storeId, input.customerId]);
      await client.query("DELETE FROM customers WHERE id = $1 AND store_id = $2", [input.customerId, input.storeId]);
    });
    return { success: true, deletedId: input.customerId };
  }
});

// serverWriteRepository.catalog.ts
var createCatalogWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createCategory(input) {
    const result = await postgresPool2.query(`
      INSERT INTO categories (store_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [input.storeId, input.name, input.description || null]);
    return result.rows[0] || null;
  },
  async updateCategory(input) {
    const result = await postgresPool2.query(`
      UPDATE categories
      SET name = $1, description = $2
      WHERE id = $3 AND store_id = $4
      RETURNING *
    `, [input.name, input.description || null, input.categoryId, input.storeId]);
    return result.rows[0] || null;
  },
  async deleteCategory(input) {
    const usageResult = await postgresPool2.query(
      "SELECT COUNT(*)::int AS count FROM products WHERE store_id = $1 AND category_id = $2 AND deleted_at IS NULL",
      [input.storeId, input.categoryId]
    );
    const usageCount = Number(usageResult.rows[0]?.count || 0);
    if (usageCount > 0) {
      throw new Error(`This category is still assigned to ${usageCount} product${usageCount === 1 ? "" : "s"}. Move those products first, then retry.`);
    }
    await postgresPool2.query("DELETE FROM categories WHERE id = $1 AND store_id = $2", [input.categoryId, input.storeId]);
    return input.categoryId;
  },
  async restoreDeletedProduct(input) {
    const result = await postgresPool2.query("UPDATE products SET deleted_at = NULL WHERE id = $1 RETURNING *", [input.productId]);
    return result.rows[0] || null;
  },
  async createActiveHold(input) {
    const result = await postgresPool2.query(`
      INSERT INTO active_holds (store_id, user_id, staff_name, customer_name, note, cart_data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      input.storeId,
      input.userId,
      input.staffName,
      input.customerName || null,
      input.note || null,
      JSON.stringify(input.cartData)
    ]);
    return result.rows[0] || null;
  },
  async deleteActiveHold(input) {
    await postgresPool2.query("DELETE FROM active_holds WHERE id = $1 AND store_id = $2", [input.holdId, input.storeId]);
    return input.holdId;
  },
  async clearActiveHolds(input = {}) {
    if (input.storeId != null && Number.isInteger(Number(input.storeId)) && Number(input.storeId) > 0) {
      await postgresPool2.query("DELETE FROM active_holds WHERE store_id = $1", [Number(input.storeId)]);
    } else {
      await postgresPool2.query("DELETE FROM active_holds");
    }
    return input.storeId ?? null;
  }
});

// serverWriteRepository.staff.ts
var toUniquePositiveIds = (values) => Array.from(new Set(
  values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
));
var createStaffWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createHandoverNote(input) {
    const result = await postgresPool2.query(`
      INSERT INTO handover_notes (store_id, author_id, note_text, priority, is_pinned, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id
    `, [input.storeId, input.authorId, input.noteText, input.priority, input.isPinned ? 1 : 0]);
    const noteId = Number(result.rows[0]?.id || 0);
    const noteResult = await postgresPool2.query(`
      SELECT n.*, u.username as author_username, u.role as author_role
      FROM handover_notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.id = $1 AND n.store_id = $2
      LIMIT 1
    `, [noteId, input.storeId]);
    return noteResult.rows[0] || null;
  },
  async updateHandoverNotePin(input) {
    const result = await postgresPool2.query(`
      UPDATE handover_notes
      SET is_pinned = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND store_id = $3
      RETURNING id
    `, [input.isPinned ? 1 : 0, input.noteId, input.storeId]);
    if (!result.rows[0]) return null;
    const noteResult = await postgresPool2.query(`
      SELECT n.*, u.username as author_username, u.role as author_role
      FROM handover_notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.id = $1 AND n.store_id = $2
      LIMIT 1
    `, [input.noteId, input.storeId]);
    return noteResult.rows[0] || null;
  },
  async deleteHandoverNote(input) {
    await postgresPool2.query("DELETE FROM handover_notes WHERE id = $1 AND store_id = $2", [input.noteId, input.storeId]);
    return input.noteId;
  },
  async createAttendanceClockIn(input) {
    const openCheck = await postgresPool2.query(`
      SELECT id FROM staff_attendance
      WHERE store_id = $1 AND user_id = $2 AND clock_out_at IS NULL
      LIMIT 1
    `, [input.storeId, input.userId]);
    const existingOpenSession = openCheck.rows[0] || null;
    if (existingOpenSession) {
      return { existingOpenSession, entry: null };
    }
    const insertResult = await postgresPool2.query(`
      INSERT INTO staff_attendance (store_id, user_id, shift_date, clock_in_at, note)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
      RETURNING id
    `, [input.storeId, input.userId, input.shiftDate, input.note || null]);
    const attendanceId = Number(insertResult.rows[0]?.id || 0);
    const entryResult = await postgresPool2.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1 AND sa.store_id = $2
      LIMIT 1
    `, [attendanceId, input.storeId]);
    const entry = entryResult.rows[0] || null;
    return { existingOpenSession: null, entry };
  },
  async clockOutAttendance(input) {
    const openSessionResult = await postgresPool2.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.store_id = $1 AND sa.user_id = $2 AND sa.clock_out_at IS NULL
      ORDER BY sa.clock_in_at DESC, sa.id DESC
      LIMIT 1
    `, [input.storeId, input.userId]);
    const openSession = openSessionResult.rows[0] || null;
    if (!openSession) {
      return { openSession: null, entry: null };
    }
    await postgresPool2.query(`
      UPDATE staff_attendance
      SET clock_out_at = CURRENT_TIMESTAMP, total_minutes = $1, note = $2
      WHERE id = $3 AND store_id = $4
    `, [input.totalMinutes, input.note || null, openSession.id, input.storeId]);
    const entryResult = await postgresPool2.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1 AND sa.store_id = $2
      LIMIT 1
    `, [openSession.id, input.storeId]);
    const entry = entryResult.rows[0] || null;
    return { openSession, entry };
  },
  async clearAttendanceHistory(storeId, scope, date) {
    let result;
    if (scope === "day") {
      result = await postgresPool2.query(
        "DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date = $2",
        [storeId, date]
      );
    } else if (scope === "month") {
      result = await postgresPool2.query(
        "DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date LIKE $2",
        [storeId, `${date}%`]
      );
    } else {
      result = await postgresPool2.query(
        "DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date LIKE $2",
        [storeId, `${date}%`]
      );
    }
    return Number(result.rowCount || 0);
  },
  async createInternalMessage(input) {
    const result = await postgresPool2.query(`
      INSERT INTO internal_messages (store_id, sender_id, recipient_id, message_text, is_read)
      VALUES ($1, $2, $3, $4, 0)
      RETURNING id
    `, [input.storeId, input.senderId, input.recipientId, input.messageText]);
    const messageId = Number(result.rows[0]?.id || 0);
    const msgResult = await postgresPool2.query(`
      SELECT m.*, sender.username as sender_username, sender.role as sender_role,
             recipient.username as recipient_username, recipient.role as recipient_role
      FROM internal_messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      LEFT JOIN users recipient ON m.recipient_id = recipient.id
      WHERE m.id = $1 AND m.store_id = $2
      LIMIT 1
    `, [messageId, input.storeId]);
    return msgResult.rows[0] || null;
  },
  async markInternalMessagesRead(input) {
    const unreadRows = await postgresPool2.query(`
      SELECT id FROM internal_messages
      WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
    `, [input.storeId, input.senderId, input.recipientId]);
    const unreadMessageIds = unreadRows.rows.map((row) => Number(row.id)).filter((id) => id > 0);
    await postgresPool2.query(`
      UPDATE internal_messages
      SET is_read = 1
      WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
    `, [input.storeId, input.senderId, input.recipientId]);
    return unreadMessageIds;
  },
  async deleteInternalMessages(input) {
    const messageIds = toUniquePositiveIds(input.messageIds || []);
    if (!messageIds.length) {
      return 0;
    }
    const placeholders = messageIds.map((_, index) => `${index + 2}`).join(", ");
    await postgresPool2.query(
      `DELETE FROM internal_messages WHERE store_id = $1 AND id IN (${placeholders})`,
      [input.storeId, ...messageIds]
    );
    return messageIds.length;
  },
  async cleanupInternalMessages(input) {
    const cutoffTs = new Date(Date.now() - input.olderThanValue * (input.olderThanUnit === "day" ? 864e5 : input.olderThanUnit === "week" ? 6048e5 : input.olderThanUnit === "month" ? 2592e6 : 864e5)).toISOString();
    const toDeleteResult = await postgresPool2.query(
      "SELECT id FROM internal_messages WHERE store_id = $1 AND created_at < $2",
      [input.storeId, cutoffTs]
    );
    const messagesToDelete = toDeleteResult.rows.map((row) => Number(row.id));
    const deleteResult = await postgresPool2.query(
      "DELETE FROM internal_messages WHERE store_id = $1 AND created_at < $2",
      [input.storeId, cutoffTs]
    );
    const storeResult = await postgresPool2.query(`
      UPDATE stores
      SET last_chat_cleanup_at = CURRENT_TIMESTAMP,
          chat_retention_value = $1,
          chat_retention_unit = $2
      WHERE id = $3
      RETURNING *
    `, [input.olderThanValue, input.olderThanUnit, input.storeId]);
    return {
      deletedCount: Number(deleteResult.rowCount || 0),
      wouldDeleteCount: messagesToDelete.length,
      store: storeResult.rows[0] || null
    };
  }
});

// serverWriteRepository.expenses.ts
var createExpensesWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createExpense(input) {
    const result = await postgresPool2.query(`
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
      input.createdBy ?? null
    ]);
    return result.rows[0] || null;
  },
  async deleteExpense(input) {
    const existing = await postgresPool2.query("SELECT * FROM expenses WHERE id = $1 AND store_id = $2 LIMIT 1", [input.expenseId, input.storeId]);
    const existingExpense = existing.rows[0] || null;
    const result = await postgresPool2.query("DELETE FROM expenses WHERE id = $1 AND store_id = $2", [input.expenseId, input.storeId]);
    return {
      changes: Number(result.rowCount || 0),
      expense: existingExpense
    };
  },
  async deleteProForma(input) {
    const existing = await postgresPool2.query("SELECT * FROM pro_formas WHERE id = $1 AND store_id = $2 LIMIT 1", [input.proFormaId, input.storeId]);
    const existingProForma = existing.rows[0] || null;
    const result = await postgresPool2.query("DELETE FROM pro_formas WHERE id = $1 AND store_id = $2", [input.proFormaId, input.storeId]);
    return {
      changes: Number(result.rowCount || 0),
      proForma: existingProForma
    };
  },
  async clearExpiredProformas(input) {
    const result = await postgresPool2.query(`
      DELETE FROM pro_formas
      WHERE store_id = $1
        AND DATE(COALESCE(expiry_date, created_at)) < CURRENT_DATE - INTERVAL '30 day'
    `, [input.storeId]);
    return Number(result.rowCount || 0);
  },
  async clearOldActivityLogs(input) {
    const result = await postgresPool2.query(`
      DELETE FROM system_activity_logs
      WHERE store_id = $1
        AND created_at < NOW() - INTERVAL '6 months'
    `, [input.storeId]);
    return Number(result.rowCount || 0);
  }
});

// serverWriteRepository.operations.ts
var isUniqueViolation2 = (error) => error instanceof Error && "code" in error && error.code === "23505";
var withPostgresTransaction3 = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      attempt += 1;
      if (isUniqueViolation2(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};
var safeJsonParse = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
var normalizeCollectionCondition = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_");
};
var normalizeBatchCode = (value) => {
  const raw = String(value || "").trim().slice(0, 80);
  return raw ? raw.toUpperCase() : null;
};
var normalizeBatchExpiryDate = (value) => {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};
var getSingleQueryRow3 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var generateUniqueMarketCollectionCodeForQueryClient = async (client, maxAttempts = 40) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = String(1e4 + Math.floor(Math.random() * 9e4));
    const exists = await getSingleQueryRow3(client, "SELECT id FROM market_collections WHERE tracking_code = $1 LIMIT 1", [code]);
    if (!exists) {
      return code;
    }
  }
  return null;
};
var syncInventoryBatchQuantityForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  quantityDelta
}) => {
  const delta = Math.trunc(Number(quantityDelta) || 0);
  if (!delta) return;
  const normalizedCondition = normalizeCollectionCondition(condition);
  const rows = await getQueryRows2(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);
  if (delta < 0) {
    let remainingToConsume = Math.abs(delta);
    for (const row of rows) {
      if (remainingToConsume <= 0) break;
      const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
      const consume = Math.min(currentRemaining, remainingToConsume);
      if (consume > 0) {
        await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining - consume, Number(row.id)]);
        remainingToConsume -= consume;
      }
    }
    return;
  }
  let remainingToAdd = delta;
  const rowsDescending = [...rows].reverse();
  for (const row of rowsDescending) {
    if (remainingToAdd <= 0) break;
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
    const availableRoom = Math.max(0, currentReceived - currentRemaining);
    const addBack = Math.min(availableRoom, remainingToAdd);
    if (addBack > 0) {
      await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining + addBack, Number(row.id)]);
      remainingToAdd -= addBack;
    }
  }
  if (remainingToAdd > 0) {
    const newestRow = rowsDescending[0];
    if (newestRow?.id) {
      const currentReceived = Math.max(0, Number(newestRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(newestRow?.quantity_remaining || 0) || 0);
      await client.query(
        "UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3",
        [currentReceived + remainingToAdd, currentRemaining + remainingToAdd, Number(newestRow.id)]
      );
    }
  }
};
var getQueryRows2 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows;
};
var getProductStockSnapshotForQueryClient = async ({
  client,
  productId,
  storeId,
  condition
}) => {
  const product = await getSingleQueryRow3(client, "SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, storeId]);
  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }
  const normalizedCondition = normalizeCollectionCondition(condition);
  const store = await getSingleQueryRow3(client, "SELECT mode FROM stores WHERE id = $1 LIMIT 1", [storeId]);
  const storeMode = String(store?.mode || "").toUpperCase();
  const isGadgetStore = storeMode === "GADGET";
  if (isGadgetStore && product.condition_matrix && normalizedCondition) {
    const matrix = safeJsonParse(product.condition_matrix, {});
    const conditionKey = normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${normalizedCondition.replace(/_/g, " ")} is not available for ${product.name}`);
    }
    return {
      product,
      normalizedCondition,
      usesConditionMatrix: true,
      currentStock: Math.max(0, Number(slot.stock || 0))
    };
  }
  if (isGadgetStore && product.condition_matrix && !normalizedCondition) {
    throw new Error(`Select a product condition for ${product.name} before adjusting stock.`);
  }
  return {
    product,
    normalizedCondition: null,
    usesConditionMatrix: false,
    currentStock: Math.max(0, Number(product.stock || 0))
  };
};
var updateProductAvailableStockForQueryClient = async ({
  client,
  productId,
  storeId,
  quantity,
  condition,
  operation
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient({ client, productId, storeId, condition });
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  if (!normalizedQuantity) {
    throw new Error("Invalid collection quantity supplied");
  }
  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse(snapshot.product.condition_matrix, {});
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, " ")} is not available for ${snapshot.product.name}`);
    }
    const currentStock2 = Number(slot.stock || 0);
    const nextStock2 = operation === "decrease" ? currentStock2 - normalizedQuantity : currentStock2 + normalizedQuantity;
    if (nextStock2 < 0) {
      throw new Error(`Not enough available stock for ${snapshot.product.name}`);
    }
    slot.stock = nextStock2;
    await client.query("UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3", [JSON.stringify(matrix), productId, storeId]);
    await syncInventoryBatchQuantityForQueryClient({
      client,
      productId,
      storeId,
      condition: snapshot.normalizedCondition,
      quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
    });
    return snapshot.product;
  }
  const currentStock = Number(snapshot.product.stock || 0);
  const nextStock = operation === "decrease" ? currentStock - normalizedQuantity : currentStock + normalizedQuantity;
  if (nextStock < 0) {
    throw new Error(`Not enough available stock for ${snapshot.product.name}`);
  }
  await client.query("UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3", [nextStock, productId, storeId]);
  await syncInventoryBatchQuantityForQueryClient({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
  });
  return snapshot.product;
};
var createOperationsWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createMarketCollection(input) {
    let createdCollection = null;
    await withPostgresTransaction3(postgresPool2, async (client) => {
      const trackingCode = await generateUniqueMarketCollectionCodeForQueryClient(client);
      if (!trackingCode) {
        throw new Error("Failed to generate a unique collection tracking code");
      }
      for (const item of input.items) {
        if (Number(item.consignment_item_id) > 0) {
          const condKey = String(item.condition || "").toLowerCase();
          const ciRow = (await client.query("SELECT public_specs, quantity FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1", [Number(item.consignment_item_id), input.storeId])).rows[0];
          const ciSpecs = ciRow?.public_specs && typeof ciRow.public_specs === "object" ? ciRow.public_specs : (() => {
            try {
              return JSON.parse(ciRow?.public_specs || "{}");
            } catch {
              return {};
            }
          })();
          const ciMatrix = ciSpecs?.__condition_matrix;
          if (ciMatrix && condKey && ciMatrix[condKey]) {
            ciMatrix[condKey].stock = Math.max(0, Number(ciMatrix[condKey].stock || 0) - Number(item.quantity));
            ciSpecs.__condition_matrix = ciMatrix;
            const newTotal = Object.values(ciMatrix).reduce((s, v) => s + Math.max(0, Number(v?.stock || 0)), 0);
            await client.query(
              `UPDATE consignment_items SET public_specs = $1, quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4`,
              [JSON.stringify(ciSpecs), newTotal, Number(item.consignment_item_id), input.storeId]
            );
          } else {
            await client.query(
              `UPDATE consignment_items SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND store_id = $3`,
              [Number(item.quantity), Number(item.consignment_item_id), input.storeId]
            );
          }
        } else {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity),
            condition: item.condition,
            operation: "decrease"
          });
        }
      }
      const result = await client.query(`
        INSERT INTO market_collections (
          store_id, collector_name, phone, items, expected_return_date, tracking_code, status, note, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        input.storeId,
        input.collectorName,
        input.phone,
        JSON.stringify(input.items),
        input.expectedReturnDate,
        trackingCode,
        input.note || null,
        input.createdBy
      ]);
      createdCollection = await getSingleQueryRow3(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [Number(result.rows[0]?.id || 0), input.storeId]);
    });
    return createdCollection;
  },
  async markMarketCollectionSold(input) {
    let soldResult = null;
    await withPostgresTransaction3(postgresPool2, async (client) => {
      const paymentMethods = { cash: Number(input.collection?.total_value || 0) || 0, transfer: 0, pos: 0 };
      const saleNoteParts = [
        `Market collection sold to ${input.collection?.collector_name || "collector"} (Ref: ${input.collection?.tracking_code || input.collectionId})`,
        String(input.collection?.note || "").trim()
      ].filter(Boolean);
      const saleResult = await client.query(`
        INSERT INTO sales (store_id, subtotal, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, $10, $11)
        RETURNING id
      `, [
        input.storeId,
        Number(input.collection?.total_value || 0) || 0,
        0,
        0,
        Number(input.collection?.total_value || 0) || 0,
        input.soldBy,
        JSON.stringify(paymentMethods),
        null,
        null,
        input.collection?.expected_return_date || null,
        saleNoteParts.join(" \u2022 ") || null
      ]);
      const saleId = Number(saleResult.rows[0]?.id || 0);
      for (const item of Array.isArray(input.collection?.items) ? input.collection.items : []) {
        if (Number(item.consignment_item_id) > 0) {
          await client.query(
            `UPDATE consignment_items SET status = CASE WHEN quantity <= 0 THEN 'sold' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2`,
            [Number(item.consignment_item_id), input.storeId]
          );
        } else {
          await client.query(`
            INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            saleId,
            Number(item.product_id),
            Number(item.quantity) || 0,
            Number(item.price_at_collection) || 0,
            Number(item.subtotal) || 0,
            Number(item.cost_at_collection) || 0,
            null,
            item.condition || null,
            JSON.stringify(item.specs_at_collection || {})
          ]);
        }
      }
      await client.query(`
        UPDATE market_collections
        SET status = 'SOLD', converted_sale_id = $1, sold_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
      `, [saleId, input.collectionId, input.storeId]);
      const updatedCollection = await getSingleQueryRow3(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [input.collectionId, input.storeId]);
      soldResult = { saleId, updatedCollection };
    });
    return soldResult;
  },
  async returnMarketCollection(input) {
    let updatedCollection = null;
    await withPostgresTransaction3(postgresPool2, async (client) => {
      for (const item of Array.isArray(input.collection?.items) ? input.collection.items : []) {
        if (Number(item.consignment_item_id) > 0) {
          const retCondKey = String(item.condition || "").toLowerCase();
          const retCiRow = (await client.query("SELECT public_specs, quantity FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1", [Number(item.consignment_item_id), input.storeId])).rows[0];
          const retSpecs = retCiRow?.public_specs && typeof retCiRow.public_specs === "object" ? retCiRow.public_specs : (() => {
            try {
              return JSON.parse(retCiRow?.public_specs || "{}");
            } catch {
              return {};
            }
          })();
          const retMatrix = retSpecs?.__condition_matrix;
          if (retMatrix && retCondKey && retMatrix[retCondKey]) {
            retMatrix[retCondKey].stock = Number(retMatrix[retCondKey].stock || 0) + Number(item.quantity || 0);
            retSpecs.__condition_matrix = retMatrix;
            const retTotal = Object.values(retMatrix).reduce((s, v) => s + Math.max(0, Number(v?.stock || 0)), 0);
            await client.query(
              `UPDATE consignment_items SET public_specs = $1, quantity = $2, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4`,
              [JSON.stringify(retSpecs), retTotal, Number(item.consignment_item_id), input.storeId]
            );
          } else {
            await client.query(
              `UPDATE consignment_items SET quantity = quantity + $1, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND store_id = $3`,
              [Number(item.quantity) || 0, Number(item.consignment_item_id), input.storeId]
            );
          }
        } else {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity) || 0,
            condition: item.condition,
            operation: "increase"
          });
        }
      }
      await client.query(`
        UPDATE market_collections
        SET status = 'RETURNED', returned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND store_id = $2
      `, [input.collectionId, input.storeId]);
      updatedCollection = await getSingleQueryRow3(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [input.collectionId, input.storeId]);
    });
    return updatedCollection;
  },
  async receivePurchaseOrder(input) {
    let receivedResult = null;
    await withPostgresTransaction3(postgresPool2, async (client) => {
      const touchedProductIds = [];
      const createdAdjustmentIds = [];
      const createdBatchIds = [];
      const order = await getSingleQueryRow3(client, "SELECT * FROM purchase_orders WHERE id = $1 AND store_id = $2 LIMIT 1", [input.orderId, input.storeId]);
      if (!order) {
        throw new Error("Purchase order not found");
      }
      if (String(order.status || "").toUpperCase() !== "ORDERED") {
        throw new Error("Only open purchase orders can be received");
      }
      const items = safeJsonParse(order.items, []);
      if (!Array.isArray(items) || !items.length) {
        throw new Error("This purchase order has no items to receive");
      }
      for (const [index, item] of items.entries()) {
        const productId = Number(item?.product_id);
        const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
        const unitCost = Math.max(0, Number(item?.unit_cost || 0) || 0);
        const normalizedCondition = item?.condition ? normalizeCollectionCondition(item.condition) : null;
        const batchCode = normalizeBatchCode(item?.batch_code);
        const expiryDate = normalizeBatchExpiryDate(item?.expiry_date);
        if (!Number.isInteger(productId) || productId <= 0 || quantity <= 0) {
          throw new Error(`Invalid product line found in this order at row ${index + 1}`);
        }
        touchedProductIds.push(productId);
        const snapshot = await getProductStockSnapshotForQueryClient({ client, productId, storeId: input.storeId, condition: normalizedCondition });
        const quantityBefore = Math.max(0, Number(snapshot.currentStock || 0));
        await updateProductAvailableStockForQueryClient({
          client,
          productId,
          storeId: input.storeId,
          quantity,
          condition: normalizedCondition,
          operation: "increase"
        });
        const quantityAfter = quantityBefore + quantity;
        if (unitCost > 0) {
          const latestProduct = await getSingleQueryRow3(client, "SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, input.storeId]);
          if (latestProduct?.condition_matrix && normalizedCondition) {
            const matrix = safeJsonParse(latestProduct.condition_matrix, {});
            const key = normalizedCondition.toLowerCase();
            if (matrix?.[key]) {
              matrix[key] = { ...matrix[key], cost: unitCost };
              await client.query(
                "UPDATE products SET condition_matrix = $1, cost = CASE WHEN COALESCE(cost, 0) <= 0 THEN $2 ELSE cost END WHERE id = $3 AND store_id = $4",
                [JSON.stringify(matrix), unitCost, productId, input.storeId]
              );
            }
          } else {
            await client.query("UPDATE products SET cost = $1 WHERE id = $2 AND store_id = $3", [unitCost, productId, input.storeId]);
          }
        }
        const adjustmentResult = await client.query(`
          INSERT INTO stock_adjustments (
            store_id, product_id, adjusted_by, adjustment_type, adjustment_mode,
            quantity_before, quantity_change, quantity_after, cost_impact, condition, note
          ) VALUES ($1, $2, $3, 'RESTOCK', 'INCREASE', $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          input.storeId,
          productId,
          input.receivedBy,
          quantityBefore,
          quantity,
          quantityAfter,
          Number((unitCost * quantity).toFixed(2)),
          normalizedCondition || null,
          `Received via ${order.order_number}${order.supplier_name ? ` from ${order.supplier_name}` : ""}`
        ]);
        createdAdjustmentIds.push(Number(adjustmentResult.rows[0]?.id || 0));
        const batchResult = await client.query(`
          INSERT INTO inventory_batches (
            store_id, product_id, supplier_id, purchase_order_id, received_by, condition,
            batch_code, expiry_date, quantity_received, quantity_remaining, unit_cost, note
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          input.storeId,
          productId,
          order.supplier_id || null,
          input.orderId,
          input.receivedBy,
          normalizedCondition || null,
          batchCode,
          expiryDate,
          quantity,
          quantity,
          unitCost,
          `Received from ${order.supplier_name || "supplier"} via ${order.order_number}`
        ]);
        createdBatchIds.push(Number(batchResult.rows[0]?.id || 0));
      }
      await client.query(`
        UPDATE purchase_orders
        SET status = 'RECEIVED', received_by = $1, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
      `, [input.receivedBy, input.orderId, input.storeId]);
      const orderRow = await getSingleQueryRow3(client, `
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE po.id = $1 AND po.store_id = $2
        LIMIT 1
      `, [input.orderId, input.storeId]);
      receivedResult = { orderRow, touchedProductIds, createdAdjustmentIds, createdBatchIds };
    });
    return receivedResult;
  }
});

// serverWriteRepository.inventory.ts
var isUniqueViolation3 = (error) => error instanceof Error && "code" in error && error.code === "23505";
var withPostgresTransaction4 = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      attempt += 1;
      if (isUniqueViolation3(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};
var safeJsonParse2 = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
var normalizeCollectionCondition2 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_");
};
var toFiniteNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var getConditionMatrixSlot = (product, condition) => {
  const normalizedCondition = normalizeCollectionCondition2(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }
  const matrix = safeJsonParse2(product.condition_matrix, {});
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};
var resolveTrackedCost = ({
  product,
  condition,
  sellingPrice,
  fallbackToSelling = false
}) => {
  const slot = getConditionMatrixSlot(product, condition);
  const normalizedCondition = String(condition || "STANDARD").trim().toLowerCase().replace(/\s+/g, "_");
  const resolvedSellingPrice = toFiniteNumberOrNull(sellingPrice) ?? toFiniteNumberOrNull(slot?.price) ?? toFiniteNumberOrNull(product?.price) ?? 0;
  const slotCost = toFiniteNumberOrNull(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
  const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== "standard";
  if (usesConditionMatrixCost) {
    if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
      return { cost: slotCost, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice
      };
    }
    return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
  }
  const candidateCosts = [slotCost, toFiniteNumberOrNull(product?.cost)];
  for (const candidate of candidateCosts) {
    if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
      return { cost: candidate, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
  }
  if (fallbackToSelling) {
    return {
      cost: resolvedSellingPrice,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: resolvedSellingPrice > 0,
      sellingPrice: resolvedSellingPrice
    };
  }
  return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
};
var getSingleQueryRow4 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var getQueryRows3 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows;
};
var syncInventoryBatchQuantityForQueryClient2 = async ({
  client,
  productId,
  storeId,
  condition,
  quantityDelta
}) => {
  const delta = Math.trunc(Number(quantityDelta) || 0);
  if (!delta) return;
  const normalizedCondition = normalizeCollectionCondition2(condition);
  const rows = await getQueryRows3(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);
  if (delta < 0) {
    let remainingToConsume = Math.abs(delta);
    for (const row of rows) {
      if (remainingToConsume <= 0) break;
      const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
      const consume = Math.min(currentRemaining, remainingToConsume);
      if (consume > 0) {
        await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining - consume, Number(row.id)]);
        remainingToConsume -= consume;
      }
    }
    return;
  }
  let remainingToAdd = delta;
  const rowsDescending = [...rows].reverse();
  for (const row of rowsDescending) {
    if (remainingToAdd <= 0) break;
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
    const availableRoom = Math.max(0, currentReceived - currentRemaining);
    const addBack = Math.min(availableRoom, remainingToAdd);
    if (addBack > 0) {
      await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining + addBack, Number(row.id)]);
      remainingToAdd -= addBack;
    }
  }
  if (remainingToAdd > 0) {
    const newestRow = rowsDescending[0];
    if (newestRow?.id) {
      const currentReceived = Math.max(0, Number(newestRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(newestRow?.quantity_remaining || 0) || 0);
      await client.query(
        "UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3",
        [currentReceived + remainingToAdd, currentRemaining + remainingToAdd, Number(newestRow.id)]
      );
    }
  }
};
var reconcileInventoryBatchQuantityForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  targetStock
}) => {
  const normalizedCondition = normalizeCollectionCondition2(condition);
  const rows = await getQueryRows3(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);
  if (!rows.length) return;
  let remainingTarget = Math.max(0, Math.floor(Number(targetStock) || 0));
  for (const row of rows) {
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const nextRemaining = Math.min(currentReceived, remainingTarget);
    await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [nextRemaining, Number(row.id)]);
    remainingTarget = Math.max(0, remainingTarget - nextRemaining);
  }
  if (remainingTarget > 0) {
    const lastRow = rows[rows.length - 1];
    const currentReceived = Math.max(0, Number(lastRow?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(lastRow?.quantity_remaining || 0) || 0);
    await client.query(
      "UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3",
      [currentReceived + remainingTarget, currentRemaining + remainingTarget, Number(lastRow.id)]
    );
  }
};
var getProductStockSnapshotForQueryClient2 = async ({
  client,
  productId,
  storeId,
  condition
}) => {
  const product = await getSingleQueryRow4(client, "SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, storeId]);
  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }
  const normalizedCondition = normalizeCollectionCondition2(condition);
  const store = await getSingleQueryRow4(client, "SELECT mode FROM stores WHERE id = $1 LIMIT 1", [storeId]);
  const storeMode = String(store?.mode || "").toUpperCase();
  const isGadgetStore = storeMode === "GADGET";
  if (isGadgetStore && product.condition_matrix && normalizedCondition) {
    const matrix = safeJsonParse2(product.condition_matrix, {});
    const conditionKey = normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${normalizedCondition.replace(/_/g, " ")} is not available for ${product.name}`);
    }
    return {
      product,
      normalizedCondition,
      usesConditionMatrix: true,
      currentStock: Math.max(0, Number(slot.stock || 0))
    };
  }
  if (isGadgetStore && product.condition_matrix && !normalizedCondition) {
    throw new Error(`Select a product condition for ${product.name} before adjusting stock.`);
  }
  return {
    product,
    normalizedCondition: null,
    usesConditionMatrix: false,
    currentStock: Math.max(0, Number(product.stock || 0))
  };
};
var updateProductAvailableStockForQueryClient2 = async ({
  client,
  productId,
  storeId,
  quantity,
  condition,
  operation
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient2({ client, productId, storeId, condition });
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  if (!normalizedQuantity) {
    throw new Error("Invalid collection quantity supplied");
  }
  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse2(snapshot.product.condition_matrix, {});
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, " ")} is not available for ${snapshot.product.name}`);
    }
    const currentStock2 = Number(slot.stock || 0);
    const nextStock2 = operation === "decrease" ? currentStock2 - normalizedQuantity : currentStock2 + normalizedQuantity;
    if (nextStock2 < 0) {
      throw new Error(`Not enough available stock for ${snapshot.product.name}`);
    }
    slot.stock = nextStock2;
    await client.query("UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3", [JSON.stringify(matrix), productId, storeId]);
    await syncInventoryBatchQuantityForQueryClient2({
      client,
      productId,
      storeId,
      condition: snapshot.normalizedCondition,
      quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
    });
    return snapshot.product;
  }
  const currentStock = Number(snapshot.product.stock || 0);
  const nextStock = operation === "decrease" ? currentStock - normalizedQuantity : currentStock + normalizedQuantity;
  if (nextStock < 0) {
    throw new Error(`Not enough available stock for ${snapshot.product.name}`);
  }
  await client.query("UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3", [nextStock, productId, storeId]);
  await syncInventoryBatchQuantityForQueryClient2({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
  });
  return snapshot.product;
};
var setProductAvailableStockForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  nextStock
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient2({ client, productId, storeId, condition });
  const normalizedNextStock = Math.max(0, Math.floor(Number(nextStock) || 0));
  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse2(snapshot.product.condition_matrix, {});
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, " ")} is not available for ${snapshot.product.name}`);
    }
    slot.stock = normalizedNextStock;
    await client.query("UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3", [JSON.stringify(matrix), productId, storeId]);
  } else {
    await client.query("UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3", [normalizedNextStock, productId, storeId]);
  }
  await reconcileInventoryBatchQuantityForQueryClient({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    targetStock: normalizedNextStock
  });
  return {
    ...snapshot,
    nextStock: normalizedNextStock
  };
};
var generateUniqueConsignmentQuickCodeForQueryClient = async (client, maxAttempts = 50, excludeConsignmentItemId, preferredCandidate) => {
  const quickCodePattern = /^([1-9])\1\1\d{2}$/;
  const buildQuickCodeCandidate = (leadingDigit, trailingValue) => {
    const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
    const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, "0");
    return `${repeatedDigit.repeat(3)}${suffix}`;
  };
  const canUseCandidate = async (candidate) => {
    const normalized = String(candidate || "").trim();
    if (!normalized || !quickCodePattern.test(normalized)) return false;
    const exists = await getSingleQueryRow4(
      client,
      "SELECT id FROM consignment_items WHERE quick_code = $1 LIMIT 1",
      [normalized]
    );
    return !exists || excludeConsignmentItemId != null && Number(exists.id) === Number(excludeConsignmentItemId);
  };
  const normalizedPreferred = String(preferredCandidate || "").trim();
  if (normalizedPreferred && await canUseCandidate(normalizedPreferred)) {
    return normalizedPreferred;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildQuickCodeCandidate(
      1 + Math.floor(Math.random() * 9),
      Math.floor(Math.random() * 100)
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }
  const fallbackSeed = Number(Date.now()) % 900;
  for (let offset = 0; offset < 900; offset += 1) {
    const candidateIndex = (fallbackSeed + offset) % 900;
    const candidate = buildQuickCodeCandidate(
      Math.floor(candidateIndex / 100) + 1,
      candidateIndex % 100
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }
  return null;
};
var createInventoryWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createStockAdjustment(input) {
    let createdAdjustment = null;
    await withPostgresTransaction4(postgresPool2, async (client) => {
      const snapshot = await getProductStockSnapshotForQueryClient2({ client, productId: input.productId, storeId: input.storeId, condition: input.condition });
      const quantityBefore = Math.max(0, Number(snapshot.currentStock || 0));
      let quantityAfter = quantityBefore;
      let quantityChange = 0;
      const isCountValidation = input.adjustmentType === "COUNT" && input.adjustmentMode === "SET";
      if (input.adjustmentMode === "SET") {
        quantityAfter = Math.max(0, Math.floor(input.rawQuantity));
        quantityChange = quantityAfter - quantityBefore;
        if (quantityChange === 0 && !isCountValidation) {
          throw new Error("No stock change detected. Adjust the quantity before saving.");
        }
      } else if (input.adjustmentMode === "INCREASE") {
        const quantity = Math.max(1, Math.floor(input.rawQuantity));
        await updateProductAvailableStockForQueryClient2({
          client,
          productId: input.productId,
          storeId: input.storeId,
          quantity,
          condition: input.condition,
          operation: "increase"
        });
        quantityChange = quantity;
        quantityAfter = quantityBefore + quantity;
      } else {
        const quantity = Math.max(1, Math.floor(input.rawQuantity));
        if (quantity > quantityBefore) {
          throw new Error(`Only ${quantityBefore} unit(s) are available to remove right now.`);
        }
        await updateProductAvailableStockForQueryClient2({
          client,
          productId: input.productId,
          storeId: input.storeId,
          quantity,
          condition: input.condition,
          operation: "decrease"
        });
        quantityChange = -quantity;
        quantityAfter = quantityBefore - quantity;
      }
      const requiresApproval = isCountValidation && quantityChange !== 0 && !["STORE_ADMIN", "MANAGER"].includes(String(input.userRole || ""));
      if (input.adjustmentMode === "SET" && !requiresApproval) {
        await setProductAvailableStockForQueryClient({
          client,
          productId: input.productId,
          storeId: input.storeId,
          condition: input.condition,
          nextStock: quantityAfter
        });
      }
      const resolvedCost = resolveTrackedCost({
        product: snapshot.product,
        condition: snapshot.normalizedCondition,
        sellingPrice: 0
      });
      const costImpact = Number(((Number(resolvedCost.cost || 0) || 0) * quantityChange).toFixed(2)) || 0;
      const recountStatus = isCountValidation ? requiresApproval ? "PENDING" : "APPROVED" : "NOT_REQUIRED";
      const result = await client.query(`
        INSERT INTO stock_adjustments (
          store_id, product_id, adjusted_by, adjustment_type, adjustment_mode,
          quantity_before, quantity_change, quantity_after, cost_impact, condition, note,
          counted_quantity, variance_quantity, recount_status, approved_by, approved_at, approval_note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `, [
        input.storeId,
        input.productId,
        input.userId,
        input.adjustmentType,
        input.adjustmentMode,
        quantityBefore,
        quantityChange,
        quantityAfter,
        costImpact,
        snapshot.normalizedCondition || null,
        input.note || null,
        isCountValidation ? quantityAfter : null,
        isCountValidation ? quantityChange : 0,
        recountStatus,
        recountStatus === "APPROVED" ? input.userId : null,
        recountStatus === "APPROVED" ? (/* @__PURE__ */ new Date()).toISOString() : null,
        null
      ]);
      createdAdjustment = await getSingleQueryRow4(client, `
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [Number(result.rows[0]?.id || 0), input.storeId]);
    });
    return createdAdjustment;
  },
  async reviewStockAdjustment(input) {
    let reviewedAdjustment = null;
    await withPostgresTransaction4(postgresPool2, async (client) => {
      const adjustment = await getSingleQueryRow4(client, `
        SELECT sa.*, p.name as product_name
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [input.adjustmentId, input.storeId]);
      if (!adjustment) {
        throw new Error("Stock recount record not found.");
      }
      if (String(adjustment.adjustment_type || "").toUpperCase() !== "COUNT") {
        throw new Error(`Only stock count validations can be ${String(input.action || "").toLowerCase()}d here.`);
      }
      if (String(adjustment.recount_status || "").toUpperCase() !== "PENDING") {
        throw new Error("This stock recount has already been reviewed.");
      }
      if (input.action === "APPROVE") {
        const nextStock = Math.max(0, Number(adjustment.counted_quantity ?? adjustment.quantity_after ?? adjustment.quantity_before) || 0);
        await setProductAvailableStockForQueryClient({
          client,
          productId: Number(adjustment.product_id),
          storeId: input.storeId,
          condition: adjustment.condition,
          nextStock
        });
      }
      await client.query(`
        UPDATE stock_adjustments
        SET recount_status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, approval_note = $3
        WHERE id = $4 AND store_id = $5
      `, [input.action === "APPROVE" ? "APPROVED" : "REJECTED", input.approvedBy, input.approvalNote || null, input.adjustmentId, input.storeId]);
      reviewedAdjustment = await getSingleQueryRow4(client, `
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [input.adjustmentId, input.storeId]);
    });
    return reviewedAdjustment;
  },
  async createConsignmentItem(input) {
    const normalizeQuickCode = (value) => {
      const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
      return code || null;
    };
    const normalizedQuickCode = normalizeQuickCode(input.quickCode);
    const normalizedVendorPhone = String(input.vendorPhone || "").trim() || null;
    const normalizedVendorAddress = String(input.vendorAddress || "").trim() || null;
    const normalizedImei = String(input.imeiSerial || "").trim() || null;
    const normalizedQuantity = Math.max(1, Math.trunc(Number(input.quantity || 0) || 1));
    return withPostgresTransaction4(postgresPool2, async (client) => {
      const resolvedQuickCode = await generateUniqueConsignmentQuickCodeForQueryClient(
        client,
        120,
        null,
        normalizedQuickCode
      );
      if (!resolvedQuickCode) {
        throw new Error("Unable to generate a unique consignment quick code.");
      }
      const result = await client.query(`
        INSERT INTO consignment_items (
          store_id, quick_code, vendor_name, vendor_phone, vendor_address, item_name, imei_serial,
          quantity, agreed_payout, selling_price, status, public_specs, internal_condition, added_by, approved_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11::jsonb, $12, $13, NULL, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        input.storeId,
        resolvedQuickCode,
        input.vendorName,
        normalizedVendorPhone,
        normalizedVendorAddress,
        input.itemName,
        normalizedImei,
        normalizedQuantity,
        input.agreedPayout,
        input.sellingPrice,
        JSON.stringify(input.publicSpecs || {}),
        input.internalCondition || null,
        input.addedBy
      ]);
      return result.rows[0] || null;
    });
  },
  async updateConsignmentItem(input) {
    const normalizeQuickCode = (value) => {
      const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
      return code || null;
    };
    const normalizedQuickCode = normalizeQuickCode(input.quickCode);
    const normalizedVendorPhone = String(input.vendorPhone || "").trim() || null;
    const normalizedVendorAddress = String(input.vendorAddress || "").trim() || null;
    const normalizedImei = String(input.imeiSerial || "").trim() || null;
    const normalizedQuantity = Math.max(1, Math.trunc(Number(input.quantity || 0) || 1));
    return withPostgresTransaction4(postgresPool2, async (client) => {
      const existing = await getSingleQueryRow4(
        client,
        "SELECT quick_code FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1",
        [input.consignmentItemId, input.storeId]
      );
      if (!existing) {
        return null;
      }
      const resolvedQuickCode = await generateUniqueConsignmentQuickCodeForQueryClient(
        client,
        120,
        input.consignmentItemId,
        normalizedQuickCode || String(existing.quick_code || "").trim() || null
      );
      if (!resolvedQuickCode) {
        throw new Error("Unable to generate a unique consignment quick code.");
      }
      const result = await client.query(`
        UPDATE consignment_items
        SET quick_code = $1,
            vendor_name = $2,
            vendor_phone = $3,
            vendor_address = $4,
            item_name = $5,
            imei_serial = $6,
            quantity = $7,
            agreed_payout = $8,
            selling_price = $9,
            public_specs = $10::jsonb,
            internal_condition = $11,
            status = 'pending',
            approved_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 AND store_id = $13
        RETURNING *
      `, [
        resolvedQuickCode,
        input.vendorName,
        normalizedVendorPhone,
        normalizedVendorAddress,
        input.itemName,
        normalizedImei,
        normalizedQuantity,
        input.agreedPayout,
        input.sellingPrice,
        JSON.stringify(input.publicSpecs || {}),
        input.internalCondition || null,
        input.consignmentItemId,
        input.storeId
      ]);
      return result.rows[0] || null;
    });
  },
  async reviewConsignmentItem(input) {
    const nextStatus = input.action === "APPROVE" ? "approved" : input.action === "RETURN" ? "returned" : "rejected";
    const nextApprover = input.action === "APPROVE" || input.action === "RETURN" ? input.reviewerId : null;
    const result = await postgresPool2.query(`
      UPDATE consignment_items
      SET status = $1,
          approved_by = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND store_id = $4
      RETURNING *
    `, [nextStatus, nextApprover, input.consignmentItemId, input.storeId]);
    return result.rows[0] || null;
  },
  async markConsignmentItemSold(storeId, consignmentItemId) {
    await postgresPool2.query(
      "UPDATE consignment_items SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2",
      [consignmentItemId, storeId]
    );
    return;
  }
});

// serverWriteRepository.sales.ts
var isUniqueViolation4 = (error) => error instanceof Error && "code" in error && error.code === "23505";
var withPostgresTransaction5 = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      attempt += 1;
      if (isUniqueViolation4(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};
var safeJsonParse3 = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
var normalizeCollectionCondition3 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_");
};
var toFiniteNumberOrNull2 = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var getConditionMatrixSlot2 = (product, condition) => {
  const normalizedCondition = normalizeCollectionCondition3(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }
  const matrix = safeJsonParse3(product.condition_matrix, {});
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};
var resolveTrackedCost2 = ({
  product,
  condition,
  sellingPrice,
  fallbackToSelling = false
}) => {
  const slot = getConditionMatrixSlot2(product, condition);
  const normalizedCondition = String(condition || "STANDARD").trim().toLowerCase().replace(/\s+/g, "_");
  const resolvedSellingPrice = toFiniteNumberOrNull2(sellingPrice) ?? toFiniteNumberOrNull2(slot?.price) ?? toFiniteNumberOrNull2(product?.price) ?? 0;
  const slotCost = toFiniteNumberOrNull2(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
  const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== "standard";
  if (usesConditionMatrixCost) {
    if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
      return { cost: slotCost, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice
      };
    }
    return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
  }
  const candidateCosts = [slotCost, toFiniteNumberOrNull2(product?.cost)];
  for (const candidate of candidateCosts) {
    if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
      return { cost: candidate, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
  }
  if (fallbackToSelling) {
    return {
      cost: resolvedSellingPrice,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: resolvedSellingPrice > 0,
      sellingPrice: resolvedSellingPrice
    };
  }
  return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
};
var getTotalPaidFromPaymentMethods = (paymentMethods) => {
  const methods = safeJsonParse3(paymentMethods, {});
  return ["cash", "transfer", "pos"].reduce((sum, key) => sum + Math.max(0, Number(methods?.[key]) || 0), 0);
};
var getSingleQueryRow5 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var getQueryRows4 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows;
};
var syncInventoryBatchQuantityForQueryClient3 = async ({
  client,
  productId,
  storeId,
  condition,
  quantityDelta
}) => {
  const delta = Math.trunc(Number(quantityDelta) || 0);
  if (!delta) return;
  const normalizedCondition = normalizeCollectionCondition3(condition);
  const rows = await getQueryRows4(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);
  if (delta < 0) {
    let remainingToConsume = Math.abs(delta);
    for (const row of rows) {
      if (remainingToConsume <= 0) break;
      const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
      const consume = Math.min(currentRemaining, remainingToConsume);
      if (consume > 0) {
        await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining - consume, Number(row.id)]);
        remainingToConsume -= consume;
      }
    }
    return;
  }
  let remainingToAdd = delta;
  const rowsDescending = [...rows].reverse();
  for (const row of rowsDescending) {
    if (remainingToAdd <= 0) break;
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
    const availableRoom = Math.max(0, currentReceived - currentRemaining);
    const addBack = Math.min(availableRoom, remainingToAdd);
    if (addBack > 0) {
      await client.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [currentRemaining + addBack, Number(row.id)]);
      remainingToAdd -= addBack;
    }
  }
  if (remainingToAdd > 0) {
    const newestRow = rowsDescending[0];
    if (newestRow?.id) {
      const currentReceived = Math.max(0, Number(newestRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(newestRow?.quantity_remaining || 0) || 0);
      await client.query(
        "UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3",
        [currentReceived + remainingToAdd, currentRemaining + remainingToAdd, Number(newestRow.id)]
      );
    }
  }
};
var getProductStockSnapshotForQueryClient3 = async ({
  client,
  productId,
  storeId,
  condition
}) => {
  const product = await getSingleQueryRow5(client, "SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1", [productId, storeId]);
  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }
  const normalizedCondition = normalizeCollectionCondition3(condition);
  const store = await getSingleQueryRow5(client, "SELECT mode FROM stores WHERE id = $1 LIMIT 1", [storeId]);
  const storeMode = String(store?.mode || "").toUpperCase();
  const isGadgetStore = storeMode === "GADGET";
  if (isGadgetStore && product.condition_matrix && normalizedCondition) {
    const matrix = safeJsonParse3(product.condition_matrix, {});
    const conditionKey = normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${normalizedCondition.replace(/_/g, " ")} is not available for ${product.name}`);
    }
    return {
      product,
      normalizedCondition,
      usesConditionMatrix: true,
      currentStock: Math.max(0, Number(slot.stock || 0))
    };
  }
  if (isGadgetStore && product.condition_matrix && !normalizedCondition) {
    throw new Error(`Select a product condition for ${product.name} before adjusting stock.`);
  }
  return {
    product,
    normalizedCondition: null,
    usesConditionMatrix: false,
    currentStock: Math.max(0, Number(product.stock || 0))
  };
};
var updateProductAvailableStockForQueryClient3 = async ({
  client,
  productId,
  storeId,
  quantity,
  condition,
  operation
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient3({ client, productId, storeId, condition });
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  if (!normalizedQuantity) {
    throw new Error("Invalid collection quantity supplied");
  }
  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse3(snapshot.product.condition_matrix, {});
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, " ")} is not available for ${snapshot.product.name}`);
    }
    const currentStock2 = Number(slot.stock || 0);
    const nextStock2 = operation === "decrease" ? currentStock2 - normalizedQuantity : currentStock2 + normalizedQuantity;
    if (nextStock2 < 0) {
      throw new Error(`Not enough available stock for ${snapshot.product.name}`);
    }
    slot.stock = nextStock2;
    await client.query("UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3", [JSON.stringify(matrix), productId, storeId]);
    await syncInventoryBatchQuantityForQueryClient3({
      client,
      productId,
      storeId,
      condition: snapshot.normalizedCondition,
      quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
    });
    return snapshot.product;
  }
  const currentStock = Number(snapshot.product.stock || 0);
  const nextStock = operation === "decrease" ? currentStock - normalizedQuantity : currentStock + normalizedQuantity;
  if (nextStock < 0) {
    throw new Error(`Not enough available stock for ${snapshot.product.name}`);
  }
  await client.query("UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3", [nextStock, productId, storeId]);
  await syncInventoryBatchQuantityForQueryClient3({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    quantityDelta: operation === "decrease" ? -normalizedQuantity : normalizedQuantity
  });
  return snapshot.product;
};
var getSaleItemsForInvoiceForQueryClient = async (client, saleId) => {
  const normalizeSaleItemSpecs = (value) => {
    const specs = safeJsonParse3(value, {});
    const sourced = Boolean(specs?.sourced_item);
    const consignment = Boolean(specs?.consignment_item);
    const consignmentItemId = Math.max(0, Number(specs?.consignment_item_id || 0) || 0);
    const consignmentItemName = consignment ? String(specs?.consignment_item_name || specs?.item_name || "").trim() : "";
    return {
      specs,
      isSourced: sourced,
      isConsignment: consignment,
      sourcedItemName: sourced ? String(specs?.sourced_item_name || "").trim() : "",
      sourcedVendorName: sourced ? String(specs?.sourced_vendor_name || "").trim() : "",
      sourcedVendorReference: sourced ? String(specs?.sourced_vendor_reference || "").trim() : "",
      sourcedCostPrice: sourced ? Math.max(0, Number(specs?.sourced_cost_price || 0) || 0) : null,
      consignmentItemId,
      consignmentItemName
    };
  };
  const items = await getQueryRows4(client, `
    SELECT si.*, p.name as product_name, p.quick_code as product_quick_code, p.specs as product_specs, COALESCE(c.name, p.category, 'General') as category_name
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE si.sale_id = $1
    ORDER BY si.id ASC
  `, [saleId]);
  const returnRows = await getQueryRows4(client, "SELECT items FROM sales_returns WHERE sale_id = $1 ORDER BY id ASC", [saleId]);
  const parsedSpecsBySaleItemId = /* @__PURE__ */ new Map();
  const consignmentItemIds = /* @__PURE__ */ new Set();
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
  const consignmentNameById = /* @__PURE__ */ new Map();
  if (consignmentItemIds.size > 0) {
    const ids = Array.from(consignmentItemIds.values());
    const consignmentRows = await getQueryRows4(client, "SELECT id, item_name FROM consignment_items WHERE id = ANY($1::int[])", [ids]);
    consignmentRows.forEach((row) => {
      consignmentNameById.set(Number(row?.id || 0), String(row?.item_name || "").trim());
    });
  }
  const returnedQuantityBySaleItem = /* @__PURE__ */ new Map();
  for (const row of returnRows) {
    const parsedItems = safeJsonParse3(row?.items, []);
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
    const productName = String(item.product_name || "").trim();
    const isPlaceholderProduct = productName === "__CONSIGNMENT_PLACEHOLDER__" || productName === "__SOURCED_PLACEHOLDER__";
    const resolvedName = parsed.isSourced ? parsed.sourcedItemName || productName || `Product #${item.product_id}` : parsed.isConsignment ? parsed.consignmentItemName || consignmentNameById.get(parsed.consignmentItemId) || (!isPlaceholderProduct ? productName : "") || `Consignment Item #${parsed.consignmentItemId || item.product_id}` : productName || `Product #${item.product_id}`;
    return {
      ...item,
      product_name: resolvedName,
      item_source: parsed.isSourced ? "SOURCED" : parsed.isConsignment ? "CONSIGNMENT" : "INVENTORY",
      sourced_vendor_name: parsed.sourcedVendorName || null,
      sourced_vendor_reference: parsed.sourcedVendorReference || null,
      quantity: soldQuantity,
      returned_quantity: returnedQuantity,
      returnable_quantity: Math.max(0, soldQuantity - returnedQuantity),
      subtotal: Number(item.subtotal || 0) || Number(item.price_at_sale || 0) * soldQuantity,
      cost_at_sale: parsed.isSourced ? parsed.sourcedCostPrice : item.cost_at_sale == null ? null : Number(item.cost_at_sale || 0),
      specs_at_sale: parsed.specs
    };
  });
};
var getOrCreateSourcedPlaceholderProductForQueryClient = async (client, storeId) => {
  const markerName = "__SOURCED_PLACEHOLDER__";
  const existing = await getSingleQueryRow5(client, "SELECT id FROM products WHERE store_id = $1 AND name = $2 LIMIT 1", [storeId, markerName]);
  if (existing?.id) {
    return Number(existing.id);
  }
  const inserted = await client.query(`
    INSERT INTO products (store_id, name, barcode, category, quick_code, specs, condition_matrix, price, stock, cost, deleted_at)
    VALUES ($1, $2, NULL, 'Sourced', NULL, '{}', NULL, 0, 0, 0, CURRENT_TIMESTAMP)
    RETURNING id
  `, [storeId, markerName]);
  return Number(inserted.rows[0]?.id || 0);
};
var getOrCreateConsignmentPlaceholderProductForQueryClient = async (client, storeId) => {
  const markerName = "__CONSIGNMENT_PLACEHOLDER__";
  const existing = await getSingleQueryRow5(client, "SELECT id FROM products WHERE store_id = $1 AND name = $2 LIMIT 1", [storeId, markerName]);
  if (existing?.id) {
    return Number(existing.id);
  }
  const inserted = await client.query(`
    INSERT INTO products (store_id, name, barcode, category, quick_code, specs, condition_matrix, price, stock, cost, deleted_at)
    VALUES ($1, $2, NULL, 'Consignment', NULL, '{}', NULL, 0, 0, 0, CURRENT_TIMESTAMP)
    RETURNING id
  `, [storeId, markerName]);
  return Number(inserted.rows[0]?.id || 0);
};
var createSalesWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async createSale(input) {
    let saleId = 0;
    await withPostgresTransaction5(postgresPool2, async (client) => {
      let saleResult;
      try {
        saleResult = await client.query(`
          INSERT INTO sales (store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, show_discount_on_invoice, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING id
        `, [
          input.storeId,
          input.subtotal,
          input.discountAmount,
          input.discountType || null,
          input.discountValue,
          input.discountNote || null,
          input.showDiscountOnInvoice === false ? 0 : 1,
          input.taxAmount,
          input.taxPercentage,
          input.total,
          input.saleActorId,
          JSON.stringify(input.paymentMethods),
          input.status || "COMPLETED",
          input.pdfPath || null,
          input.customerId || null,
          input.dueDate || null,
          input.note || null
        ]);
      } catch (error) {
        const missingShowDiscountColumn = String(error?.code || "") === "42703" || /show_discount_on_invoice/i.test(String(error?.message || ""));
        if (!missingShowDiscountColumn) {
          throw error;
        }
        saleResult = await client.query(`
          INSERT INTO sales (store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id
        `, [
          input.storeId,
          input.subtotal,
          input.discountAmount,
          input.discountType || null,
          input.discountValue,
          input.discountNote || null,
          input.taxAmount,
          input.taxPercentage,
          input.total,
          input.saleActorId,
          JSON.stringify(input.paymentMethods),
          input.status || "COMPLETED",
          input.pdfPath || null,
          input.customerId || null,
          input.dueDate || null,
          input.note || null
        ]);
      }
      const insertedSaleId = saleResult.rows[0]?.id;
      if (!insertedSaleId) throw new Error("Failed to create sale: no ID returned from database");
      saleId = Number(insertedSaleId);
      let sourcedPlaceholderProductId = null;
      let consignmentPlaceholderProductId = null;
      let totalMarkupAmount = 0;
      const markupItemSummaries = [];
      for (const item of input.items) {
        const quantity = Math.max(1, Number(item.quantity || 0) || 1);
        const unitPrice = Math.max(0, Number(item.price_at_sale || 0) || 0);
        const subtotal = Number((unitPrice * quantity).toFixed(2));
        const isSourced = Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === "SOURCED");
        const isConsignment = Boolean(item?.is_consignment || item?.consignment_item || item?.item_source === "CONSIGNMENT");
        const sourcedVendorName = String(item?.sourced_vendor_name || "").trim();
        const sourcedVendorReference = String(item?.sourced_vendor_reference || "").trim();
        const sourcedItemName = String(item?.name || item?.product_name || "").trim();
        const consignmentItemName = String(item?.name || item?.product_name || "").trim();
        const sourcedCostPrice = Math.max(0, Number(item?.sourced_cost_price ?? item?.cost_at_sale ?? 0) || 0);
        const consignmentItemId = Math.max(0, Number(item?.consignment_item_id || 0) || 0);
        const consignmentVendorName = String(item?.vendor_name || item?.consignment_vendor_name || "").trim();
        const consignmentImei = String(item?.imei_serial || "").trim();
        const consignmentPayout = Math.max(0, Number(item?.agreed_payout ?? item?.cost_at_sale ?? 0) || 0);
        const consignmentPublicSpecs = item?.public_specs && typeof item.public_specs === "object" ? item.public_specs : item?.specs_at_sale && typeof item.specs_at_sale === "object" ? item.specs_at_sale : {};
        if (isSourced && !sourcedPlaceholderProductId) {
          sourcedPlaceholderProductId = await getOrCreateSourcedPlaceholderProductForQueryClient(client, input.storeId);
        }
        if (isConsignment && !consignmentPlaceholderProductId) {
          consignmentPlaceholderProductId = await getOrCreateConsignmentPlaceholderProductForQueryClient(client, input.storeId);
        }
        const resolvedProductId = isSourced ? Number(sourcedPlaceholderProductId || 0) : isConsignment ? Number(consignmentPlaceholderProductId || 0) : Number(item.product_id);
        const product = !isSourced && !isConsignment ? await getSingleQueryRow5(client, "SELECT * FROM products WHERE id = $1", [resolvedProductId]) : null;
        const resolvedCostAtSale = resolveTrackedCost2({
          product,
          condition: item.condition || null,
          sellingPrice: unitPrice,
          fallbackToSelling: Boolean(input.allowCostFallback)
        });
        const specsAtSale = {
          ...item.specs_at_sale || {},
          ...isSourced ? {
            sourced_item: true,
            sourced_item_name: sourcedItemName || "Sourced Item",
            sourced_vendor_name: sourcedVendorName,
            sourced_vendor_reference: sourcedVendorReference || null,
            sourced_cost_price: sourcedCostPrice
          } : {},
          ...isConsignment ? {
            consignment_item: true,
            consignment_item_id: consignmentItemId || null,
            consignment_item_name: consignmentItemName || null,
            vendor_name: consignmentVendorName,
            imei_serial: consignmentImei || null,
            public_specs: consignmentPublicSpecs || {}
          } : {}
        };
        const effectiveCostAtSale = isSourced ? sourcedCostPrice : isConsignment ? consignmentPayout : resolvedCostAtSale.cost;
        const basePriceAtSale = Math.max(0, Number(item.base_price_at_sale ?? unitPrice) || 0);
        const priceMarkup = Math.max(0, Number((unitPrice - basePriceAtSale).toFixed(2)));
        if (priceMarkup > 0) {
          totalMarkupAmount = Number((totalMarkupAmount + priceMarkup * quantity).toFixed(2));
          markupItemSummaries.push({
            name: String(item.name || `Product #${item.product_id}`).trim(),
            base_price: basePriceAtSale,
            sale_price: unitPrice,
            markup: priceMarkup,
            quantity
          });
        }
        const saleItemInsert = await client.query(`
          INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, base_price_at_sale, price_markup, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          saleId,
          resolvedProductId,
          quantity,
          unitPrice,
          basePriceAtSale,
          priceMarkup,
          subtotal,
          effectiveCostAtSale,
          item.imei_serial || null,
          item.condition || null,
          JSON.stringify(specsAtSale)
        ]);
        const saleItemId = Number(saleItemInsert.rows[0]?.id || 0);
        if (isSourced && saleItemId > 0 && sourcedVendorName) {
          const amountDue = Number((sourcedCostPrice * quantity).toFixed(2));
          await client.query(`
            INSERT INTO vendor_payables (store_id, sale_id, sale_item_id, source_type, vendor_name, vendor_reference, item_name, amount_due, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UNPAID')
          `, [
            input.storeId,
            saleId,
            saleItemId,
            "SOURCED",
            sourcedVendorName,
            sourcedVendorReference || null,
            sourcedItemName || "Sourced Item",
            amountDue
          ]);
          logVendorPayableMutation({
            action: "created",
            storeId: input.storeId,
            saleId,
            saleItemId,
            sourceType: "SOURCED",
            amountDue
          });
        }
        if (isConsignment && saleItemId > 0 && consignmentVendorName) {
          const amountDue = Number((consignmentPayout * quantity).toFixed(2));
          await client.query(`
            INSERT INTO vendor_payables (store_id, sale_id, sale_item_id, source_type, vendor_name, vendor_reference, item_name, amount_due, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UNPAID')
          `, [
            input.storeId,
            saleId,
            saleItemId,
            "CONSIGNMENT",
            consignmentVendorName,
            consignmentImei || consignmentItemName || null,
            consignmentItemName || "Consignment Item",
            amountDue
          ]);
          logVendorPayableMutation({
            action: "created",
            storeId: input.storeId,
            saleId,
            saleItemId,
            sourceType: "CONSIGNMENT",
            amountDue
          });
        }
        if (isConsignment && consignmentItemId > 0) {
          const consignmentRow = await getSingleQueryRow5(
            client,
            "SELECT quantity, status, public_specs FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1",
            [consignmentItemId, input.storeId]
          );
          if (!consignmentRow) {
            throw new Error("Consignment item not found while posting sale.");
          }
          const currentQuantity = Math.max(0, Math.trunc(Number(consignmentRow.quantity || 0) || 0));
          const publicSpecs = safeJsonParse3(consignmentRow.public_specs, {});
          const rawMatrix = publicSpecs && typeof publicSpecs === "object" ? publicSpecs.__condition_matrix : null;
          const matrixKeys = ["new", "open_box", "used"];
          const normalizedMatrix = rawMatrix && typeof rawMatrix === "object" ? matrixKeys.reduce((acc, key) => {
            const source = rawMatrix[key] && typeof rawMatrix[key] === "object" ? rawMatrix[key] : {};
            acc[key] = {
              price: Math.max(0, Number(source.price || 0) || 0),
              cost: Math.max(0, Number(source.cost || 0) || 0),
              stock: Math.max(0, Math.trunc(Number(source.stock || 0) || 0))
            };
            return acc;
          }, {}) : null;
          const matrixTotalStock = normalizedMatrix ? matrixKeys.reduce((sum, key) => sum + Math.max(0, Math.trunc(Number(normalizedMatrix[key]?.stock || 0) || 0)), 0) : 0;
          const availableQuantity = Math.max(currentQuantity, matrixTotalStock);
          if (availableQuantity < quantity) {
            throw new Error("Consignment quantity is insufficient for this sale.");
          }
          const nextQuantity = Math.max(0, availableQuantity - quantity);
          const previousSoldQuantity = Math.max(0, Math.trunc(Number(publicSpecs?.__sold_quantity_total || 0) || 0));
          const previousSoldAmount = Math.max(0, Number(publicSpecs?.__sold_amount_total || 0) || 0);
          const nextSoldQuantity = previousSoldQuantity + Math.max(0, Math.trunc(Number(quantity) || 0));
          const soldIncrementAmount = Math.max(0, Number(subtotal || 0) || 0);
          const nextSoldAmount = Number((previousSoldAmount + soldIncrementAmount).toFixed(2));
          const nextPublicSpecsBase = {
            ...publicSpecs && typeof publicSpecs === "object" ? publicSpecs : {},
            __sold_quantity_total: nextSoldQuantity,
            __sold_amount_total: nextSoldAmount,
            __last_sold_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          if (normalizedMatrix) {
            let remainingToDeduct = Math.max(0, Math.trunc(quantity) || 0);
            for (const key of matrixKeys) {
              if (remainingToDeduct <= 0) break;
              const stock = Math.max(0, Math.trunc(Number(normalizedMatrix[key]?.stock || 0) || 0));
              if (stock <= 0) continue;
              const deduction = Math.min(stock, remainingToDeduct);
              normalizedMatrix[key].stock = stock - deduction;
              remainingToDeduct -= deduction;
            }
            const nextPublicSpecs = {
              ...nextPublicSpecsBase,
              __condition_matrix: normalizedMatrix
            };
            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity <= 0 ? "sold" : "approved", JSON.stringify(nextPublicSpecs), consignmentItemId, input.storeId]
            );
          } else {
            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity <= 0 ? "sold" : "approved", JSON.stringify(nextPublicSpecsBase), consignmentItemId, input.storeId]
            );
          }
        }
        if (product && !isSourced && !isConsignment) {
          await updateProductAvailableStockForQueryClient3({
            client,
            productId: Number(resolvedProductId),
            storeId: input.storeId,
            quantity,
            condition: item.condition || null,
            operation: "decrease"
          });
        }
      }
      if (totalMarkupAmount > 0 && saleId > 0) {
        const markupNote = markupItemSummaries.map((m) => `${m.name}: +${m.markup} markup (${m.base_price} \u2192 ${m.sale_price}) \xD7 ${m.quantity}`).join("; ");
        await client.query(
          `INSERT INTO transaction_flags (store_id, sale_id, flagged_by, issue_type, note, status)
           VALUES ($1, $2, $3, 'PRICE_MARKUP', $4, 'OPEN')`,
          [
            input.storeId,
            saleId,
            input.saleActorId,
            `Price markup of ${totalMarkupAmount} applied on Sale #${saleId}. ${markupNote}`.slice(0, 1e3)
          ]
        );
      }
    });
    return { saleId };
  },
  async createLayawaySale(input) {
    let createdSale = null;
    await withPostgresTransaction5(postgresPool2, async (client) => {
      let customerId = input.requestedCustomerId && Number.isInteger(input.requestedCustomerId) && input.requestedCustomerId > 0 ? input.requestedCustomerId : null;
      if (customerId) {
        const existingCustomer = await getSingleQueryRow5(client, "SELECT id FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1", [customerId, input.storeId]);
        if (!existingCustomer) {
          throw new Error("Selected customer no longer exists for this store.");
        }
      } else {
        const existingByPhone = input.customerPhone ? await getSingleQueryRow5(client, "SELECT id FROM customers WHERE store_id = $1 AND phone = $2 LIMIT 1", [input.storeId, input.customerPhone]) : null;
        if (existingByPhone?.id) {
          customerId = Number(existingByPhone.id);
        } else {
          const result = await client.query(
            "INSERT INTO customers (store_id, name, phone, address) VALUES ($1, $2, $3, $4) RETURNING id",
            [input.storeId, input.customerName, input.customerPhone, input.customerAddress || null]
          );
          customerId = Number(result.rows[0]?.id || 0);
        }
      }
      const saleResult = await client.query(`
        INSERT INTO sales (
          store_id, subtotal, discount_amount, discount_type, discount_value, discount_note,
          tax_amount, tax_percentage, total, user_id, payment_methods, status,
          sale_channel, payment_plan, locked_until_paid, pdf_path, customer_id, due_date, note
        ) VALUES ($1, $2, 0, NULL, 0, NULL, 0, 0, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12)
        RETURNING id
      `, [
        input.storeId,
        input.subtotal,
        input.subtotal,
        input.userId,
        JSON.stringify(input.paymentMethods),
        input.nextStatus,
        input.saleChannel,
        JSON.stringify(input.paymentPlan),
        input.nextLockedUntilPaid,
        customerId,
        input.dueDate,
        input.note || null
      ]);
      const saleId = Number(saleResult.rows[0]?.id || 0);
      for (const item of input.items) {
        await client.query(`
          INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          saleId,
          Number(item.product_id),
          Number(item.quantity) || 0,
          Number(item.price_at_sale) || 0,
          Number(item.subtotal) || 0,
          Number(item.cost_at_sale) || 0,
          item.imei_serial || null,
          item.condition || null,
          JSON.stringify(item.specs_at_sale || {})
        ]);
        await updateProductAvailableStockForQueryClient3({
          client,
          productId: Number(item.product_id),
          storeId: input.storeId,
          quantity: Number(item.quantity) || 0,
          condition: item.condition || null,
          operation: "decrease"
        });
      }
      createdSale = await getSingleQueryRow5(client, `
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.id = $1 AND s.store_id = $2
      `, [saleId, input.storeId]);
    });
    return createdSale;
  },
  async processSaleReturn(input) {
    let result = null;
    await withPostgresTransaction5(postgresPool2, async (client) => {
      const sale = await getSingleQueryRow5(client, `
        SELECT s.*
        FROM sales s
        WHERE s.id = $1 AND s.store_id = $2 AND s.deleted_at IS NULL
      `, [input.saleId, input.storeId]);
      if (!sale) {
        throw new Error("Sale not found");
      }
      if (String(sale.status || "").toUpperCase() === "VOIDED") {
        throw new Error("Voided sales cannot be returned again");
      }
      const saleItems = await getSaleItemsForInvoiceForQueryClient(client, input.saleId);
      if (!saleItems.length) {
        throw new Error("No sale items found for this invoice");
      }
      const saleItemMap = new Map(saleItems.map((item) => [Number(item.id), item]));
      const processedItems = input.requestedItems.map((rawItem) => {
        const saleItemId = Number(rawItem?.sale_item_id || rawItem?.id);
        const requestedQuantity = Math.max(0, Number(rawItem?.quantity) || 0);
        const saleItem = saleItemMap.get(saleItemId);
        if (!saleItem || !requestedQuantity) {
          return null;
        }
        const availableQuantity = Math.max(0, Number(saleItem.returnable_quantity ?? saleItem.quantity) || 0);
        if (requestedQuantity > availableQuantity) {
          throw new Error(`${saleItem.product_name || "Item"} only has ${availableQuantity} returnable unit(s) left.`);
        }
        return {
          consignment_item_id: Math.max(0, Number(saleItem?.specs_at_sale?.consignment_item_id || 0) || 0),
          sale_item_id: saleItemId,
          product_id: Number(saleItem.product_id) || 0,
          name: saleItem.product_name || `Product #${saleItem.product_id}`,
          quantity: requestedQuantity,
          price_at_sale: Number(saleItem.price_at_sale || 0) || 0,
          subtotal: Number((Number(saleItem.price_at_sale || 0) * requestedQuantity).toFixed(2)) || 0,
          condition: saleItem.condition || null,
          imei_serial: saleItem.imei_serial || null,
          item_source: String(saleItem.item_source || "").toUpperCase() === "SOURCED" ? "SOURCED" : String(saleItem.item_source || "").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : "INVENTORY",
          sourced_vendor_name: saleItem.sourced_vendor_name || null,
          sourced_vendor_reference: saleItem.sourced_vendor_reference || null,
          sourced_cost_price: Math.max(0, Number(saleItem.cost_at_sale || 0) || 0),
          return_to_vendor_required: ["SOURCED", "CONSIGNMENT"].includes(String(saleItem.item_source || "").toUpperCase()),
          specs_at_sale: safeJsonParse3(saleItem.specs_at_sale, {})
        };
      }).filter(Boolean);
      if (!processedItems.length) {
        throw new Error("Choose at least one return quantity greater than zero.");
      }
      const returnedValue = Number(processedItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0).toFixed(2)) || 0;
      const requestedRefundAmount = Math.max(0, Number(input?.refundAmount || 0) || 0);
      const refundAmount = requestedRefundAmount > 0 ? requestedRefundAmount : input.returnType === "REFUND" ? returnedValue : 0;
      if (refundAmount > returnedValue + 9e-3) {
        throw new Error("Refund amount cannot be greater than the selected return value.");
      }
      if (input.restockItems) {
        for (const item of processedItems) {
          const itemSource = String(item.item_source || "").toUpperCase();
          if (itemSource === "SOURCED") {
            continue;
          }
          if (itemSource === "CONSIGNMENT") {
            const consignmentItemId = Math.max(0, Number(item?.consignment_item_id || item?.specs_at_sale?.consignment_item_id || 0) || 0);
            if (consignmentItemId <= 0) {
              continue;
            }
            const consignmentRow = await getSingleQueryRow5(client, `
              SELECT id, quantity, status, public_specs
              FROM consignment_items
              WHERE id = $1 AND store_id = $2
              LIMIT 1
            `, [consignmentItemId, input.storeId]);
            if (!consignmentRow?.id) {
              continue;
            }
            const returnedQty = Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));
            const currentQuantity = Math.max(0, Math.trunc(Number(consignmentRow.quantity || 0) || 0));
            const publicSpecs = safeJsonParse3(consignmentRow.public_specs, {});
            const nextReturnedQuantity = Math.max(0, Math.trunc(Number(publicSpecs?.__returned_quantity_total || 0) || 0)) + returnedQty;
            const nextReturnedAmount2 = Number((Math.max(0, Number(publicSpecs?.__returned_amount_total || 0) || 0) + Math.max(0, Number(item.subtotal || 0) || 0)).toFixed(2));
            const nextSoldQuantity = Math.max(0, Math.trunc(Number(publicSpecs?.__sold_quantity_total || 0) || 0) - returnedQty);
            const nextSoldAmount = Number((Math.max(0, Number(publicSpecs?.__sold_amount_total || 0) || 0) - Math.max(0, Number(item.subtotal || 0) || 0)).toFixed(2));
            const nextQuantity = Math.max(0, currentQuantity + returnedQty);
            const rawMatrix = publicSpecs && typeof publicSpecs === "object" ? publicSpecs.__condition_matrix : null;
            const matrixKeys = ["new", "open_box", "used"];
            let nextPublicSpecs = {
              ...publicSpecs && typeof publicSpecs === "object" ? publicSpecs : {},
              __returned_quantity_total: nextReturnedQuantity,
              __returned_amount_total: nextReturnedAmount2,
              __sold_quantity_total: nextSoldQuantity,
              __sold_amount_total: nextSoldAmount,
              __last_returned_at: (/* @__PURE__ */ new Date()).toISOString()
            };
            if (rawMatrix && typeof rawMatrix === "object") {
              const normalizedMatrix = matrixKeys.reduce((acc, key) => {
                const source = rawMatrix[key] && typeof rawMatrix[key] === "object" ? rawMatrix[key] : {};
                acc[key] = {
                  price: Math.max(0, Number(source.price || 0) || 0),
                  cost: Math.max(0, Number(source.cost || 0) || 0),
                  stock: Math.max(0, Math.trunc(Number(source.stock || 0) || 0))
                };
                return acc;
              }, {});
              let matrixKey = String(item.condition || "").toLowerCase();
              if (!matrixKeys.includes(matrixKey)) {
                matrixKey = "used";
              }
              normalizedMatrix[matrixKey].stock = Math.max(0, Math.trunc(Number(normalizedMatrix[matrixKey].stock || 0) || 0) + returnedQty);
              nextPublicSpecs = {
                ...nextPublicSpecs,
                __condition_matrix: normalizedMatrix
              };
            }
            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity > 0 ? "approved" : String(consignmentRow.status || "pending").toLowerCase(), JSON.stringify(nextPublicSpecs), consignmentItemId, input.storeId]
            );
            continue;
          }
          await updateProductAvailableStockForQueryClient3({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity),
            condition: item.condition || null,
            operation: "increase"
          });
        }
      }
      for (const item of processedItems) {
        const itemSource = String(item.item_source || "").toUpperCase();
        if (!["SOURCED", "CONSIGNMENT"].includes(itemSource)) {
          continue;
        }
        const unitVendorCost = Math.max(0, Number(item.sourced_cost_price || 0) || 0);
        const returnCostValue = Number((unitVendorCost * Math.max(0, Number(item.quantity) || 0)).toFixed(2));
        const payable = await getSingleQueryRow5(client, `
          SELECT id, amount_due, status
          FROM vendor_payables
          WHERE sale_item_id = $1 AND sale_id = $2 AND store_id = $3
          ORDER BY id DESC
          LIMIT 1
        `, [item.sale_item_id, input.saleId, input.storeId]);
        if (!payable?.id) {
          continue;
        }
        const { nextAmountDue, nextStatus: nextStatus2 } = computePayableAfterReturn({
          currentAmountDue: Number(payable.amount_due || 0) || 0,
          returnCostValue,
          currentStatus: String(payable.status || "UNPAID")
        });
        item.vendor_payable_adjustment = returnCostValue;
        item.vendor_payable_source = itemSource;
        await client.query(
          "UPDATE vendor_payables SET amount_due = $1, status = $2, settled_at = CASE WHEN $2 = 'SETTLED' THEN COALESCE(settled_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id = $3",
          [nextAmountDue, nextStatus2, Number(payable.id)]
        );
        logVendorPayableMutation({
          action: "return_adjusted",
          storeId: input.storeId,
          saleId: input.saleId,
          saleItemId: Number(item.sale_item_id || 0) || void 0,
          payableId: Number(payable.id || 0) || void 0,
          sourceType: itemSource === "CONSIGNMENT" ? "CONSIGNMENT" : "SOURCED",
          previousAmountDue: Math.max(0, Number(payable.amount_due || 0) || 0),
          nextAmountDue,
          previousStatus: String(payable.status || "UNPAID").toUpperCase(),
          nextStatus: nextStatus2
        });
      }
      const returnInsert = await client.query(`
        INSERT INTO sales_returns (
          sale_id, store_id, processed_by, returned_value, refund_amount, refund_method,
          return_type, restock_items, reason, items, note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        input.saleId,
        input.storeId,
        input.processedBy,
        returnedValue,
        refundAmount,
        input.refundMethod,
        input.returnType,
        input.restockItems ? 1 : 0,
        input.reason,
        JSON.stringify(processedItems),
        input.note || null
      ]);
      const returnMeta = await getSingleQueryRow5(client, `
        SELECT
          COUNT(*) as returns_count,
          COALESCE(SUM(returned_value), 0) as returned_amount,
          COALESCE(SUM(refund_amount), 0) as refunded_amount
        FROM sales_returns
        WHERE sale_id = $1
      `, [input.saleId]);
      const paymentReceived = getTotalPaidFromPaymentMethods(sale.payment_methods);
      const nextReturnedAmount = Math.max(0, Number(returnMeta?.returned_amount || 0));
      const nextNetTotal = Math.max(0, Number((Number(sale.total || 0) - nextReturnedAmount).toFixed(2)) || 0);
      const nextStatus = paymentReceived >= nextNetTotal - 9e-3 ? "COMPLETED" : "PENDING";
      await client.query("UPDATE sales SET status = $1 WHERE id = $2 AND store_id = $3", [nextStatus, input.saleId, input.storeId]);
      const returnId = Number(returnInsert.rows[0]?.id || 0);
      const createdReturn = await getSingleQueryRow5(client, `
        SELECT sr.*, u.username as processed_by_username, c.name as customer_name, c.phone as customer_phone
        FROM sales_returns sr
        LEFT JOIN sales s ON sr.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE sr.id = $1 AND sr.store_id = $2
      `, [returnId, input.storeId]);
      const updatedSale = await getSingleQueryRow5(client, `
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
          COALESCE((SELECT SUM(sr.returned_value) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returned_amount,
          COALESCE((SELECT SUM(sr.refund_amount) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as refunded_amount,
          COALESCE((SELECT COUNT(*) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returns_count
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.id = $1 AND s.store_id = $2
      `, [input.saleId, input.storeId]);
      result = {
        returnId,
        productIds: processedItems.map((item) => Number(item.product_id)).filter((productId) => Number.isInteger(productId) && productId > 0),
        createdReturn,
        updatedSale
      };
    });
    return result;
  },
  async voidSale(input) {
    let voidedSale = null;
    await withPostgresTransaction5(postgresPool2, async (client) => {
      const sale = await getSingleQueryRow5(client, "SELECT * FROM sales WHERE id = $1 AND store_id = $2", [input.saleId, input.storeId]);
      if (!sale) {
        throw new Error("Sale not found");
      }
      if (sale.status === "VOIDED") {
        throw new Error("Sale is already voided");
      }
      const returnMeta = await getSingleQueryRow5(client, `
        SELECT COUNT(*) as returns_count
        FROM sales_returns
        WHERE sale_id = $1
      `, [input.saleId]);
      if (Number(returnMeta?.returns_count || 0) > 0) {
        throw new Error("This sale already has a processed return. Use the returns workflow instead of voiding it.");
      }
      await client.query("UPDATE sales SET status = 'VOIDED', void_reason = $1, voided_by = $2 WHERE id = $3 AND store_id = $4", [input.reason, input.voidedBy, input.saleId, input.storeId]);
      const items = await getQueryRows4(client, "SELECT * FROM sale_items WHERE sale_id = $1", [input.saleId]);
      for (const item of items) {
        const specs = safeJsonParse3(item?.specs_at_sale, {});
        if (Boolean(specs?.sourced_item)) {
          continue;
        }
        const product = await getSingleQueryRow5(client, "SELECT * FROM products WHERE id = $1", [item.product_id]);
        if (product) {
          await updateProductAvailableStockForQueryClient3({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity) || 0,
            condition: item.condition || null,
            operation: "increase"
          });
        }
      }
      voidedSale = {
        saleId: input.saleId,
        total: Number(sale.total || 0) || 0,
        previousStatus: String(sale.status || "COMPLETED"),
        productIds: items.map((item) => Number(item.product_id)).filter((productId) => Number.isInteger(productId) && productId > 0)
      };
    });
    return voidedSale;
  },
  async createTransactionFlag(input) {
    const result = await postgresPool2.query(`
      INSERT INTO transaction_flags (store_id, sale_id, flagged_by, issue_type, note, status)
      VALUES ($1, $2, $3, $4, $5, 'OPEN')
      RETURNING *
    `, [input.storeId, input.saleId, input.flaggedBy, input.issueType, input.note]);
    return result.rows[0] || null;
  }
});

// serverWriteRepository.imports.ts
var isUniqueViolation5 = (error) => error instanceof Error && "code" in error && error.code === "23505";
var withPostgresTransaction6 = async (pool, operation, maxRetries = 3) => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      attempt += 1;
      if (isUniqueViolation5(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};
var safeJsonParse4 = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
var normalizePhone2 = (value) => String(value ?? "").replace(/\D/g, "");
var normalizeStoredPhone = (value) => {
  const raw = String(value ?? "").trim();
  const digits = normalizePhone2(raw);
  return raw.startsWith("+") && digits ? `+${digits}` : digits;
};
var normalizeProductBarcode = (value) => String(value ?? "").trim();
var normalizeCollectionCondition4 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_");
};
var clampChatCleanupReminderDay = (value) => Math.min(31, Math.max(1, Number(value) || 28));
var clampChatRetentionValue = (value) => Math.min(365, Math.max(1, Number(value) || 3));
var normalizeChatRetentionUnit = (value) => String(value || "").toLowerCase() === "days" ? "days" : "months";
var normalizeStoreSignatureImage = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 8e6) return null;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw) ? raw : null;
};
var normalizeHandoverPriority = (value) => String(value || "").toUpperCase() === "IMPORTANT" ? "IMPORTANT" : "INFO";
var toFiniteNumberOrNull3 = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var getConditionMatrixSlot3 = (product, condition) => {
  const normalizedCondition = normalizeCollectionCondition4(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }
  const matrix = safeJsonParse4(product.condition_matrix, {});
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};
var resolveTrackedCost3 = ({
  product,
  condition,
  sellingPrice,
  fallbackToSelling = false
}) => {
  const slot = getConditionMatrixSlot3(product, condition);
  const normalizedCondition = String(condition || "STANDARD").trim().toLowerCase().replace(/\s+/g, "_");
  const resolvedSellingPrice = toFiniteNumberOrNull3(sellingPrice) ?? toFiniteNumberOrNull3(slot?.price) ?? toFiniteNumberOrNull3(product?.price) ?? 0;
  const slotCost = toFiniteNumberOrNull3(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
  const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== "standard";
  if (usesConditionMatrixCost) {
    if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
      return { cost: slotCost, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice
      };
    }
    return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
  }
  const candidateCosts = [slotCost, toFiniteNumberOrNull3(product?.cost)];
  for (const candidate of candidateCosts) {
    if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
      return { cost: candidate, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
  }
  if (fallbackToSelling) {
    return {
      cost: resolvedSellingPrice,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: resolvedSellingPrice > 0,
      sellingPrice: resolvedSellingPrice
    };
  }
  return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
};
var calculateEan13CheckDigit = (base12) => {
  const digits = base12.replace(/\D/g, "");
  if (digits.length !== 12) {
    throw new Error("Barcode base must contain exactly 12 digits");
  }
  const weightedSum = digits.split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - weightedSum % 10) % 10);
};
var getSingleQueryRow6 = async (client, text, values = []) => {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
};
var generateUniqueQuickCodeForQueryClient = async (client, maxAttempts = 50, excludeProductId, preferredCandidate) => {
  const quickCodePattern = /^([1-9])\1\1\d{2}$/;
  const buildQuickCodeCandidate = (leadingDigit, trailingValue) => {
    const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
    const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, "0");
    return `${repeatedDigit.repeat(3)}${suffix}`;
  };
  const canUseCandidate = async (candidate) => {
    const normalized = String(candidate || "").trim();
    if (!normalized || !quickCodePattern.test(normalized)) return false;
    const exists = await getSingleQueryRow6(client, "SELECT id FROM products WHERE quick_code = $1 LIMIT 1", [normalized]);
    return !exists || excludeProductId != null && Number(exists.id) === Number(excludeProductId);
  };
  const normalizedPreferred = String(preferredCandidate || "").trim();
  if (normalizedPreferred && await canUseCandidate(normalizedPreferred)) {
    return normalizedPreferred;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildQuickCodeCandidate(
      1 + Math.floor(Math.random() * 9),
      Math.floor(Math.random() * 100)
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }
  const fallbackSeed = Number(Date.now()) % 900;
  for (let offset = 0; offset < 900; offset += 1) {
    const candidateIndex = (fallbackSeed + offset) % 900;
    const candidate = buildQuickCodeCandidate(
      Math.floor(candidateIndex / 100) + 1,
      candidateIndex % 100
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }
  return null;
};
var generateUniqueBarcodeForQueryClient = async (client, storeId, maxAttempts = 20) => {
  const storePart = String(Math.max(0, Number(storeId) || 0)).padStart(4, "0").slice(-4);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const timePart = String(Date.now() + attempt).slice(-5).padStart(5, "0");
    const randomDigit = String(Math.floor(Math.random() * 10));
    const base12 = `20${storePart}${timePart}${randomDigit}`;
    const candidate = `${base12}${calculateEan13CheckDigit(base12)}`;
    const exists = await getSingleQueryRow6(client, "SELECT id FROM products WHERE barcode = $1 LIMIT 1", [candidate]);
    if (!exists) {
      return candidate;
    }
  }
  return null;
};
var generateUniqueCustomerCodeForQueryClient = async (client, maxAttempts = 20) => {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    const exists = await getSingleQueryRow6(client, "SELECT id FROM customers WHERE customer_code = $1 LIMIT 1", [code]);
    if (!exists) return code;
    attempts += 1;
  }
  return `${Date.now().toString().slice(-6)}`;
};
var createImportsWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  async importProducts(input) {
    const toNumber = (value) => {
      const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const toInteger = (value) => Math.max(0, Math.round(toNumber(value)));
    const parseObject = (value, fallback) => {
      if (!value) return fallback;
      if (typeof value === "object") return value;
      try {
        return JSON.parse(String(value));
      } catch {
        return fallback;
      }
    };
    const normalizeHeaderKey = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const getRowValue = (row, aliases) => {
      const normalizedRow = Object.fromEntries(
        Object.entries(row || {}).map(([key, value]) => [normalizeHeaderKey(key), value])
      );
      for (const alias of aliases) {
        const normalizedAlias = normalizeHeaderKey(alias);
        if (normalizedAlias in normalizedRow) {
          return normalizedRow[normalizedAlias];
        }
      }
      return void 0;
    };
    let importedCount = 0;
    await withPostgresTransaction6(postgresPool2, async (client) => {
      for (const row of input.rows) {
        const name = String(getRowValue(row, ["name", "product_name", "product name", "product"]) ?? "").trim();
        if (!name) continue;
        const categoryName = String(getRowValue(row, ["category"]) ?? "General").trim() || "General";
        let categoryId = null;
        const existingCategory = await getSingleQueryRow6(client, "SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1", [input.storeId, categoryName]);
        if (existingCategory) {
          categoryId = Number(existingCategory.id);
        } else {
          const categoryInsert = await client.query("INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) RETURNING id", [input.storeId, categoryName, null]);
          categoryId = Number(categoryInsert.rows[0]?.id || 0) || null;
        }
        const quickCodeCandidate = String(getRowValue(row, ["quick_code", "quick code"]) ?? "").trim();
        const barcodeCandidate = normalizeProductBarcode(getRowValue(row, ["barcode", "sku", "barcode_sku", "barcode / sku"]));
        const existingProduct = await getSingleQueryRow6(client, `
          SELECT id, deleted_at FROM products
          WHERE store_id = $1 AND (
            (barcode IS NOT NULL AND barcode != '' AND barcode = $2)
            OR (quick_code IS NOT NULL AND quick_code != '' AND quick_code = $3)
          )
          ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, id DESC
          LIMIT 1
        `, [input.storeId, barcodeCandidate || null, quickCodeCandidate || null]);
        const quickCode = await generateUniqueQuickCodeForQueryClient(client, 50, Number(existingProduct?.id || 0) || null, quickCodeCandidate);
        const resolvedBarcode = barcodeCandidate || await generateUniqueBarcodeForQueryClient(client, input.storeId);
        const parsedSpecs = parseObject(getRowValue(row, ["specs"]), {});
        const parsedMatrix = parseObject(getRowValue(row, ["condition_matrix", "condition matrix"]), null);
        const conditionMatrix = parsedMatrix || {
          new: {
            price: toNumber(getRowValue(row, ["new_price", "new price"])),
            stock: toInteger(getRowValue(row, ["new_stock", "new stock"])),
            cost: toNumber(getRowValue(row, ["new_cost", "new cost"]))
          },
          open_box: {
            price: toNumber(getRowValue(row, ["open_box_price", "open box price"])),
            stock: toInteger(getRowValue(row, ["open_box_stock", "open box stock"])),
            cost: toNumber(getRowValue(row, ["open_box_cost", "open box cost"]))
          },
          used: {
            price: toNumber(getRowValue(row, ["used_price", "used price"])),
            stock: toInteger(getRowValue(row, ["used_stock", "used stock"])),
            cost: toNumber(getRowValue(row, ["used_cost", "used cost"]))
          }
        };
        const payload = {
          name,
          barcode: resolvedBarcode,
          categoryName,
          categoryId,
          thumbnail: String(getRowValue(row, ["thumbnail", "image", "image_url", "image url"]) ?? "").trim() || null,
          quickCode,
          specs: JSON.stringify(parsedSpecs || {}),
          conditionMatrix: JSON.stringify(conditionMatrix || null),
          price: toNumber(getRowValue(row, ["price", "selling_price", "selling price"])),
          stock: toInteger(getRowValue(row, ["stock", "stock_level", "stock level"])),
          cost: toNumber(getRowValue(row, ["cost", "cost_price", "cost price"])),
          createdAt: String(getRowValue(row, ["created_at", "created at"]) ?? (/* @__PURE__ */ new Date()).toISOString())
        };
        if (existingProduct) {
          await client.query(`
            UPDATE products
            SET name = $1, barcode = $2, category = $3, category_id = $4, thumbnail = $5, quick_code = $6,
                specs = $7, condition_matrix = $8, price = $9, stock = $10, cost = $11, deleted_at = NULL
            WHERE id = $12 AND store_id = $13
          `, [
            payload.name,
            payload.barcode,
            payload.categoryName,
            payload.categoryId,
            payload.thumbnail,
            payload.quickCode,
            payload.specs,
            payload.conditionMatrix,
            payload.price,
            payload.stock,
            payload.cost,
            existingProduct.id,
            input.storeId
          ]);
        } else {
          await client.query(`
            INSERT INTO products (store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `, [
            input.storeId,
            payload.name,
            payload.barcode,
            payload.categoryName,
            payload.categoryId,
            payload.thumbnail,
            payload.quickCode,
            payload.specs,
            payload.conditionMatrix,
            payload.price,
            payload.stock,
            payload.cost,
            payload.createdAt
          ]);
        }
        importedCount += 1;
      }
    });
    return { importedCount };
  },
  async importCustomers(input) {
    let importedCount = 0;
    await withPostgresTransaction6(postgresPool2, async (client) => {
      for (const row of input.rows) {
        const name = String(row?.name ?? "").trim();
        const rawPhone = String(row?.phone ?? "").trim();
        const normalizedPhone = normalizePhone2(rawPhone);
        const storedPhone = normalizeStoredPhone(rawPhone);
        if (!name || !normalizedPhone) continue;
        const existing = await getSingleQueryRow6(
          client,
          `SELECT * FROM customers
           WHERE store_id = $1
             AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
           LIMIT 1`,
          [input.storeId, normalizedPhone]
        );
        if (existing) {
          await client.query("UPDATE customers SET name = $1, address = $2 WHERE id = $3 AND store_id = $4", [name, String(row?.address ?? "").trim() || null, existing.id, input.storeId]);
        } else {
          await client.query(
            "INSERT INTO customers (store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
            [
              input.storeId,
              name,
              storedPhone,
              String(row?.address ?? "").trim() || null,
              String(row?.customer_code ?? "").trim() || await generateUniqueCustomerCodeForQueryClient(client),
              String(row?.created_at ?? (/* @__PURE__ */ new Date()).toISOString())
            ]
          );
        }
        importedCount += 1;
      }
    });
    return { importedCount };
  },
  async importSales(input) {
    const toNumber = (value) => {
      const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };
    let importedCount = 0;
    await withPostgresTransaction6(postgresPool2, async (client) => {
      for (const row of input.rows) {
        const customerName = String(row?.customer_name ?? "").trim();
        const rawCustomerPhone = String(row?.customer_phone ?? "").trim();
        const normalizedCustomerPhone = normalizePhone2(rawCustomerPhone);
        const storedCustomerPhone = normalizeStoredPhone(rawCustomerPhone);
        const customerAddress = String(row?.customer_address ?? "").trim() || null;
        let customerId = null;
        if (customerName || normalizedCustomerPhone) {
          const existingCustomer = normalizedCustomerPhone ? await getSingleQueryRow6(
            client,
            `SELECT * FROM customers
                 WHERE store_id = $1
                   AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
                 LIMIT 1`,
            [input.storeId, normalizedCustomerPhone]
          ) : null;
          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else if (customerName && normalizedCustomerPhone) {
            const insertedCustomer = await client.query(
              "INSERT INTO customers (store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
              [
                input.storeId,
                customerName,
                storedCustomerPhone,
                customerAddress,
                await generateUniqueCustomerCodeForQueryClient(client),
                String(row?.created_at ?? row?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString())
              ]
            );
            customerId = Number(insertedCustomer.rows[0]?.id || 0) || null;
          }
        }
        const subtotal = toNumber(row?.subtotal) || toNumber(row?.total);
        const taxAmount = toNumber(row?.tax_amount);
        const taxPercentage = toNumber(row?.tax_percentage);
        const total = toNumber(row?.total) || subtotal + taxAmount;
        const paymentMethods = {
          cash: toNumber(row?.payment_cash ?? row?.cash),
          transfer: toNumber(row?.payment_transfer ?? row?.transfer),
          pos: toNumber(row?.payment_pos ?? row?.pos)
        };
        const status = ["COMPLETED", "PENDING", "VOIDED"].includes(String(row?.status ?? "").toUpperCase()) ? String(row?.status).toUpperCase() : "COMPLETED";
        const timestamp = String(row?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString());
        const saleInsert = await client.query(`
          INSERT INTO sales (store_id, subtotal, tax_amount, tax_percentage, total, user_id, payment_methods, status, timestamp, customer_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          input.storeId,
          subtotal,
          taxAmount,
          taxPercentage,
          total,
          input.userId,
          JSON.stringify(paymentMethods),
          status,
          timestamp,
          customerId
        ]);
        const saleId = Number(saleInsert.rows[0]?.id || 0);
        const productName = String(row?.product_name ?? "").trim();
        const productBarcode = String(row?.barcode ?? "").trim();
        const quantity = Math.max(1, Math.round(toNumber(row?.quantity) || 1));
        const priceAtSale = toNumber(row?.price_at_sale) || toNumber(row?.item_price);
        if (saleId && (productName || productBarcode)) {
          let product = null;
          if (productBarcode) {
            product = await getSingleQueryRow6(client, "SELECT * FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1", [input.storeId, productBarcode]);
          }
          if (!product && productName) {
            product = await getSingleQueryRow6(client, "SELECT * FROM products WHERE store_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL LIMIT 1", [input.storeId, productName]);
          }
          if (!product && productName) {
            const quickCode = await generateUniqueQuickCodeForQueryClient(client, 10);
            const insertProductResult = await client.query(`
              INSERT INTO products (store_id, name, barcode, category, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              RETURNING id
            `, [
              input.storeId,
              productName,
              productBarcode || null,
              "Imported",
              null,
              quickCode,
              JSON.stringify({}),
              JSON.stringify(null),
              priceAtSale,
              0,
              0,
              timestamp
            ]);
            product = { id: Number(insertProductResult.rows[0]?.id || 0) };
          }
          if (product?.id) {
            const resolvedCostAtSale = resolveTrackedCost3({
              product,
              condition: String(row?.condition ?? "").trim() || null,
              sellingPrice: priceAtSale
            });
            await client.query(`
              INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
              saleId,
              product.id,
              quantity,
              priceAtSale,
              (priceAtSale || 0) * quantity,
              resolvedCostAtSale.cost,
              String(row?.imei_serial ?? "").trim() || null,
              String(row?.condition ?? "").trim() || null,
              JSON.stringify({})
            ]);
          }
        }
        importedCount += 1;
      }
    });
    return { importedCount };
  },
  async importStoreData(input) {
    const numericStoreId = Number(input.storeId);
    const { data } = input;
    const importMode = input.mode === "merge" ? "merge" : "replace";
    await withPostgresTransaction6(postgresPool2, async (client) => {
      if (importMode === "replace") {
        await client.query("DELETE FROM market_collections WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM staff_attendance WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM internal_messages WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM inventory_batches WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM repair_tickets WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM stock_adjustments WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM vendor_payables WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1))", [numericStoreId]);
        await client.query("DELETE FROM consignment_vendor_bank_details WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM consignment_items WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM sales_returns WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM transaction_flags WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)", [numericStoreId]);
        await client.query("DELETE FROM purchase_orders WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM pro_formas WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM sales WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM active_holds WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM handover_notes WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM expenses WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM product_change_requests WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM products WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM categories WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM customers WHERE store_id = $1", [numericStoreId]);
        await client.query("DELETE FROM suppliers WHERE store_id = $1", [numericStoreId]);
      }
      if (data.store) {
        await client.query(`
          UPDATE stores SET name = $1, address = $2, phone = $3, logo = $4, signature_image = $5, mode = $6,
            custom_specs = $7, bank_name = $8, account_number = $9, account_name = $10, receipt_paper_size = $11,
            document_color = $12, show_store_name_on_documents = $13, tax_enabled = $14, tax_percentage = $15,
            receipt_header_note = $16, receipt_footer_note = $17, receipt_show_bank_details = $18,
            default_missing_cost_to_price = $19, pin_checkout_enabled = $20, chat_cleanup_reminders_enabled = $21,
            chat_cleanup_reminder_day = $22, chat_retention_value = $23, chat_retention_unit = $24,
            last_chat_cleanup_at = $25
          WHERE id = $26
        `, [
          data.store.name,
          data.store.address,
          data.store.phone,
          data.store.logo,
          normalizeStoreSignatureImage(data.store.signature_image),
          data.store.mode,
          data.store.custom_specs,
          data.store.bank_name || null,
          data.store.account_number || null,
          data.store.account_name || null,
          data.store.receipt_paper_size === "A4" ? "A4" : "THERMAL",
          /^#([0-9A-Fa-f]{6})$/.test(String(data.store.document_color || "")) ? String(data.store.document_color).toUpperCase() : "#F4BD4A",
          data.store.show_store_name_on_documents ? 1 : 0,
          data.store.tax_enabled ? 1 : 0,
          Math.min(100, Math.max(0, Number(data.store.tax_percentage) || 0)),
          String(data.store.receipt_header_note || "").trim(),
          String(data.store.receipt_footer_note || "").trim() || "Thank you for your business!",
          data.store.receipt_show_bank_details === false ? 0 : 1,
          data.store.default_missing_cost_to_price ? 1 : 0,
          data.store.pin_checkout_enabled === false ? 0 : 1,
          data.store.chat_cleanup_reminders_enabled === false ? 0 : 1,
          clampChatCleanupReminderDay(data.store.chat_cleanup_reminder_day),
          clampChatRetentionValue(data.store.chat_retention_value),
          normalizeChatRetentionUnit(data.store.chat_retention_unit),
          data.store.last_chat_cleanup_at || null,
          numericStoreId
        ]);
      }
      const importedUserIdMap = /* @__PURE__ */ new Map();
      if (data.users && Array.isArray(data.users)) {
        for (const u of data.users) {
          const incomingUserId = Number(u.id);
          const username = String(u.username || "").trim();
          if (!username) continue;
          const updateResult = await client.query(
            "UPDATE users SET store_id = $1, username = $2, password = $3, role = $4, pin = $5 WHERE id = $6 RETURNING id",
            [numericStoreId, username, u.password, u.role, u.pin || null, incomingUserId]
          );
          if (updateResult.rowCount === 0) {
            await client.query(
              "INSERT INTO users (id, store_id, username, password, role, pin) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
              [incomingUserId, numericStoreId, username, u.password, u.role, u.pin || null]
            );
          }
          const byId = await client.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [incomingUserId]);
          const byUsername = byId.rows[0] ? null : await client.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", [username]);
          const resolvedUser = byId.rows[0] || byUsername?.rows[0];
          if (resolvedUser) {
            importedUserIdMap.set(incomingUserId, Number(resolvedUser.id));
          }
        }
      }
      const importedUserIds = new Set(Array.from(importedUserIdMap.values()));
      const fallbackUserId = importedUserIdMap.get(Number(input.actorUserId)) ?? (Array.from(importedUserIds)[0] ?? Number(input.actorUserId));
      const importedCategoryIds = /* @__PURE__ */ new Set();
      if (data.categories && Array.isArray(data.categories)) {
        for (const c of data.categories) {
          await client.query(
            "INSERT INTO categories (id, store_id, name, description, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            [c.id, numericStoreId, c.name, c.description, c.created_at]
          );
          importedCategoryIds.add(Number(c.id));
        }
      }
      const importedCustomerIds = /* @__PURE__ */ new Set();
      if (data.customers && Array.isArray(data.customers)) {
        for (const c of data.customers) {
          await client.query(
            "INSERT INTO customers (id, store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
            [c.id, numericStoreId, c.name, c.phone, c.address, c.customer_code, c.created_at]
          );
          importedCustomerIds.add(Number(c.id));
        }
      }
      const importedSupplierIds = /* @__PURE__ */ new Set();
      const importedSuppliers = Array.isArray(data.suppliers) ? data.suppliers : Array.isArray(data.suppliers_list) ? data.suppliers_list : [];
      for (const supplier of importedSuppliers) {
        await client.query(
          "INSERT INTO suppliers (id, store_id, name, phone, email, address, note, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING",
          [
            supplier.id,
            numericStoreId,
            supplier.name,
            supplier.phone || null,
            supplier.email || null,
            supplier.address || null,
            supplier.note || null,
            supplier.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            supplier.updated_at || supplier.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
        importedSupplierIds.add(Number(supplier.id));
      }
      const importedProductIds = /* @__PURE__ */ new Set();
      if (data.products && Array.isArray(data.products)) {
        for (const p of data.products) {
          const resolvedCategoryId = importedCategoryIds.has(Number(p.category_id)) ? Number(p.category_id) : null;
          await client.query(
            "INSERT INTO products (id, store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING",
            [p.id, numericStoreId, p.name, p.barcode, p.category, resolvedCategoryId, p.thumbnail, p.quick_code, p.specs, p.condition_matrix, p.price, p.stock, p.cost, p.created_at || (/* @__PURE__ */ new Date()).toISOString(), p.deleted_at]
          );
          importedProductIds.add(Number(p.id));
        }
      }
      if (data.stockAdjustments && Array.isArray(data.stockAdjustments)) {
        for (const entry of data.stockAdjustments) {
          if (!importedProductIds.has(Number(entry.product_id))) continue;
          const resolvedAdjustedBy = importedUserIdMap.get(Number(entry.adjusted_by)) ?? fallbackUserId;
          await client.query(
            "INSERT INTO stock_adjustments (id, store_id, product_id, adjusted_by, adjustment_type, adjustment_mode, quantity_before, quantity_change, quantity_after, cost_impact, condition, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING",
            [
              entry.id,
              numericStoreId,
              entry.product_id,
              resolvedAdjustedBy,
              entry.adjustment_type || "MANUAL",
              entry.adjustment_mode || "DECREASE",
              entry.quantity_before ?? 0,
              entry.quantity_change ?? 0,
              entry.quantity_after ?? 0,
              entry.cost_impact ?? 0,
              entry.condition || null,
              entry.note || null,
              entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
            ]
          );
        }
      }
      const importedSaleIds = /* @__PURE__ */ new Set();
      if (data.sales && Array.isArray(data.sales)) {
        for (const s of data.sales) {
          const resolvedUserId = importedUserIdMap.get(Number(s.user_id)) ?? fallbackUserId;
          const resolvedVoidedBy = s.voided_by != null ? importedUserIdMap.get(Number(s.voided_by)) ?? null : null;
          const resolvedCustomerId = importedCustomerIds.has(Number(s.customer_id)) ? Number(s.customer_id) : null;
          await client.query(
            "INSERT INTO sales (id, store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, timestamp, deleted_at, void_reason, voided_by, is_ledger_locked, customer_id, due_date, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) ON CONFLICT DO NOTHING",
            [
              s.id,
              numericStoreId,
              s.subtotal ?? s.total,
              s.discount_amount ?? 0,
              s.discount_type || null,
              s.discount_value ?? 0,
              s.discount_note || null,
              s.tax_amount ?? 0,
              s.tax_percentage ?? 0,
              s.total,
              resolvedUserId,
              s.payment_methods,
              s.status,
              s.pdf_path,
              s.timestamp,
              s.deleted_at,
              s.void_reason,
              resolvedVoidedBy,
              s.is_ledger_locked ? 1 : 0,
              resolvedCustomerId,
              s.due_date || null,
              s.note || null
            ]
          );
          importedSaleIds.add(Number(s.id));
        }
      }
      if (data.saleItems && Array.isArray(data.saleItems)) {
        for (const si of data.saleItems) {
          if (!importedSaleIds.has(Number(si.sale_id)) || !importedProductIds.has(Number(si.product_id))) continue;
          const subtotal = si.price_at_sale * si.quantity || si.subtotal || 0;
          await client.query(
            "INSERT INTO sale_items (id, sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING",
            [si.id, si.sale_id, si.product_id, si.quantity, si.price_at_sale, subtotal, si.cost_at_sale ?? null, si.imei_serial, si.condition, si.specs_at_sale]
          );
        }
      }
      if (data.salesReturns && Array.isArray(data.salesReturns)) {
        for (const entry of data.salesReturns) {
          if (!importedSaleIds.has(Number(entry.sale_id))) continue;
          const resolvedProcessedBy = importedUserIdMap.get(Number(entry.processed_by)) ?? fallbackUserId;
          await client.query(
            "INSERT INTO sales_returns (id, sale_id, store_id, processed_by, returned_value, refund_amount, refund_method, return_type, restock_items, reason, items, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING",
            [
              entry.id,
              entry.sale_id,
              numericStoreId,
              resolvedProcessedBy,
              entry.returned_value ?? entry.refund_amount ?? 0,
              entry.refund_amount ?? 0,
              entry.refund_method || "cash",
              entry.return_type || "REFUND",
              entry.restock_items === false || entry.restock_items === "0" ? 0 : Number(entry.restock_items) === 0 ? 0 : 1,
              entry.reason || "Imported return record",
              typeof entry.items === "string" ? entry.items : JSON.stringify(entry.items || []),
              entry.note || null,
              entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
            ]
          );
        }
      }
      const importedTransactionFlags = Array.isArray(data.transactionFlags) ? data.transactionFlags : Array.isArray(data.transaction_flags) ? data.transaction_flags : [];
      for (const entry of importedTransactionFlags) {
        if (!importedSaleIds.has(Number(entry.sale_id))) continue;
        const resolvedFlaggedBy = importedUserIdMap.get(Number(entry.flagged_by)) ?? fallbackUserId;
        const resolvedBy = entry.resolved_by != null ? importedUserIdMap.get(Number(entry.resolved_by)) ?? fallbackUserId : null;
        await client.query(
          "INSERT INTO transaction_flags (id, store_id, sale_id, flagged_by, issue_type, note, status, created_at, resolved_at, resolved_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            entry.sale_id,
            resolvedFlaggedBy,
            entry.issue_type || "CHECK_REQUIRED",
            String(entry.note || "").trim() || "Imported transaction flag",
            entry.status || "OPEN",
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            entry.resolved_at || null,
            resolvedBy
          ]
        );
      }
      if (data.holds && Array.isArray(data.holds)) {
        for (const h of data.holds) {
          const resolvedUserId = importedUserIdMap.get(Number(h.user_id)) ?? fallbackUserId;
          await client.query(
            "INSERT INTO active_holds (id, store_id, user_id, staff_name, customer_name, note, cart_data, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING",
            [h.id, numericStoreId, resolvedUserId, h.staff_name, h.customer_name, h.note, h.cart_data, h.timestamp]
          );
        }
      }
      if (data.proformas && Array.isArray(data.proformas)) {
        for (const p of data.proformas) {
          const resolvedCustomerId = importedCustomerIds.has(Number(p.customer_id)) ? Number(p.customer_id) : null;
          await client.query(
            "INSERT INTO pro_formas (id, store_id, customer_id, customer_name, customer_phone, customer_address, items, subtotal, tax_amount, tax_percentage, total, expiry_date, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING",
            [
              p.id,
              numericStoreId,
              resolvedCustomerId,
              p.customer_name || null,
              p.customer_phone || null,
              p.customer_address || null,
              typeof p.items === "string" ? p.items : JSON.stringify(p.items || []),
              p.subtotal ?? p.total,
              p.tax_amount ?? 0,
              p.tax_percentage ?? 0,
              p.total,
              p.expiry_date,
              p.status || "PENDING",
              p.created_at
            ]
          );
        }
      }
      if (data.expenses && Array.isArray(data.expenses)) {
        for (const expense of data.expenses) {
          const resolvedCreatedBy = importedUserIdMap.get(Number(expense.created_by)) ?? fallbackUserId;
          await client.query(
            "INSERT INTO expenses (id, store_id, title, category, amount, note, spent_at, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING",
            [
              expense.id,
              numericStoreId,
              expense.title,
              expense.category || "General",
              expense.amount,
              expense.note || null,
              expense.spent_at || expense.created_at || (/* @__PURE__ */ new Date()).toISOString(),
              resolvedCreatedBy,
              expense.created_at || (/* @__PURE__ */ new Date()).toISOString()
            ]
          );
        }
      }
      const importedHandoverNotes = Array.isArray(data.handoverNotes) ? data.handoverNotes : Array.isArray(data.handover_notes) ? data.handover_notes : [];
      for (const entry of importedHandoverNotes) {
        const resolvedAuthorId = importedUserIdMap.get(Number(entry.author_id)) ?? fallbackUserId;
        await client.query(
          "INSERT INTO handover_notes (id, store_id, author_id, note_text, priority, is_pinned, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            resolvedAuthorId,
            String(entry.note_text || entry.note || "").trim(),
            normalizeHandoverPriority(entry.priority),
            entry.is_pinned ? 1 : 0,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            entry.updated_at || entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      const importedInternalMessages = Array.isArray(data.internalMessages) ? data.internalMessages : Array.isArray(data.internal_messages) ? data.internal_messages : [];
      for (const entry of importedInternalMessages) {
        const resolvedSenderId = importedUserIdMap.get(Number(entry.sender_id)) ?? fallbackUserId;
        const resolvedRecipientId = importedUserIdMap.get(Number(entry.recipient_id)) ?? fallbackUserId;
        await client.query(
          "INSERT INTO internal_messages (id, store_id, sender_id, recipient_id, message_text, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            resolvedSenderId,
            resolvedRecipientId,
            String(entry.message_text || "").trim(),
            entry.is_read ? true : false,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      const importedAttendanceEntries = Array.isArray(data.staffAttendance) ? data.staffAttendance : Array.isArray(data.staff_attendance) ? data.staff_attendance : [];
      for (const entry of importedAttendanceEntries) {
        const resolvedUserId = importedUserIdMap.get(Number(entry.user_id)) ?? fallbackUserId;
        await client.query(
          "INSERT INTO staff_attendance (id, store_id, user_id, shift_date, clock_in_at, clock_out_at, total_minutes, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            resolvedUserId,
            entry.shift_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            entry.clock_in_at || entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            entry.clock_out_at || null,
            entry.total_minutes ?? 0,
            entry.note || null,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      const importedRepairTickets = Array.isArray(data.repairTickets) ? data.repairTickets : Array.isArray(data.repair_tickets) ? data.repair_tickets : [];
      for (const entry of importedRepairTickets) {
        const resolvedCreatedBy = entry.created_by != null ? importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId : null;
        const resolvedUpdatedBy = entry.updated_by != null ? importedUserIdMap.get(Number(entry.updated_by)) ?? fallbackUserId : null;
        await client.query(
          "INSERT INTO repair_tickets (id, store_id, ticket_number, customer_name, customer_phone, device_name, brand, model, imei_serial, issue_summary, accessories, purchase_reference, warranty_status, technician_name, intake_notes, internal_notes, estimated_cost, final_cost, amount_paid, status, promised_date, created_by, updated_by, completed_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            entry.ticket_number,
            entry.customer_name,
            entry.customer_phone || null,
            entry.device_name,
            entry.brand || null,
            entry.model || null,
            entry.imei_serial || null,
            entry.issue_summary,
            entry.accessories || null,
            entry.purchase_reference || null,
            entry.warranty_status || "NO_WARRANTY",
            entry.technician_name || null,
            entry.intake_notes || null,
            entry.internal_notes || null,
            entry.estimated_cost ?? 0,
            entry.final_cost ?? 0,
            entry.amount_paid ?? 0,
            entry.status || "RECEIVED",
            entry.promised_date || null,
            resolvedCreatedBy,
            resolvedUpdatedBy,
            entry.completed_at || null,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            entry.updated_at || entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      const importedPurchaseOrders = Array.isArray(data.purchaseOrders) ? data.purchaseOrders : Array.isArray(data.purchase_orders) ? data.purchase_orders : [];
      for (const entry of importedPurchaseOrders) {
        const resolvedSupplierId = importedSupplierIds.has(Number(entry.supplier_id)) ? Number(entry.supplier_id) : null;
        const resolvedCreatedBy = entry.created_by != null ? importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId : null;
        const resolvedReceivedBy = entry.received_by != null ? importedUserIdMap.get(Number(entry.received_by)) ?? fallbackUserId : null;
        await client.query(
          "INSERT INTO purchase_orders (id, store_id, supplier_id, supplier_name, order_number, status, items, subtotal, note, expected_date, created_by, received_by, received_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            resolvedSupplierId,
            entry.supplier_name || null,
            entry.order_number,
            entry.status || "ORDERED",
            typeof entry.items === "string" ? entry.items : JSON.stringify(entry.items || []),
            entry.subtotal ?? 0,
            entry.note || null,
            entry.expected_date || null,
            resolvedCreatedBy,
            resolvedReceivedBy,
            entry.received_at || null,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            entry.updated_at || entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      const importedInventoryBatches = Array.isArray(data.inventoryBatches) ? data.inventoryBatches : Array.isArray(data.inventory_batches) ? data.inventory_batches : [];
      for (const entry of importedInventoryBatches) {
        if (!importedProductIds.has(Number(entry.product_id))) continue;
        const resolvedSupplierId = importedSupplierIds.has(Number(entry.supplier_id)) ? Number(entry.supplier_id) : null;
        const resolvedPurchaseOrderId = importedPurchaseOrders.some((order) => Number(order.id) === Number(entry.purchase_order_id)) ? Number(entry.purchase_order_id) : null;
        const resolvedReceivedBy = entry.received_by != null ? importedUserIdMap.get(Number(entry.received_by)) ?? fallbackUserId : null;
        await client.query(
          "INSERT INTO inventory_batches (id, store_id, product_id, supplier_id, purchase_order_id, received_by, condition, batch_code, expiry_date, quantity_received, quantity_remaining, unit_cost, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING",
          [
            entry.id,
            numericStoreId,
            entry.product_id,
            resolvedSupplierId,
            resolvedPurchaseOrderId,
            resolvedReceivedBy,
            entry.condition || null,
            entry.batch_code || null,
            entry.expiry_date || null,
            entry.quantity_received ?? 0,
            entry.quantity_remaining ?? entry.quantity_received ?? 0,
            entry.unit_cost ?? 0,
            entry.note || null,
            entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
          ]
        );
      }
      if (data.marketCollections && Array.isArray(data.marketCollections)) {
        for (const entry of data.marketCollections) {
          const resolvedCreatedBy = importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId;
          const resolvedSaleId = importedSaleIds.has(Number(entry.converted_sale_id)) ? Number(entry.converted_sale_id) : null;
          await client.query(
            "INSERT INTO market_collections (id, store_id, collector_name, phone, items, expected_return_date, tracking_code, status, note, created_by, converted_sale_id, sold_at, returned_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING",
            [
              entry.id,
              numericStoreId,
              entry.collector_name,
              entry.phone,
              typeof entry.items === "string" ? entry.items : JSON.stringify(entry.items || []),
              entry.expected_return_date,
              entry.tracking_code,
              entry.status || "OPEN",
              entry.note || null,
              resolvedCreatedBy,
              resolvedSaleId,
              entry.sold_at || null,
              entry.returned_at || null,
              entry.created_at || (/* @__PURE__ */ new Date()).toISOString(),
              entry.updated_at || entry.created_at || (/* @__PURE__ */ new Date()).toISOString()
            ]
          );
        }
      }
    });
    return { storeId: numericStoreId };
  }
});

// serverWriteRepository.ts
var createCoreWriteRepository = ({ postgresPool: postgresPool2 }) => ({
  ...createSettingsWriteRepository({ postgresPool: postgresPool2 }),
  ...createCustomersWriteRepository({ postgresPool: postgresPool2 }),
  ...createCatalogWriteRepository({ postgresPool: postgresPool2 }),
  ...createStaffWriteRepository({ postgresPool: postgresPool2 }),
  ...createExpensesWriteRepository({ postgresPool: postgresPool2 }),
  ...createOperationsWriteRepository({ postgresPool: postgresPool2 }),
  ...createInventoryWriteRepository({ postgresPool: postgresPool2 }),
  ...createSalesWriteRepository({ postgresPool: postgresPool2 }),
  ...createImportsWriteRepository({ postgresPool: postgresPool2 })
});

// serverSharedHelpers.ts
var normalizePhone3 = (value) => String(value ?? "").replace(/\D/g, "");
var normalizeProductBarcode2 = (value) => String(value ?? "").trim();
var safeJsonParse5 = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
var normalizeStoreDiscountCodes = (value) => {
  const parsed = safeJsonParse5(value, []);
  const list = Array.isArray(parsed) ? parsed : [];
  const seenCodes = /* @__PURE__ */ new Set();
  return list.reduce((acc, entry, index) => {
    const name = String(entry?.name || "").trim().slice(0, 80);
    const code = String(entry?.code || "").trim().toUpperCase().replace(/\s+/g, "");
    const type = String(entry?.type || "").toUpperCase() === "FIXED" ? "FIXED" : "PERCENTAGE";
    const rawValue = Math.max(0, Number(entry?.value) || 0);
    const normalizedValue = type === "PERCENTAGE" ? Number(Math.min(100, rawValue).toFixed(2)) : Number(rawValue.toFixed(2));
    const rawExpiry = String(entry?.expires_at ?? entry?.expiresAt ?? "").trim();
    const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? rawExpiry : null;
    if (!name || !code || normalizedValue <= 0 || seenCodes.has(code)) {
      return acc;
    }
    seenCodes.add(code);
    acc.push({
      id: String(entry?.id || `discount-${code.toLowerCase()}-${index + 1}`),
      name,
      code,
      type,
      value: normalizedValue,
      expires_at: expiresAt,
      active: entry?.active !== false
    });
    return acc;
  }, []);
};
var normalizeStaffAnnouncement = (value) => {
  const text = String(value?.staff_announcement_text ?? value?.text ?? "").trim().slice(0, 240);
  return {
    text,
    active: Boolean(text) && value?.staff_announcement_active !== 0 && value?.active !== false,
    updated_at: value?.staff_announcement_updated_at ? String(value.staff_announcement_updated_at) : null
  };
};
var normalizeStoreSignatureImage2 = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 8e6) return null;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw) ? raw : null;
};
var normalizeHandoverPriority2 = (value) => String(value || "").toUpperCase() === "IMPORTANT" ? "IMPORTANT" : "INFO";
var normalizeRecountStatus = (value) => {
  const normalized = String(value || "").toUpperCase();
  return ["PENDING", "APPROVED", "REJECTED"].includes(normalized) ? normalized : "NOT_REQUIRED";
};
var formatHandoverNoteRecord = (note, currentUser) => ({
  ...note,
  note_text: String(note?.note_text || ""),
  priority: normalizeHandoverPriority2(note?.priority),
  is_pinned: Number(note?.is_pinned || 0) === 1,
  can_delete: currentUser ? Number(note?.author_id) === Number(currentUser.id) || ["STORE_ADMIN", "MANAGER"].includes(String(currentUser.role || "")) : void 0,
  can_pin: currentUser ? ["STORE_ADMIN", "MANAGER"].includes(String(currentUser.role || "")) : void 0
});
var clampChatCleanupReminderDay2 = (value) => Math.min(31, Math.max(1, Number(value) || 28));
var clampChatRetentionValue2 = (value) => Math.min(365, Math.max(1, Number(value) || 3));
var normalizeChatRetentionUnit2 = (value) => String(value || "").toLowerCase() === "days" ? "days" : "months";
var isChatCleanupReminderDue = (store, referenceDate = /* @__PURE__ */ new Date()) => {
  const remindersEnabled = Number(store?.chat_cleanup_reminders_enabled ?? 1) === 1;
  if (!remindersEnabled) return false;
  const reminderDay = clampChatCleanupReminderDay2(store?.chat_cleanup_reminder_day);
  const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const triggerDay = Math.min(reminderDay, lastDayOfMonth);
  if (referenceDate.getDate() < triggerDay) {
    return false;
  }
  const lastCleanup = store?.last_chat_cleanup_at ? new Date(store.last_chat_cleanup_at) : null;
  if (!lastCleanup || Number.isNaN(lastCleanup.getTime())) {
    return true;
  }
  return lastCleanup.getFullYear() < referenceDate.getFullYear() || lastCleanup.getMonth() < referenceDate.getMonth();
};
var normalizeCollectionCondition5 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "_");
};
var normalizeBatchCode2 = (value) => {
  const raw = String(value || "").trim().slice(0, 80);
  return raw ? raw.toUpperCase() : null;
};
var normalizeBatchExpiryDate2 = (value) => {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};
var getShiftDateKey = (dateInput = /* @__PURE__ */ new Date()) => {
  const date = new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
var getAttendanceDurationMinutes = (clockInAt, clockOutAt) => {
  const clockInTime = new Date(String(clockInAt || "")).getTime();
  const clockOutTime = clockOutAt ? new Date(String(clockOutAt || "")).getTime() : Date.now();
  if (!Number.isFinite(clockInTime) || !Number.isFinite(clockOutTime) || clockOutTime < clockInTime) {
    return 0;
  }
  return Math.max(0, Math.round((clockOutTime - clockInTime) / 6e4));
};
var formatAttendanceEntry = (entry) => {
  const clockInAt = entry?.clock_in_at ? String(entry.clock_in_at) : null;
  const clockOutAt = entry?.clock_out_at ? String(entry.clock_out_at) : null;
  const totalMinutes = Math.max(0, Number(entry?.total_minutes || 0) || 0) || getAttendanceDurationMinutes(clockInAt, clockOutAt);
  return {
    ...entry,
    shift_date: String(entry?.shift_date || getShiftDateKey()),
    clock_in_at: clockInAt,
    clock_out_at: clockOutAt,
    total_minutes: totalMinutes,
    total_hours: Number((totalMinutes / 60).toFixed(2)),
    is_open: Boolean(clockInAt) && !clockOutAt,
    user_name: String(entry?.user_name || entry?.username || entry?.user?.username || "Staff"),
    role: String(entry?.role || "STAFF").toUpperCase(),
    note: entry?.note ? String(entry.note) : null
  };
};
var normalizeSaleChannel = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return ["LAYAWAY", "INSTALLMENT"].includes(raw) ? raw : "STANDARD";
};
var normalizePaymentFrequency = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return ["WEEKLY", "BIWEEKLY", "MONTHLY"].includes(raw) ? raw : "MONTHLY";
};
var toFiniteNumberOrNull4 = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// serverBusinessHelpers.ts
var HIGH_RISK_AUDIT_ACTIONS = ["PRICE_CHANGE", "DELETE", "STOCK_ADJUST"];
var serializeAuditValue = (value) => {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
var getConditionMatrixSlot4 = (product, condition) => {
  const normalizedCondition = normalizeCollectionCondition5(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }
  const matrix = safeJsonParse5(product.condition_matrix, {});
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};
var shiftDateByFrequency = (dateText, frequency, step) => {
  const date = /* @__PURE__ */ new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }
  const normalizedFrequency = normalizePaymentFrequency(frequency);
  if (normalizedFrequency === "WEEKLY") {
    date.setDate(date.getDate() + 7 * step);
  } else if (normalizedFrequency === "BIWEEKLY") {
    date.setDate(date.getDate() + 14 * step);
  } else {
    date.setMonth(date.getMonth() + step);
  }
  return date.toISOString().slice(0, 10);
};
var isCollectionOverdue = (status, expectedReturnDate) => {
  const normalizedDate = String(expectedReturnDate || "").trim();
  if (String(status || "").toUpperCase() !== "OPEN" || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    return false;
  }
  return (/* @__PURE__ */ new Date(`${normalizedDate}T23:59:59`)).getTime() < Date.now();
};
var createBusinessHelpers = ({
  postgresPool: postgresPool2
}) => {
  const logSystemActivity2 = async ({
    storeId,
    userId,
    action,
    details
  }) => {
    try {
      await postgresPool2.query(
        `INSERT INTO system_activity_logs (store_id, user_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [storeId, userId ?? null, action, details ? JSON.stringify(details) : null]
      );
    } catch (error) {
      console.warn("Failed to write system activity log:", error);
    }
  };
  const formatAuditCurrency2 = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "\u20A60";
    const hasDecimals = Math.abs(amount % 1) > 1e-6;
    return `\u20A6${amount.toLocaleString("en-NG", {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2
    })}`;
  };
  const getMissingCostPriceLabels2 = ({
    price,
    condition,
    productPrice,
    conditionMatrix
  }) => {
    const directPrice = Math.max(0, Number(price || 0) || 0);
    const normalizedCondition = String(condition || "STANDARD").trim().toLowerCase().replace(/\s+/g, "_");
    const matrix = safeJsonParse5(conditionMatrix, {});
    const orderedKeys = Array.from(/* @__PURE__ */ new Set(["new", "used", "open_box", ...Object.keys(matrix || {})]));
    const availableConditionPrices = orderedKeys.map((key) => {
      const slot = matrix?.[key] || {};
      const slotPrice = Math.max(0, Number(slot?.price || 0) || 0);
      if (slotPrice <= 0) return null;
      return `${key.replace(/_/g, " ").toUpperCase()} ${formatAuditCurrency2(slotPrice)}`;
    }).filter(Boolean);
    const exactConditionPrice = Math.max(0, Number(matrix?.[normalizedCondition]?.price || 0) || 0);
    const fallbackBasePrice = Math.max(0, Number(productPrice || 0) || 0);
    const primaryLabel = directPrice > 0 ? formatAuditCurrency2(directPrice) : exactConditionPrice > 0 ? formatAuditCurrency2(exactConditionPrice) : availableConditionPrices.length > 0 ? availableConditionPrices.join(" \u2022 ") : fallbackBasePrice > 0 ? formatAuditCurrency2(fallbackBasePrice) : "Not set yet";
    return {
      primaryLabel,
      allConditionsLabel: availableConditionPrices.length > 0 ? availableConditionPrices.join(" \u2022 ") : null
    };
  };
  const getAuditActorLabel2 = (role) => {
    const normalizedRole = String(role || "").toUpperCase();
    if (normalizedRole === "STORE_ADMIN") return "Owner";
    if (normalizedRole === "SYSTEM_ADMIN") return "System Admin";
    if (normalizedRole === "MANAGER") return "Manager";
    if (normalizedRole === "ACCOUNTANT") return "Accountant";
    if (normalizedRole === "PROCUREMENT_OFFICER") return "Procurement Officer";
    return "Staff";
  };
  const logAuditEvent2 = async ({
    storeId,
    userId,
    userName,
    actionType,
    description,
    oldValue,
    newValue
  }) => {
    try {
      await postgresPool2.query(
        `INSERT INTO system_logs (store_id, user_id, user_name, action_type, description, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          storeId,
          userId ?? null,
          String(userName || "").trim() || null,
          String(actionType || "").trim().toUpperCase(),
          String(description || "").trim(),
          serializeAuditValue(oldValue),
          serializeAuditValue(newValue)
        ]
      );
    } catch (error) {
      console.warn("Failed to write immutable audit log:", error);
    }
  };
  const getProductTotalStock2 = (product) => {
    if (product?.condition_matrix && product?.mode === "GADGET") {
      try {
        const matrix = typeof product.condition_matrix === "string" ? JSON.parse(product.condition_matrix) : product.condition_matrix;
        return Number(matrix?.new?.stock || 0) + Number(matrix?.open_box?.stock || 0) + Number(matrix?.used?.stock || 0);
      } catch {
        return Number(product?.stock || 0);
      }
    }
    return Number(product?.stock || 0);
  };
  const resolveTrackedCost5 = ({
    product,
    condition,
    sellingPrice,
    fallbackToSelling = false
  }) => {
    const slot = getConditionMatrixSlot4(product, condition);
    const normalizedCondition = String(condition || "STANDARD").trim().toLowerCase().replace(/\s+/g, "_");
    const resolvedSellingPrice = toFiniteNumberOrNull4(sellingPrice) ?? toFiniteNumberOrNull4(slot?.price) ?? toFiniteNumberOrNull4(product?.price) ?? 0;
    const slotCost = toFiniteNumberOrNull4(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
    const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== "standard";
    if (usesConditionMatrixCost) {
      if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
        return {
          cost: slotCost,
          missing: false,
          usedSellingDefault: false,
          sellingPrice: resolvedSellingPrice
        };
      }
      if (fallbackToSelling) {
        return {
          cost: resolvedSellingPrice,
          missing: resolvedSellingPrice > 0,
          usedSellingDefault: resolvedSellingPrice > 0,
          sellingPrice: resolvedSellingPrice
        };
      }
      return {
        cost: null,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: false,
        sellingPrice: resolvedSellingPrice
      };
    }
    const candidateCosts = [
      slotCost,
      toFiniteNumberOrNull4(product?.cost)
    ];
    for (const candidate of candidateCosts) {
      if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
        return {
          cost: candidate,
          missing: false,
          usedSellingDefault: false,
          sellingPrice: resolvedSellingPrice
        };
      }
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice
      };
    }
    return {
      cost: null,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: false,
      sellingPrice: resolvedSellingPrice
    };
  };
  const getTotalPaidFromPaymentMethods3 = (paymentMethods) => {
    const methods = safeJsonParse5(paymentMethods, {});
    return ["cash", "transfer", "pos"].reduce((sum, key) => sum + Math.max(0, Number(methods?.[key]) || 0), 0);
  };
  const buildLayawayPaymentPlan2 = ({
    saleChannel,
    total,
    amountPaid,
    firstDueDate,
    installmentCount,
    paymentFrequency,
    note
  }) => {
    const normalizedChannel = normalizeSaleChannel(saleChannel);
    const normalizedCount = Math.max(1, Math.min(24, Number(installmentCount) || 1));
    const normalizedFrequency = normalizePaymentFrequency(paymentFrequency);
    const normalizedTotal = Math.max(0, Number(total || 0) || 0);
    const normalizedAmountPaid = Math.max(0, Number(amountPaid || 0) || 0);
    const balanceDue = Math.max(0, Number((normalizedTotal - normalizedAmountPaid).toFixed(2)) || 0);
    const normalizedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(firstDueDate || "").trim()) ? String(firstDueDate).trim() : null;
    const schedule = [];
    if (normalizedDueDate && balanceDue > 0) {
      const baseAmount = Number((balanceDue / normalizedCount).toFixed(2));
      let runningTotal = 0;
      for (let index = 0; index < normalizedCount; index += 1) {
        const amount = index === normalizedCount - 1 ? Number((balanceDue - runningTotal).toFixed(2)) : baseAmount;
        runningTotal = Number((runningTotal + amount).toFixed(2));
        schedule.push({
          installment_number: index + 1,
          due_date: shiftDateByFrequency(normalizedDueDate, normalizedFrequency, index),
          amount
        });
      }
    }
    return {
      type: normalizedChannel,
      installment_count: normalizedCount,
      payment_frequency: normalizedFrequency,
      deposit_paid: normalizedAmountPaid,
      balance_due: balanceDue,
      first_due_date: normalizedDueDate,
      note: String(note || "").trim() || null,
      schedule
    };
  };
  const formatInventoryBatch2 = (entry) => {
    const expiryDate = normalizeBatchExpiryDate2(entry?.expiry_date);
    const quantityReceived = Math.max(0, Number(entry?.quantity_received || 0) || 0);
    const quantityRemaining = Math.max(0, Number(entry?.quantity_remaining || 0) || 0);
    let status = "NO_EXPIRY";
    let daysUntilExpiry = null;
    if (quantityRemaining <= 0) {
      status = "DEPLETED";
    } else if (expiryDate) {
      const expiryTime = (/* @__PURE__ */ new Date(`${expiryDate}T23:59:59`)).getTime();
      if (Number.isFinite(expiryTime)) {
        daysUntilExpiry = Math.ceil((expiryTime - Date.now()) / 864e5);
        if (daysUntilExpiry < 0) {
          status = "EXPIRED";
        } else if (daysUntilExpiry <= 30) {
          status = "EXPIRING_SOON";
        } else {
          status = "ACTIVE";
        }
      }
    }
    return {
      ...entry,
      batch_code: normalizeBatchCode2(entry?.batch_code),
      expiry_date: expiryDate,
      quantity_received: quantityReceived,
      quantity_remaining: quantityRemaining,
      unit_cost: Math.max(0, Number(entry?.unit_cost || 0) || 0),
      condition: entry?.condition ? normalizeCollectionCondition5(entry.condition) : null,
      product_name: String(entry?.product_name || `Product #${entry?.product_id || "\u2014"}`),
      supplier_name: entry?.supplier_name ? String(entry.supplier_name) : null,
      received_by_username: entry?.received_by_username ? String(entry.received_by_username) : null,
      status,
      days_until_expiry: daysUntilExpiry
    };
  };
  const formatStockAdjustmentEntry2 = (entry) => ({
    ...entry,
    quantity_before: Number(entry?.quantity_before || 0) || 0,
    quantity_change: Number(entry?.quantity_change || 0) || 0,
    quantity_after: Number(entry?.quantity_after || 0) || 0,
    counted_quantity: entry?.counted_quantity == null ? null : Number(entry?.counted_quantity || 0) || 0,
    variance_quantity: Number(entry?.variance_quantity || 0) || 0,
    cost_impact: Number(entry?.cost_impact || 0) || 0,
    adjustment_type: String(entry?.adjustment_type || "MANUAL").toUpperCase(),
    adjustment_mode: String(entry?.adjustment_mode || "DECREASE").toUpperCase(),
    recount_status: normalizeRecountStatus(entry?.recount_status),
    awaiting_approval: normalizeRecountStatus(entry?.recount_status) === "PENDING",
    condition: entry?.condition ? normalizeCollectionCondition5(entry.condition) : null,
    product_name: entry?.product_name || `Product #${entry?.product_id || "\u2014"}`,
    category_name: entry?.category_name || entry?.category || "General",
    adjusted_by_username: entry?.adjusted_by_username || "Staff",
    approved_by_username: entry?.approved_by_username || null,
    approved_at: entry?.approved_at ? String(entry.approved_at) : null,
    approval_note: entry?.approval_note ? String(entry.approval_note) : null
  });
  const formatPurchaseOrder2 = (entry) => {
    const items = safeJsonParse5(entry?.items, []).map((item, index) => {
      const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
      const unitCost = Math.max(0, Number(item?.unit_cost ?? item?.cost ?? 0) || 0);
      const lineTotal = Number(item?.line_total ?? unitCost * quantity) || 0;
      return {
        ...item,
        id: item?.id || `${entry?.id || "po"}-${index}`,
        product_id: Number(item?.product_id) || 0,
        product_name: String(item?.product_name || item?.name || `Item ${index + 1}`),
        quantity,
        unit_cost: unitCost,
        line_total: lineTotal,
        condition: item?.condition ? normalizeCollectionCondition5(item.condition) : null,
        batch_code: normalizeBatchCode2(item?.batch_code),
        expiry_date: normalizeBatchExpiryDate2(item?.expiry_date)
      };
    });
    return {
      ...entry,
      supplier_name: String(entry?.supplier_name || "Unknown Supplier"),
      status: String(entry?.status || "ORDERED").toUpperCase(),
      subtotal: Number(entry?.subtotal || items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0)) || 0,
      total_quantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      items,
      created_by_username: entry?.created_by_username || "Staff",
      received_by_username: entry?.received_by_username || null
    };
  };
  const formatMarketCollection2 = (entry) => {
    const items = safeJsonParse5(entry?.items, []).map((item, index) => {
      const quantity = Math.max(0, Number(item?.quantity) || 0);
      const priceAtCollection = Number(item?.price_at_collection ?? item?.price_at_sale ?? 0) || 0;
      const costAtCollection = Number(item?.cost_at_collection ?? item?.cost ?? 0) || 0;
      return {
        ...item,
        id: item?.id || `${entry?.id || "collection"}-${index}`,
        product_id: Number(item?.product_id) || 0,
        name: String(item?.name || item?.product_name || `Item ${index + 1}`),
        quantity,
        condition: normalizeCollectionCondition5(item?.condition),
        price_at_collection: priceAtCollection,
        cost_at_collection: costAtCollection,
        subtotal: Number(item?.subtotal ?? priceAtCollection * quantity) || 0,
        specs_at_collection: safeJsonParse5(item?.specs_at_collection, {})
      };
    });
    const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const totalValue = items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
    const totalCost = items.reduce((sum, item) => sum + (Number(item.cost_at_collection) || 0) * (Number(item.quantity) || 0), 0);
    const overdue = isCollectionOverdue(entry?.status, entry?.expected_return_date);
    return {
      ...entry,
      phone: String(entry?.phone || ""),
      items,
      total_quantity: totalQuantity,
      total_value: totalValue,
      total_cost: totalCost,
      is_overdue: overdue,
      status_label: overdue ? "OVERDUE" : String(entry?.status || "OPEN").toUpperCase()
    };
  };
  const formatRepairTicket2 = (entry) => {
    const estimatedCost = Math.max(0, Number(entry?.estimated_cost || 0) || 0);
    const finalCost = Math.max(0, Number(entry?.final_cost || estimatedCost || 0) || 0);
    const amountPaid = Math.max(0, Number(entry?.amount_paid || 0) || 0);
    const amountDue = Math.max(0, finalCost - amountPaid);
    const normalizedStatus = String(entry?.status || "RECEIVED").toUpperCase();
    const promisedDate = String(entry?.promised_date || "").trim();
    const isOverdue = Boolean(promisedDate) && !["DELIVERED", "CANCELLED"].includes(normalizedStatus) && promisedDate < (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    return {
      ...entry,
      ticket_number: String(entry?.ticket_number || `RPR-${entry?.id || "\u2014"}`),
      customer_name: String(entry?.customer_name || "Walk-in Customer"),
      customer_phone: String(entry?.customer_phone || ""),
      device_name: String(entry?.device_name || "Device"),
      brand: String(entry?.brand || ""),
      model: String(entry?.model || ""),
      imei_serial: String(entry?.imei_serial || ""),
      issue_summary: String(entry?.issue_summary || ""),
      accessories: String(entry?.accessories || ""),
      purchase_reference: String(entry?.purchase_reference || ""),
      technician_name: String(entry?.technician_name || ""),
      intake_notes: String(entry?.intake_notes || ""),
      internal_notes: String(entry?.internal_notes || ""),
      warranty_status: String(entry?.warranty_status || "NO_WARRANTY").toUpperCase(),
      estimated_cost: estimatedCost,
      final_cost: finalCost,
      amount_paid: amountPaid,
      amount_due: amountDue,
      status: normalizedStatus,
      is_overdue: isOverdue,
      status_label: isOverdue && !["READY", "DELIVERED", "CANCELLED"].includes(normalizedStatus) ? "OVERDUE" : normalizedStatus,
      created_by_username: entry?.created_by_username || "Staff",
      updated_by_username: entry?.updated_by_username || null
    };
  };
  const formatSaleReturnEntry2 = (entry) => {
    const items = safeJsonParse5(entry?.items, []).map((item, index) => {
      const quantity = Math.max(0, Number(item?.quantity) || 0);
      const unitPrice = Number(item?.price_at_sale ?? item?.unit_price ?? 0) || 0;
      return {
        ...item,
        id: item?.id || `${entry?.id || "return"}-${index}`,
        sale_item_id: Number(item?.sale_item_id) || 0,
        product_id: Number(item?.product_id) || 0,
        name: String(item?.name || item?.product_name || `Item ${index + 1}`),
        quantity,
        price_at_sale: unitPrice,
        subtotal: Number(item?.subtotal ?? unitPrice * quantity) || 0,
        item_source: String(item?.item_source || "").toUpperCase() === "SOURCED" ? "SOURCED" : String(item?.item_source || "").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : "INVENTORY",
        sourced_vendor_name: item?.sourced_vendor_name ? String(item.sourced_vendor_name) : null,
        sourced_vendor_reference: item?.sourced_vendor_reference ? String(item.sourced_vendor_reference) : null,
        return_to_vendor_required: Boolean(item?.return_to_vendor_required),
        vendor_payable_adjustment: Math.max(0, Number(item?.vendor_payable_adjustment || 0) || 0),
        vendor_payable_source: String(item?.vendor_payable_source || "").toUpperCase() === "CONSIGNMENT" ? "CONSIGNMENT" : String(item?.vendor_payable_source || "").toUpperCase() === "SOURCED" ? "SOURCED" : null,
        condition: item?.condition ? normalizeCollectionCondition5(item.condition) : null,
        imei_serial: item?.imei_serial || null,
        specs_at_sale: safeJsonParse5(item?.specs_at_sale, {})
      };
    });
    return {
      ...entry,
      items,
      item_count: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      returned_value: Number(entry?.returned_value || 0) || 0,
      refund_amount: Number(entry?.refund_amount || 0) || 0,
      return_type: String(entry?.return_type || "REFUND").toUpperCase(),
      refund_method: String(entry?.refund_method || "cash").toLowerCase(),
      restock_items: Number(entry?.restock_items || 0) === 1,
      return_to_vendor_count: items.filter((item) => Boolean(item?.return_to_vendor_required)).length
    };
  };
  const getSaleReturnsMeta2 = async (saleId) => {
    const result = await postgresPool2.query(
      `SELECT
        COUNT(*) as returns_count,
        COALESCE(SUM(returned_value), 0) as returned_amount,
        COALESCE(SUM(refund_amount), 0) as refunded_amount
       FROM sales_returns
       WHERE sale_id = $1`,
      [saleId]
    );
    return result.rows[0] || null;
  };
  const formatSaleResponse2 = async (sale) => {
    const total = Number(sale.total) || 0;
    const paymentMethods = safeJsonParse5(sale.payment_methods, {});
    const amountPaid = getTotalPaidFromPaymentMethods3(paymentMethods);
    let returnedAmount = Number(sale?.returned_amount);
    let refundedAmount = Number(sale?.refunded_amount);
    let returnsCount = Number(sale?.returns_count);
    if ((!Number.isFinite(returnedAmount) || !Number.isFinite(refundedAmount) || !Number.isFinite(returnsCount)) && sale?.id) {
      const meta = await getSaleReturnsMeta2(Number(sale.id));
      returnedAmount = Number(meta?.returned_amount || 0);
      refundedAmount = Number(meta?.refunded_amount || 0);
      returnsCount = Number(meta?.returns_count || 0);
    }
    const normalizedReturnedAmount = Math.max(0, Number(returnedAmount) || 0);
    const normalizedRefundedAmount = Math.max(0, Number(refundedAmount) || 0);
    const normalizedReturnsCount = Math.max(0, Number(returnsCount) || 0);
    const discountAmount = Math.max(0, Number(sale?.discount_amount || 0) || 0);
    const subtotalAmount = Number(sale.subtotal ?? sale.total) || 0;
    const netSubtotal = Math.max(0, Number((subtotalAmount - discountAmount).toFixed(2)) || 0);
    const netTotal = Math.max(0, Number((total - normalizedReturnedAmount).toFixed(2)) || 0);
    const amountDue = Math.max(0, Number((netTotal - amountPaid).toFixed(2)) || 0);
    const creditBalance = Math.max(0, Number((amountPaid - netTotal).toFixed(2)) || 0);
    const returnStatus = normalizedReturnsCount === 0 ? "NONE" : normalizedReturnedAmount >= total - 0.01 ? "FULL" : "PARTIAL";
    const saleChannel = normalizeSaleChannel(sale?.sale_channel);
    const rawPaymentPlan = safeJsonParse5(sale?.payment_plan, null);
    const normalizedPlanSchedule = Array.isArray(rawPaymentPlan?.schedule) ? rawPaymentPlan.schedule.map((entry, index) => ({
      installment_number: Math.max(1, Number(entry?.installment_number || index + 1) || index + 1),
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.due_date || "").trim()) ? String(entry.due_date).trim() : null,
      amount: Math.max(0, Number(entry?.amount || 0) || 0)
    })) : [];
    const paymentPlan = rawPaymentPlan ? {
      ...rawPaymentPlan,
      type: normalizeSaleChannel(rawPaymentPlan?.type || saleChannel),
      payment_frequency: normalizePaymentFrequency(rawPaymentPlan?.payment_frequency),
      installment_count: Math.max(1, Number(rawPaymentPlan?.installment_count || normalizedPlanSchedule.length || 1) || 1),
      deposit_paid: Math.max(0, Number(rawPaymentPlan?.deposit_paid || 0) || 0),
      balance_due: amountDue,
      schedule: normalizedPlanSchedule
    } : null;
    const depositPaid = Math.max(0, Number(paymentPlan?.deposit_paid || 0) || 0);
    const paidTowardsInstallments = Math.max(0, Number((amountPaid - depositPaid).toFixed(2)) || 0);
    let runningScheduledAmount = 0;
    let nextInstallment = null;
    for (const entry of normalizedPlanSchedule) {
      const scheduledAmount = Math.max(0, Number(entry.amount || 0) || 0);
      runningScheduledAmount = Number((runningScheduledAmount + scheduledAmount).toFixed(2));
      if (paidTowardsInstallments + 9e-3 < runningScheduledAmount) {
        nextInstallment = {
          ...entry,
          amount_remaining: Math.max(0, Number((runningScheduledAmount - paidTowardsInstallments).toFixed(2)) || 0)
        };
        break;
      }
    }
    const nextInstallmentDueDate = String(nextInstallment?.due_date || sale?.due_date || "").trim() || null;
    const isDueOverdue = Boolean(nextInstallmentDueDate) && amountDue > 0 && String(sale?.status || "").toUpperCase() !== "VOIDED" && (/* @__PURE__ */ new Date(`${nextInstallmentDueDate}T23:59:59`)).getTime() < Date.now();
    const lockedUntilPaid = saleChannel !== "STANDARD" ? amountDue > 0 && String(sale?.status || "").toUpperCase() !== "VOIDED" : Number(sale?.locked_until_paid || 0) === 1;
    return {
      ...sale,
      subtotal: subtotalAmount,
      discount_amount: discountAmount,
      discount_type: sale?.discount_type || null,
      discount_value: Math.max(0, Number(sale?.discount_value || 0) || 0),
      discount_note: sale?.discount_note || null,
      show_discount_on_invoice: sale?.show_discount_on_invoice !== 0,
      tax_amount: Number(sale.tax_amount) || 0,
      tax_percentage: Number(sale.tax_percentage) || 0,
      total,
      net_subtotal: netSubtotal,
      net_total: netTotal,
      payment_methods: paymentMethods,
      amount_paid: amountPaid,
      amount_due: amountDue,
      credit_balance: creditBalance,
      returned_amount: normalizedReturnedAmount,
      refunded_amount: normalizedRefundedAmount,
      returns_count: normalizedReturnsCount,
      return_status: returnStatus,
      due_date: sale.due_date || null,
      note: sale.note || null,
      customer_name: sale.customer_name || "Walk-in Customer",
      customer_phone: sale.customer_phone || null,
      customer_address: sale.customer_address || null,
      sale_channel: saleChannel,
      payment_plan: paymentPlan,
      locked_until_paid: lockedUntilPaid,
      is_layaway: saleChannel === "LAYAWAY",
      is_installment: saleChannel === "INSTALLMENT",
      reference_code: saleChannel === "STANDARD" ? `SALE-${sale.id}` : `PLAN-${sale.id}`,
      next_installment_due_date: nextInstallmentDueDate,
      next_installment_amount: Math.max(0, Number(nextInstallment?.amount_remaining ?? nextInstallment?.amount ?? 0) || 0),
      is_due_overdue: isDueOverdue
    };
  };
  return {
    logSystemActivity: logSystemActivity2,
    formatAuditCurrency: formatAuditCurrency2,
    getMissingCostPriceLabels: getMissingCostPriceLabels2,
    getAuditActorLabel: getAuditActorLabel2,
    logAuditEvent: logAuditEvent2,
    getProductTotalStock: getProductTotalStock2,
    toFiniteNumberOrNull: toFiniteNumberOrNull4,
    resolveTrackedCost: resolveTrackedCost5,
    getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods3,
    buildLayawayPaymentPlan: buildLayawayPaymentPlan2,
    formatInventoryBatch: formatInventoryBatch2,
    formatStockAdjustmentEntry: formatStockAdjustmentEntry2,
    formatPurchaseOrder: formatPurchaseOrder2,
    formatMarketCollection: formatMarketCollection2,
    formatRepairTicket: formatRepairTicket2,
    formatSaleReturnEntry: formatSaleReturnEntry2,
    getSaleReturnsMeta: getSaleReturnsMeta2,
    formatSaleResponse: formatSaleResponse2,
    getShiftDateKey,
    getAttendanceDurationMinutes,
    formatAttendanceEntry
  };
};

// serverMaintenanceHelpers.ts
import fs4 from "fs";
import path5 from "path";
var createMaintenanceHelpers = ({
  postgresPool: postgresPool2,
  uploadsRootDir: uploadsRootDir2
}) => {
  const getFileSizeSafe = (filePath) => {
    try {
      return fs4.statSync(filePath).size;
    } catch {
      return 0;
    }
  };
  const normalizeUploadsReference = (value) => {
    const raw = String(value || "").trim();
    if (!raw || !raw.includes("/uploads/")) {
      return null;
    }
    try {
      const pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
      const sanitized = pathname.split("?")[0].split("#")[0].replace(/^\/+/, "");
      const marker = "uploads/";
      const index = sanitized.toLowerCase().indexOf(marker);
      if (index === -1) {
        return null;
      }
      return sanitized.slice(index + marker.length).replace(/\\/g, "/");
    } catch {
      return null;
    }
  };
  const collectUnusedMediaCleanupStats2 = async () => {
    const result = {
      scannedFiles: 0,
      deletedFiles: 0,
      deletedBytes: 0
    };
    if (!fs4.existsSync(uploadsRootDir2)) {
      return result;
    }
    const referencedFiles = /* @__PURE__ */ new Set();
    const productMediaResult = await postgresPool2.query(`
      SELECT thumbnail as media_path FROM products
      WHERE deleted_at IS NULL AND thumbnail IS NOT NULL AND TRIM(thumbnail) != ''
      UNION ALL
      SELECT logo as media_path FROM stores
      WHERE logo IS NOT NULL AND TRIM(logo) != ''
    `);
    const productMediaRows = productMediaResult.rows;
    productMediaRows.forEach((row) => {
      const normalized = normalizeUploadsReference(row?.media_path);
      if (normalized) {
        referencedFiles.add(normalized);
      }
    });
    const allowedExtensions = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]);
    const stack = [uploadsRootDir2];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      const entries = fs4.readdirSync(currentDir, { withFileTypes: true });
      entries.forEach((entry) => {
        const fullPath = path5.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          return;
        }
        const extension = path5.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) {
          return;
        }
        result.scannedFiles += 1;
        const relativePath = path5.relative(uploadsRootDir2, fullPath).replace(/\\/g, "/");
        if (referencedFiles.has(relativePath)) {
          return;
        }
        const fileSize = getFileSizeSafe(fullPath);
        fs4.unlinkSync(fullPath);
        result.deletedFiles += 1;
        result.deletedBytes += fileSize;
      });
    }
    return result;
  };
  const markExpiredProformas2 = async () => {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const expiredResult = await postgresPool2.query(
        `SELECT id FROM pro_formas WHERE status = 'PENDING' AND expiry_date <= $1`,
        [now]
      );
      const expiredRows = expiredResult.rows;
      if (!expiredRows.length) {
        return;
      }
      await postgresPool2.query(
        `UPDATE pro_formas SET status = 'EXPIRED' WHERE status = 'PENDING' AND expiry_date <= $1`,
        [now]
      );
    } catch (err) {
      console.error("Error marking expired pro-formas:", err);
    }
  };
  const startScheduledMaintenance2 = () => {
    setInterval(markExpiredProformas2, 5 * 60 * 1e3);
  };
  return {
    getFileSizeSafe,
    collectUnusedMediaCleanupStats: collectUnusedMediaCleanupStats2,
    markExpiredProformas: markExpiredProformas2,
    startScheduledMaintenance: startScheduledMaintenance2
  };
};

// serverInventoryHelpers.ts
var calculateEan13CheckDigit2 = (base12) => {
  const digits = base12.replace(/\D/g, "");
  if (digits.length !== 12) {
    throw new Error("Barcode base must contain exactly 12 digits");
  }
  const weightedSum = digits.split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - weightedSum % 10) % 10);
};
var createInventoryHelpers = ({
  postgresPool: postgresPool2
}) => {
  const generateUniqueQuickCode2 = async (maxAttempts = 50, excludeProductId, preferredCandidate) => {
    const quickCodePattern = /^([1-9])\1\1\d{2}$/;
    const buildQuickCodeCandidate = (leadingDigit, trailingValue) => {
      const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
      const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, "0");
      return `${repeatedDigit.repeat(3)}${suffix}`;
    };
    const canUseCandidate = async (candidate) => {
      const normalized = String(candidate || "").trim();
      if (!normalized || !quickCodePattern.test(normalized)) return false;
      const result = await postgresPool2.query("SELECT id FROM products WHERE quick_code = $1 LIMIT 1", [normalized]);
      const exists = result.rows[0];
      return !exists || excludeProductId != null && Number(exists.id) === Number(excludeProductId);
    };
    const normalizedPreferred = String(preferredCandidate || "").trim();
    if (normalizedPreferred && await canUseCandidate(normalizedPreferred)) {
      return normalizedPreferred;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = buildQuickCodeCandidate(
        1 + Math.floor(Math.random() * 9),
        Math.floor(Math.random() * 100)
      );
      if (await canUseCandidate(candidate)) {
        return candidate;
      }
    }
    const fallbackSeed = Number(Date.now()) % 900;
    for (let offset = 0; offset < 900; offset += 1) {
      const candidateIndex = (fallbackSeed + offset) % 900;
      const candidate = buildQuickCodeCandidate(
        Math.floor(candidateIndex / 100) + 1,
        candidateIndex % 100
      );
      if (await canUseCandidate(candidate)) {
        return candidate;
      }
    }
    return null;
  };
  const generateUniqueBarcode2 = async (storeId, maxAttempts = 20) => {
    const storePart = String(Math.max(0, Number(storeId) || 0)).padStart(4, "0").slice(-4);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = String(Date.now() + attempt).slice(-5).padStart(5, "0");
      const randomDigit = String(Math.floor(Math.random() * 10));
      const base12 = `20${storePart}${timePart}${randomDigit}`;
      const candidate = `${base12}${calculateEan13CheckDigit2(base12)}`;
      const result = await postgresPool2.query("SELECT id FROM products WHERE barcode = $1 LIMIT 1", [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }
    return null;
  };
  const reconcileInventoryBatchQuantity2 = async ({
    productId,
    storeId,
    condition,
    targetStock
  }) => {
    const normalizedCondition = normalizeCollectionCondition5(condition);
    const batchResult = await postgresPool2.query(
      `SELECT id, quantity_received, quantity_remaining
       FROM inventory_batches
       WHERE store_id = $1
         AND product_id = $2
         AND COALESCE(condition, '') = COALESCE($3, '')
       ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC`,
      [storeId, productId, normalizedCondition]
    );
    const rows = batchResult.rows;
    if (!rows.length) return;
    let remainingTarget = Math.max(0, Math.floor(Number(targetStock) || 0));
    for (const row of rows) {
      const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
      const nextRemaining = Math.min(currentReceived, remainingTarget);
      await postgresPool2.query("UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2", [nextRemaining, row.id]);
      remainingTarget = Math.max(0, remainingTarget - nextRemaining);
    }
    if (remainingTarget > 0) {
      const lastRow = rows[rows.length - 1];
      const currentReceived = Math.max(0, Number(lastRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(lastRow?.quantity_remaining || 0) || 0);
      await postgresPool2.query(
        "UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3",
        [currentReceived + remainingTarget, currentRemaining + remainingTarget, lastRow.id]
      );
    }
  };
  const generateUniquePurchaseOrderNumber2 = async (storeId, maxAttempts = 40) => {
    const storePart = String(storeId || 0).slice(-2).padStart(2, "0");
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = Date.now().toString().slice(-6);
      const randomPart = String(Math.floor(100 + Math.random() * 900));
      const candidate = `PO-${storePart}${timePart}${randomPart}`;
      const result = await postgresPool2.query("SELECT id FROM purchase_orders WHERE order_number = $1 LIMIT 1", [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }
    return null;
  };
  const generateUniqueRepairTicketNumber2 = async (storeId, maxAttempts = 40) => {
    const storePart = String(storeId || 0).slice(-2).padStart(2, "0");
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = Date.now().toString().slice(-5);
      const randomPart = String(Math.floor(10 + Math.random() * 90));
      const candidate = `RPR-${storePart}${timePart}${randomPart}`;
      const result = await postgresPool2.query("SELECT id FROM repair_tickets WHERE ticket_number = $1 LIMIT 1", [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }
    return null;
  };
  return {
    generateUniqueQuickCode: generateUniqueQuickCode2,
    generateUniqueBarcode: generateUniqueBarcode2,
    reconcileInventoryBatchQuantity: reconcileInventoryBatchQuantity2,
    generateUniquePurchaseOrderNumber: generateUniquePurchaseOrderNumber2,
    generateUniqueRepairTicketNumber: generateUniqueRepairTicketNumber2
  };
};

// serverLifecycle.ts
import express2 from "express";
var createBackupLifecycle = ({
  dailyBackupDir: _dailyBackupDir,
  safetySnapshotDir: _safetySnapshotDir,
  makeSafeTimestamp: _makeSafeTimestamp
}) => {
  const createSafetySnapshot2 = async (_reason) => {
    return null;
  };
  const scheduleDailyLocalBackups2 = () => {
  };
  return {
    createSafetySnapshot: createSafetySnapshot2,
    scheduleDailyLocalBackups: scheduleDailyLocalBackups2
  };
};

// serverComposition.ts
var createServerComposition = ({
  postgresPool: postgresPool2,
  dailyBackupDir: dailyBackupDir2,
  safetySnapshotDir: safetySnapshotDir2,
  makeSafeTimestamp: makeSafeTimestamp2,
  jwtSecret,
  maxLoginAttempts,
  lockoutDurationMs,
  uploadsRootDir: uploadsRootDir2
}) => {
  const coreReadRepository2 = createCoreReadRepository({
    postgresPool: postgresPool2
  });
  const coreWriteRepository2 = createCoreWriteRepository({
    postgresPool: postgresPool2
  });
  const backupLifecycle = createBackupLifecycle({
    dailyBackupDir: dailyBackupDir2,
    safetySnapshotDir: safetySnapshotDir2,
    makeSafeTimestamp: makeSafeTimestamp2
  });
  const securityHelpers = createSecurityHelpers({
    postgresPool: postgresPool2,
    jwtSecret,
    maxLoginAttempts,
    lockoutDurationMs
  });
  const businessHelpers = createBusinessHelpers({
    postgresPool: postgresPool2
  });
  const maintenanceHelpers = createMaintenanceHelpers({
    postgresPool: postgresPool2,
    uploadsRootDir: uploadsRootDir2
  });
  const inventoryHelpers = createInventoryHelpers({
    postgresPool: postgresPool2
  });
  return {
    coreReadRepository: coreReadRepository2,
    coreWriteRepository: coreWriteRepository2,
    ...backupLifecycle,
    ...securityHelpers,
    ...businessHelpers,
    ...maintenanceHelpers,
    ...inventoryHelpers
  };
};

// api/index.ts
dotenv.config();
if (!process.env.GOODY_POS_DATA_DIR) {
  process.env.GOODY_POS_DATA_DIR = "/tmp/goodypos";
}
if (!process.env.GOODY_POS_DB_PROVIDER) {
  process.env.GOODY_POS_DB_PROVIDER = "local";
}
var appBaseDir = process.env.GOODY_POS_APP_DIR ? path6.resolve(process.env.GOODY_POS_APP_DIR) : process.cwd();
var {
  dataRootDir,
  uploadsRootDir,
  uploadsDir,
  dailyBackupDir,
  safetySnapshotDir,
  isDesktopRuntime,
  NODE_ENV,
  makeSafeTimestamp
} = initializeRuntimeEnvironment(appBaseDir);
var isNewDatabase = !fs5.existsSync(path6.join(dataRootDir, "pos.db"));
var {
  selectedProvider: databaseProvider,
  postgresPool,
  isLocalAdapter
} = openPrimaryDatabase(dataRootDir);
if (!postgresPool) {
  throw new Error("Database could not be initialized.");
}
void logDatabaseConfiguration({ selectedProvider: databaseProvider, postgresPool, isLocalAdapter });
var {
  PORT,
  HOST,
  APP_VERSION,
  JWT_SECRET,
  JWT_EXPIRY,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS
} = createServerConfig({ dataRootDir, isDesktopRuntime, nodeEnv: NODE_ENV, resolveJwtSecret });
var {
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  checkLicenseServiceConnection,
  activateRemoteStoreLicense
} = createLicenseService({ dataRootDir, appVersion: APP_VERSION });
var {
  coreReadRepository,
  coreWriteRepository,
  createSafetySnapshot,
  scheduleDailyLocalBackups,
  getLoginAttemptKey,
  getRemainingLockoutMs,
  registerFailedLogin,
  clearLoginAttempt,
  normalizePin,
  hashPin: hashPin2,
  verifyPin,
  resolveCheckoutActorByPin,
  findUserById,
  findStoreById,
  authenticate,
  authorize,
  checkStoreLock,
  logSystemActivity,
  formatAuditCurrency,
  getMissingCostPriceLabels,
  getAuditActorLabel,
  logAuditEvent,
  getProductTotalStock,
  toFiniteNumberOrNull: toFiniteNumberOrNull5,
  resolveTrackedCost: resolveTrackedCost4,
  getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods2,
  buildLayawayPaymentPlan,
  formatInventoryBatch,
  formatStockAdjustmentEntry,
  formatPurchaseOrder,
  formatMarketCollection,
  formatRepairTicket,
  formatSaleReturnEntry,
  getSaleReturnsMeta,
  formatSaleResponse,
  collectUnusedMediaCleanupStats,
  markExpiredProformas,
  startScheduledMaintenance,
  generateUniqueQuickCode,
  generateUniqueBarcode,
  reconcileInventoryBatchQuantity,
  generateUniquePurchaseOrderNumber,
  generateUniqueRepairTicketNumber
} = createServerComposition({
  postgresPool,
  dailyBackupDir,
  safetySnapshotDir,
  makeSafeTimestamp,
  jwtSecret: JWT_SECRET,
  maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
  lockoutDurationMs: LOCKOUT_DURATION_MS,
  uploadsRootDir
});
await runLegacyDatabaseMigrations({ postgresPool, isLocalAdapter });
await ensureRootSystemOwner({
  postgresPool,
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || "ChangeMe123!"
});
if (isNewDatabase) {
  try {
    const seedDbPath = path6.join(path6.dirname(new URL(import.meta.url).pathname), "seed.db");
    if (fs5.existsSync(seedDbPath)) {
      fs5.mkdirSync(dataRootDir, { recursive: true });
      fs5.copyFileSync(seedDbPath, path6.join(dataRootDir, "pos.db"));
      console.log("\u2705 Pre-seeded demo database copied to /tmp.");
    } else {
      await seedDemoData(postgresPool);
      console.log("\u2705 Demo data seeded on first boot.");
    }
  } catch (err) {
    console.warn("\u26A0\uFE0F Demo seed skipped:", err instanceof Error ? err.message : err);
  }
}
var LAN_IP = "";
var app = createConfiguredApp({ PORT, LAN_IP });
registerApplicationRoutes({
  app,
  db: postgresPool,
  postgresPool,
  uploadsDir,
  APP_VERSION,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  findStoreById,
  findUserById,
  normalizePhone: normalizePhone3,
  safeJsonParse: safeJsonParse5,
  normalizeStaffAnnouncement,
  normalizeStoreDiscountCodes,
  normalizeStoreSignatureImage: normalizeStoreSignatureImage2,
  clampChatCleanupReminderDay: clampChatCleanupReminderDay2,
  clampChatRetentionValue: clampChatRetentionValue2,
  normalizeChatRetentionUnit: normalizeChatRetentionUnit2,
  isChatCleanupReminderDue,
  formatHandoverNoteRecord,
  getAttendanceDurationMinutes,
  getShiftDateKey,
  formatAttendanceEntry,
  normalizeHandoverPriority: normalizeHandoverPriority2,
  normalizeBatchCode: normalizeBatchCode2,
  normalizeBatchExpiryDate: normalizeBatchExpiryDate2,
  normalizeCollectionCondition: normalizeCollectionCondition5,
  normalizePaymentFrequency,
  normalizeSaleChannel,
  normalizeRecountStatus,
  normalizeProductBarcode: normalizeProductBarcode2,
  normalizePin,
  hashPin: hashPin2,
  verifyPin,
  resolveCheckoutActorByPin,
  resolveTrackedCost: resolveTrackedCost4,
  getTotalPaidFromPaymentMethods: getTotalPaidFromPaymentMethods2,
  getProductTotalStock,
  getSaleReturnsMeta,
  getMissingCostPriceLabels,
  getAuditActorLabel,
  logAuditEvent,
  logSystemActivity,
  formatAuditCurrency,
  toFiniteNumberOrNull: toFiniteNumberOrNull5,
  buildLayawayPaymentPlan,
  formatInventoryBatch,
  formatStockAdjustmentEntry,
  formatPurchaseOrder,
  formatMarketCollection,
  formatRepairTicket,
  formatSaleReturnEntry,
  formatSaleResponse,
  HIGH_RISK_AUDIT_ACTIONS,
  getLoginAttemptKey,
  getRemainingLockoutMs,
  registerFailedLogin,
  clearLoginAttempt,
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  JWT_SECRET,
  JWT_EXPIRY,
  checkLicenseServiceConnection,
  activateRemoteStoreLicense,
  markExpiredProformas,
  startScheduledMaintenance,
  generateUniqueQuickCode,
  generateUniqueBarcode,
  reconcileInventoryBatchQuantity,
  generateUniquePurchaseOrderNumber,
  generateUniqueRepairTicketNumber,
  collectUnusedMediaCleanupStats,
  createSafetySnapshot: async (reason) => createSafetySnapshot(reason === "startup" ? "startup" : "pre-maintenance")
});
app.post("/api/reset", async (req, res) => {
  const secret = String(req.headers["x-cron-secret"] || req.query.secret || "");
  const expectedSecret = process.env.CRON_SECRET || process.env.DEMO_RESET_TOKEN || "";
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const dbPath = path6.join(dataRootDir, "pos.db");
    if (fs5.existsSync(dbPath)) {
      fs5.rmSync(dbPath, { force: true });
    }
    return res.json({ success: true, message: "Demo database reset. A fresh instance will re-seed on the next request." });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Reset failed" });
  }
});
function handler(req, res) {
  return app(req, res);
}
export {
  handler as default
};
