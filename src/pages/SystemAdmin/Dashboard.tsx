import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { Store, Plus, UserPlus, ShieldCheck, LayoutGrid, ListFilter, Loader2, Lock, Unlock, Trash2, Key, Users, X, Home, RotateCcw, Eraser, Package, Download, Upload, ShieldAlert, RefreshCw } from 'lucide-react';
import { useNotification } from '../../context/NotificationContext';
import ConfirmActionModal from '../../components/ConfirmActionModal';

const SystemAdminDashboard: React.FC = () => {
  const { showNotification } = useNotification();
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<any>(null);
  const [showUsersModal, setShowUsersModal] = useState<any>(null);
  const [storeUsers, setStoreUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [confirmAction, setConfirmAction] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [licenseConfig, setLicenseConfig] = useState<any>(null);
  const [creatingStore, setCreatingStore] = useState(false);
  
  const [storeForm, setStoreForm] = useState({ name: '', mode: 'SUPERMARKET', licenseKey: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'STORE_ADMIN', store_id: '' });
  const [resetPassword, setResetPassword] = useState('');
  
  // Profile Password Change State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  // Recycle Bin & Holds States
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [deletedProducts, setDeletedProducts] = useState<any[]>([]);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [clearingHolds, setClearingHolds] = useState(false);

  // Recovery Audit Log
  const [auditLines, setAuditLines] = useState<string[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);

  // Demo Seeder
  const [seedingDemo, setSeedingDemo] = useState(false);
  const seedDemo = async () => {
    if (!window.confirm('This will create GoodyTech Smart Retail + GoodyMart Supermarket demo stores with full activity data. Continue?')) return;
    setSeedingDemo(true);
    try {
      const res = await appFetch('/api/admin/seed-demo', { method: 'POST' });
      showNotification({ message: res.message || 'Demo data seeded!', type: 'success' });
      void loadStores();
    } catch (err: any) {
      showNotification({ message: String(err.message), type: 'error' });
    } finally {
      setSeedingDemo(false);
    }
  };

  const toggleLock = (id: string, currentLock: number, storeName: string) => {
    setConfirmAction({
      type: 'toggle-lock',
      storeId: id,
      currentLock,
      storeName,
      title: currentLock ? 'Unlock Store' : 'Lock Store',
      description: currentLock
        ? `Restore access for ${storeName} and allow the team to continue working.`
        : `Temporarily restrict access for ${storeName} until you unlock it again.`,
      confirmLabel: currentLock ? 'Yes, Unlock Store' : 'Yes, Lock Store',
      tone: 'warning',
    });
  };

  const deleteStore = (id: string, storeName: string) => {
    setConfirmAction({
      type: 'delete-store',
      storeId: id,
      storeName,
      title: 'Delete Store Permanently',
      description: 'This will remove all products, sales, customers, held transactions, and users for this store.',
      confirmLabel: 'Yes, Delete Store',
      tone: 'danger',
    });
  };

  const loadDeletedProducts = async () => {
    setLoadingDeleted(true);
    try {
      const data = await appFetch('/api/admin/inventory/deleted');
      setDeletedProducts(data);
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setLoadingDeleted(false);
    }
  };

  const restoreProduct = async (id: number) => {
    try {
      await appFetch(`/api/admin/inventory/restore/${id}`, { method: 'POST' });
      loadDeletedProducts();
      showNotification({ message: 'Product restored successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const clearAllHolds = () => {
    setConfirmAction({
      type: 'clear-holds',
      title: 'Clear All Held Transactions',
      description: 'Every held transaction across all stores will be erased and cannot be recovered.',
      confirmLabel: 'Yes, Clear Holds',
      tone: 'danger',
    });
  };

  const handleProfilePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      showNotification({ message: 'New passwords do not match', type: 'error' });
      return;
    }
    setChangingPassword(true);
    try {
      await appFetch('/api/auth/profile/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword
        })
      });
      showNotification({ message: 'Password changed successfully', type: 'success' });
      setShowProfileModal(false);
      setProfileForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      showNotification({ message: String(err.message), type: 'error' });
    } finally {
      setChangingPassword(false);
    }
  };

  const loadAuditLog = async () => {
    setLoadingAudit(true);
    try {
      const data = await appFetch('/api/admin/recovery-audit-log');
      setAuditLines(Array.isArray(data?.lines) ? data.lines : []);
    } catch {
      setAuditLines([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    void loadStores();
    void loadLicenseConfig();
  }, []);

  const loadLicenseConfig = async () => {
    try {
      const data = await appFetch('/api/license/status');
      setLicenseConfig(data);
    } catch (err) {
      console.warn('License configuration check failed:', err);
      setLicenseConfig({
        configured: false,
        connected: false,
        connectionError: 'Could not check the current license server status.',
        requiredForNewStores: false,
        activationRequiresInternet: true,
        activationMode: 'ONLINE_ONLY_FIRST_ACTIVATION',
        deviceName: 'This device',
      });
    }
  };

  const loadStores = async () => {
    try {
      const data = await appFetch('/api/admin/stores');
      setStores(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (storeId: number, storeName: string) => {
    try {
      const data = await appFetch(`/api/admin/store/export?storeId=${storeId}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${storeName.replace(/\s+/g, '_')}_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showNotification({ message: 'Export failed: ' + err.message, type: 'error' });
    }
  };

  const handleImport = (storeId: number, file: File, storeName: string) => {
    setConfirmAction({
      type: 'import-store',
      storeId,
      storeName,
      file,
      fileName: file.name,
      title: 'Import Store Backup',
      description: 'This backup will overwrite the current store records with the selected file.',
      confirmLabel: 'Yes, Import Backup',
      tone: 'warning',
    });
  };

  const runConfirmedAction = async () => {
    if (!confirmAction?.type || actionLoading) return;

    const pendingAction = confirmAction;
    setActionLoading(true);
    try {
      if (pendingAction.type === 'toggle-lock') {
        await appFetch(`/api/admin/stores/${pendingAction.storeId}/lock`, {
          method: 'PUT',
          body: JSON.stringify({ is_locked: !pendingAction.currentLock })
        });
        await loadStores();
        showNotification({
          message: pendingAction.currentLock ? 'Store unlocked successfully' : 'Store locked successfully',
          type: 'success'
        });
      }

      if (pendingAction.type === 'delete-store') {
        const result = await appFetch(`/api/admin/stores/${pendingAction.storeId}`, { method: 'DELETE' });
        await loadStores();
        showNotification({
          message: result?.alreadyDeleted ? 'Store was already removed' : 'Store deleted successfully',
          type: 'success'
        });
      }

      if (pendingAction.type === 'clear-holds') {
        setClearingHolds(true);
        await appFetch('/api/admin/holds/clear', { method: 'DELETE' });
        showNotification({ message: 'All held transactions cleared successfully', type: 'success' });
      }

      if (pendingAction.type === 'import-store') {
        if (!pendingAction.file) throw new Error('No file selected for import');
        const rawText = await pendingAction.file.text();
        const data = JSON.parse(rawText);
        await appFetch(`/api/admin/store/import`, {
          method: 'POST',
          body: JSON.stringify({ data, storeId: pendingAction.storeId })
        });
        await loadStores();
        showNotification({ message: 'Store data imported successfully!', type: 'success' });
      }

      setConfirmAction(null);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setActionLoading(false);
      setClearingHolds(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();

    if (licenseConfig?.requiredForNewStores !== false && licenseConfig?.connected === false) {
      showNotification({
        message: String(
          licenseConfig?.connectionError
            || 'The configured license server is currently unavailable. Update the deployment URL before creating a new store.',
        ),
        type: 'error',
      });
      return;
    }

    setCreatingStore(true);
    try {
      const payload = {
        name: storeForm.name,
        mode: storeForm.mode,
        licenseKey: storeForm.licenseKey.trim(),
      };

      const result = await appFetch('/api/admin/stores', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setShowStoreModal(false);
      setStoreForm({ name: '', mode: 'SUPERMARKET', licenseKey: '' });
      await loadStores();
      await loadLicenseConfig();
      showNotification({
        message: result?.licenseActivated ? 'Store deployed and license activated successfully' : 'Store deployed successfully',
        type: 'success',
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setCreatingStore(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedUsername = userForm.username.trim();
    const selectedStore = stores.find((store) => String(store.id) === String(userForm.store_id));

    if (!normalizedUsername) {
      showNotification({ message: 'Username is required', type: 'error' });
      return;
    }

    if (selectedStore?.owner_id) {
      showNotification({
        message: `This store already has an owner (${selectedStore.owner_username || 'existing owner'}). Reset or replace that account instead.`,
        type: 'error',
      });
      return;
    }

    try {
      await appFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...userForm, username: normalizedUsername }),
      });
      setShowUserModal(false);
      setUserForm({ username: '', password: '', role: 'STORE_ADMIN', store_id: '' });
      await loadStores();
      showNotification({ message: 'Store owner created successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
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

  const loadStoreUsers = async (storeId: string) => {
    setLoadingUsers(true);
    setStoreUsers([]);
    try {
      const data = await appFetch(`/api/admin/users?store_id=${storeId}`);
      const resolvedUsers = Array.isArray(data)
        ? data
        : (Array.isArray(data?.users) ? data.users : []);
      setStoreUsers(resolvedUsers);
    } catch (err) {
      setStoreUsers([]);
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setLoadingUsers(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  const selectedOwnerStore = stores.find((store) => String(store.id) === String(userForm.store_id));

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Command Center</h1>
          <p className="text-slate-500">Manage root operations and store deployments</p>
        </div>
        <div className="flex gap-4">
          <Link to="/admin" className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-50 hover:text-slate-700 transition-colors border border-slate-200">
            <Home size={16} /> Home
          </Link>
          <button 
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-50 hover:text-slate-700 transition-colors border border-slate-200"
          >
            <Lock size={16} /> My Password
          </button>
          <button
            onClick={() => {
              setShowRecycleBin(true);
              loadDeletedProducts();
            }}
            className="flex items-center gap-2 bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors border border-slate-200"
          >
            <Trash2 size={16} /> Recycle Bin
          </button>
          <button
            onClick={() => { setShowAuditLog(true); loadAuditLog(); }}
            className="flex items-center gap-2 bg-rose-900/20 text-rose-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-rose-100 transition-colors border border-rose-700/30"
          >
            <ShieldAlert size={16} /> Recovery Log
          </button>
          <button
            onClick={clearAllHolds}
            disabled={clearingHolds}
            className="flex items-center gap-2 bg-amber-900/20 text-amber-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-amber-100 transition-colors border border-amber-700/30"
          >
            {clearingHolds ? <Loader2 className="animate-spin" size={16} /> : <Eraser size={16} />}
            Clear All Holds
          </button>
          <button
            onClick={seedDemo}
            disabled={seedingDemo}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors border border-indigo-700"
          >
            {seedingDemo ? <Loader2 className="animate-spin" size={16} /> : <span>🎭</span>}
            Seed Demo Data
          </button>
          <button
            onClick={() => setShowStoreModal(true)}
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus size={18} /> New Store
          </button>
          <button 
            onClick={() => setShowUserModal(true)}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-red-700 transition-colors"
          >
            <UserPlus size={18} /> New Store Owner
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stores.map(store => (
          <div key={store.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-100 rounded-xl">
                <Store className="text-slate-900" />
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => toggleLock(store.id, store.is_locked, store.name)}
                  className={`p-2 rounded-lg transition-colors ${
                    store.is_locked ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'
                  }`}
                  title={store.is_locked ? 'Unlock Store' : 'Lock Store'}
                >
                  {store.is_locked ? <Lock size={16} /> : <Unlock size={16} />}
                </button>
                <button
                  onClick={() => {
                    setShowUsersModal(store);
                    loadStoreUsers(store.id);
                  }}
                  className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                  title="Manage All Users"
                >
                  <Users size={16} />
                </button>
                {store.owner_id && (
                  <button
                    onClick={() => setShowResetModal({ id: store.owner_id, username: store.owner_username })}
                    className="p-2 bg-amber-100 text-amber-600 rounded-lg hover:bg-amber-200 transition-colors"
                    title="Reset Owner Password"
                  >
                    <Key size={16} />
                  </button>
                )}
                <button
                  onClick={() => handleExport(store.id, store.name)}
                  className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors"
                  title="Export Store Data"
                >
                  <Download size={16} />
                </button>
                <label className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors cursor-pointer" title="Import Store Data">
                  <Upload size={16} />
                  <input 
                    type="file" 
                    className="hidden" 
                    accept=".json" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImport(store.id, file, store.name);
                      e.target.value = ''; // Reset
                    }} 
                  />
                </label>
                <button
                  onClick={() => deleteStore(store.id, store.name)}
                  className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                  title="Delete Store"
                >
                  <Trash2 size={16} />
                </button>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  store.mode === 'SUPERMARKET' ? 'bg-blue-100 text-blue-400' : 'bg-purple-100 text-purple-700'
                }`}>
                  {store.mode}
                </span>
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{store.name}</h3>
            <p className="text-sm text-slate-500 mb-4">{store.address || 'No address set'}</p>
            <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${
              store.is_locked ? 'text-red-500' : 'text-slate-400'
            }`}>
              {store.is_locked ? (
                <><Lock size={14} /> Store Locked</>
              ) : (
                <><ShieldCheck size={14} /> Active Deployment</>
              )}
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              <p>
                <span className="font-semibold text-slate-300">License:</span>{' '}
                {store.license_key
                  ? `${String(store.license_key).slice(0, 7)}••••${String(store.license_key).slice(-4)}`
                  : 'Legacy / not linked yet'}
              </p>
              <p>
                <span className="font-semibold text-slate-300">Status:</span>{' '}
                {String(store.license_status || 'UNLICENSED').toUpperCase() === 'ACTIVE'
                  ? 'Active'
                  : 'Unlicensed'}
                {store.license_plan ? ` • ${store.license_plan}` : ''}
              </p>
              {store.license_activated_at && (
                <p>
                  <span className="font-semibold text-slate-300">Activated:</span>{' '}
                  {new Date(store.license_activated_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmActionModal
        isOpen={Boolean(confirmAction)}
        title={confirmAction?.title || 'Confirm Action'}
        description={confirmAction?.description || ''}
        confirmLabel={confirmAction?.confirmLabel || 'Continue'}
        tone={confirmAction?.tone || 'warning'}
        loading={actionLoading}
        onClose={() => {
          if (!actionLoading) setConfirmAction(null);
        }}
        onConfirm={runConfirmedAction}
        details={confirmAction ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-300">
            {confirmAction.storeName && (
              <p>
                <span className="font-bold text-slate-900">Store:</span> {confirmAction.storeName}
              </p>
            )}
            {confirmAction.fileName && (
              <p className="mt-1">
                <span className="font-bold text-slate-900">Backup File:</span> {confirmAction.fileName}
              </p>
            )}
            {confirmAction.type === 'delete-store' && (
              <p className="mt-1 text-red-600">This action is permanent and cannot be undone.</p>
            )}
          </div>
        ) : null}
      />

      {/* Profile Password Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900">Change My Password</h2>
              <button onClick={() => setShowProfileModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleProfilePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Current Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.currentPassword}
                  onChange={e => setProfileForm({...profileForm, currentPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">New Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.newPassword}
                  onChange={e => setProfileForm({...profileForm, newPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.confirmPassword}
                  onChange={e => setProfileForm({...profileForm, confirmPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={changingPassword}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  {changingPassword ? <Loader2 className="animate-spin" size={18} /> : <Key size={18} />}
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recycle Bin Modal */}
      {showRecycleBin && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 z-[80]">
          <div className="bg-slate-900 max-w-4xl w-full rounded-[40px] p-10 border border-slate-800 shadow-2xl flex flex-col max-h-[85vh]">
            <header className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-black">Inventory Recycle Bin</h2>
                <p className="text-slate-400">Restore soft-deleted products to their respective stores</p>
              </div>
              <button onClick={() => setShowRecycleBin(false)} className="text-slate-500 hover:text-white"><X size={32} /></button>
            </header>

            <div className="flex-1 overflow-auto space-y-4 pr-2">
              {loadingDeleted ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-red-500" size={48} /></div>
              ) : deletedProducts.length === 0 ? (
                <div className="text-center py-20 text-slate-500">
                  <Trash2 size={64} className="mx-auto mb-4 opacity-20" />
                  <p className="text-xl font-bold">Recycle bin is empty</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {deletedProducts.map(product => (
                    <div key={product.id} className="bg-slate-800/50 border border-slate-700 p-6 rounded-3xl flex items-center justify-between hover:bg-slate-800 transition-colors group">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-slate-900 rounded-2xl overflow-hidden border border-slate-700">
                          {product.thumbnail ? (
                            <img src={product.thumbnail} alt={product.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Package className="w-full h-full p-4 text-slate-300" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">{product.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-slate-500">
                            <span className="bg-slate-700 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">Store ID: {product.store_id}</span>
                            <span>Deleted: {new Date(product.deleted_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => restoreProduct(product.id)}
                        className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-600/10"
                      >
                        <RotateCcw size={18} /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Store Modal */}
      {showStoreModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <h2 className="text-xl font-bold mb-6 text-slate-900">Deploy New Store</h2>
            <form onSubmit={handleCreateStore} className="space-y-4">
              <div className={`rounded-xl border p-3 text-sm ${!licenseConfig?.configured
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : licenseConfig?.connected === false
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                <p className="font-semibold">
                  {!licenseConfig?.configured
                    ? 'License server not configured yet'
                    : licenseConfig?.connected === false
                      ? 'License server unavailable'
                      : 'License server connected'}
                </p>
                <p className="mt-1">
                  Internet is required for first activation only. This device will identify itself as {licenseConfig?.deviceName || 'this device'}.
                </p>
                {licenseConfig?.connected === false && licenseConfig?.connectionError ? (
                  <p className="mt-2 text-xs font-medium">{licenseConfig.connectionError}</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Store Name</label>
                <input
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={storeForm.name}
                  onChange={e => setStoreForm({...storeForm, name: e.target.value})}
                  placeholder="e.g. Downtown Gadgets"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">One-Time License Key</label>
                <input
                  required={licenseConfig?.requiredForNewStores !== false}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={storeForm.licenseKey}
                  onChange={e => setStoreForm({ ...storeForm, licenseKey: e.target.value.toUpperCase() })}
                  placeholder="GDP-ABCDE-FGHIJ-KLMNO"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Ask the Super System Owner for a one-time key before deploying a new store.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Business Mode</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setStoreForm({...storeForm, mode: 'SUPERMARKET'})}
                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                      storeForm.mode === 'SUPERMARKET' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <ListFilter />
                    <span className="text-xs font-bold">Supermarket</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStoreForm({...storeForm, mode: 'GADGET'})}
                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                      storeForm.mode === 'GADGET' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <LayoutGrid />
                    <span className="text-xs font-bold">Smart Retail Store</span>
                  </button>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    if (!creatingStore) {
                      setShowStoreModal(false);
                      setStoreForm({ name: '', mode: 'SUPERMARKET', licenseKey: '' });
                    }
                  }}
                  disabled={creatingStore}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={creatingStore || (licenseConfig?.requiredForNewStores !== false && licenseConfig?.connected === false)}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingStore ? 'Deploying...' : 'Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <h2 className="text-xl font-bold mb-6 text-slate-900">Create Store Owner</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Assign to Store</label>
                <select
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                  value={userForm.store_id}
                  onChange={e => setUserForm({...userForm, store_id: e.target.value})}
                >
                  <option value="">Select a store...</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {selectedOwnerStore?.owner_id && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This store already has an owner: <span className="font-semibold">{selectedOwnerStore.owner_username}</span>.
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Username</label>
                <input
                  required
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={userForm.username}
                  onChange={e => setUserForm({...userForm, username: e.target.value})}
                  placeholder="owner_user"
                />
                <p className="mt-1 text-xs text-slate-500">Must be unique across the whole system, even if the only difference is letter casing.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={userForm.password}
                  onChange={e => setUserForm({...userForm, password: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={Boolean(selectedOwnerStore?.owner_id)}
                  className="flex-1 p-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create Owner
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

      {/* Users Modal */}
      {showUsersModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white max-w-2xl w-full rounded-2xl p-8 shadow-2xl text-slate-900">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Manage Users</h2>
                <p className="text-sm text-slate-500">Store: {showUsersModal.name}</p>
              </div>
              <button 
                onClick={() => setShowUsersModal(null)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
              >
                <X size={24} />
              </button>
            </div>

            {loadingUsers ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" /></div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] tracking-widest">
                      <tr>
                        <th className="px-6 py-3">Username</th>
                        <th className="px-6 py-3">Role</th>
                        <th className="px-6 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {storeUsers.map(user => (
                        <tr key={user.id} className="hover:bg-white transition-colors">
                          <td className="px-6 py-4 font-medium">{user.username}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              user.role === 'STORE_ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-400'
                            }`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => setShowResetModal(user)}
                              className="p-2 text-amber-600 hover:bg-amber-900/20 rounded-lg transition-colors"
                              title="Reset Password"
                            >
                              <Key size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Recovery Audit Log Modal */}
      {showAuditLog && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 z-[80]">
          <div className="bg-slate-900 max-w-3xl w-full rounded-2xl border border-slate-800 shadow-2xl flex flex-col max-h-[85vh]">
            <header className="flex justify-between items-center px-6 py-5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-900/20">
                  <ShieldAlert className="h-5 w-5 text-rose-400" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-rose-400">Security</p>
                  <h2 className="text-lg font-black text-white">Recovery Audit Log</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadAuditLog} disabled={loadingAudit} className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
                  <RefreshCw size={16} className={loadingAudit ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setShowAuditLog(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {loadingAudit ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="animate-spin text-rose-400" size={36} />
                </div>
              ) : auditLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <ShieldAlert size={48} className="mb-3 opacity-20" />
                  <p className="font-bold">No recovery activity recorded yet.</p>
                </div>
              ) : (
                auditLines.map((line, i) => {
                  const isFlagged = line.includes('FLAGGED_IP_LOGIN');
                  const isSuccess = line.includes('RECOVERY_SUCCESS');
                  const isLockout = line.includes('RECOVERY_LOCKOUT') || line.includes('RECOVERY_BLOCKED');
                  const isFailed = line.includes('RECOVERY_FAILED');

                  const tagColor = isFlagged
                    ? 'bg-red-950/60 border-red-500/50 text-red-200'
                    : isSuccess
                    ? 'bg-amber-950/60 border-amber-400/50 text-amber-200'
                    : isLockout
                    ? 'bg-rose-950/60 border-rose-500/50 text-rose-200'
                    : isFailed
                    ? 'bg-orange-950/60 border-orange-400/50 text-orange-200'
                    : 'bg-slate-800 border-slate-700 text-slate-300';

                  return (
                    <div key={i} className={`rounded-xl border px-4 py-3 font-mono text-xs leading-relaxed ${tagColor}`}>
                      {line}
                    </div>
                  );
                })
              )}
            </div>

            <footer className="px-6 py-3 border-t border-slate-800 text-xs text-slate-500">
              Log file: <span className="font-mono text-slate-400">recovery-audit.log</span> — stored next to <span className="font-mono text-slate-400">pos.db</span> on this device
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemAdminDashboard;
