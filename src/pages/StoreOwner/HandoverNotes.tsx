import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Home, Loader2, Plus, Trash2 } from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';

const HandoverNotes: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [form, setForm] = useState({
    note: '',
    priority: 'INFO',
    is_pinned: false,
  });

  const canManagePins = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER';

  useEffect(() => {
    void loadNotes();
  }, []);

  const loadNotes = async () => {
    try {
      setLoading(true);
      const data = await appFetch('/api/handover-notes?limit=25');
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load handover notes'), type: 'error' });
      setNotes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.note.trim()) {
      showNotification({ message: 'Type a short handover note first', type: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await appFetch('/api/handover-notes', {
        method: 'POST',
        body: JSON.stringify({
          note: form.note.trim(),
          priority: form.priority,
          is_pinned: canManagePins ? form.is_pinned : false,
        }),
      });

      setForm({ note: '', priority: 'INFO', is_pinned: false });
      showNotification({ message: 'Handover note saved', type: 'success' });
      await loadNotes();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save handover note'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (note: any) => {
    if (!note?.id) return;

    setDeletingId(Number(note.id));
    try {
      await appFetch(`/api/handover-notes/${note.id}`, { method: 'DELETE' });
      showNotification({ message: 'Handover note removed', type: 'success' });
      await loadNotes();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to delete handover note'), type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleTogglePin = async (note: any) => {
    if (!note?.id || !canManagePins) return;

    setPinningId(Number(note.id));
    try {
      await appFetch(`/api/handover-notes/${note.id}/pin`, {
        method: 'PUT',
        body: JSON.stringify({ is_pinned: !note.is_pinned }),
      });
      showNotification({ message: note.is_pinned ? 'Note unpinned' : 'Note pinned to the top', type: 'success' });
      await loadNotes();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to update note pin'), type: 'error' });
    } finally {
      setPinningId(null);
    }
  };

  const pinnedCount = useMemo(() => notes.filter((note) => note.is_pinned).length, [notes]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-blue-900/20 p-3 text-blue-600">
            <FileText size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Staff Handover Notes</h1>
            <p className="text-slate-500">Keep short per-store updates for the next shift without slowing down the system.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Home size={16} /> Home
          </Link>
          <div className="flex items-center gap-2 rounded-xl bg-emerald-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-400">
            {notes.length} active note{notes.length === 1 ? '' : 's'} • {pinnedCount} pinned
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900">Add shift note</h2>
            <p className="text-sm text-slate-500">Use this for quick handovers like cash counts, pending pickups, or printer issues.</p>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Note</label>
              <textarea
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                rows={6}
                maxLength={600}
                placeholder="Example: Cash counted, receipt paper replaced, and Mr. James will return for pickup by 10am."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-300 outline-none transition focus:border-slate-400 focus:bg-white"
              />
              <p className="mt-1 text-right text-[11px] font-medium text-slate-400">{form.note.length}/600</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Priority
                <select
                  value={form.priority}
                  onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-300 outline-none"
                >
                  <option value="INFO">Normal update</option>
                  <option value="IMPORTANT">Important handover</option>
                </select>
              </label>

              {canManagePins ? (
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_pinned}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_pinned: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Pin to top for the whole team
                </label>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Managers and store admins can pin important notes.
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              Save Note
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4 sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">Recent store notes</h2>
            <p className="text-sm text-slate-500">Pinned notes stay at the top so the next staff member sees them first.</p>
          </div>

          <div className="divide-y divide-slate-100">
            {notes.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No handover notes yet. Add the first shift update for your team.
              </div>
            ) : notes.map((note) => (
              <article key={note.id} className="p-4 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {note.is_pinned && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-amber-400">
                          Pinned
                        </span>
                      )}
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${note.priority === 'IMPORTANT' ? 'bg-rose-100 text-rose-400' : 'bg-slate-100 text-slate-600'}`}>
                        {note.priority === 'IMPORTANT' ? 'Important' : 'Update'}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{note.note_text}</p>
                    <p className="mt-3 text-xs font-medium text-slate-500">
                      {note.author_username || 'Unknown staff'} • {note.created_at ? new Date(note.created_at).toLocaleString() : 'Just now'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 sm:pl-4">
                    {canManagePins && (
                      <button
                        type="button"
                        onClick={() => handleTogglePin(note)}
                        disabled={pinningId === Number(note.id)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                      >
                        {pinningId === Number(note.id) ? 'Saving...' : note.is_pinned ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                    {note.can_delete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(note)}
                        disabled={deletingId === Number(note.id)}
                        className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title="Delete note"
                      >
                        {deletingId === Number(note.id) ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default HandoverNotes;
