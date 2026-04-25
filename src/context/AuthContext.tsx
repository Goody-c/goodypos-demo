import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { appFetch } from '../lib/api';
import { safeStorage } from '../lib/storage';

interface User {
  id: number;
  username: string;
  role: 'SYSTEM_ADMIN' | 'STORE_ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'PROCUREMENT_OFFICER' | 'STAFF';
  store_id?: number;
}

interface AuthContextType {
  user: User | null;
  login: (token: string, user: User) => void;
  logout: (notice?: string) => void;
  loading: boolean;
}

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const WARNING_BEFORE_LOGOUT_MS = 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;
const LAST_ACTIVITY_STORAGE_KEY = 'goody_last_activity_at';

const formatCountdown = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [warningCountdownSeconds, setWarningCountdownSeconds] = useState(Math.ceil(WARNING_BEFORE_LOGOUT_MS / 1000));
  const navigate = useNavigate();
  const warningTimeoutRef = useRef<number | null>(null);
  const logoutTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const lastActivityAtRef = useRef(Date.now());

  const clearInactivityTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      window.clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }
    if (logoutTimeoutRef.current) {
      window.clearTimeout(logoutTimeoutRef.current);
      logoutTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const logout = useCallback((notice?: string) => {
    clearInactivityTimers();
    safeStorage.removeItem('ominous_token');
    safeStorage.removeItem('ominous_user');
    safeStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    setShowInactivityWarning(false);
    setWarningCountdownSeconds(Math.ceil(WARNING_BEFORE_LOGOUT_MS / 1000));
    setUser(null);
    navigate('/login', notice ? { replace: true, state: { notice } } : { replace: true });
  }, [clearInactivityTimers, navigate]);

  const startWarningCountdown = useCallback((logoutAt: number) => {
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
    }

    const updateCountdown = () => {
      setWarningCountdownSeconds(Math.max(0, Math.ceil((logoutAt - Date.now()) / 1000)));
    };

    updateCountdown();
    countdownIntervalRef.current = window.setInterval(updateCountdown, 250);
  }, []);

  const handleInactivityLogout = useCallback(() => {
    logout('Signed out after 15 minutes of inactivity to keep Goody POS secure.');
  }, [logout]);

  const scheduleInactivityTimers = useCallback((lastActivityAt: number) => {
    clearInactivityTimers();

    if (!user) return;

    const elapsed = Date.now() - lastActivityAt;
    if (elapsed >= INACTIVITY_LIMIT_MS) {
      handleInactivityLogout();
      return;
    }

    const msUntilWarning = INACTIVITY_LIMIT_MS - WARNING_BEFORE_LOGOUT_MS - elapsed;
    const msUntilLogout = INACTIVITY_LIMIT_MS - elapsed;

    if (msUntilWarning <= 0) {
      setShowInactivityWarning(true);
      startWarningCountdown(Date.now() + msUntilLogout);
    } else {
      setShowInactivityWarning(false);
      setWarningCountdownSeconds(Math.ceil(WARNING_BEFORE_LOGOUT_MS / 1000));
      warningTimeoutRef.current = window.setTimeout(() => {
        setShowInactivityWarning(true);
        startWarningCountdown(Date.now() + WARNING_BEFORE_LOGOUT_MS);
      }, msUntilWarning);
    }

    logoutTimeoutRef.current = window.setTimeout(handleInactivityLogout, msUntilLogout);
  }, [clearInactivityTimers, handleInactivityLogout, startWarningCountdown, user]);

  const recordActivity = useCallback((force = false) => {
    if (!user) return;

    const now = Date.now();
    const elapsed = now - lastActivityAtRef.current;

    if (elapsed >= INACTIVITY_LIMIT_MS) {
      handleInactivityLogout();
      return;
    }

    if (!force && elapsed < ACTIVITY_THROTTLE_MS) {
      return;
    }

    lastActivityAtRef.current = now;
    safeStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
    setShowInactivityWarning(false);
    scheduleInactivityTimers(now);
  }, [handleInactivityLogout, scheduleInactivityTimers, user]);

  useEffect(() => {
    const checkAuth = async () => {
      const storedUser = safeStorage.getItem('ominous_user');
      const storedToken = safeStorage.getItem('ominous_token');

      if (storedUser && storedToken) {
        try {
          const data = await appFetch('/api/auth/verify');
          if (data && data.valid) {
            const parsedUser = JSON.parse(storedUser) as User;
            const savedLastActivity = Number(safeStorage.getItem(LAST_ACTIVITY_STORAGE_KEY) || 0);
            const initialLastActivity = Number.isFinite(savedLastActivity) && savedLastActivity > 0
              ? savedLastActivity
              : Date.now();

            if (Date.now() - initialLastActivity >= INACTIVITY_LIMIT_MS) {
              logout('Signed out after 15 minutes of inactivity to keep Goody POS secure.');
              return;
            }

            lastActivityAtRef.current = initialLastActivity;
            safeStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(initialLastActivity));
            setUser(parsedUser);
          } else {
            setUser(null);
          }
        } catch (err) {
          console.debug('Auth verification failed (expected on restart):', err);
          logout();
          return;
        }
      }
      setLoading(false);
    };

    void checkAuth();
  }, [logout]);

  useEffect(() => {
    if (!user) {
      clearInactivityTimers();
      setShowInactivityWarning(false);
      setWarningCountdownSeconds(Math.ceil(WARNING_BEFORE_LOGOUT_MS / 1000));
      return;
    }

    const syncInactivityState = () => {
      const savedLastActivity = Number(safeStorage.getItem(LAST_ACTIVITY_STORAGE_KEY) || lastActivityAtRef.current || Date.now());
      const effectiveLastActivity = Number.isFinite(savedLastActivity) && savedLastActivity > 0
        ? savedLastActivity
        : Date.now();

      if (Date.now() - effectiveLastActivity >= INACTIVITY_LIMIT_MS) {
        handleInactivityLogout();
        return;
      }

      lastActivityAtRef.current = effectiveLastActivity;
      scheduleInactivityTimers(effectiveLastActivity);
    };

    const handleActivity = () => {
      if (showInactivityWarning) return;
      recordActivity();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncInactivityState();
      }
    };

    const handleStorageSync = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_STORAGE_KEY) {
        syncInactivityState();
      }
    };

    syncInactivityState();

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity));
    window.addEventListener('focus', syncInactivityState);
    window.addEventListener('storage', handleStorageSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.removeEventListener('focus', syncInactivityState);
      window.removeEventListener('storage', handleStorageSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInactivityTimers();
    };
  }, [clearInactivityTimers, handleInactivityLogout, recordActivity, scheduleInactivityTimers, showInactivityWarning, user]);

  const login = (token: string, user: User) => {
    const now = Date.now();
    safeStorage.setItem('ominous_token', token);
    safeStorage.setItem('ominous_user', JSON.stringify(user));
    safeStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
    lastActivityAtRef.current = now;
    setShowInactivityWarning(false);
    setWarningCountdownSeconds(Math.ceil(WARNING_BEFORE_LOGOUT_MS / 1000));
    setUser(user);
    if (user.role === 'SYSTEM_ADMIN') {
      navigate('/admin');
    } else {
      navigate('/');
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}

      {showInactivityWarning && user && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inactivity-warning-title"
            className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-900/20 p-3 text-amber-600">
                <AlertTriangle size={26} />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-600">Security timeout</p>
                <h2 id="inactivity-warning-title" className="mt-1 text-xl font-black text-slate-900">Stay signed in?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  For safety, Goody POS signs out inactive sessions after 15 minutes. Your session will end unless you confirm that you are still here.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-400">Automatic sign-out</p>
              <p className="mt-1 text-2xl font-black text-amber-950">{formatCountdown(warningCountdownSeconds)} remaining</p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => logout()}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-300 transition-colors hover:bg-slate-50"
              >
                Log out now
              </button>
              <button
                type="button"
                onClick={() => recordActivity(true)}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 font-bold text-white transition-colors hover:bg-slate-800"
              >
                Stay signed in
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
