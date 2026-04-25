const memoryFallback = new Map<string, string>();

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const safeStorage = {
  getItem(key: string) {
    const storage = getLocalStorage();
    if (!storage) {
      return memoryFallback.get(key) ?? null;
    }

    try {
      return storage.getItem(key);
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },

  setItem(key: string, value: string) {
    const storage = getLocalStorage();
    memoryFallback.set(key, value);

    if (!storage) return;

    try {
      storage.setItem(key, value);
    } catch {
      // Ignore quota/private-mode errors and keep the in-memory fallback.
    }
  },

  removeItem(key: string) {
    const storage = getLocalStorage();
    memoryFallback.delete(key);

    if (!storage) return;

    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage access errors.
    }
  },
};
