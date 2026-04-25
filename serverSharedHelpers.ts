export const normalizePhone = (value: unknown): string => String(value ?? '').replace(/\D/g, '');
export const normalizeProductBarcode = (value: unknown): string => String(value ?? '').trim();

export const safeJsonParse = (value: any, fallback: any) => {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const normalizeStoreDiscountCodes = (value: unknown) => {
  const parsed = safeJsonParse(value, []);
  const list = Array.isArray(parsed) ? parsed : [];
  const seenCodes = new Set<string>();

  return list.reduce((acc: any[], entry: any, index: number) => {
    const name = String(entry?.name || '').trim().slice(0, 80);
    const code = String(entry?.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const type = String(entry?.type || '').toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const rawValue = Math.max(0, Number(entry?.value) || 0);
    const normalizedValue = type === 'PERCENTAGE'
      ? Number(Math.min(100, rawValue).toFixed(2))
      : Number(rawValue.toFixed(2));
    const rawExpiry = String(entry?.expires_at ?? entry?.expiresAt ?? '').trim();
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
      active: entry?.active !== false,
    });
    return acc;
  }, []);
};

export const normalizeStaffAnnouncement = (value: any) => {
  const text = String(value?.staff_announcement_text ?? value?.text ?? '').trim().slice(0, 240);
  return {
    text,
    active: Boolean(text) && value?.staff_announcement_active !== 0 && value?.active !== false,
    updated_at: value?.staff_announcement_updated_at ? String(value.staff_announcement_updated_at) : null,
  };
};

export const normalizeStoreSignatureImage = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length > 8_000_000) return null;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw) ? raw : null;
};

export const normalizeHandoverPriority = (value: unknown) => String(value || '').toUpperCase() === 'IMPORTANT' ? 'IMPORTANT' : 'INFO';

export const normalizeRecountStatus = (value: unknown) => {
  const normalized = String(value || '').toUpperCase();
  return ['PENDING', 'APPROVED', 'REJECTED'].includes(normalized) ? normalized : 'NOT_REQUIRED';
};

export const formatHandoverNoteRecord = (note: any, currentUser?: any) => ({
  ...note,
  note_text: String(note?.note_text || ''),
  priority: normalizeHandoverPriority(note?.priority),
  is_pinned: Number(note?.is_pinned || 0) === 1,
  can_delete: currentUser
    ? Number(note?.author_id) === Number(currentUser.id) || ['STORE_ADMIN', 'MANAGER'].includes(String(currentUser.role || ''))
    : undefined,
  can_pin: currentUser
    ? ['STORE_ADMIN', 'MANAGER'].includes(String(currentUser.role || ''))
    : undefined,
});

export const clampChatCleanupReminderDay = (value: unknown) => Math.min(31, Math.max(1, Number(value) || 28));
export const clampChatRetentionValue = (value: unknown) => Math.min(365, Math.max(1, Number(value) || 3));
export const normalizeChatRetentionUnit = (value: unknown): 'days' | 'months' => String(value || '').toLowerCase() === 'days' ? 'days' : 'months';

export const isChatCleanupReminderDue = (store: any, referenceDate = new Date()) => {
  const remindersEnabled = Number(store?.chat_cleanup_reminders_enabled ?? 1) === 1;
  if (!remindersEnabled) return false;

  const reminderDay = clampChatCleanupReminderDay(store?.chat_cleanup_reminder_day);
  const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const triggerDay = Math.min(reminderDay, lastDayOfMonth);

  if (referenceDate.getDate() < triggerDay) {
    return false;
  }

  const lastCleanup = store?.last_chat_cleanup_at ? new Date(store.last_chat_cleanup_at) : null;
  if (!lastCleanup || Number.isNaN(lastCleanup.getTime())) {
    return true;
  }

  return lastCleanup.getFullYear() < referenceDate.getFullYear()
    || lastCleanup.getMonth() < referenceDate.getMonth();
};

export const normalizeCollectionCondition = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, '_');
};

export const normalizeBatchCode = (value: unknown) => {
  const raw = String(value || '').trim().slice(0, 80);
  return raw ? raw.toUpperCase() : null;
};

export const normalizeBatchExpiryDate = (value: unknown) => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

export const getShiftDateKey = (dateInput = new Date()) => {
  const date = new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getAttendanceDurationMinutes = (clockInAt: unknown, clockOutAt?: unknown) => {
  const clockInTime = new Date(String(clockInAt || '')).getTime();
  const clockOutTime = clockOutAt ? new Date(String(clockOutAt || '')).getTime() : Date.now();

  if (!Number.isFinite(clockInTime) || !Number.isFinite(clockOutTime) || clockOutTime < clockInTime) {
    return 0;
  }

  return Math.max(0, Math.round((clockOutTime - clockInTime) / 60000));
};

export const formatAttendanceEntry = (entry: any) => {
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
    user_name: String(entry?.user_name || entry?.username || entry?.user?.username || 'Staff'),
    role: String(entry?.role || 'STAFF').toUpperCase(),
    note: entry?.note ? String(entry.note) : null,
  };
};

export const normalizeSaleChannel = (value: unknown) => {
  const raw = String(value || '').trim().toUpperCase();
  return ['LAYAWAY', 'INSTALLMENT'].includes(raw) ? raw : 'STANDARD';
};

export const normalizePaymentFrequency = (value: unknown) => {
  const raw = String(value || '').trim().toUpperCase();
  return ['WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(raw) ? raw : 'MONTHLY';
};

export const toFiniteNumberOrNull = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
