export const getVendorSignature = (name: unknown, phone?: unknown, address?: unknown) => {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedPhone = String(phone || '').trim().toLowerCase();
  const normalizedAddress = String(address || '').trim().toLowerCase();
  return [normalizedName, normalizedPhone, normalizedAddress].filter(Boolean).join('|') || 'unknown-vendor';
};

export const calculateVendorIdFromSignature = (signature: string) => {
  let hash = 0;
  for (let i = 0; i < signature.length; i += 1) {
    hash = ((hash * 31) + signature.charCodeAt(i)) % 90000;
  }
  return String(hash + 10000).padStart(5, '0');
};

export const getTrackedSoldQuantityFromSpecs = (publicSpecs: any) => {
  return Math.max(0, Math.trunc(Number(publicSpecs?.__sold_quantity_total || 0) || 0));
};

export const getTrackedSoldAmountFromSpecs = (publicSpecs: any, fallbackUnitPrice = 0) => {
  const trackedAmount = Math.max(0, Number(publicSpecs?.__sold_amount_total || 0) || 0);
  if (trackedAmount > 0) return trackedAmount;
  const soldQuantity = getTrackedSoldQuantityFromSpecs(publicSpecs);
  return soldQuantity > 0
    ? Number((soldQuantity * Math.max(0, Number(fallbackUnitPrice || 0) || 0)).toFixed(2))
    : 0;
};

export const getCollectedStatsFromItems = (items: any[]) => {
  const safeItems = Array.isArray(items) ? items : [];
  const collectedRows = safeItems.filter((item) => {
    const soldQuantity = Math.max(
      0,
      Math.trunc(Number(item?.sold_quantity || getTrackedSoldQuantityFromSpecs(item?.public_specs) || 0) || 0),
    );
    return soldQuantity > 0;
  });

  const units = collectedRows.reduce((sum, item) => {
    const soldQuantity = Math.max(
      0,
      Math.trunc(Number(item?.sold_quantity || getTrackedSoldQuantityFromSpecs(item?.public_specs) || 0) || 0),
    );
    return sum + soldQuantity;
  }, 0);

  const amount = Number(collectedRows.reduce((sum, item) => {
    const soldAmount = Math.max(
      0,
      Number(item?.sold_amount || getTrackedSoldAmountFromSpecs(item?.public_specs, Number(item?.selling_price || 0) || 0) || 0) || 0,
    );
    return sum + soldAmount;
  }, 0).toFixed(2));

  return {
    records: collectedRows.length,
    units,
    amount,
  };
};
