import type { Pool, PoolClient } from 'pg';

type ImportProductsInput = {
  storeId: number;
  rows: any[];
};

type ImportCustomersInput = {
  storeId: number;
  rows: any[];
};

type ImportSalesInput = {
  storeId: number;
  userId: number;
  rows: any[];
};

type ImportStoreDataInput = {
  storeId: number;
  actorUserId: number;
  data: any;
  mode?: 'replace' | 'merge';
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

const safeJsonParse = <T>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const normalizePhone = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const normalizeStoredPhone = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const digits = normalizePhone(raw);
  return raw.startsWith('+') && digits ? `+${digits}` : digits;
};
const normalizeProductBarcode = (value: unknown) => String(value ?? '').trim();
const normalizeCollectionCondition = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, '_');
};
const clampChatCleanupReminderDay = (value: unknown) => Math.min(31, Math.max(1, Number(value) || 28));
const clampChatRetentionValue = (value: unknown) => Math.min(365, Math.max(1, Number(value) || 3));
const normalizeChatRetentionUnit = (value: unknown): 'days' | 'months' => String(value || '').toLowerCase() === 'days' ? 'days' : 'months';
const normalizeStoreSignatureImage = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length > 8_000_000) return null;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw) ? raw : null;
};
const normalizeHandoverPriority = (value: unknown) => String(value || '').toUpperCase() === 'IMPORTANT' ? 'IMPORTANT' : 'INFO';

const toFiniteNumberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getConditionMatrixSlot = (product: any, condition?: unknown) => {
  const normalizedCondition = normalizeCollectionCondition(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }

  const matrix = safeJsonParse(product.condition_matrix, {} as any);
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};

const resolveTrackedCost = ({
  product,
  condition,
  sellingPrice,
  fallbackToSelling = false,
}: {
  product: any;
  condition?: unknown;
  sellingPrice?: unknown;
  fallbackToSelling?: boolean;
}) => {
  const slot = getConditionMatrixSlot(product, condition);
  const normalizedCondition = String(condition || 'STANDARD').trim().toLowerCase().replace(/\s+/g, '_');
  const resolvedSellingPrice = toFiniteNumberOrNull(sellingPrice)
    ?? toFiniteNumberOrNull(slot?.price)
    ?? toFiniteNumberOrNull(product?.price)
    ?? 0;
  const slotCost = toFiniteNumberOrNull(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
  const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== 'standard';

  if (usesConditionMatrixCost) {
    if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
      return { cost: slotCost, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice,
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
      sellingPrice: resolvedSellingPrice,
    };
  }

  return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
};

const calculateEan13CheckDigit = (base12: string) => {
  const digits = base12.replace(/\D/g, '');
  if (digits.length !== 12) {
    throw new Error('Barcode base must contain exactly 12 digits');
  }

  const weightedSum = digits
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

  return String((10 - (weightedSum % 10)) % 10);
};

const getSingleQueryRow = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return (result.rows[0] ?? null) as T | null;
};

const generateUniqueQuickCodeForQueryClient = async (
  client: SqlQueryClient,
  maxAttempts = 50,
  excludeProductId?: number | null,
  preferredCandidate?: string | null,
) => {
  const quickCodePattern = /^([1-9])\1\1\d{2}$/;
  const buildQuickCodeCandidate = (leadingDigit: number, trailingValue: number) => {
    const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
    const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, '0');
    return `${repeatedDigit.repeat(3)}${suffix}`;
  };

  const canUseCandidate = async (candidate: string) => {
    const normalized = String(candidate || '').trim();
    if (!normalized || !quickCodePattern.test(normalized)) return false;

    const exists = await getSingleQueryRow<{ id: number }>(client, 'SELECT id FROM products WHERE quick_code = $1 LIMIT 1', [normalized]);
    return !exists || (excludeProductId != null && Number(exists.id) === Number(excludeProductId));
  };

  const normalizedPreferred = String(preferredCandidate || '').trim();
  if (normalizedPreferred && await canUseCandidate(normalizedPreferred)) {
    return normalizedPreferred;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildQuickCodeCandidate(
      1 + Math.floor(Math.random() * 9),
      Math.floor(Math.random() * 100),
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
      candidateIndex % 100,
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
};

const generateUniqueBarcodeForQueryClient = async (client: SqlQueryClient, storeId: number, maxAttempts = 20) => {
  const storePart = String(Math.max(0, Number(storeId) || 0)).padStart(4, '0').slice(-4);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const timePart = String(Date.now() + attempt).slice(-5).padStart(5, '0');
    const randomDigit = String(Math.floor(Math.random() * 10));
    const base12 = `20${storePart}${timePart}${randomDigit}`;
    const candidate = `${base12}${calculateEan13CheckDigit(base12)}`;
    const exists = await getSingleQueryRow(client, 'SELECT id FROM products WHERE barcode = $1 LIMIT 1', [candidate]);
    if (!exists) {
      return candidate;
    }
  }

  return null;
};

const generateUniqueCustomerCodeForQueryClient = async (client: SqlQueryClient, maxAttempts = 20) => {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const exists = await getSingleQueryRow(client, 'SELECT id FROM customers WHERE customer_code = $1 LIMIT 1', [code]);
    if (!exists) return code;
    attempts += 1;
  }
  return `${Date.now().toString().slice(-6)}`;
};

export const createImportsWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async importProducts(input: ImportProductsInput) {
    const toNumber = (value: unknown) => {
      const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const toInteger = (value: unknown) => Math.max(0, Math.round(toNumber(value)));
    const parseObject = (value: unknown, fallback: any) => {
      if (!value) return fallback;
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(String(value));
      } catch {
        return fallback;
      }
    };
    const normalizeHeaderKey = (value: unknown) => String(value ?? '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const getRowValue = (row: any, aliases: string[]) => {
      const normalizedRow = Object.fromEntries(
        Object.entries(row || {}).map(([key, value]) => [normalizeHeaderKey(key), value]),
      );

      for (const alias of aliases) {
        const normalizedAlias = normalizeHeaderKey(alias);
        if (normalizedAlias in normalizedRow) {
          return normalizedRow[normalizedAlias];
        }
      }

      return undefined;
    };


    let importedCount = 0;

    await withPostgresTransaction(postgresPool, async (client) => {
      for (const row of input.rows) {
        const name = String(getRowValue(row, ['name', 'product_name', 'product name', 'product']) ?? '').trim();
        if (!name) continue;

        const categoryName = String(getRowValue(row, ['category']) ?? 'General').trim() || 'General';
        let categoryId = null as number | null;
        const existingCategory = await getSingleQueryRow<{ id: number; name: string }>(client, 'SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [input.storeId, categoryName]);
        if (existingCategory) {
          categoryId = Number(existingCategory.id);
        } else {
          const categoryInsert = await client.query('INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) RETURNING id', [input.storeId, categoryName, null]);
          categoryId = Number(categoryInsert.rows[0]?.id || 0) || null;
        }

        const quickCodeCandidate = String(getRowValue(row, ['quick_code', 'quick code']) ?? '').trim();
        const barcodeCandidate = normalizeProductBarcode(getRowValue(row, ['barcode', 'sku', 'barcode_sku', 'barcode / sku']));
        const existingProduct = await getSingleQueryRow<{ id: number; deleted_at?: string | null }>(client, `
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

        const parsedSpecs = parseObject(getRowValue(row, ['specs']), {});
        const parsedMatrix = parseObject(getRowValue(row, ['condition_matrix', 'condition matrix']), null);
        const conditionMatrix = parsedMatrix || {
          new: {
            price: toNumber(getRowValue(row, ['new_price', 'new price'])),
            stock: toInteger(getRowValue(row, ['new_stock', 'new stock'])),
            cost: toNumber(getRowValue(row, ['new_cost', 'new cost'])),
          },
          open_box: {
            price: toNumber(getRowValue(row, ['open_box_price', 'open box price'])),
            stock: toInteger(getRowValue(row, ['open_box_stock', 'open box stock'])),
            cost: toNumber(getRowValue(row, ['open_box_cost', 'open box cost'])),
          },
          used: {
            price: toNumber(getRowValue(row, ['used_price', 'used price'])),
            stock: toInteger(getRowValue(row, ['used_stock', 'used stock'])),
            cost: toNumber(getRowValue(row, ['used_cost', 'used cost'])),
          },
        };

        const payload = {
          name,
          barcode: resolvedBarcode,
          categoryName,
          categoryId,
          thumbnail: String(getRowValue(row, ['thumbnail', 'image', 'image_url', 'image url']) ?? '').trim() || null,
          quickCode,
          specs: JSON.stringify(parsedSpecs || {}),
          conditionMatrix: JSON.stringify(conditionMatrix || null),
          price: toNumber(getRowValue(row, ['price', 'selling_price', 'selling price'])),
          stock: toInteger(getRowValue(row, ['stock', 'stock_level', 'stock level'])),
          cost: toNumber(getRowValue(row, ['cost', 'cost_price', 'cost price'])),
          createdAt: String(getRowValue(row, ['created_at', 'created at']) ?? new Date().toISOString()),
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
            input.storeId,
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
            payload.createdAt,
          ]);
        }

        importedCount += 1;
      }
    });

    return { importedCount };

  },

  async importCustomers(input: ImportCustomersInput) {

    let importedCount = 0;

    await withPostgresTransaction(postgresPool, async (client) => {
      for (const row of input.rows) {
        const name = String(row?.name ?? '').trim();
        const rawPhone = String(row?.phone ?? '').trim();
        const normalizedPhone = normalizePhone(rawPhone);
        const storedPhone = normalizeStoredPhone(rawPhone);
        if (!name || !normalizedPhone) continue;

        const existing = await getSingleQueryRow<any>(
          client,
          `SELECT * FROM customers
           WHERE store_id = $1
             AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
           LIMIT 1`,
          [input.storeId, normalizedPhone],
        );

        if (existing) {
          await client.query('UPDATE customers SET name = $1, address = $2 WHERE id = $3 AND store_id = $4', [name, String(row?.address ?? '').trim() || null, existing.id, input.storeId]);
        } else {
          await client.query(
            'INSERT INTO customers (store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              input.storeId,
              name,
              storedPhone,
              String(row?.address ?? '').trim() || null,
              String(row?.customer_code ?? '').trim() || await generateUniqueCustomerCodeForQueryClient(client),
              String(row?.created_at ?? new Date().toISOString()),
            ],
          );
        }

        importedCount += 1;
      }
    });

    return { importedCount };

  },

  async importSales(input: ImportSalesInput) {
    const toNumber = (value: unknown) => {
      const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };


    let importedCount = 0;

    await withPostgresTransaction(postgresPool, async (client) => {
      for (const row of input.rows) {
        const customerName = String(row?.customer_name ?? '').trim();
        const rawCustomerPhone = String(row?.customer_phone ?? '').trim();
        const normalizedCustomerPhone = normalizePhone(rawCustomerPhone);
        const storedCustomerPhone = normalizeStoredPhone(rawCustomerPhone);
        const customerAddress = String(row?.customer_address ?? '').trim() || null;
        let customerId = null;

        if (customerName || normalizedCustomerPhone) {
          const existingCustomer = normalizedCustomerPhone
            ? await getSingleQueryRow<any>(
                client,
                `SELECT * FROM customers
                 WHERE store_id = $1
                   AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
                 LIMIT 1`,
                [input.storeId, normalizedCustomerPhone],
              )
            : null;

          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else if (customerName && normalizedCustomerPhone) {
            const insertedCustomer = await client.query(
              'INSERT INTO customers (store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [
                input.storeId,
                customerName,
                storedCustomerPhone,
                customerAddress,
                await generateUniqueCustomerCodeForQueryClient(client),
                String(row?.created_at ?? row?.timestamp ?? new Date().toISOString()),
              ],
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
          pos: toNumber(row?.payment_pos ?? row?.pos),
        };
        const status = ['COMPLETED', 'PENDING', 'VOIDED'].includes(String(row?.status ?? '').toUpperCase())
          ? String(row?.status).toUpperCase()
          : 'COMPLETED';
        const timestamp = String(row?.timestamp ?? new Date().toISOString());

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
          customerId,
        ]);
        const saleId = Number(saleInsert.rows[0]?.id || 0);

        const productName = String(row?.product_name ?? '').trim();
        const productBarcode = String(row?.barcode ?? '').trim();
        const quantity = Math.max(1, Math.round(toNumber(row?.quantity) || 1));
        const priceAtSale = toNumber(row?.price_at_sale) || toNumber(row?.item_price);

        if (saleId && (productName || productBarcode)) {
          let product = null as any;
          if (productBarcode) {
            product = await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1', [input.storeId, productBarcode]);
          }
          if (!product && productName) {
            product = await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE store_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL LIMIT 1', [input.storeId, productName]);
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
              'Imported',
              null,
              quickCode,
              JSON.stringify({}),
              JSON.stringify(null),
              priceAtSale,
              0,
              0,
              timestamp,
            ]);
            product = { id: Number(insertProductResult.rows[0]?.id || 0) };
          }

          if (product?.id) {
            const resolvedCostAtSale = resolveTrackedCost({
              product,
              condition: String(row?.condition ?? '').trim() || null,
              sellingPrice: priceAtSale,
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
              String(row?.imei_serial ?? '').trim() || null,
              String(row?.condition ?? '').trim() || null,
              JSON.stringify({}),
            ]);
          }
        }

        importedCount += 1;
      }
    });

    return { importedCount };

  },

  async importStoreData(input: ImportStoreDataInput) {
    const numericStoreId = Number(input.storeId);
    const { data } = input;
    const importMode = input.mode === 'merge' ? 'merge' : 'replace';

    await withPostgresTransaction(postgresPool, async (client) => {
      if (importMode === 'replace') {
        // Clear existing data for this store - FK constraint ordering (most dependent → least dependent)
        // Leaf tables first (no FK dependencies within store)
        await client.query('DELETE FROM market_collections WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM staff_attendance WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM internal_messages WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM inventory_batches WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM repair_tickets WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM stock_adjustments WHERE store_id = $1', [numericStoreId]);

        // Sales-related chain: vendor_payables → sale_items → sales
        await client.query('DELETE FROM vendor_payables WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1))', [numericStoreId]);
        await client.query('DELETE FROM consignment_vendor_bank_details WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM consignment_items WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM sales_returns WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM transaction_flags WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)', [numericStoreId]);

        // Order references
        await client.query('DELETE FROM purchase_orders WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM pro_formas WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM sales WHERE store_id = $1', [numericStoreId]);

        // Document/operational tables
        await client.query('DELETE FROM active_holds WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM handover_notes WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM expenses WHERE store_id = $1', [numericStoreId]);

        // Product-related chain: product_change_requests → products → categories
        await client.query('DELETE FROM product_change_requests WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM products WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM categories WHERE store_id = $1', [numericStoreId]);

        // Master data
        await client.query('DELETE FROM customers WHERE store_id = $1', [numericStoreId]);
        await client.query('DELETE FROM suppliers WHERE store_id = $1', [numericStoreId]);
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
          data.store.receipt_paper_size === 'A4' ? 'A4' : 'THERMAL',
          /^#([0-9A-Fa-f]{6})$/.test(String(data.store.document_color || '')) ? String(data.store.document_color).toUpperCase() : '#F4BD4A',
          data.store.show_store_name_on_documents ? 1 : 0,
          data.store.tax_enabled ? 1 : 0,
          Math.min(100, Math.max(0, Number(data.store.tax_percentage) || 0)),
          String(data.store.receipt_header_note || '').trim(),
          String(data.store.receipt_footer_note || '').trim() || 'Thank you for your business!',
          data.store.receipt_show_bank_details === false ? 0 : 1,
          data.store.default_missing_cost_to_price ? 1 : 0,
          data.store.pin_checkout_enabled === false ? 0 : 1,
          data.store.chat_cleanup_reminders_enabled === false ? 0 : 1,
          clampChatCleanupReminderDay(data.store.chat_cleanup_reminder_day),
          clampChatRetentionValue(data.store.chat_retention_value),
          normalizeChatRetentionUnit(data.store.chat_retention_unit),
          data.store.last_chat_cleanup_at || null,
          numericStoreId,
        ]);
      }

      const importedUserIdMap = new Map<number, number>();
      if (data.users && Array.isArray(data.users)) {
        for (const u of data.users) {
          const incomingUserId = Number(u.id);
          const username = String(u.username || '').trim();
          if (!username) continue;

          const updateResult = await client.query(
            'UPDATE users SET store_id = $1, username = $2, password = $3, role = $4, pin = $5 WHERE id = $6 RETURNING id',
            [numericStoreId, username, u.password, u.role, u.pin || null, incomingUserId],
          );
          if (updateResult.rowCount === 0) {
            await client.query(
              'INSERT INTO users (id, store_id, username, password, role, pin) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
              [incomingUserId, numericStoreId, username, u.password, u.role, u.pin || null],
            );
          }

          const byId = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [incomingUserId]);
          const byUsername = byId.rows[0]
            ? null
            : await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
          const resolvedUser = byId.rows[0] || byUsername?.rows[0];
          if (resolvedUser) {
            importedUserIdMap.set(incomingUserId, Number(resolvedUser.id));
          }
        }
      }
      const importedUserIds = new Set<number>(Array.from(importedUserIdMap.values()));
      const fallbackUserId = importedUserIdMap.get(Number(input.actorUserId))
        ?? (Array.from(importedUserIds)[0] ?? Number(input.actorUserId));

      const importedCategoryIds = new Set<number>();
      if (data.categories && Array.isArray(data.categories)) {
        for (const c of data.categories) {
          await client.query(
            'INSERT INTO categories (id, store_id, name, description, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [c.id, numericStoreId, c.name, c.description, c.created_at],
          );
          importedCategoryIds.add(Number(c.id));
        }
      }

      const importedCustomerIds = new Set<number>();
      if (data.customers && Array.isArray(data.customers)) {
        for (const c of data.customers) {
          await client.query(
            'INSERT INTO customers (id, store_id, name, phone, address, customer_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
            [c.id, numericStoreId, c.name, c.phone, c.address, c.customer_code, c.created_at],
          );
          importedCustomerIds.add(Number(c.id));
        }
      }

      const importedSupplierIds = new Set<number>();
      const importedSuppliers = Array.isArray(data.suppliers)
        ? data.suppliers
        : Array.isArray(data.suppliers_list)
          ? data.suppliers_list
          : [];
      for (const supplier of importedSuppliers) {
        await client.query(
          'INSERT INTO suppliers (id, store_id, name, phone, email, address, note, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
          [
            supplier.id, numericStoreId, supplier.name, supplier.phone || null,
            supplier.email || null, supplier.address || null, supplier.note || null,
            supplier.created_at || new Date().toISOString(),
            supplier.updated_at || supplier.created_at || new Date().toISOString(),
          ],
        );
        importedSupplierIds.add(Number(supplier.id));
      }

      const importedProductIds = new Set<number>();
      if (data.products && Array.isArray(data.products)) {
        for (const p of data.products) {
          const resolvedCategoryId = importedCategoryIds.has(Number(p.category_id)) ? Number(p.category_id) : null;
          await client.query(
            'INSERT INTO products (id, store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING',
            [p.id, numericStoreId, p.name, p.barcode, p.category, resolvedCategoryId, p.thumbnail, p.quick_code, p.specs, p.condition_matrix, p.price, p.stock, p.cost, p.created_at || new Date().toISOString(), p.deleted_at],
          );
          importedProductIds.add(Number(p.id));
        }
      }

      if (data.stockAdjustments && Array.isArray(data.stockAdjustments)) {
        for (const entry of data.stockAdjustments) {
          if (!importedProductIds.has(Number(entry.product_id))) continue;
          const resolvedAdjustedBy = importedUserIdMap.get(Number(entry.adjusted_by)) ?? fallbackUserId;
          await client.query(
            'INSERT INTO stock_adjustments (id, store_id, product_id, adjusted_by, adjustment_type, adjustment_mode, quantity_before, quantity_change, quantity_after, cost_impact, condition, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING',
            [
              entry.id, numericStoreId, entry.product_id, resolvedAdjustedBy,
              entry.adjustment_type || 'MANUAL', entry.adjustment_mode || 'DECREASE',
              entry.quantity_before ?? 0, entry.quantity_change ?? 0, entry.quantity_after ?? 0,
              entry.cost_impact ?? 0, entry.condition || null, entry.note || null,
              entry.created_at || new Date().toISOString(),
            ],
          );
        }
      }

      const importedSaleIds = new Set<number>();
      if (data.sales && Array.isArray(data.sales)) {
        for (const s of data.sales) {
          const resolvedUserId = importedUserIdMap.get(Number(s.user_id)) ?? fallbackUserId;
          const resolvedVoidedBy = s.voided_by != null ? (importedUserIdMap.get(Number(s.voided_by)) ?? null) : null;
          const resolvedCustomerId = importedCustomerIds.has(Number(s.customer_id)) ? Number(s.customer_id) : null;
          await client.query(
            'INSERT INTO sales (id, store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, timestamp, deleted_at, void_reason, voided_by, is_ledger_locked, customer_id, due_date, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) ON CONFLICT DO NOTHING',
            [
              s.id, numericStoreId, s.subtotal ?? s.total, s.discount_amount ?? 0, s.discount_type || null,
              s.discount_value ?? 0, s.discount_note || null, s.tax_amount ?? 0, s.tax_percentage ?? 0, s.total,
              resolvedUserId, s.payment_methods, s.status, s.pdf_path, s.timestamp, s.deleted_at,
              s.void_reason, resolvedVoidedBy, s.is_ledger_locked ? 1 : 0, resolvedCustomerId, s.due_date || null, s.note || null,
            ],
          );
          importedSaleIds.add(Number(s.id));
        }
      }

      if (data.saleItems && Array.isArray(data.saleItems)) {
        for (const si of data.saleItems) {
          if (!importedSaleIds.has(Number(si.sale_id)) || !importedProductIds.has(Number(si.product_id))) continue;
          const subtotal = (si.price_at_sale * si.quantity) || si.subtotal || 0;
          await client.query(
            'INSERT INTO sale_items (id, sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING',
            [si.id, si.sale_id, si.product_id, si.quantity, si.price_at_sale, subtotal, si.cost_at_sale ?? null, si.imei_serial, si.condition, si.specs_at_sale],
          );
        }
      }

      if (data.salesReturns && Array.isArray(data.salesReturns)) {
        for (const entry of data.salesReturns) {
          if (!importedSaleIds.has(Number(entry.sale_id))) continue;
          const resolvedProcessedBy = importedUserIdMap.get(Number(entry.processed_by)) ?? fallbackUserId;
          await client.query(
            'INSERT INTO sales_returns (id, sale_id, store_id, processed_by, returned_value, refund_amount, refund_method, return_type, restock_items, reason, items, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING',
            [
              entry.id, entry.sale_id, numericStoreId, resolvedProcessedBy,
              entry.returned_value ?? entry.refund_amount ?? 0, entry.refund_amount ?? 0,
              entry.refund_method || 'cash', entry.return_type || 'REFUND',
              entry.restock_items === false || entry.restock_items === '0' ? 0 : Number(entry.restock_items) === 0 ? 0 : 1,
              entry.reason || 'Imported return record',
              typeof entry.items === 'string' ? entry.items : JSON.stringify(entry.items || []),
              entry.note || null, entry.created_at || new Date().toISOString(),
            ],
          );
        }
      }

      const importedTransactionFlags = Array.isArray(data.transactionFlags)
        ? data.transactionFlags
        : Array.isArray(data.transaction_flags) ? data.transaction_flags : [];
      for (const entry of importedTransactionFlags) {
        if (!importedSaleIds.has(Number(entry.sale_id))) continue;
        const resolvedFlaggedBy = importedUserIdMap.get(Number(entry.flagged_by)) ?? fallbackUserId;
        const resolvedBy = entry.resolved_by != null ? (importedUserIdMap.get(Number(entry.resolved_by)) ?? fallbackUserId) : null;
        await client.query(
          'INSERT INTO transaction_flags (id, store_id, sale_id, flagged_by, issue_type, note, status, created_at, resolved_at, resolved_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, entry.sale_id, resolvedFlaggedBy,
            entry.issue_type || 'CHECK_REQUIRED', String(entry.note || '').trim() || 'Imported transaction flag',
            entry.status || 'OPEN', entry.created_at || new Date().toISOString(),
            entry.resolved_at || null, resolvedBy,
          ],
        );
      }

      if (data.holds && Array.isArray(data.holds)) {
        for (const h of data.holds) {
          const resolvedUserId = importedUserIdMap.get(Number(h.user_id)) ?? fallbackUserId;
          await client.query(
            'INSERT INTO active_holds (id, store_id, user_id, staff_name, customer_name, note, cart_data, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
            [h.id, numericStoreId, resolvedUserId, h.staff_name, h.customer_name, h.note, h.cart_data, h.timestamp],
          );
        }
      }

      if (data.proformas && Array.isArray(data.proformas)) {
        for (const p of data.proformas) {
          const resolvedCustomerId = importedCustomerIds.has(Number(p.customer_id)) ? Number(p.customer_id) : null;
          await client.query(
            'INSERT INTO pro_formas (id, store_id, customer_id, customer_name, customer_phone, customer_address, items, subtotal, tax_amount, tax_percentage, total, expiry_date, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING',
            [
              p.id, numericStoreId, resolvedCustomerId, p.customer_name || null,
              p.customer_phone || null, p.customer_address || null,
              typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []),
              p.subtotal ?? p.total, p.tax_amount ?? 0, p.tax_percentage ?? 0, p.total,
              p.expiry_date, p.status || 'PENDING', p.created_at,
            ],
          );
        }
      }

      if (data.expenses && Array.isArray(data.expenses)) {
        for (const expense of data.expenses) {
          const resolvedCreatedBy = importedUserIdMap.get(Number(expense.created_by)) ?? fallbackUserId;
          await client.query(
            'INSERT INTO expenses (id, store_id, title, category, amount, note, spent_at, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
            [
              expense.id, numericStoreId, expense.title, expense.category || 'General',
              expense.amount, expense.note || null,
              expense.spent_at || expense.created_at || new Date().toISOString(),
              resolvedCreatedBy, expense.created_at || new Date().toISOString(),
            ],
          );
        }
      }

      const importedHandoverNotes = Array.isArray(data.handoverNotes)
        ? data.handoverNotes
        : Array.isArray(data.handover_notes) ? data.handover_notes : [];
      for (const entry of importedHandoverNotes) {
        const resolvedAuthorId = importedUserIdMap.get(Number(entry.author_id)) ?? fallbackUserId;
        await client.query(
          'INSERT INTO handover_notes (id, store_id, author_id, note_text, priority, is_pinned, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, resolvedAuthorId, String(entry.note_text || entry.note || '').trim(),
            normalizeHandoverPriority(entry.priority), entry.is_pinned ? 1 : 0,
            entry.created_at || new Date().toISOString(),
            entry.updated_at || entry.created_at || new Date().toISOString(),
          ],
        );
      }

      const importedInternalMessages = Array.isArray(data.internalMessages)
        ? data.internalMessages
        : Array.isArray(data.internal_messages) ? data.internal_messages : [];
      for (const entry of importedInternalMessages) {
        const resolvedSenderId = importedUserIdMap.get(Number(entry.sender_id)) ?? fallbackUserId;
        const resolvedRecipientId = importedUserIdMap.get(Number(entry.recipient_id)) ?? fallbackUserId;
        await client.query(
          'INSERT INTO internal_messages (id, store_id, sender_id, recipient_id, message_text, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, resolvedSenderId, resolvedRecipientId,
            String(entry.message_text || '').trim(), entry.is_read ? true : false,
            entry.created_at || new Date().toISOString(),
          ],
        );
      }

      const importedAttendanceEntries = Array.isArray(data.staffAttendance)
        ? data.staffAttendance
        : Array.isArray(data.staff_attendance) ? data.staff_attendance : [];
      for (const entry of importedAttendanceEntries) {
        const resolvedUserId = importedUserIdMap.get(Number(entry.user_id)) ?? fallbackUserId;
        await client.query(
          'INSERT INTO staff_attendance (id, store_id, user_id, shift_date, clock_in_at, clock_out_at, total_minutes, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, resolvedUserId,
            entry.shift_date || new Date().toISOString().slice(0, 10),
            entry.clock_in_at || entry.created_at || new Date().toISOString(),
            entry.clock_out_at || null, entry.total_minutes ?? 0, entry.note || null,
            entry.created_at || new Date().toISOString(),
          ],
        );
      }

      const importedRepairTickets = Array.isArray(data.repairTickets)
        ? data.repairTickets
        : Array.isArray(data.repair_tickets) ? data.repair_tickets : [];
      for (const entry of importedRepairTickets) {
        const resolvedCreatedBy = entry.created_by != null ? (importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId) : null;
        const resolvedUpdatedBy = entry.updated_by != null ? (importedUserIdMap.get(Number(entry.updated_by)) ?? fallbackUserId) : null;
        await client.query(
          'INSERT INTO repair_tickets (id, store_id, ticket_number, customer_name, customer_phone, device_name, brand, model, imei_serial, issue_summary, accessories, purchase_reference, warranty_status, technician_name, intake_notes, internal_notes, estimated_cost, final_cost, amount_paid, status, promised_date, created_by, updated_by, completed_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, entry.ticket_number, entry.customer_name,
            entry.customer_phone || null, entry.device_name, entry.brand || null,
            entry.model || null, entry.imei_serial || null, entry.issue_summary,
            entry.accessories || null, entry.purchase_reference || null,
            entry.warranty_status || 'NO_WARRANTY', entry.technician_name || null,
            entry.intake_notes || null, entry.internal_notes || null,
            entry.estimated_cost ?? 0, entry.final_cost ?? 0, entry.amount_paid ?? 0,
            entry.status || 'RECEIVED', entry.promised_date || null,
            resolvedCreatedBy, resolvedUpdatedBy, entry.completed_at || null,
            entry.created_at || new Date().toISOString(),
            entry.updated_at || entry.created_at || new Date().toISOString(),
          ],
        );
      }

      const importedPurchaseOrders = Array.isArray(data.purchaseOrders)
        ? data.purchaseOrders
        : Array.isArray(data.purchase_orders) ? data.purchase_orders : [];
      for (const entry of importedPurchaseOrders) {
        const resolvedSupplierId = importedSupplierIds.has(Number(entry.supplier_id)) ? Number(entry.supplier_id) : null;
        const resolvedCreatedBy = entry.created_by != null ? (importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId) : null;
        const resolvedReceivedBy = entry.received_by != null ? (importedUserIdMap.get(Number(entry.received_by)) ?? fallbackUserId) : null;
        await client.query(
          'INSERT INTO purchase_orders (id, store_id, supplier_id, supplier_name, order_number, status, items, subtotal, note, expected_date, created_by, received_by, received_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, resolvedSupplierId, entry.supplier_name || null,
            entry.order_number, entry.status || 'ORDERED',
            typeof entry.items === 'string' ? entry.items : JSON.stringify(entry.items || []),
            entry.subtotal ?? 0, entry.note || null, entry.expected_date || null,
            resolvedCreatedBy, resolvedReceivedBy, entry.received_at || null,
            entry.created_at || new Date().toISOString(),
            entry.updated_at || entry.created_at || new Date().toISOString(),
          ],
        );
      }

      const importedInventoryBatches = Array.isArray(data.inventoryBatches)
        ? data.inventoryBatches
        : Array.isArray(data.inventory_batches) ? data.inventory_batches : [];
      for (const entry of importedInventoryBatches) {
        if (!importedProductIds.has(Number(entry.product_id))) continue;
        const resolvedSupplierId = importedSupplierIds.has(Number(entry.supplier_id)) ? Number(entry.supplier_id) : null;
        const resolvedPurchaseOrderId = importedPurchaseOrders.some((order: any) => Number(order.id) === Number(entry.purchase_order_id)) ? Number(entry.purchase_order_id) : null;
        const resolvedReceivedBy = entry.received_by != null ? (importedUserIdMap.get(Number(entry.received_by)) ?? fallbackUserId) : null;
        await client.query(
          'INSERT INTO inventory_batches (id, store_id, product_id, supplier_id, purchase_order_id, received_by, condition, batch_code, expiry_date, quantity_received, quantity_remaining, unit_cost, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING',
          [
            entry.id, numericStoreId, entry.product_id, resolvedSupplierId,
            resolvedPurchaseOrderId, resolvedReceivedBy, entry.condition || null,
            entry.batch_code || null, entry.expiry_date || null,
            entry.quantity_received ?? 0, entry.quantity_remaining ?? entry.quantity_received ?? 0,
            entry.unit_cost ?? 0, entry.note || null, entry.created_at || new Date().toISOString(),
          ],
        );
      }

      if (data.marketCollections && Array.isArray(data.marketCollections)) {
        for (const entry of data.marketCollections) {
          const resolvedCreatedBy = importedUserIdMap.get(Number(entry.created_by)) ?? fallbackUserId;
          const resolvedSaleId = importedSaleIds.has(Number(entry.converted_sale_id)) ? Number(entry.converted_sale_id) : null;
          await client.query(
            'INSERT INTO market_collections (id, store_id, collector_name, phone, items, expected_return_date, tracking_code, status, note, created_by, converted_sale_id, sold_at, returned_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING',
            [
              entry.id, numericStoreId, entry.collector_name, entry.phone,
              typeof entry.items === 'string' ? entry.items : JSON.stringify(entry.items || []),
              entry.expected_return_date, entry.tracking_code, entry.status || 'OPEN',
              entry.note || null, resolvedCreatedBy, resolvedSaleId,
              entry.sold_at || null, entry.returned_at || null,
              entry.created_at || new Date().toISOString(),
              entry.updated_at || entry.created_at || new Date().toISOString(),
            ],
          );
        }
      }
    });

    return { storeId: numericStoreId };
  },
});
