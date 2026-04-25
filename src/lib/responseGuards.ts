type JsonRecord = Record<string, any>;

const asObject = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

export const normalizeVendorPayablesResponse = (raw: unknown) => {
  const source = asObject(raw) || {};
  const records = asArray(source.records).map((entry) => asObject(entry) || {}).map((row) => ({
    ...row,
    id: Math.max(0, Number(row.id || 0) || 0),
    sale_id: Math.max(0, Number(row.sale_id || 0) || 0),
    amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
    status: String(row.status || 'UNPAID').toUpperCase() === 'SETTLED' ? 'SETTLED' : 'UNPAID',
    source_type: String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED',
    vendor_name: String(row.vendor_name || 'Unknown Vendor'),
    item_name: String(row.item_name || ''),
  }));

  const summaryRaw = asObject(source.summary) || {};
  const summary = {
    totalRecords: Math.max(0, Number(summaryRaw.totalRecords || records.length || 0) || 0),
    totalAmountDue: Math.max(0, Number(summaryRaw.totalAmountDue || 0) || 0),
    unpaidAmount: Math.max(0, Number(summaryRaw.unpaidAmount || 0) || 0),
  };

  return { records, summary };
};

export const normalizeReturnsResponse = (raw: unknown) => {
  return asArray(raw).map((entry) => asObject(entry) || {}).map((row) => ({
    ...row,
    id: Math.max(0, Number(row.id || 0) || 0),
    sale_id: Math.max(0, Number(row.sale_id || 0) || 0),
    refund_amount: Math.max(0, Number(row.refund_amount || 0) || 0),
    returned_value: Math.max(0, Number(row.returned_value || 0) || 0),
    item_count: Math.max(0, Number(row.item_count || 0) || 0),
    items: asArray(row.items),
    reason: String(row.reason || ''),
  }));
};

export const normalizeVendorPortalResponse = (raw: unknown) => {
  const source = asObject(raw);
  if (!source) return null;

  const store = asObject(source.store);
  const vendor = asObject(source.vendor);
  const summary = asObject(source.summary);
  if (!store || !vendor || !summary) return null;

  return {
    store: {
      id: Math.max(0, Number(store.id || 0) || 0),
      name: String(store.name || ''),
      currency_code: String(store.currency_code || 'USD'),
    },
    vendor: {
      id: String(vendor.id || ''),
      name: String(vendor.name || ''),
      phone: String(vendor.phone || ''),
      address: String(vendor.address || ''),
    },
    summary: {
      total_records: Math.max(0, Number(summary.total_records || 0) || 0),
      active_units: Math.max(0, Number(summary.active_units || 0) || 0),
      collected_records: Math.max(0, Number(summary.collected_records || 0) || 0),
      collected_units: Math.max(0, Number(summary.collected_units || 0) || 0),
      sold_units: Math.max(0, Number(summary.sold_units || 0) || 0),
      sold_amount: Math.max(0, Number(summary.sold_amount || 0) || 0),
      returned_units: Math.max(0, Number(summary.returned_units || 0) || 0),
      customer_return_events: Math.max(0, Number(summary.customer_return_events || 0) || 0),
      customer_returned_units: Math.max(0, Number(summary.customer_returned_units || 0) || 0),
      pending_payout: Math.max(0, Number(summary.pending_payout || 0) || 0),
      settled_payout: Math.max(0, Number(summary.settled_payout || 0) || 0),
      sourced_payout: Math.max(0, Number(summary.sourced_payout || 0) || 0),
      consignment_payout: Math.max(0, Number(summary.consignment_payout || 0) || 0),
      total_payout_generated: Math.max(0, Number(summary.total_payout_generated || 0) || 0),
    },
    items: asArray(source.items),
    customer_returns: asArray(source.customer_returns),
    activities: asArray(source.activities),
  };
};
