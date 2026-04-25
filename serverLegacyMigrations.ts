const LEGACY_QUICK_CODE_PATTERN = /^([1-9])\1\1\d{2}$/;

const buildRepeatedPrefixQuickCode = (leadingDigit: number, trailingValue: number) => {
  const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
  const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, '0');
  return `${repeatedDigit.repeat(3)}${suffix}`;
};

const createQuickCodeAllocator = (existingCodes: Iterable<string>) => {
  const taken = new Set(
    Array.from(existingCodes, (code) => String(code || '').trim())
      .filter((code) => LEGACY_QUICK_CODE_PATTERN.test(code)),
  );

  return (seed = 0) => {
    const safeSeed = Math.max(0, Math.trunc(seed) || 0);
    for (let offset = 0; offset < 900; offset += 1) {
      const candidateIndex = (safeSeed + offset) % 900;
      const candidate = buildRepeatedPrefixQuickCode(
        Math.floor(candidateIndex / 100) + 1,
        candidateIndex % 100,
      );
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }

    return null;
  };
};

const normalizePostgresProductQuickCodes = async (postgresPool?: any | null) => {
  if (!postgresPool) return;

  try {
    const result = await postgresPool.query('SELECT id, quick_code FROM products WHERE deleted_at IS NULL ORDER BY id ASC');
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const allocateQuickCode = createQuickCodeAllocator(rows.map((row: any) => String(row?.quick_code || '').trim()));
    let updatedCount = 0;

    for (const row of rows) {
      const currentQuickCode = String(row?.quick_code || '').trim();
      if (LEGACY_QUICK_CODE_PATTERN.test(currentQuickCode)) {
        continue;
      }

      const nextQuickCode = allocateQuickCode(Number(row?.id) || 0);
      if (!nextQuickCode) {
        continue;
      }

      await postgresPool.query('UPDATE products SET quick_code = $1 WHERE id = $2', [nextQuickCode, row.id]);
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      console.log(`🔁 Normalized ${updatedCount} legacy product quick code(s) in PostgreSQL.`);
    }
  } catch (error) {
    console.warn('Quick-code normalization skipped for PostgreSQL:', error);
  }
};

export const runLegacyDatabaseMigrations = async ({ postgresPool, isLocalAdapter }: { postgresPool?: any | null; isLocalAdapter?: boolean }) => {
  if (!isLocalAdapter) {
    await normalizePostgresProductQuickCodes(postgresPool);
  }

  if (postgresPool) {
    try {
      await postgresPool.query(`
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
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_consignment_items_store_status ON consignment_items(store_id, status, updated_at DESC)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_consignment_items_store_name ON consignment_items(store_id, item_name)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_consignment_items_store_quick_code ON consignment_items(store_id, quick_code)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_consignment_items_store_imei ON consignment_items(store_id, imei_serial)');
      await postgresPool.query('ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS vendor_phone TEXT');
      await postgresPool.query('ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS vendor_address TEXT');
      await postgresPool.query('ALTER TABLE consignment_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1');
      await postgresPool.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS show_discount_on_invoice INTEGER NOT NULL DEFAULT 1');
      await postgresPool.query('ALTER TABLE stores ADD COLUMN IF NOT EXISTS vendor_portal_enabled INTEGER NOT NULL DEFAULT 0');

      await postgresPool.query(`
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
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_product_change_requests_store_status_created ON product_change_requests(store_id, status, created_at DESC)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_product_change_requests_product_created ON product_change_requests(product_id, created_at DESC)');

      await postgresPool.query(`
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
      await postgresPool.query("ALTER TABLE vendor_payables ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'SOURCED'");
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_vendor_payables_store_status_created ON vendor_payables(store_id, status, created_at DESC)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_vendor_payables_sale_item ON vendor_payables(sale_item_id)');
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_vendor_payables_vendor_name ON vendor_payables(store_id, vendor_name)');

      // Price markup audit trail columns
      await postgresPool.query('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS base_price_at_sale DOUBLE PRECISION');
      await postgresPool.query('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_markup DOUBLE PRECISION NOT NULL DEFAULT 0');

      await postgresPool.query(`
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
      await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_vendor_bank_details_store_vendor_key ON consignment_vendor_bank_details(store_id, vendor_key)');
    } catch (error) {
      console.warn('Vendor payables migration skipped for PostgreSQL:', error);
    }

    try {
      await postgresPool.query("ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_receipt_paper_size_check");
      await postgresPool.query("ALTER TABLE stores ADD CONSTRAINT stores_receipt_paper_size_check CHECK (receipt_paper_size IN ('THERMAL', 'THERMAL_58', 'A4'))");
    } catch (error) {
      console.warn('Paper size constraint migration skipped:', error);
    }
  }
};
