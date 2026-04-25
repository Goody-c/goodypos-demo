import React, { useState, useEffect, useMemo } from 'react';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Award,
  AlertTriangle,
  Target,
  PieChart as PieChartIcon,
  ShieldAlert,
  Download,
  ChevronRight,
  Loader2,
  RefreshCw,
  Activity,
  BarChart2,
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { readCurrencyPreference } from '../../lib/currency';

const CHART_COLORS = ['#0f172a', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];

const PaymentSplitChart: React.FC<{ data: Array<{ label: string; value: number }> }> = ({ data }) => {
  const sanitized = data.filter((item) => Number(item.value) > 0);
  const total = sanitized.reduce((sum, item) => sum + Number(item.value || 0), 0);

  if (sanitized.length === 0 || total <= 0) {
    return <p className="text-sm text-slate-400">No payment split available yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
        {sanitized.map((item, index) => (
          <div
            key={item.label}
            style={{
              width: `${(Number(item.value || 0) / total) * 100}%`,
              backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
            }}
          />
        ))}
      </div>

      <div className="space-y-3">
        {sanitized.map((item, index) => {
          const percentage = ((Number(item.value || 0) / total) * 100).toFixed(1);
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  {item.label}
                </span>
                <span className="font-bold text-slate-900">{formatCurrency(item.value)} · {percentage}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SalesTrendChart: React.FC<{ data: Array<{ label: string; value: number }> }> = ({ data }) => {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400">No sales trend data yet.</p>;
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const bestIndex = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const todayShort = new Date().toLocaleDateString('en-US', { weekday: 'short' });

  return (
    <div className="space-y-4">
      <div className="flex h-44 items-end gap-1.5 rounded-2xl bg-slate-50 px-4 pt-4 pb-2">
        {data.map((item, index) => {
          const heightPct = Math.max((item.value / maxValue) * 100, item.value > 0 ? 3 : 0);
          const isBest = index === bestIndex && item.value > 0;
          const isToday = item.label.toLowerCase().startsWith(todayShort.toLowerCase().slice(0, 3));
          const barColor = isToday
            ? 'bg-red-500'
            : isBest
            ? 'bg-emerald-900/200'
            : 'bg-slate-300';
          const labelColor = isToday ? 'text-red-500 font-black' : isBest ? 'text-emerald-600 font-bold' : 'text-slate-400 font-semibold';

          return (
            <div key={item.label} className="group flex flex-1 flex-col items-center gap-1">
              {item.value > 0 && (
                <span className={`hidden text-[9px] group-hover:block ${isToday ? 'text-red-500' : isBest ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {formatCurrency(item.value)}
                </span>
              )}
              <div className="flex w-full flex-col justify-end" style={{ height: '120px' }}>
                <div
                  className={`w-full rounded-t-md transition-all duration-500 ${barColor}`}
                  style={{ height: `${heightPct}%` }}
                  title={`${item.label}: ${formatCurrency(item.value)}`}
                />
              </div>
              <span className={`text-[10px] ${labelColor}`}>{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] font-bold text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-red-500" />Today</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-900/200" />Best day</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-slate-300" />Other days</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-7">
        {data.map((item) => (
          <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="font-semibold text-slate-500">{item.label}</div>
            <div className="font-bold text-slate-900">{formatCurrency(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const CategoryBars: React.FC<{ data: Array<{ label: string; value: number }> }> = ({ data }) => {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400">No category movement data yet.</p>;
  }

  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className="space-y-4">
      {data.map((item, index) => (
        <div key={`${item.label}-${index}`} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate pr-3 font-medium text-slate-300">{item.label}</span>
            <span className="font-bold text-slate-900">{item.value}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.value / maxValue) * 100}%`,
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const Analytics: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [data, setData] = useState<any>(null);
  const [productsCatalog, setProductsCatalog] = useState<any[]>([]);
  const productsCatalogById = useMemo(() => new Map(productsCatalog.map((entry: any) => [Number(entry?.id), entry])), [productsCatalog]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [savingCostKey, setSavingCostKey] = useState<string | null>(null);
  const [savingAllMissingCosts, setSavingAllMissingCosts] = useState(false);
  const [sameCostDraft, setSameCostDraft] = useState('');
  const inputCurrencySymbol = readCurrencyPreference().symbol;

  const normalizeConditionKey = (condition: unknown) =>
    String(condition || 'STANDARD').trim().toLowerCase().replace(/\s+/g, '_');

  const formatConditionLabel = (condition: unknown) =>
    normalizeConditionKey(condition).replace(/_/g, ' ').toUpperCase();

  const getCostDraftKey = (item: any, overrideCondition?: unknown) =>
    `${Number(item?.id ?? item?.product_id ?? item?.productId)}-${normalizeConditionKey(overrideCondition ?? item?.condition)}`;

  const formatCurrencyDraftInput = (value: unknown) => {
    const sanitized = String(value ?? '')
      .replace(/,/g, '')
      .replace(/[^\d.]/g, '');

    if (!sanitized) return '';

    const [wholePartRaw = '', decimalPartRaw = ''] = sanitized.split('.');
    const normalizedWhole = wholePartRaw.replace(/^0+(?=\d)/, '') || '0';
    const formattedWhole = Number(normalizedWhole).toLocaleString('en-NG');
    const normalizedDecimal = decimalPartRaw.slice(0, 2);

    return sanitized.includes('.')
      ? `${formattedWhole}.${normalizedDecimal}`
      : formattedWhole;
  };

  const parseCurrencyDraftInput = (value: unknown) => {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    if (!normalized) return Number.NaN;
    return Number(normalized);
  };

  useEffect(() => {
    loadAnalytics();
    
    // Auto-refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadAnalytics();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!Array.isArray(data?.missingCostItems)) return;

    setCostDrafts((previous) => {
      const next = { ...previous };
      data.missingCostItems.forEach((item: any) => {
        const baseKey = getCostDraftKey(item);
        if (next[baseKey] == null) {
          next[baseKey] = '';
        }

        const product = productsCatalogById.get(Number(item?.id ?? item?.product_id ?? item?.productId));
        let matrix: Record<string, any> = {};
        try {
          matrix = typeof product?.condition_matrix === 'string'
            ? JSON.parse(product.condition_matrix || '{}')
            : (product?.condition_matrix || {});
        } catch {
          matrix = {};
        }

        Object.keys(matrix || {}).forEach((conditionKey) => {
          const draftKey = getCostDraftKey(item, conditionKey);
          if (next[draftKey] == null) {
            next[draftKey] = '';
          }
        });
      });
      return next;
    });
  }, [data?.missingCostItems, productsCatalogById]);

  const loadAnalytics = async () => {
    try {
      const [result, productsResponse] = await Promise.all([
        appFetch('/api/analytics'),
        appFetch('/api/products?limit=500&offset=0'),
      ]);
      setData(result);
      setProductsCatalog(Array.isArray(productsResponse?.items) ? productsResponse.items : Array.isArray(productsResponse) ? productsResponse : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const deduplicatedMissingCostItems = useMemo(() => {
    if (!Array.isArray(data?.missingCostItems)) {
      return [] as any[];
    }

    const grouped = new Map<string, any>();

    data.missingCostItems.forEach((item: any) => {
      const productId = Number(item?.id ?? item?.product_id ?? item?.productId) || 0;
      const linkedProduct = productId > 0 ? productsCatalogById.get(productId) : null;
      const identityKey = productId > 0
        ? `product:${productId}`
        : String(linkedProduct?.quick_code || item?.quickCode || item?.name || item?.condition || 'missing-cost-item');
      const conditionLabel = formatConditionLabel(item?.condition);

      if (!grouped.has(identityKey)) {
        grouped.set(identityKey, {
          ...item,
          id: productId || item?.id,
          quickCode: linkedProduct?.quick_code || item?.quickCode || null,
          stockUnits: Math.max(0, Number(item?.stockUnits || 0) || 0),
          soldUnits: Math.max(0, Number(item?.soldUnits || 0) || 0),
          missingConditions: [conditionLabel],
        });
        return;
      }

      const current = grouped.get(identityKey);
      current.stockUnits += Math.max(0, Number(item?.stockUnits || 0) || 0);
      current.soldUnits += Math.max(0, Number(item?.soldUnits || 0) || 0);
      current.price = Math.max(Number(current?.price || 0) || 0, Number(item?.price || 0) || 0);
      current.quickCode = current.quickCode || linkedProduct?.quick_code || item?.quickCode || null;
      current.missingConditions = Array.from(new Set([...(current.missingConditions || []), conditionLabel]));
      grouped.set(identityKey, current);
    });

    return Array.from(grouped.values()).sort((a, b) => (
      (Number(b?.soldUnits || 0) || 0) - (Number(a?.soldUnits || 0) || 0)
      || (Number(b?.stockUnits || 0) || 0) - (Number(a?.stockUnits || 0) || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''))
    ));
  }, [data?.missingCostItems, productsCatalogById]);

  const applySavedMissingCostLocally = (item: any, savedCondition: string, savedCost: number) => {
    const productId = Number(item?.id ?? item?.product_id ?? item?.productId) || 0;
    const linkedProduct = productsCatalogById.get(productId);

    let nextMatrix: Record<string, any> = {};
    let hasConditionMatrix = false;
    try {
      nextMatrix = typeof linkedProduct?.condition_matrix === 'string'
        ? JSON.parse(linkedProduct.condition_matrix || '{}')
        : { ...(linkedProduct?.condition_matrix || {}) };
      hasConditionMatrix = Boolean(linkedProduct?.condition_matrix) || Object.keys(nextMatrix || {}).length > 0;
    } catch {
      nextMatrix = {};
      hasConditionMatrix = false;
    }

    if (hasConditionMatrix && savedCondition !== 'standard') {
      const currentSlot = (nextMatrix as any)?.[savedCondition] || {};
      nextMatrix = {
        ...nextMatrix,
        [savedCondition]: {
          ...currentSlot,
          cost: savedCost,
        },
      };
    }

    setProductsCatalog((previous) => previous.map((entry: any) => {
      if (Number(entry?.id) !== productId) {
        return entry;
      }

      if (hasConditionMatrix && savedCondition !== 'standard') {
        return {
          ...entry,
          condition_matrix: typeof entry?.condition_matrix === 'string'
            ? JSON.stringify(nextMatrix)
            : nextMatrix,
        };
      }

      return {
        ...entry,
        cost: savedCost,
      };
    }));

    setData((previous: any) => {
      if (!previous) return previous;

      const allItems = Array.isArray(previous?.missingCostItems) ? previous.missingCostItems : [];
      const relatedItems = allItems.filter((entry: any) => Number(entry?.id ?? entry?.product_id ?? entry?.productId) === productId);
      const unrelatedItems = allItems.filter((entry: any) => Number(entry?.id ?? entry?.product_id ?? entry?.productId) !== productId);
      const remainingItemsByCondition = new Map<string, any>();

      relatedItems.forEach((entry: any) => {
        const normalizedEntryCondition = normalizeConditionKey(entry?.condition);
        if (normalizedEntryCondition !== savedCondition) {
          remainingItemsByCondition.set(normalizedEntryCondition, entry);
        }
      });

      if (hasConditionMatrix) {
        Array.from(new Set(['new', 'used', 'open_box', ...Object.keys(nextMatrix || {})])).forEach((key) => {
          const slot = (nextMatrix as any)?.[key] || {};
          const price = Math.max(0, Number(slot?.price || 0) || 0);
          const cost = Math.max(0, Number(slot?.cost || 0) || 0);

          if (key === savedCondition || price <= 0 || cost > 0 || remainingItemsByCondition.has(key)) {
            return;
          }

          remainingItemsByCondition.set(key, {
            ...item,
            id: productId || item?.id,
            product_id: productId || item?.product_id || item?.id,
            productId: productId || item?.productId || item?.id,
            condition: key,
            price,
            stockUnits: Math.max(0, Number(slot?.stock || 0) || 0),
            soldUnits: 0,
            basePrice: Math.max(0, Number(linkedProduct?.price || item?.basePrice || 0) || 0),
            conditionMatrix: nextMatrix,
            quickCode: linkedProduct?.quick_code || item?.quickCode || null,
          });
        });
      }

      const nextMissingCostItems = [...unrelatedItems, ...Array.from(remainingItemsByCondition.values())];

      return {
        ...previous,
        missingCostItems: nextMissingCostItems,
        missingCostItemCount: nextMissingCostItems.length,
      };
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAnalytics();
  };

  const handleDownloadReport = async () => {
    try {
      const store = await appFetch('/api/store/settings');
      const { generateAnalyticsPDF } = await import('../../lib/pdf');
      const { doc, filename } = await generateAnalyticsPDF(data, store, user);
      doc.save(filename);
    } catch (err: any) {
      console.error('Failed to generate analytics PDF:', err);
      showNotification({ message: `Failed to download report: ${err.message || err}`, type: 'error' });
    }
  };

  const saveMissingCostForItem = async (item: any, overrideDraft?: string | number, overrideCondition?: unknown) => {
    const normalizedCondition = normalizeConditionKey(overrideCondition ?? item?.condition);
    const conditionLabel = formatConditionLabel(normalizedCondition);
    const itemKey = getCostDraftKey(item, normalizedCondition);
    const draftValue = String(overrideDraft ?? costDrafts[itemKey] ?? '').trim();
    const parsedCost = parseCurrencyDraftInput(draftValue);

    if (draftValue === '' || !Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new Error(`Enter a valid cost for ${item.name} (${conditionLabel}).`);
    }

    const productResponse = await appFetch('/api/products?limit=500&offset=0');
    const products = Array.isArray(productResponse?.items) ? productResponse.items : Array.isArray(productResponse) ? productResponse : [];
    const product = productsCatalogById.get(Number(item.id)) || products.find((entry: any) => Number(entry?.id) === Number(item.id));

    if (!product) {
      throw new Error(`Product not found for ${item.name}.`);
    }

    let conditionMatrix: Record<string, any> | null = null;
    try {
      conditionMatrix = typeof product.condition_matrix === 'string'
        ? JSON.parse(product.condition_matrix || '{}')
        : (product.condition_matrix ? { ...product.condition_matrix } : null);
    } catch {
      conditionMatrix = null;
    }

    let nextCost = Number(product.cost || 0) || 0;

    if (conditionMatrix && normalizedCondition !== 'standard') {
      const currentSlot = conditionMatrix[normalizedCondition] || { price: 0, stock: 0, cost: 0 };
      conditionMatrix[normalizedCondition] = {
        ...currentSlot,
        cost: parsedCost,
      };
    } else {
      nextCost = parsedCost;
    }

    await appFetch(`/api/products/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: product.name,
        barcode: product.barcode || null,
        category: product.category,
        category_id: product.category_id || null,
        thumbnail: product.thumbnail || null,
        specs: product.specs || {},
        condition_matrix: conditionMatrix,
        price: Number(product.price || 0) || 0,
        stock: Number(product.stock || 0) || 0,
        cost: nextCost,
      }),
    });

    return { itemKey, normalizedCondition, parsedCost };
  };

  const handleSaveMissingCost = async (item: any, overrideCondition?: unknown) => {
    const itemKey = getCostDraftKey(item, overrideCondition ?? item?.condition);
    const conditionLabel = formatConditionLabel(overrideCondition ?? item?.condition);
    setSavingCostKey(itemKey);
    try {
      const result = await saveMissingCostForItem(item, undefined, overrideCondition);
      showNotification({ message: `Buying cost for ${item.name} (${conditionLabel}) updated successfully.`, type: 'success', presentation: 'toast', duration: 1800 });
      setCostDrafts((previous) => ({ ...previous, [itemKey]: '' }));
      applySavedMissingCostLocally(item, result.normalizedCondition, result.parsedCost);
    } catch (err: any) {
      console.error('Failed to update missing cost:', err);
      showNotification({ message: `Failed to update missing cost: ${err?.message || err}`, type: 'error' });
    } finally {
      setSavingCostKey(null);
    }
  };

  const handleSaveAllMissingCosts = async () => {
    const visibleItems = deduplicatedMissingCostItems.slice(0, 6);
    const saveTargetMap = new Map<string, { item: any; condition: string }>();

    visibleItems.forEach((item: any) => {
      const matrixEntries = getProductConditionMatrixEntries(item);
      if (matrixEntries.length > 0) {
        matrixEntries.forEach((entry) => {
          const draftKey = getCostDraftKey(item, entry.key);
          if (String(costDrafts[draftKey] ?? '').trim() !== '') {
            saveTargetMap.set(draftKey, { item, condition: entry.key });
          }
        });
        return;
      }

      const draftKey = getCostDraftKey(item);
      if (String(costDrafts[draftKey] ?? '').trim() !== '') {
        saveTargetMap.set(draftKey, { item, condition: String(item?.condition || 'STANDARD') });
      }
    });

    const itemsToSave = Array.from(saveTargetMap.values());

    if (!itemsToSave.length) {
      showNotification({ message: 'Enter at least one missing cost before using Save All.', type: 'warning' });
      return;
    }

    setSavingAllMissingCosts(true);
    try {
      for (const target of itemsToSave) {
        await saveMissingCostForItem(target.item, undefined, target.condition);
      }

      setCostDrafts((previous) => {
        const next = { ...previous };
        itemsToSave.forEach(({ item, condition }) => {
          next[getCostDraftKey(item, condition)] = '';
        });
        return next;
      });

      showNotification({ message: `${itemsToSave.length} condition cost entr${itemsToSave.length === 1 ? 'y' : 'ies'} saved successfully.`, type: 'success', presentation: 'toast', duration: 2000 });
      await loadAnalytics();
    } catch (err: any) {
      console.error('Failed to bulk-save missing costs:', err);
      showNotification({ message: `Failed to save all missing costs: ${err?.message || err}`, type: 'error' });
    } finally {
      setSavingAllMissingCosts(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  const paymentSplitData = Array.isArray(data?.paymentSplit)
    ? data.paymentSplit.map((entry: any) => ({
        label: String(entry?.name || entry?.method || 'Unknown'),
        value: Number(entry?.value) || 0,
      }))
    : [];

  const salesTrendData = Array.isArray(data?.salesTrend)
    ? data.salesTrend.map((entry: any) => ({
        label: String(entry?.date || '—'),
        value: Number(entry?.total) || 0,
      }))
    : [];

  const categoryTrendData = Array.isArray(data?.categoryTrend)
    ? data.categoryTrend.map((entry: any) => ({
        label: String(entry?.category || 'Uncategorized'),
        value: Number(entry?.quantity) || 0,
      }))
    : [];

  const topSellingProducts = Array.isArray(data?.topSellingProducts) ? data.topSellingProducts : [];
  const restockSuggestions = Array.isArray(data?.restockSuggestions) ? data.restockSuggestions : [];
  const canUpdateMissingCosts = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN';

  const getProductConditionPriceBadges = (item: any) => {
    const product = productsCatalogById.get(Number(item?.id ?? item?.product_id ?? item?.productId));

    let matrix: Record<string, any> = {};
    try {
      matrix = typeof product?.condition_matrix === 'string'
        ? JSON.parse(product.condition_matrix || '{}')
        : (product?.condition_matrix || {});
    } catch {
      matrix = {};
    }

    const badgeColors: Record<string, string> = {
      new: 'border-emerald-200 bg-emerald-900/20 text-emerald-400',
      used: 'border-blue-200 bg-blue-900/20 text-blue-400',
      open_box: 'border-purple-200 bg-purple-900/20 text-purple-700',
    };

    return Array.from(new Set(['new', 'used', 'open_box', ...Object.keys(matrix || {})]))
      .map((key) => {
        const price = Math.max(0, Number((matrix as any)?.[key]?.price || 0) || 0);
        if (price <= 0) return null;
        return {
          key,
          label: key.replace(/_/g, ' ').toUpperCase(),
          value: formatCurrency(price),
          className: badgeColors[key] || 'border-slate-200 bg-slate-50 text-slate-300',
        };
      })
      .filter(Boolean) as Array<{ key: string; label: string; value: string; className: string }>;
  };

  const getProductConditionPricesLabel = (item: any) => {
    if (typeof item?.conditionPricesLabel === 'string' && item.conditionPricesLabel.trim()) {
      return item.conditionPricesLabel;
    }

    return getProductConditionPriceBadges(item)
      .map((entry) => `${entry.label} ${entry.value}`)
      .join(' • ');
  };

  const getMissingConditionBadges = (item: any) => {
    const missingConditions = Array.isArray(item?.missingConditions) && item.missingConditions.length > 0
      ? item.missingConditions
      : [formatConditionLabel(item?.condition)];

    const badgeColors: Record<string, string> = {
      NEW: 'border-emerald-200 bg-emerald-900/20 text-emerald-400',
      USED: 'border-blue-200 bg-blue-900/20 text-blue-400',
      'OPEN BOX': 'border-purple-200 bg-purple-900/20 text-purple-700',
      STANDARD: 'border-slate-200 bg-slate-100 text-slate-300',
    };

    return missingConditions.map((label: string) => ({
      label,
      className: badgeColors[label] || 'border-amber-200 bg-amber-900/20 text-amber-400',
    }));
  };

  const getProductConditionMatrixEntries = (item: any) => {
    const product = productsCatalogById.get(Number(item?.id ?? item?.product_id ?? item?.productId));

    let matrix: Record<string, any> = {};
    try {
      matrix = typeof product?.condition_matrix === 'string'
        ? JSON.parse(product.condition_matrix || '{}')
        : (product?.condition_matrix || {});
    } catch {
      matrix = {};
    }

    const hasConditionMatrix = Boolean(product?.condition_matrix) || Object.keys(matrix || {}).length > 0;
    if (!hasConditionMatrix) {
      return [] as Array<{
        key: string;
        label: string;
        sellingLabel: string;
        costLabel: string;
        stock: number;
        isActive: boolean;
        isMissingCost: boolean;
        containerClass: string;
        textClass: string;
        draftKey: string;
        draftValue: string;
      }>;
    }

    const activeConditionKey = normalizeConditionKey(item?.condition || 'STANDARD');
    const missingConditionKeys = new Set(
      (Array.isArray(item?.missingConditions) && item.missingConditions.length > 0
        ? item.missingConditions
        : [formatConditionLabel(item?.condition)])
        .map((label: string) => normalizeConditionKey(label)),
    );
    const containerColors: Record<string, string> = {
      new: 'border-emerald-200 bg-emerald-900/20/80',
      used: 'border-blue-200 bg-blue-900/20/80',
      open_box: 'border-purple-200 bg-purple-900/20/80',
    };
    const textColors: Record<string, string> = {
      new: 'text-emerald-400',
      used: 'text-blue-400',
      open_box: 'text-purple-700',
    };

    return Array.from(new Set(['new', 'used', 'open_box', ...Object.keys(matrix || {})]))
      .map((key) => {
        const slot = (matrix as any)?.[key] || {};
        const price = Math.max(0, Number(slot?.price || 0) || 0);
        const cost = Math.max(0, Number(slot?.cost || 0) || 0);
        const stock = Math.max(0, Number(slot?.stock || 0) || 0);
        const isMissingCost = cost <= 0 || missingConditionKeys.has(key);

        if (price <= 0 || !isMissingCost) {
          return null;
        }

        const isActive = key === activeConditionKey;
        const draftKey = getCostDraftKey(item, key);

        return {
          key,
          label: key.replace(/_/g, ' ').toUpperCase(),
          sellingLabel: formatCurrency(price),
          costLabel: cost > 0 ? formatCurrency(cost) : 'Missing cost',
          stock,
          isActive,
          isMissingCost,
          containerClass: `${containerColors[key] || 'border-slate-200 bg-slate-50'} ${isActive ? 'ring-2 ring-amber-300' : ''}`,
          textClass: textColors[key] || 'text-slate-300',
          draftKey,
          draftValue: costDrafts[draftKey] ?? '',
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        label: string;
        sellingLabel: string;
        costLabel: string;
        stock: number;
        isActive: boolean;
        isMissingCost: boolean;
        containerClass: string;
        textClass: string;
        draftKey: string;
        draftValue: string;
      }>;
  };

  const getMissingCostSellingPriceLabel = (item: any) => {
    if (typeof item?.priceLabel === 'string' && item.priceLabel.trim()) {
      return item.priceLabel;
    }

    const directPrice = Math.max(0, Number(item?.price || 0) || 0);
    if (directPrice > 0) {
      return formatCurrency(directPrice);
    }

    const product = productsCatalogById.get(Number(item?.id ?? item?.product_id ?? item?.productId));
    if (!product) return 'Not set yet';

    let matrix: Record<string, any> = {};
    try {
      matrix = typeof product?.condition_matrix === 'string'
        ? JSON.parse(product.condition_matrix || '{}')
        : (product?.condition_matrix || {});
    } catch {
      matrix = {};
    }

    const normalizedCondition = String(item?.condition || 'STANDARD').trim().toLowerCase().replace(/\s+/g, '_');
    const exactConditionPrice = Math.max(0, Number(matrix?.[normalizedCondition]?.price || 0) || 0);
    if (exactConditionPrice > 0) {
      return formatCurrency(exactConditionPrice);
    }

    const allConditionPrices = getProductConditionPricesLabel(item);
    if (allConditionPrices) {
      return allConditionPrices;
    }

    const basePrice = Math.max(0, Number(product?.price || 0) || 0);
    return basePrice > 0 ? formatCurrency(basePrice) : 'Not set yet';
  };

  const visibleMissingCostItems = deduplicatedMissingCostItems.slice(0, 6);

  // Inventory Health Score (0–100)
  const totalItems = data?.totalItems || 0;
  const missingCount = data?.missingCostItemCount || 0;
  const agingPct = data?.imeiAgingPercentage || 0;
  const hsCostCoverage = totalItems > 0 ? Math.max(0, 34 * (1 - missingCount / totalItems)) : (missingCount === 0 ? 34 : 0);
  const hsAging = Math.round(((100 - Math.min(agingPct, 100)) / 100) * 33);
  const hsStock = totalItems > 0 ? 33 : 0;
  const healthScore = Math.min(100, Math.round(hsCostCoverage + hsAging + hsStock));
  const healthGrade = healthScore >= 90 ? 'A' : healthScore >= 75 ? 'B' : healthScore >= 55 ? 'C' : 'D';
  const healthGradeColor = healthScore >= 90 ? 'text-emerald-600' : healthScore >= 75 ? 'text-blue-600' : healthScore >= 55 ? 'text-amber-600' : 'text-rose-600';
  const healthArcColor = healthScore >= 90 ? '#10b981' : healthScore >= 75 ? '#3b82f6' : healthScore >= 55 ? '#f59e0b' : '#f43f5e';
  const gaugeR = 38;
  const gaugeCirc = 2 * Math.PI * gaugeR;
  const gaugeArc = gaugeCirc * 0.75;
  const gaugeFill = gaugeArc * (healthScore / 100);

  // Margin bar
  const totalCost = data?.totalCost || 0;
  const potentialRevenue = data?.potentialRevenue || 0;
  const netProfit = data?.netProfit || data?.grossProfit || 0;
  const expensesTotal = data?.expensesTotal || 0;
  const costPct = potentialRevenue > 0 ? Math.min(100, (totalCost / potentialRevenue) * 100) : 0;
  const profitPct = potentialRevenue > 0 ? Math.min(100 - costPct, (netProfit / potentialRevenue) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl overflow-x-hidden space-y-6 sm:space-y-8 print:m-0 print:w-full print:p-0">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 shadow-xl">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-red-500 opacity-10" />
        <div className="pointer-events-none absolute -bottom-10 left-1/3 h-40 w-40 rounded-full bg-blue-900/200 opacity-10" />

        <div className="relative">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-red-400" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">Real-Time Analytics</span>
              </div>
              <h1 className="mt-1 text-2xl font-black text-white">Inventory wealth, sales margin &amp; profit tracking</h1>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-50"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh Data
              </button>
              <button
                onClick={handleDownloadReport}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-600"
              >
                <Download size={14} /> Download Report
              </button>
            </div>
          </div>

          {(user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN' || user?.role === 'ACCOUNTANT') && (
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total Stock</p>
                <p className="mt-1 text-2xl font-black text-white">{data?.totalItems || 0}</p>
                <p className="text-[10px] text-slate-500">items tracked</p>
              </div>
              <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Inventory Cost</p>
                <p className="mt-1 text-xl font-black text-white">{formatCurrency(data?.totalCost || 0)}</p>
                <p className="text-[10px] text-slate-500">capital tied up</p>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/200/20 p-4 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Potential Revenue</p>
                <p className="mt-1 text-xl font-black text-white">{formatCurrency(data?.potentialRevenue || 0)}</p>
                <p className="text-[10px] text-emerald-400">if all stock sells</p>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-900/200/20 p-4 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">Out on Collection</p>
                <p className="mt-1 text-2xl font-black text-white">{data?.outOnCollectionCount || 0}</p>
                <p className="text-[10px] text-amber-400">{formatCurrency(data?.outOnCollectionValue || 0)} value</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="space-y-8">

        {/* 2. Role-Based Analytics */}
        {(user?.role === 'STORE_ADMIN' || user?.role === 'ACCOUNTANT') && (
          <section>
            <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-400">Owner Insights</h3>

            {/* Profit margin bar */}
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-slate-500" />
                  <span className="text-sm font-bold text-slate-300">Profit Margin on Inventory</span>
                </div>
                <span className={`text-sm font-black ${profitPct > 30 ? 'text-emerald-600' : profitPct > 10 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {potentialRevenue > 0 ? profitPct.toFixed(1) : '0.0'}% margin
                </span>
              </div>
              <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-slate-400 transition-all duration-700" style={{ width: `${costPct}%` }} />
                <div className="h-full bg-emerald-900/200 transition-all duration-700" style={{ width: `${profitPct}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Cost {formatCurrency(totalCost)}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-900/200" />Profit {formatCurrency(netProfit)}</span>
                {expensesTotal > 0 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />Expenses {formatCurrency(expensesTotal)}</span>}
                {potentialRevenue > 0 && <span className="flex items-center gap-1.5 text-slate-400">Selling {formatCurrency(potentialRevenue)}</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="flex flex-col justify-center rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 dark:border-emerald-500/40 dark:bg-slate-800/95">
                <span className="mb-2 block text-sm font-black text-emerald-800 dark:text-emerald-300">Net Profit</span>
                <p className="text-[3rem] font-black leading-none text-emerald-900 dark:text-emerald-400">{formatCurrency(netProfit)}</p>
                <p className="mt-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">(Selling − Cost) × Qty sold</p>
              </div>

              <div className="flex flex-col justify-center rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-6 dark:border-rose-500/40 dark:bg-slate-800/95">
                <span className="mb-2 block text-sm font-black text-rose-800 dark:text-rose-300">Operating Expenses</span>
                <p className="text-[3rem] font-black leading-none text-rose-900 dark:text-rose-400">{formatCurrency(expensesTotal)}</p>
              </div>

              <div className="flex flex-col justify-center rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-6 dark:border-blue-500/40 dark:bg-slate-800/95">
                <span className="mb-2 block text-sm font-black text-blue-800 dark:text-blue-300">Net After Expenses</span>
                <p className="text-[3rem] font-black leading-none text-blue-900 dark:text-blue-400">{formatCurrency(data?.netProfitAfterExpenses || 0)}</p>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <div className="rounded-lg bg-purple-900/20 p-2 text-purple-600"><Award size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">Yearly Reward Tracker</span>
                </div>
                <div className="space-y-3">
                  {data?.topCustomers?.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="flex-1 truncate text-slate-600">{i + 1}. {c.name}</span>
                      <span className="font-bold text-slate-900">{formatCurrency(c.total_spend)}</span>
                    </div>
                  ))}
                  {(!data?.topCustomers || data.topCustomers.length === 0) && (
                    <p className="text-sm text-slate-400">No customer data yet.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col justify-center rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-lg bg-orange-50 p-2 text-orange-600"><AlertTriangle size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">IMEI Aging (&gt;60 days)</span>
                </div>
                <p className="mt-2 text-4xl font-black text-slate-900">{agingPct}%</p>
                <p className="mt-1 text-sm text-slate-500">of stock is aging</p>
              </div>

              {/* Inventory Health Score */}
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 self-start">
                  <div className="rounded-lg bg-sky-50 p-2 text-sky-600"><Activity size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">Inventory Health Score</span>
                </div>
                <div className="relative flex items-center justify-center">
                  <svg width="100" height="80" viewBox="0 0 100 80">
                    {/* track */}
                    <circle
                      cx="50" cy="55" r={gaugeR}
                      fill="none" stroke="#e2e8f0" strokeWidth="8"
                      strokeDasharray={`${gaugeArc} ${gaugeCirc}`}
                      strokeDashoffset={gaugeCirc * 0.125}
                      strokeLinecap="round"
                      transform="rotate(180 50 55)"
                    />
                    {/* fill */}
                    <circle
                      cx="50" cy="55" r={gaugeR}
                      fill="none" stroke={healthArcColor} strokeWidth="8"
                      strokeDasharray={`${gaugeFill} ${gaugeCirc}`}
                      strokeDashoffset={gaugeCirc * 0.125}
                      strokeLinecap="round"
                      transform="rotate(180 50 55)"
                      style={{ transition: 'stroke-dasharray 1s ease' }}
                    />
                  </svg>
                  <div className="absolute bottom-0 flex flex-col items-center">
                    <span className={`text-3xl font-black leading-none ${healthGradeColor}`}>{healthGrade}</span>
                    <span className="text-xs font-bold text-slate-400">{healthScore}/100</span>
                  </div>
                </div>
                <div className="w-full space-y-1 text-[10px] font-semibold text-slate-500">
                  <div className="flex items-center justify-between">
                    <span>Cost coverage</span>
                    <span className={missingCount === 0 ? 'text-emerald-600' : 'text-amber-600'}>{missingCount === 0 ? 'Complete' : `${missingCount} missing`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Stock aging</span>
                    <span className={agingPct <= 10 ? 'text-emerald-600' : agingPct <= 30 ? 'text-amber-600' : 'text-rose-600'}>{agingPct}% aging</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Items tracked</span>
                    <span className={totalItems > 0 ? 'text-emerald-600' : 'text-slate-400'}>{totalItems} items</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {(user?.role === 'STORE_ADMIN' || user?.role === 'ACCOUNTANT') && (
          <section>
            <div className={`rounded-2xl border p-5 ${data?.missingCostItemCount && !data?.costFallbackEnabled ? 'border-amber-200 bg-amber-900/20' : data?.costFallbackEnabled ? 'border-blue-200 bg-blue-900/20' : 'border-emerald-700/30 bg-emerald-900/20'}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2 ${data?.missingCostItemCount && !data?.costFallbackEnabled ? 'bg-amber-100 text-amber-400' : data?.costFallbackEnabled ? 'bg-blue-100 text-blue-400' : 'bg-emerald-100 text-emerald-400'}`}>
                  <ShieldAlert size={18} />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className={`text-base font-black ${data?.missingCostItemCount && !data?.costFallbackEnabled ? 'text-amber-300' : data?.costFallbackEnabled ? 'text-blue-300' : 'text-emerald-300'}`}>
                      {data?.missingCostItemCount && !data?.costFallbackEnabled ? '⚠️ Missing Cost Data' : data?.costFallbackEnabled ? 'Cost Defaulting is Active' : 'Cost Tracking is Complete'}
                    </p>
                    <p className={`mt-1 text-sm ${data?.missingCostItemCount && !data?.costFallbackEnabled ? 'text-amber-300' : data?.costFallbackEnabled ? 'text-blue-300' : 'text-emerald-300'}`}>
                      {data?.missingCostItemCount && !data?.costFallbackEnabled
                        ? `${data.missingCostItemCount} product condition(s) are missing cost prices and are excluded from profit totals until updated.`
                        : data?.costFallbackEnabled
                          ? `${data?.defaultedCostItemCount || 0} sold line item(s) are defaulting to selling price, so their profit contribution is ${formatCurrency(0)} until real cost is entered.`
                          : 'All products contributing to analytics currently have usable cost data.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-white/80 px-3 py-1 text-slate-300 border border-slate-200">Tracked sales: {data?.trackedProfitItems || 0}</span>
                    <span className="rounded-full bg-white/80 px-3 py-1 text-slate-300 border border-slate-200">Excluded lines: {data?.excludedProfitItemsCount || 0}</span>
                  </div>

                  {Array.isArray(data?.missingCostItems) && data.missingCostItems.length > 0 && !data?.costFallbackEnabled && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-amber-400">Quick cost update queue</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-amber-300">Two-row view stays filled as each missing cost is saved.</span>
                          {canUpdateMissingCosts && (
                            <>
                              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-2 py-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={sameCostDraft}
                                  onChange={(e) => setSameCostDraft(formatCurrencyDraftInput(e.target.value))}
                                  placeholder={`Same cost (${inputCurrencySymbol})`}
                                  className="w-32 bg-transparent text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parsed = parseCurrencyDraftInput(sameCostDraft);
                                    if (sameCostDraft.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
                                      showNotification({ message: 'Enter a valid shared cost before applying it to all visible items.', type: 'warning' });
                                      return;
                                    }
                                    const formattedSharedCost = formatCurrencyDraftInput(sameCostDraft);
                                    const visibleItems = deduplicatedMissingCostItems.slice(0, 6);
                                    setCostDrafts((previous) => {
                                      const next = { ...previous };
                                      visibleItems.forEach((item: any) => {
                                        const matrixEntries = getProductConditionMatrixEntries(item);
                                        if (matrixEntries.length > 0) {
                                          matrixEntries.forEach((entry) => {
                                            next[getCostDraftKey(item, entry.key)] = formattedSharedCost;
                                          });
                                          return;
                                        }

                                        next[getCostDraftKey(item)] = formattedSharedCost;
                                      });
                                      return next;
                                    });
                                  }}
                                  className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-200"
                                >
                                  Apply same cost to all visible conditions
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={handleSaveAllMissingCosts}
                                disabled={savingAllMissingCosts}
                                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingAllMissingCosts ? <Loader2 size={12} className="animate-spin" /> : null}
                                {savingAllMissingCosts ? 'Saving All...' : 'Save All Missing Costs'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="grid auto-rows-fr gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {visibleMissingCostItems.map((item: any) => {
                            const itemKey = getCostDraftKey(item);
                            const cardKey = `product-${Number(item?.id ?? item?.product_id ?? item?.productId) || String(item?.quickCode || item?.name)}`;
                            const isSaving = savingCostKey === itemKey;
                            const sellingPriceLabel = getMissingCostSellingPriceLabel(item);
                            const allConditionPricesLabel = getProductConditionPricesLabel(item);
                            const conditionPriceBadges = getProductConditionPriceBadges(item);
                            const conditionMatrixEntries = getProductConditionMatrixEntries(item);
                            const missingConditionBadges = getMissingConditionBadges(item);
                            const linkedProduct = productsCatalogById.get(Number(item?.id ?? item?.product_id ?? item?.productId));

                            return (
                              <div key={cardKey} className="flex h-full flex-col justify-between rounded-xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-300">
                                <div>
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <p className="font-bold text-slate-900">{item.name}</p>
                                    {((item as any)?.quickCode || linkedProduct?.quick_code) && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const quickCode = String((item as any)?.quickCode || linkedProduct?.quick_code);
                                          try {
                                            await navigator.clipboard.writeText(quickCode);
                                            showNotification({ message: `Quick code ${quickCode} copied.`, type: 'success', presentation: 'toast', duration: 1400 });
                                          } catch {
                                            showNotification({ message: 'Failed to copy quick code.', type: 'error' });
                                          }
                                        }}
                                        className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-colors hover:bg-slate-200"
                                        title={`Copy quick code ${String((item as any)?.quickCode || linkedProduct?.quick_code)}`}
                                      >
                                        Copy Code: {String((item as any)?.quickCode || linkedProduct?.quick_code)}
                                      </button>
                                    )}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Missing cost in:</span>
                                    {missingConditionBadges.map((badge) => (
                                      <span
                                        key={`${cardKey}-missing-${badge.label}`}
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${badge.className}`}
                                      >
                                        {badge.label}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">In stock: {item.stockUnits || 0} • Sold: {item.soldUnits || 0}</p>
                                  <p className="mt-1 text-xs font-semibold text-slate-600">This {String(item.condition || 'item').toLowerCase()} price: {sellingPriceLabel}</p>
                                  {conditionPriceBadges.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {conditionPriceBadges.map((badge) => (
                                        <span
                                          key={`${itemKey}-${badge.key}`}
                                          className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${badge.className}`}
                                        >
                                          {badge.label}: {badge.value}
                                        </span>
                                      ))}
                                    </div>
                                  ) : allConditionPricesLabel && allConditionPricesLabel !== sellingPriceLabel ? (
                                    <p className="mt-1 text-[11px] text-slate-500">All condition prices: {allConditionPricesLabel}</p>
                                  ) : null}

                                  {conditionMatrixEntries.length > 0 && (
                                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2">
                                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Condition cost matrix</p>
                                      <div className="mt-2 space-y-1.5">
                                        {conditionMatrixEntries.map((entry) => {
                                          const isEntrySaving = savingCostKey === entry.draftKey;
                                          return (
                                            <div
                                              key={`${itemKey}-matrix-${entry.key}`}
                                              className={`rounded-lg border px-2.5 py-2 ${entry.containerClass}`}
                                            >
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className={`text-[10px] font-black tracking-wide ${entry.textClass}`}>
                                                  {entry.label}{entry.isActive ? ' • editing now' : ''}
                                                </span>
                                                <span className="text-[10px] font-bold text-slate-600">Stock: {entry.stock}</span>
                                              </div>
                                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                                <span className="font-semibold text-slate-600">Sell: {entry.sellingLabel}</span>
                                                <span className={`font-semibold ${entry.isMissingCost ? 'text-rose-600' : 'text-slate-300'}`}>
                                                  Cost: {entry.costLabel}
                                                </span>
                                              </div>
                                              {canUpdateMissingCosts && (
                                                <div className="mt-2 space-y-1.5">
                                                  <div className="flex items-center gap-2">
                                                    <input
                                                      type="text"
                                                      inputMode="decimal"
                                                      value={entry.draftValue}
                                                      onChange={(e) => setCostDrafts((previous) => ({ ...previous, [entry.draftKey]: formatCurrencyDraftInput(e.target.value) }))}
                                                      onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                          e.preventDefault();
                                                          void handleSaveMissingCost(item, entry.key);
                                                        }
                                                      }}
                                                      placeholder={`Set ${entry.label.toLowerCase()} buying cost (${inputCurrencySymbol})`}
                                                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-amber-400"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={() => handleSaveMissingCost(item, entry.key)}
                                                      disabled={isEntrySaving || savingAllMissingCosts || entry.draftValue.trim() === ''}
                                                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                      {isEntrySaving ? <Loader2 size={12} className="animate-spin" /> : null}
                                                      {isEntrySaving ? 'Saving...' : 'Save'}
                                                    </button>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div className="mt-3 space-y-2">
                                  {canUpdateMissingCosts ? (
                                    conditionMatrixEntries.length > 0 ? (
                                      <p className="text-[11px] text-slate-500">Only the remaining missing conditions stay here. `New`, `Used`, and `Open Box` are saved separately.</p>
                                    ) : (
                                      <>
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              inputMode="decimal"
                                              value={costDrafts[itemKey] ?? ''}
                                              onChange={(e) => setCostDrafts((previous) => ({ ...previous, [itemKey]: formatCurrencyDraftInput(e.target.value) }))}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  void handleSaveMissingCost(item);
                                                }
                                              }}
                                              placeholder={`Add ${String(item.condition || 'item').toLowerCase()} buying cost (${inputCurrencySymbol})`}
                                              className="w-full rounded-lg border border-amber-200 bg-amber-900/20 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-amber-400"
                                            />
                                          </div>
                                        </div>
                                        <p className="text-[11px] text-slate-500">This saves the buying cost for the selected <span className="font-bold uppercase tracking-wide">{item.condition}</span> condition only.</p>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveMissingCost(item)}
                                          disabled={isSaving || savingAllMissingCosts || (costDrafts[itemKey] ?? '') === ''}
                                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                                          {isSaving ? 'Saving Cost...' : 'Save Missing Cost'}
                                        </button>
                                      </>
                                    )
                                  ) : (
                                    <Link
                                      to="/inventory"
                                      className="inline-flex w-full items-center justify-center rounded-lg border border-amber-200 bg-amber-900/20 px-3 py-2 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-100"
                                    >
                                      View in Inventory
                                    </Link>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {user?.role === 'MANAGER' && (
          <section>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Manager Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 bg-blue-900/20 rounded-lg text-blue-600"><Target size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">Daily Sales Target</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 mb-2">
                  <div className="bg-blue-600 h-3 rounded-full" style={{ width: `${Math.min(100, (data?.todaySales / (data?.dailyTarget || 100000)) * 100)}%` }}></div>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span className="font-bold text-slate-900">{formatCurrency(data?.todaySales || 0)}</span>
                  <span>Goal: {formatCurrency(data?.dailyTarget || 100000)}</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 bg-red-50 rounded-lg text-red-600"><AlertTriangle size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">Low Stock Alerts (&lt;3 units)</span>
                </div>
                <div className="space-y-3 max-h-40 overflow-y-auto">
                  {data?.lowStockItems?.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-center text-sm">
                      <span className="text-slate-600 truncate flex-1">{item.name}</span>
                      <span className="font-bold text-red-500 bg-red-50 px-2 py-1 rounded">{item.stock} left</span>
                    </div>
                  ))}
                  {(!data?.lowStockItems || data.lowStockItems.length === 0) && (
                    <p className="text-sm text-slate-400">No low stock items.</p>
                  )}
                </div>
              </div>

              <div className="bg-amber-900/20 p-6 rounded-2xl border border-amber-700/30 flex flex-col justify-center">
                <span className="text-sm font-bold text-amber-400 block mb-2">Open Receivables</span>
                <p className="text-4xl font-black text-amber-300">{formatCurrency(data?.pendingReceivables || 0)}</p>
                <p className="text-sm text-amber-400 mt-1">{data?.pendingReceivableCount || 0} pending customer balance(s).</p>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 bg-indigo-900/20 rounded-lg text-indigo-600"><PieChartIcon size={18} /></div>
                  <span className="text-sm font-bold text-slate-300">Payment Split</span>
                </div>
                <PaymentSplitChart data={paymentSplitData} />
              </div>
            </div>
          </section>
        )}

        {(user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER') && (
          <section>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Market Collection Alert</h3>
            <div className={`rounded-2xl border p-5 ${data?.overdueCollections?.length ? 'border-rose-200 bg-rose-900/20' : 'border-emerald-700/30 bg-emerald-900/20'}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2 ${data?.overdueCollections?.length ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  <AlertTriangle size={18} />
                </div>
                <div className="flex-1">
                  <p className={`text-base font-black ${data?.overdueCollections?.length ? 'text-rose-300' : 'text-emerald-300'}`}>
                    {data?.overdueCollections?.length ? 'Overdue collector follow-up needed' : 'All market collections are within date'}
                  </p>
                  <p className={`mt-1 text-sm ${data?.overdueCollections?.length ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {data?.overdueCollections?.length
                      ? `${data.overdueCollections.length} collection entr${data.overdueCollections.length === 1 ? 'y is' : 'ies are'} already past the expected return date.`
                      : 'No red flags on market collections right now.'}
                  </p>

                  {data?.overdueCollections?.length ? (
                    <div className="mt-4 space-y-2">
                      {data.overdueCollections.map((entry: any) => (
                        <div key={entry.id || entry.tracking_code} className="flex flex-col gap-1 rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-bold text-slate-900">{entry.collector_name} <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-rose-400">Ref {entry.tracking_code}</span></p>
                            <p className="text-xs text-rose-400">Due {entry.expected_return_date} · {entry.total_quantity || 0} item(s)</p>
                          </div>
                          <span className="font-black text-rose-400">{formatCurrency(entry.total_value || 0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 3. Visual Charts */}
        <section>
          <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-400">Trends</h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-2">
                <div className="rounded-lg bg-red-50 p-2 text-red-500"><BarChart2 size={18} /></div>
                <span className="text-base font-bold text-slate-900">Sales (Last 7 Days)</span>
              </div>
              <SalesTrendChart data={salesTrendData} />
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-2">
                <div className="rounded-lg bg-blue-900/20 p-2 text-blue-600"><TrendingUp size={18} /></div>
                <span className="text-base font-bold text-slate-900">Fastest Moving Categories</span>
              </div>
              <CategoryBars data={categoryTrendData} />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Smart Inventory Signals</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-emerald-900/20 rounded-lg text-emerald-600"><TrendingUp size={18} /></div>
                <span className="text-sm font-bold text-slate-300">Top-Selling Products</span>
              </div>
              <div className="space-y-3">
                {topSellingProducts.length ? topSellingProducts.map((item: any, index: number) => (
                  <div key={item.id || index} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.category || 'General'} · {item.quantity || 0} sold</p>
                    </div>
                    <span className="font-bold text-slate-900">{formatCurrency(item.revenue || 0)}</span>
                  </div>
                )) : <p className="text-sm text-slate-400">No hot sellers yet.</p>}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-amber-900/20 rounded-lg text-amber-600"><AlertTriangle size={18} /></div>
                <span className="text-sm font-bold text-slate-300">Restock Suggestions</span>
              </div>
              <div className="space-y-3">
                {restockSuggestions.length ? restockSuggestions.map((item: any, index: number) => (
                  <div key={item.id || index} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-bold text-slate-900">{item.name}</p>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-400">Restock {item.suggestedReorder || 1}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Stock {item.stock || 0} · Avg/day {item.avgDailySales || 0} · Days left {item.daysLeft ?? '—'}</p>
                  </div>
                )) : <p className="text-sm text-slate-400">No urgent restocks right now.</p>}
              </div>
            </div>
          </div>
        </section>

        {/* 4. Audit Vault Integration */}
        {(user?.role === 'STORE_ADMIN' || user?.role === 'ACCOUNTANT') && (
          <div className="pt-4 no-print">
            <Link to="/audit" className="flex items-center justify-between p-6 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/20 rounded-xl">
                  <ShieldAlert size={24} className="text-red-400" />
                </div>
                <div>
                  <p className="font-bold text-lg">Audit Vault</p>
                  <p className="text-sm text-slate-400">Track all price changes and stock adjustments</p>
                </div>
              </div>
              <ChevronRight size={24} className="text-slate-400" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;
