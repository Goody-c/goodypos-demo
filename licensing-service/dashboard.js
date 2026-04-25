const adminKeyInput = document.querySelector('#adminKey');
const saveKeyButton = document.querySelector('#saveKeyButton');
const loadButton = document.querySelector('#loadButton');
const statusFilter = document.querySelector('#statusFilter');
const createLicenseForm = document.querySelector('#createLicenseForm');
const latestLicenseCard = document.querySelector('#latestLicenseCard');
const licenseTableBody = document.querySelector('#licenseTableBody');
const healthBadge = document.querySelector('#healthBadge');
const toast = document.querySelector('#toast');

const STORAGE_KEY = 'goodypos-license-admin-key';
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

const request = async (path, options = {}) => {
  const adminKey = getAdminKey();
  const headers = {
    'Content-Type': 'application/json',
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
    throw new Error(message);
  }

  return data;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
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
        </div>
      </td>
    </tr>
  `).join('');
};

const loadLicenses = async () => {
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

loadButton.addEventListener('click', loadLicenses);
statusFilter.addEventListener('change', loadLicenses);
licenseTableBody.addEventListener('click', handleActionClick);

createLicenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(createLicenseForm);
  const payload = {
    issuedToName: String(formData.get('issuedToName') || '').trim(),
    issuedToEmail: String(formData.get('issuedToEmail') || '').trim(),
    plan: String(formData.get('plan') || 'STANDARD').trim().toUpperCase(),
    storeModeAllowed: String(formData.get('storeModeAllowed') || 'ANY').trim().toUpperCase(),
    validityDays: Number(formData.get('validityDays') || 365),
    notes: String(formData.get('notes') || '').trim(),
  };

  try {
    const data = await request('/api/admin/create-license', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderLatestLicense(data.license);
    createLicenseForm.reset();
    createLicenseForm.querySelector('[name="validityDays"]').value = '365';
    showToast('New one-time license key created.', 'success');
    await loadLicenses();
  } catch (error) {
    showToast(error.message || 'Could not create the license.', 'error');
  }
});

checkHealth();
loadLicenses();
