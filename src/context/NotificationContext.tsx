import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, XCircle, X } from 'lucide-react';

type NotificationType = 'success' | 'warning' | 'error';

interface NotificationAction {
  label: string | React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  countdown?: number;
}

interface NotificationOptions {
  title?: string;
  message: string | React.ReactNode;
  type: NotificationType;
  actions?: NotificationAction[];
  autoClose?: boolean;
  duration?: number;
  presentation?: 'modal' | 'toast';
  position?: 'top-center' | 'bottom-center';
}

interface NotificationContextType {
  showNotification: (options: NotificationOptions) => void;
  hideNotification: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notification, setNotification] = useState<NotificationOptions | null>(null);
  const [countdowns, setCountdowns] = useState<Record<number, number>>({});

  const hideNotification = useCallback(() => {
    setNotification(null);
    setCountdowns({});
  }, []);

  const showNotification = useCallback((options: NotificationOptions) => {
    const normalizedOptions: NotificationOptions = {
      ...options,
      presentation: 'toast',
      position: options.position || 'top-center',
    };

    setNotification(normalizedOptions);
    
    if (normalizedOptions.actions) {
      const initialCountdowns: Record<number, number> = {};
      normalizedOptions.actions.forEach((action, index) => {
        if (action.countdown) {
          initialCountdowns[index] = action.countdown;
        }
      });
      setCountdowns(initialCountdowns);
    } else {
      setCountdowns({});
    }

    if (normalizedOptions.autoClose !== false && normalizedOptions.type === 'success') {
      setTimeout(() => {
        setNotification((current) => {
          if (current === normalizedOptions) {
            setCountdowns({});
            return null;
          }
          return current;
        });
      }, normalizedOptions.duration || 3000);
    }
  }, []);

  useEffect(() => {
    if (Object.keys(countdowns).length === 0) return;

    const timer = setInterval(() => {
      setCountdowns(prev => {
        const next = { ...prev };
        let changed = false;
        for (const key in next) {
          if (next[key] > 0) {
            next[key] -= 1;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdowns]);

  return (
    <NotificationContext.Provider value={{ showNotification, hideNotification }}>
      {children}
      {notification && (
        <div className={`fixed left-1/2 z-[9999] w-[min(94vw,30rem)] -translate-x-1/2 animate-in fade-in ${
          notification.position === 'bottom-center'
            ? 'bottom-6 slide-in-from-bottom-2'
            : 'top-20 slide-in-from-top-2'
        }`}>
          <div className={`rounded-2xl border p-4 shadow-2xl backdrop-blur-sm ${
            notification.type === 'success' ? 'border-green-200 bg-white text-slate-900' :
            notification.type === 'warning' ? 'border-yellow-200 bg-white text-slate-900' :
            'border-red-200 bg-white text-slate-900'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${
                notification.type === 'success' ? 'bg-green-100 text-green-600' :
                notification.type === 'warning' ? 'bg-yellow-100 text-yellow-600' :
                'bg-red-100 text-red-600'
              }`}>
                {notification.type === 'success' && <CheckCircle2 size={20} />}
                {notification.type === 'warning' && <AlertCircle size={20} />}
                {notification.type === 'error' && <XCircle size={20} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-black ${
                  notification.type === 'success' ? 'text-green-700' :
                  notification.type === 'warning' ? 'text-yellow-700' :
                  'text-red-700'
                }`}>
                  {notification.title || (
                    notification.type === 'success' ? 'Success' :
                    notification.type === 'warning' ? 'Warning' : 'Error'
                  )}
                </p>
                <div className="mt-1 text-sm text-slate-600">{notification.message}</div>

                {notification.actions && notification.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {notification.actions.map((action, index) => {
                      const currentCountdown = countdowns[index] || 0;
                      const isDisabled = action.disabled || currentCountdown > 0;
                      const isCountdownAction = action.countdown && action.countdown > 0;
                      const isCountdownComplete = isCountdownAction && currentCountdown === 0;

                      return (
                        <button
                          key={index}
                          disabled={isDisabled}
                          onClick={action.onClick}
                          className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                            action.primary
                              ? isCountdownAction
                                ? isCountdownComplete
                                  ? 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300'
                                  : 'bg-yellow-500 text-white hover:bg-yellow-600 disabled:bg-slate-300'
                                : notification.type === 'success'
                                  ? 'bg-green-600 text-white hover:bg-green-700 disabled:bg-slate-300'
                                  : notification.type === 'warning'
                                    ? 'bg-yellow-500 text-white hover:bg-yellow-600 disabled:bg-slate-300'
                                    : 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300'
                              : 'bg-slate-100 text-slate-300 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400'
                          }`}
                        >
                          {isCountdownAction && currentCountdown > 0
                            ? `${action.label} (${currentCountdown}s)`
                            : action.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={hideNotification}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-300"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within NotificationProvider');
  return context;
};