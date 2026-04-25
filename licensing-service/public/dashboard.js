const adminKeyInput = document.querySelector('#adminKey');
const saveKeyButton = document.querySelector('#saveKeyButton');
const loadButton = document.querySelector('#loadButton');
const statusFilter = document.querySelector('#statusFilter');
const createLicenseForm = document.querySelector('#createLicenseForm');
const latestLicenseCard = document.querySelector('#latestLicenseCard');
const licenseTableBody = document.querySelector('#licenseTableBody');
const healthBadge = document.querySelector('#healthBadge');
const toast = document.querySelector('#toast');
const lifetimeCheckbox = document.querySelector('#isLifetime');
const validityDaysInput = createLicenseForm?.querySelector('[name="validityDays"]');
const accessGate = document.querySelector('#accessGate');
const dashboardAccessForm = document.querySelector('#dashboardAccessForm');
const dashboardPasswordInput = document.querySelector('#dashboardPassword');
const accessError = document.querySelector('#accessError');
const shell = document.querySelector('.shell');

const STORAGE_KEY = 'goodypos-license-admin-key';
const ACCESS_TOKEN_KEY = 'goodypos-license-dashboard-access-token';
adminKeyInput.value = localStorage.getItem(STORAGE_KEY) || '';

const showToast = (message, tone = 'info') => {
  toast.textContent = message;
  toast.className = 'toast';
  if (tone === 'error') {
    toast.style.background = '#991b1b';
  } else if (tone === 'success') {
    toast.style.background = '#166534';
  } else {
    toast.style.background = '#111827';
  }

  clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3200);
};

const getAdminKey = () => String(adminKeyInput.value || '').trim();
const getDashboardAccessToken = () => String(sessionStorage.getItem(ACCESS_TOKEN_KEY) || '').trim();

const setAccessError = (message = '') => {
  if (!accessError) return;
  accessError.textContent = message;
  accessError.classList.toggle('hidden', !message);
};

const setDashboardLocked = (locked) => {
  document.body.classList.toggle('is-locked', locked);
  accessGate?.classList.toggle('hidden', !locked);
  shell?.classList.toggle('shell-locked', locked);

  if (locked) {
    dashboardPasswordInput?.focus();
  } else {
    setAccessError('');
  }
};

const syncLifetimeState = () => {
  if (!lifetimeCheckbox || !validityDaysInput) return;

  if (lifetimeCheckbox.checked) {
    validityDaysInput.value = '0';
    validityDaysInput.disabled = true;
  } else {
    validityDaysInput.disabled = false;
    if (!validityDaysInput.value || Number(validityDaysInput.value) <= 0) {
      validityDaysInput.value = '365';
    }
  }
};

const request = async (path, options = {}) => {
  const adminKey = getAdminKey();
  const dashboardAccessToken = getDashboardAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(dashboardAccessToken ? { 'x-dashboard-access-token': dashboardAccessToken } : {}),
    ...(adminKey ? { 'x-admin-key': adminKey } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'object' && data
      ? (data.error || data.message || 'Request failed')
      : String(data || 'Request failed');

    if (/dashboard password required/i.test(message)) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      setDashboardLocked(true);
      setAccessError('Enter the dashboard password to continue.');
    }

    throw new Error(message);
  }

  return data;
};

const formatDate = (value) => {
  if (!value) return 'Lifetime';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Lifetime' : date.toLocaleString();
};

const statusBadgeClass = (status) => {
  switch (String(status || '').toUpperCase()) {
    case 'ACTIVE':
      return 'badge badge-success';
    case 'REVOKED':
      return 'badge badge-danger';
    case 'EXPIRED':
      return 'badge badge-warning';
    default:
      return 'badge badge-muted';
  }
};

const renderLatestLicense = (license) => {
  if (!license) {
    latestLicenseCard.classList.add('hidden');
    latestLicenseCard.innerHTML = '';
    return;
  }

  latestLicenseCard.classList.remove('hidden');
  latestLicenseCard.innerHTML = `
    <strong>New one-time activation key created</strong>
    <code>${license.licenseKey}</code>
    <div class="row">
      <span class="badge badge-success">${license.status}</span>
      <span class="badge badge-muted">${license.plan}</span>
      <span class="badge badge-muted">${license.storeModeAllowed}</span>
      <span class="badge badge-muted">${formatDate(license.expiresAt)}</span>
    </div>
  `;
};

const renderLicenses = (licenses = []) => {
  if (!licenses.length) {
    licenseTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">No licenses found for this filter.</td></tr>';
    return;
  }

  licenseTableBody.innerHTML = licenses.map((license) => `
    <tr>
      <td>
        <strong>${license.licenseKey}</strong><br />
        <span class="muted">${license.notes || 'No note'}</span>
      </td>
      <td><span class="${statusBadgeClass(license.status)}">${license.status}</span></td>
      <td>${license.plan || '—'}</td>
      <td>
        ${license.issuedToName || '—'}<br />
        <span class="muted">${license.issuedToEmail || '—'}</span>
      </td>
      <td>${license.storeModeAllowed || 'ANY'}</td>
      <td>
        ${license.storeName || 'Not yet activated'}<br />
        <span class="muted">${license.metadata?.lastSeenIp || 'No device check-in yet'}</span>
      </td>
      <td>${formatDate(license.expiresAt)}</td>
      <td>
        <div class="actions">
          <button class="link-button" data-action="copy" data-license="${license.licenseKey}">Copy</button>
          <button class="link-button" data-action="revoke" data-license="${license.licenseKey}">Revoke</button>
          <button class="link-button" data-action="reset" data-license="${license.licenseKey}">Reset Device</button>
          <button class="link-button" data-action="delete" data-license="${license.licenseKey}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
};

const loadLicenses = async () => {
  if (!getDashboardAccessToken()) {
    renderLicenses([]);
    licenseTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">Unlock the dashboard to manage licenses.</td></tr>';
    return;
  }

  if (!getAdminKey()) {
    renderLicenses([]);
    licenseTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">Enter and save the admin API key to manage licenses.</td></tr>';
    return;
  }

  try {
    const status = String(statusFilter.value || '').trim();
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await request(`/api/admin/list-licenses${query}`);
    renderLicenses(Array.isArray(data.licenses) ? data.licenses : []);
    showToast('License list refreshed.', 'success');
  } catch (error) {
    renderLicenses([]);
    showToast(error.message || 'Failed to load licenses.', 'error');
  }
};

const handleActionClick = async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.getAttribute('data-action');
  const licenseKey = button.getAttribute('data-license');
  if (!licenseKey) return;

  try {
    if (action === 'copy') {
      await navigator.clipboard.writeText(licenseKey);
      showToast('License key copied to clipboard.', 'success');
      return;
    }

    if (action === 'revoke') {
      const reason = window.prompt('Reason for revoking this license?', 'Key compromised or cancelled') || '';
      await request('/api/admin/revoke-license', {
        method: 'POST',
        body: JSON.stringify({ licenseKey, reason }),
      });
      showToast('License revoked.', 'success');
      await loadLicenses();
      return;
    }

    if (action === 'reset') {
      const reason = window.prompt('Reason for resetting the device binding?', 'Device changed or OS reinstalled') || '';
      await request('/api/admin/reset-device', {
        method: 'POST',
        body: JSON.stringify({ licenseKey, reason }),
      });
      showToast('Device binding reset.', 'success');
      await loadLicenses();
      return;
    }

    if (action === 'delete') {
      const confirmed = window.confirm(`Delete ${licenseKey}? This permanently removes the license key and cannot be undone.`);
      if (!confirmed) return;

      await request('/api/admin/delete-license', {
        method: 'POST',
        body: JSON.stringify({ licenseKey }),
      });
      showToast('License deleted.', 'success');
      await loadLicenses();
      return;
    }
  } catch (error) {
    showToast(error.message || 'Action failed.', 'error');
  }
};

const checkHealth = async () => {
  try {
    const data = await request('/api/health', { headers: {} });
    healthBadge.textContent = data?.ok ? 'Service online' : 'Service unavailable';
    healthBadge.className = data?.ok ? 'badge badge-success' : 'badge badge-danger';
  } catch {
    healthBadge.textContent = 'Service unavailable';
    healthBadge.className = 'badge badge-danger';
  }
};

saveKeyButton.addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, getAdminKey());
  showToast('Admin key saved in this browser.', 'success');
});

if (dashboardAccessForm) {
  dashboardAccessForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const response = await fetch('/api/auth/dashboard-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: String(dashboardPasswordInput?.value || '').trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Invalid dashboard password');
      }

      sessionStorage.setItem(ACCESS_TOKEN_KEY, String(data.token || ''));
      if (dashboardPasswordInput) dashboardPasswordInput.value = '';
      setDashboardLocked(false);
      showToast('Dashboard unlocked.', 'success');
      await loadLicenses();
    } catch (error) {
      setAccessError(error.message || 'Could not unlock dashboard.');
    }
  });
}

loadButton.addEventListener('click', loadLicenses);
statusFilter.addEventListener('change', loadLicenses);
licenseTableBody.addEventListener('click', handleActionClick);

if (lifetimeCheckbox) {
  lifetimeCheckbox.addEventListener('change', syncLifetimeState);
  syncLifetimeState();
}

createLicenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(createLicenseForm);
  const payload = {
    issuedToName: String(formData.get('issuedToName') || '').trim(),
    issuedToEmail: String(formData.get('issuedToEmail') || '').trim(),
    plan: String(formData.get('plan') || 'STANDARD').trim().toUpperCase(),
    storeModeAllowed: String(formData.get('storeModeAllowed') || 'ANY').trim().toUpperCase(),
    isLifetime: Boolean(lifetimeCheckbox?.checked),
    validityDays: lifetimeCheckbox?.checked ? 0 : Number(formData.get('validityDays') || 365),
    notes: String(formData.get('notes') || '').trim(),
  };

  try {
    const data = await request('/api/admin/create-license', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderLatestLicense(data.license);
    createLicenseForm.reset();
    if (lifetimeCheckbox) lifetimeCheckbox.checked = false;
    syncLifetimeState();
    showToast('New one-time license key created.', 'success');
    await loadLicenses();
  } catch (error) {
    showToast(error.message || 'Could not create the license.', 'error');
  }
});

setDashboardLocked(!getDashboardAccessToken());
checkHealth();
loadLicenses();
