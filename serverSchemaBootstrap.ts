export const initializeDatabaseSchema = (db: any) => {
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
    // Indexes may already exist
  }
};
