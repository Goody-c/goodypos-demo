import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, User, Lock, Loader2, Eye, EyeOff, AlertTriangle, KeyRound } from 'lucide-react';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [announcement, setAnnouncement] = useState<{ message: string; store_name?: string | null } | null>(null);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetNewUsername, setResetNewUsername] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const logoClickCount = useRef(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { login } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const nextNotice = typeof (location.state as { notice?: string } | null)?.notice === 'string'
      ? String((location.state as { notice?: string }).notice)
      : '';
    setSessionNotice(nextNotice);
  }, [location.state]);

  useEffect(() => {
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      setAnnouncement(null);
      setShowAnnouncementModal(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/public/store-announcement?username=${encodeURIComponent(trimmedUsername)}`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!controller.signal.aborted && data?.active && data?.message) {
          setAnnouncement({ message: String(data.message), store_name: data.store_name || null });
          setShowAnnouncementModal(true);
        } else if (!controller.signal.aborted) {
          setAnnouncement(null);
          setShowAnnouncementModal(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setAnnouncement(null);
          setShowAnnouncementModal(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [username]);

  const handleLogoClick = () => {
    logoClickCount.current += 1;
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    logoClickTimer.current = setTimeout(() => { logoClickCount.current = 0; }, 600);
    if (logoClickCount.current >= 5) {
      logoClickCount.current = 0;
      setResetError('');
      setResetSuccess('');
      setResetCode('');
      setResetNewUsername('');
      setResetNewPassword('');
      setResetConfirm('');
      setShowResetModal(true);
    }
  };

  const handleAdminReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');
    if (!resetNewPassword && !resetNewUsername.trim()) { setResetError('Enter a new username, password, or both.'); return; }
    if (resetNewPassword && resetNewPassword !== resetConfirm) { setResetError('Passwords do not match.'); return; }
    if (resetNewPassword && resetNewPassword.length < 6) { setResetError('Password must be at least 6 characters.'); return; }
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/admin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resetCode, newPassword: resetNewPassword || undefined, newUsername: resetNewUsername.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed.');
      setResetSuccess(`Done. SYSTEM_ADMIN account updated — username is now "${data.username}". You can log in.`);
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const updateCapsLockState = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSessionNotice('');
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      login(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {showResetModal && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-900/200/10">
                <KeyRound className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-amber-400">Emergency Reset</p>
                <p className="text-sm text-slate-400">SYSTEM_ADMIN password only</p>
              </div>
            </div>

            {resetSuccess ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-900/200/10 p-3 text-sm text-emerald-300">{resetSuccess}</div>
                <button type="button" onClick={() => setShowResetModal(false)} className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white hover:bg-slate-700">Close</button>
              </div>
            ) : (
              <form onSubmit={handleAdminReset} className="space-y-3">
                {resetError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{resetError}</div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Recovery Code</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Enter numeric recovery code"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">New Username <span className="normal-case text-slate-500">(optional)</span></label>
                  <input
                    type="text"
                    value={resetNewUsername}
                    onChange={(e) => setResetNewUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">New Password <span className="normal-case text-slate-500">(optional)</span></label>
                  <input
                    type="password"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Confirm Password <span className="normal-case text-slate-500">(if changing)</span></label>
                  <input
                    type="password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Repeat new password"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowResetModal(false)} className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-800">Cancel</button>
                  <button type="submit" disabled={resetLoading} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-900/200 disabled:opacity-50">
                    {resetLoading ? <Loader2 className="mx-auto animate-spin" size={16} /> : 'Reset Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showAnnouncementModal && announcement?.message && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-announcement-title"
            className="w-full max-w-md rounded-2xl border border-red-700 bg-gradient-to-br from-red-600 via-red-600 to-rose-700 p-6 shadow-2xl"
          >
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-100">Staff Announcement</p>
            <h3 id="staff-announcement-title" className="mt-2 text-xl font-black text-white">Please read this update</h3>
            <p className="mt-3 text-base font-semibold text-white">{announcement.message}</p>
            {announcement.store_name && (
              <p className="mt-2 text-sm text-red-100/90">Visible for {announcement.store_name} staff.</p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAnnouncementModal(false)}
                className="rounded-xl bg-white px-4 py-2 text-sm font-black text-red-700 transition-colors hover:bg-red-50"
              >
                Close Announcement
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-md w-full space-y-8 bg-slate-900 p-10 rounded-2xl border border-slate-800 shadow-2xl">
        <div className="text-center">
          <div onClick={handleLogoClick} className="mx-auto h-16 w-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-4 cursor-pointer select-none">
            <ShieldAlert className="h-10 w-10 text-red-500" />
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Goody-POS</h2>
          <p className="mt-2 text-sm text-slate-400">Secure terminal login</p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {sessionNotice && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/200/10 p-3 text-center text-sm text-amber-200">
              {sessionNotice}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-username" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  id="login-username"
                  aria-label="Username"
                  type="text"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                  placeholder="admin"
                />
              </div>
            </div>
            
            <div>
              <label htmlFor="login-password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  id="login-password"
                  aria-label="Password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={updateCapsLockState}
                  onKeyDown={updateCapsLockState}
                  onBlur={() => setCapsLockOn(false)}
                  className="block w-full pl-10 pr-12 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                  title={showPassword ? 'Hide characters' : 'Show characters'}
                  aria-label={showPassword ? 'Hide characters' : 'Show characters'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {capsLockOn && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-900/200/10 px-3 py-2 text-xs font-semibold text-amber-200">
                  <AlertTriangle size={14} />
                  Caps Lock appears to be on.
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative flex w-full justify-center rounded-xl border border-transparent bg-red-600 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'Access Terminal'}
          </button>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
            Tip: enter your staff username first to load any active store announcement before signing in.
          </div>
        </form>

        {/* ── Demo Accounts Panel ── */}
        <div className="mt-6 rounded-2xl border border-slate-700/60 bg-slate-900/80 p-5 backdrop-blur-sm">
          <p className="mb-4 text-center text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Demo Accounts — Click to Fill</p>

          {/* Smart Retail */}
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              <span className="text-xs font-black uppercase tracking-widest text-violet-400">TechHub Electronics — Smart Retail</span>
            </div>
            <div className="space-y-1.5">
              {([
                { user: 'demo_gt_owner',     role: 'STORE_ADMIN', pin: '1000' },
                { user: 'demo_gt_manager',   role: 'MANAGER',     pin: '1234' },
                { user: 'demo_gt_cashier',   role: 'STAFF',       pin: '5678' },
                { user: 'demo_gt_accountant',role: 'ACCOUNTANT',  pin: '3456' },
              ] as const).map((a) => (
                <button
                  key={a.user}
                  type="button"
                  onClick={() => { setUsername(a.user); setPassword('demo123'); }}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-left transition-colors hover:border-violet-500/40 hover:bg-slate-800"
                >
                  <User size={14} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-200">{a.user}</span>
                  <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-300">{a.role}</span>
                  <span className="rounded-md bg-amber-900/40 px-2 py-0.5 text-[10px] font-black text-amber-400">PIN {a.pin}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Supermarket */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-black uppercase tracking-widest text-emerald-400">FreshMart Grocery — Supermarket</span>
            </div>
            <div className="space-y-1.5">
              {([
                { user: 'demo_sm_owner',     role: 'STORE_ADMIN', pin: '5000' },
                { user: 'demo_sm_manager',   role: 'MANAGER',     pin: '2000' },
                { user: 'demo_sm_cashier',   role: 'STAFF',       pin: '3000' },
                { user: 'demo_sm_accountant',role: 'ACCOUNTANT',  pin: '4000' },
              ] as const).map((a) => (
                <button
                  key={a.user}
                  type="button"
                  onClick={() => { setUsername(a.user); setPassword('demo123'); }}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-slate-800"
                >
                  <User size={14} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-200">{a.user}</span>
                  <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-300">{a.role}</span>
                  <span className="rounded-md bg-amber-900/40 px-2 py-0.5 text-[10px] font-black text-amber-400">PIN {a.pin}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-slate-600">
            Password for all accounts: <span className="font-mono font-bold text-slate-400">demo123</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
