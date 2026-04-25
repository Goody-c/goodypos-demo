import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import { formatCurrency } from '../../lib/utils';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  Trash2, 
  Loader2,
  Key,
  Lock,
  X,
  Home,
  TrendingUp,
  Calendar,
  ReceiptText,
} from 'lucide-react';
import ConfirmActionModal from '../../components/ConfirmActionModal';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRoleRank = (role: string) => {
  if (role === 'STORE_ADMIN') return 0;
  if (role === 'ACCOUNTANT') return 1;
  if (role === 'MANAGER') return 2;
  if (role === 'PROCUREMENT_OFFICER') return 3;
  return 4;
};

const getRoleBadgeClass = (role: string) => {
  if (role === 'STORE_ADMIN') return 'bg-amber-100 text-amber-400';
  if (role === 'ACCOUNTANT') return 'bg-emerald-100 text-emerald-400';
  if (role === 'MANAGER') return 'bg-violet-100 text-violet-700';
  if (role === 'PROCUREMENT_OFFICER') return 'bg-sky-100 text-sky-700';
  return 'bg-blue-100 text-blue-400';
};

const Staff: React.FC = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<any>(null);
  const [showResetPinModal, setShowResetPinModal] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<any>(null);
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [staffHistory, setStaffHistory] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => getLocalDateValue());
  const [formData, setFormData] = useState({ username: '', password: '', role: 'STAFF' });
  const [resetPassword, setResetPassword] = useState('');
  const [resetPin, setResetPin] = useState('');

  useEffect(() => {
    loadStaff();
  }, []);

  const canResetPassword = (targetUser: any) => {
    if (!user) return false;
    if (user.role === 'SYSTEM_ADMIN') return true;
    if (user.role === 'STORE_ADMIN') {
      return (targetUser.role === 'MANAGER' || targetUser.role === 'ACCOUNTANT' || targetUser.role === 'PROCUREMENT_OFFICER' || targetUser.role === 'STAFF');
    }
    return false;
  };

  const canResetTeamPin = (targetUser: any) => {
    if (!user) return false;
    if (user.role === 'SYSTEM_ADMIN') return true;
    if (user.role === 'STORE_ADMIN') {
      return targetUser.role === 'MANAGER' || targetUser.role === 'PROCUREMENT_OFFICER' || targetUser.role === 'STAFF';
    }
    return false;
  };

  const loadStaff = async () => {
    try {
      const data = await appFetch('/api/admin/users');
      const users = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
      setStaff(
        users
          .filter((u: any) => ['STORE_ADMIN', 'ACCOUNTANT', 'MANAGER', 'PROCUREMENT_OFFICER', 'STAFF'].includes(String(u.role)))
          .sort((a: any, b: any) => getRoleRank(String(a.role)) - getRoleRank(String(b.role)) || String(a.username).localeCompare(String(b.username)))
      );
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to load staff list'), type: 'error' });
      setStaff([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await appFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      setShowModal(false);
      setFormData({ username: '', password: '', role: 'STAFF' });
      await loadStaff();
      showNotification({ message: 'Staff account created successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const requestDelete = (member: any) => {
    setStaffToDelete(member);
  };

  const handleDelete = async (member = staffToDelete) => {
    if (!member?.id) return;

    const id = Number(member.id);
    setDeletingId(id);
    try {
      await appFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      setStaffToDelete(null);
      await loadStaff();
      showNotification({ message: 'Staff member deleted successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal?.id) return;
    try {
      await appFetch(`/api/admin/users/${showResetModal.id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: resetPassword }),
      });
      setShowResetModal(null);
      setResetPassword('');
      showNotification({ message: 'Password reset successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetPinModal?.id) return;

    const nextPin = String(resetPin || '').trim();
    if (!/^\d{4,6}$/.test(nextPin)) {
      showNotification({ message: 'PIN must be 4 to 6 digits', type: 'error' });
      return;
    }

    try {
      await appFetch(`/api/admin/users/${showResetPinModal.id}/pin`, {
        method: 'PUT',
        body: JSON.stringify({ pin: nextPin }),
      });
      setShowResetPinModal(null);
      setResetPin('');
      showNotification({ message: 'Checkout PIN reset successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const loadStaffHistory = async (member: any, dateValue = historyDate) => {
    setSelectedStaff(member);
    setLoadingHistory(true);

    try {
      const data = await appFetch(`/api/reports/staff-sales-history/${member.id}?date=${encodeURIComponent(dateValue)}&days=7&limit=20`);
      setStaffHistory(data);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load staff sales history'), type: 'error' });
      setStaffHistory(null);
    } finally {
      setLoadingHistory(false);
    }
  };

  const closeHistoryModal = () => {
    setSelectedStaff(null);
    setStaffHistory(null);
    setHistoryDate(getLocalDateValue());
    setLoadingHistory(false);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="mx-auto w-full max-w-7xl overflow-x-hidden space-y-6 sm:space-y-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4 sm:items-center">
          <div className="rounded-2xl bg-blue-900/200/10 p-3 sm:p-4">
            <Users className="text-blue-600" size={32} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">Staff Management</h1>
            <p className="text-slate-500">Manage terminal access and review sales for your full store team</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
          <Link to="/" className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:w-auto">
            <Home size={16} /> Home
          </Link>
          {user?.role === 'STORE_ADMIN' && (
            <button 
              onClick={() => setShowModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-800 sm:w-auto"
            >
              <UserPlus size={20} /> Add Staff Member
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.length === 0 ? (
          <div className="md:col-span-2 lg:col-span-3 bg-white p-10 rounded-2xl shadow-sm border border-gray-100 text-center text-slate-500">
            <Users className="mx-auto mb-3 text-slate-300" size={40} />
            <p className="text-lg font-bold text-slate-300">No team members found yet</p>
            <p className="text-sm mt-1">Create a staff or manager account to see everyone listed here.</p>
          </div>
        ) : staff.map(member => (
          <div
            key={member.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              const today = getLocalDateValue();
              setHistoryDate(today);
              loadStaffHistory(member, today);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const today = getLocalDateValue();
                setHistoryDate(today);
                loadStaffHistory(member, today);
              }
            }}
            className="cursor-pointer rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md sm:p-6"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-900">
                {member.username[0].toUpperCase()}
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getRoleBadgeClass(member.role)}`}>
                {member.role === 'STORE_ADMIN'
                  ? 'STORE OWNER'
                  : member.role === 'ACCOUNTANT'
                    ? 'ACCOUNTANT'
                    : member.role === 'PROCUREMENT_OFFICER'
                      ? 'PROCUREMENT'
                      : member.role}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{member.username}</h3>
            <p className="text-xs text-slate-400 mb-2 uppercase tracking-widest font-bold">
              {member.role === 'STORE_ADMIN'
                ? 'Store Owner Access Active'
                : member.role === 'ACCOUNTANT'
                  ? 'Accountant Financial Access Active'
                  : member.role === 'MANAGER'
                    ? 'Manager Access Active'
                    : member.role === 'PROCUREMENT_OFFICER'
                      ? 'Procurement & Stock Control Access Active'
                      : 'Terminal Access Active'}
            </p>
            <p className="text-xs text-blue-600 font-bold mb-4">Click to view sales history & chart</p>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-50 pt-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-green-500">
                <ShieldCheck size={14} /> Verified Account
              </div>
              <div className="flex flex-wrap gap-2">
                {canResetPassword(member) && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowResetModal(member);
                    }}
                    className="p-2 text-amber-600 hover:bg-amber-900/20 rounded-lg transition-colors"
                    title="Reset Password"
                  >
                    <Key size={18} />
                  </button>
                )}
                {canResetTeamPin(member) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowResetPinModal(member);
                    }}
                    className="p-2 text-blue-600 hover:bg-blue-900/20 rounded-lg transition-colors"
                    title="Reset Checkout PIN"
                  >
                    <Lock size={18} />
                  </button>
                )}
                {user?.role === 'STORE_ADMIN' && member.role !== 'STORE_ADMIN' && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDelete(member);
                    }}
                    disabled={deletingId === Number(member.id)}
                    className="p-2 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-50"
                    title="Delete Staff"
                  >
                    {deletingId === Number(member.id) ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedStaff && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 max-h-[90vh] overflow-hidden text-slate-900 flex flex-col">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{selectedStaff.username} Sales History</h2>
                <p className="text-sm text-slate-500">View chart performance and previous sales records.</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                  <Calendar size={16} />
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      setHistoryDate(nextDate);
                      loadStaffHistory(selectedStaff, nextDate);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </label>
                <button onClick={closeHistoryModal} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <X size={22} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-slate-50 p-4 space-y-6 sm:p-6">
              {loadingHistory ? (
                <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
              ) : staffHistory ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Selected Day Total</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(Number(staffHistory.summary?.total || 0))}</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Transactions</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">{staffHistory.summary?.count || 0}</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Cash</p>
                      <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(Number(staffHistory.summary?.cash || 0))}</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Transfer / POS</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{formatCurrency(Number((staffHistory.summary?.transfer || 0) + (staffHistory.summary?.pos || 0)))}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                      <TrendingUp size={18} /> Last 7 Days Chart
                    </h3>
                    <div className="flex items-end gap-2 overflow-x-auto no-scrollbar h-[230px]">
                      {staffHistory.trend?.map((point: any) => {
                        const maxValue = Math.max(1, ...(staffHistory.trend || []).map((entry: any) => Number(entry.total) || 0));
                        const barHeight = Math.max(10, ((Number(point.total) || 0) / maxValue) * 100);
                        return (
                          <div key={point.date} className="flex min-w-[60px] flex-1 flex-col items-center justify-end gap-2">
                            <span className="text-[10px] font-semibold text-slate-500">{formatCurrency(Number(point.total || 0))}</span>
                            <div className="flex h-32 w-full items-end rounded-lg bg-slate-50 p-1.5 ring-1 ring-slate-100">
                              <div className="w-full rounded-md bg-slate-900" style={{ height: `${barHeight}%` }} />
                            </div>
                            <div className="text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{point.label}</p>
                              <p className="text-[10px] text-slate-400">{point.count} sale{point.count === 1 ? '' : 's'}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center gap-2">
                      <ReceiptText size={18} className="text-slate-600" />
                      <h3 className="text-lg font-bold text-slate-900">Previous Sales</h3>
                    </div>
                    {staffHistory.sales?.length ? (
                      <div className="divide-y divide-slate-100">
                        {staffHistory.sales.map((sale: any) => (
                          <div key={sale.id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-bold text-slate-900">Sale #{sale.id}</p>
                              <p className="text-sm text-slate-500">{new Date(sale.timestamp).toLocaleString()}</p>
                              <p className="text-xs text-slate-500">{sale.customer_name || 'Walk-in Customer'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-slate-900">{formatCurrency(Number(sale.total || 0))}</p>
                              <p className="text-xs text-slate-500 uppercase">{sale.status}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-slate-500">No previous sales found for this staff member.</div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(staffToDelete)}
        title="Delete Staff Member"
        description="This account will lose access to the store immediately."
        confirmLabel="Yes, Delete Staff"
        tone="danger"
        loading={deletingId === Number(staffToDelete?.id)}
        onClose={() => setStaffToDelete(null)}
        onConfirm={() => handleDelete(staffToDelete)}
        details={staffToDelete ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-slate-700">
            <p><span className="font-bold text-slate-900">Username:</span> {staffToDelete.username}</p>
            <p className="mt-1"><span className="font-bold text-slate-900">Role:</span> {staffToDelete.role === 'STORE_ADMIN' ? 'Store Owner' : staffToDelete.role}</p>
          </div>
        ) : null}
      />

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-[calc(100%-1.5rem)] max-w-md rounded-3xl bg-white p-8 text-slate-900 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-slate-900">Add Team Member</h2>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Username</label>
                <input 
                  required
                  type="text"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                  placeholder="staff_user"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Initial Password</label>
                <input 
                  required
                  type="password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={formData.password}
                  onChange={e => setFormData({...formData, password: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Role</label>
                <select 
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={formData.role}
                  onChange={e => setFormData({...formData, role: e.target.value})}
                >
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                  <option value="ACCOUNTANT">Accountant</option>
                  <option value="PROCUREMENT_OFFICER">Procurement Officer</option>
                </select>
              </div>
              
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 p-4 border border-slate-200 rounded-2xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 p-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <h2 className="text-xl font-bold mb-2 text-slate-900">Reset Password</h2>
            <p className="text-sm text-slate-500 mb-6">Resetting password for: <span className="font-bold text-slate-900">{showResetModal.username}</span></p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">New Password</label>
                <input 
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setShowResetModal(null);
                    setResetPassword('');
                  }}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetPinModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <h2 className="text-xl font-bold mb-2 text-slate-900">Reset Checkout PIN</h2>
            <p className="text-sm text-slate-500 mb-2">
              Set a new checkout PIN for: <span className="font-bold text-slate-900">{showResetPinModal.username}</span>
            </p>
            <p className="text-xs text-slate-500 mb-6">Only Store Owner can reset a forgotten PIN for staff or managers.</p>
            <form onSubmit={handleResetPin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">New 4-6 digit PIN</label>
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={resetPin}
                  onChange={e => setResetPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="1234"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPinModal(null);
                    setResetPin('');
                  }}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800"
                >
                  Reset PIN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Staff;
