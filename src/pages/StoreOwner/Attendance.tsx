import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Home, Loader2, LogIn, LogOut, Trash2, Users } from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatMinutes = (totalMinutes: number) => {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const Attendance: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'in' | 'out' | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateValue());
  const [note, setNote] = useState('');
  const [attendance, setAttendance] = useState<any>({
    current_session: null,
    my_entries: [],
    team_entries: [],
    summary: { present_count: 0, open_count: 0, clocked_out_count: 0, total_hours: 0 },
  });

  const isLeadership = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER';

  const HISTORY_PAGE_SIZE = 8;
  const [historyPage, setHistoryPage] = useState(1);
  const [historyData, setHistoryData] = useState<{ entries: any[]; total: number; totalPages: number }>({ entries: [], total: 0, totalPages: 0 });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearScope, setClearScope] = useState<'day' | 'month' | 'year'>('month');
  const [clearDate, setClearDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const loadData = async (dateValue = selectedDate) => {
    try {
      setLoading(true);
      const data = await appFetch(`/api/attendance?date=${encodeURIComponent(dateValue)}`);
      setAttendance({
        current_session: data?.current_session || null,
        my_entries: Array.isArray(data?.my_entries) ? data.my_entries : [],
        team_entries: Array.isArray(data?.team_entries) ? data.team_entries : [],
        summary: data?.summary || { present_count: 0, open_count: 0, clocked_out_count: 0, total_hours: 0 },
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load attendance'), type: 'error' });
      setAttendance({
        current_session: null,
        my_entries: [],
        team_entries: [],
        summary: { present_count: 0, open_count: 0, clocked_out_count: 0, total_hours: 0 },
      });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (page: number) => {
    try {
      setHistoryLoading(true);
      const data = await appFetch(`/api/attendance/history?page=${page}&limit=${HISTORY_PAGE_SIZE}`);
      setHistoryData({
        entries: Array.isArray(data?.entries) ? data.entries : [],
        total: Number(data?.total || 0),
        totalPages: Number(data?.totalPages || 0),
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load attendance history'), type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      setClearLoading(true);
      await appFetch('/api/attendance/clear', {
        method: 'DELETE',
        body: JSON.stringify({ scope: clearScope, date: clearDate }),
      });
      showNotification({ message: 'Attendance history cleared successfully.', type: 'success' });
      setClearConfirmOpen(false);
      setHistoryPage(1);
      await Promise.all([loadHistory(1), loadData(selectedDate)]);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to clear attendance history'), type: 'error' });
    } finally {
      setClearLoading(false);
    }
  };

  const handleScopeChange = (scope: 'day' | 'month' | 'year') => {
    setClearScope(scope);
    const now = new Date();
    if (scope === 'day') setClearDate(getLocalDateValue(now));
    else if (scope === 'month') setClearDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    else setClearDate(String(now.getFullYear()));
  };

  useEffect(() => {
    void loadData();
    void loadHistory(1);
    setHistoryPage(1);
  }, [selectedDate]);

  const handleClockAction = async (action: 'in' | 'out') => {
    try {
      setActionLoading(action);
      await appFetch(`/api/attendance/clock-${action === 'in' ? 'in' : 'out'}`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() }),
      });
      showNotification({
        message: action === 'in' ? 'Clock-in recorded successfully.' : 'Clock-out recorded successfully.',
        type: 'success',
      });
      setNote('');
      await loadData(selectedDate);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || `Failed to clock ${action}`), type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const myTodayEntries = useMemo(
    () => (Array.isArray(attendance.my_entries) ? attendance.my_entries.filter((entry: any) => entry.shift_date === selectedDate) : []),
    [attendance.my_entries, selectedDate],
  );

  const todayMinutes = myTodayEntries.reduce((sum: number, entry: any) => sum + (Number(entry.total_minutes || 0) || 0), 0);
  const currentSession = attendance.current_session;

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Team Operations</p>
          <h1 className="text-2xl font-bold text-slate-900">Attendance & Clock-In</h1>
          <p className="text-slate-500">Track daily presence, open shifts, and who is currently on duty.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            <Home size={16} /> Home
          </Link>
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <CalendarDays size={16} />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent outline-none"
            />
          </label>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">My Status</p>
          <p className={`mt-2 text-2xl font-black ${currentSession ? 'text-emerald-400' : 'text-slate-900'}`}>
            {currentSession ? 'On Shift' : 'Off Shift'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {currentSession?.clock_in_at ? `Clocked in at ${new Date(currentSession.clock_in_at).toLocaleTimeString()}` : 'No active shift right now'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Today Hours</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{formatMinutes(todayMinutes)}</p>
          <p className="mt-1 text-xs text-slate-500">Based on completed attendance sessions for {selectedDate}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">My Entries</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{myTodayEntries.length}</p>
          <p className="mt-1 text-xs text-slate-500">Clock sessions recorded for the selected day</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Team Present</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{attendance.summary?.present_count || 0}</p>
          <p className="mt-1 text-xs text-slate-500">Unique staff with attendance records on {selectedDate}</p>
        </div>
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="rounded-xl bg-slate-100 p-2 text-slate-300"><Clock3 size={18} /></div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Clock In / Out</h2>
                <p className="text-sm text-slate-500">Add a short shift note if needed before recording attendance.</p>
              </div>
            </div>

            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional shift note, handover detail, or task focus"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-400"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={Boolean(currentSession) || actionLoading !== null}
                onClick={() => handleClockAction('in')}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === 'in' ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                Clock In
              </button>
              <button
                type="button"
                disabled={!currentSession || actionLoading !== null}
                onClick={() => handleClockAction('out')}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === 'out' ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                Clock Out
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">My Attendance History</h2>
                  <p className="text-sm text-slate-500">Your clock-in and clock-out records.</p>
                </div>
                {isLeadership && (
                  <button
                    type="button"
                    onClick={() => setClearConfirmOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-900/20 px-3 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-100"
                  >
                    <Trash2 size={13} /> Clear History
                  </button>
                )}
              </div>
              {isLeadership && clearConfirmOpen && (
                <div className="mt-4 space-y-3 rounded-xl border border-rose-200 bg-rose-900/20 p-4">
                  <p className="text-sm font-bold text-rose-300">Choose what to clear:</p>
                  <div className="flex flex-wrap gap-2">
                    {(['day', 'month', 'year'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleScopeChange(s)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${clearScope === s ? 'bg-rose-600 text-white' : 'border border-rose-200 bg-white text-rose-400'}`}
                      >
                        By {s}
                      </button>
                    ))}
                  </div>
                  <div>
                    {clearScope === 'day' && (
                      <input type="date" value={clearDate} onChange={(e) => setClearDate(e.target.value)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm outline-none" />
                    )}
                    {clearScope === 'month' && (
                      <input type="month" value={clearDate} onChange={(e) => setClearDate(e.target.value)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm outline-none" />
                    )}
                    {clearScope === 'year' && (
                      <input type="number" min="2020" max="2099" value={clearDate} onChange={(e) => setClearDate(e.target.value)} placeholder="YYYY" className="w-24 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm outline-none" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={clearLoading}
                      onClick={handleClearHistory}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {clearLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Confirm Clear
                    </button>
                    <button type="button" onClick={() => setClearConfirmOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {historyLoading ? (
                <div className="flex justify-center p-6"><Loader2 className="animate-spin text-slate-400" /></div>
              ) : historyData.entries.length ? historyData.entries.map((entry: any) => (
                <div key={entry.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{entry.shift_date}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        In: {entry.clock_in_at ? new Date(entry.clock_in_at).toLocaleString() : '—'}
                        {entry.clock_out_at ? ` • Out: ${new Date(entry.clock_out_at).toLocaleString()}` : ' • Shift still open'}
                      </p>
                      {entry.note && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{entry.note}</p>}
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${entry.is_open ? 'bg-emerald-100 text-emerald-400' : 'bg-slate-100 text-slate-300'}`}>
                      {entry.is_open ? 'OPEN' : formatMinutes(Number(entry.total_minutes || 0))}
                    </span>
                  </div>
                </div>
              )) : (
                <div className="p-6 text-sm text-slate-500">No attendance records yet. Use the clock buttons above to start your first shift.</div>
              )}
            </div>
            {historyData.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-500">Page {historyPage} of {historyData.totalPages} • {historyData.total} total records</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={historyPage <= 1}
                    onClick={() => { const p = historyPage - 1; setHistoryPage(p); void loadHistory(p); }}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= historyData.totalPages}
                    onClick={() => { const p = historyPage + 1; setHistoryPage(p); void loadHistory(p); }}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-blue-900/20 p-2 text-blue-600"><Users size={18} /></div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{isLeadership ? 'Team Attendance Overview' : 'Today Summary'}</h2>
                <p className="text-sm text-slate-500">
                  {isLeadership ? 'See who is currently on shift and who has clocked out.' : 'Managers and store owners can also see the full team view here.'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {isLeadership ? (
              attendance.team_entries?.length ? (
                <div className="space-y-3">
                  {attendance.team_entries.map((entry: any) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-900">{entry.user_name}</p>
                          <p className="text-xs font-black uppercase tracking-widest text-slate-500">{String(entry.role || 'STAFF').replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            In: {entry.clock_in_at ? new Date(entry.clock_in_at).toLocaleTimeString() : '—'}
                            {entry.clock_out_at ? ` • Out: ${new Date(entry.clock_out_at).toLocaleTimeString()}` : ' • Still on shift'}
                          </p>
                          {entry.note && <p className="mt-2 text-sm text-slate-600">{entry.note}</p>}
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${entry.is_open ? 'bg-emerald-100 text-emerald-400' : 'bg-slate-100 text-slate-300'}`}>
                          {entry.is_open ? 'ON SHIFT' : formatMinutes(Number(entry.total_minutes || 0))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No team attendance records found for {selectedDate}.
                </div>
              )
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <p><span className="font-bold text-slate-900">Open shifts:</span> {attendance.summary?.open_count || 0}</p>
                <p className="mt-1"><span className="font-bold text-slate-900">Clocked out:</span> {attendance.summary?.clocked_out_count || 0}</p>
                <p className="mt-1"><span className="font-bold text-slate-900">Tracked team hours:</span> {Number(attendance.summary?.total_hours || 0).toFixed(2)}h</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Attendance;
