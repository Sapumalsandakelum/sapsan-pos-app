// src/licenseUtils.js
// 🔑 License activation for this specific installation. Talks to the small
// Vercel-hosted license API (see /license-server) to bind this PC to one
// license key, and periodically re-checks that it's still valid and not expired.

// 👇 Replace this with your deployed license server URL after running `vercel --prod`
const LICENSE_API_BASE = 'https://sapsanpos.vercel.app';

const DEVICE_ID_KEY = 'pos_device_id';
const LICENSE_STATE_KEY = 'pos_license_state';

const VALIDATE_INTERVAL_DAYS = 3;   // try to check in this often whenever online
const OFFLINE_GRACE_DAYS = 14;      // max stretch allowed without a successful check-in
const EXPIRY_WARNING_DAYS = 14;     // start showing a "renew soon" notice this many days out

const FETCH_TIMEOUT_MS = 6000;

const generateUuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
};

// This ID lives in the browser's local storage — NOT in the project files —
// which is exactly why copying the source folder to another PC doesn't carry
// it along. It's generated once and never regenerated after that.
export const getDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateUuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

export const getLicenseState = () => {
  try {
    const saved = localStorage.getItem(LICENSE_STATE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
};

const saveLicenseState = (state) => {
  localStorage.setItem(LICENSE_STATE_KEY, JSON.stringify(state));
};

export const clearLicenseState = () => {
  localStorage.removeItem(LICENSE_STATE_KEY);
};

const daysSince = (isoString) => {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
};

const daysUntil = (isoString) => {
  if (!isoString) return Infinity;
  return (new Date(isoString).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
};

// Activates this installation with a license key. Call from the activation screen.
export const activateLicense = async (licenseKeyInput) => {
  const licenseKey = licenseKeyInput.trim().toUpperCase();
  const deviceId = getDeviceId();
  try {
    const res = await fetchWithTimeout(`${LICENSE_API_BASE}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceId, clientMeta: navigator.userAgent }),
    });
    const data = await res.json();
    if (data.success) {
      saveLicenseState({
        licenseKey,
        deviceId,
        clientName: data.clientName,
        activatedAt: data.activatedAt,
        expiresAt: data.expiresAt,
        lastValidatedAt: new Date().toISOString(),
      });
    }
    return data;
  } catch (err) {
    return { success: false, reason: 'NETWORK_ERROR' };
  }
};

// Call once when the app loads. Returns:
//   { status: 'NEEDS_ACTIVATION' }
//   { status: 'OK', expiresAt, expiringSoonDays: number|null }
//   { status: 'BLOCKED', reason: 'REVOKED' | 'EXPIRED' | 'ALREADY_ACTIVATED_ELSEWHERE', expiresAt? }
//   { status: 'NEEDS_ONLINE_CHECK' }  — offline too long, must reconnect to keep going
export const checkLicenseStatus = async () => {
  const state = getLicenseState();
  if (!state) return { status: 'NEEDS_ACTIVATION' };

  const staleness = daysSince(state.lastValidatedAt);

  if (staleness >= VALIDATE_INTERVAL_DAYS) {
    try {
      const res = await fetchWithTimeout(`${LICENSE_API_BASE}/api/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: state.licenseKey, deviceId: state.deviceId }),
      });
      const data = await res.json();

      if (data.success) {
        const updated = { ...state, lastValidatedAt: new Date().toISOString(), expiresAt: data.expiresAt, clientName: data.clientName };
        saveLicenseState(updated);
        const daysLeft = daysUntil(data.expiresAt);
        return { status: 'OK', expiresAt: data.expiresAt, expiringSoonDays: daysLeft <= EXPIRY_WARNING_DAYS ? Math.ceil(daysLeft) : null };
      }
      // Server explicitly rejected — genuinely blocked, not just offline
      return { status: 'BLOCKED', reason: data.reason, expiresAt: data.expiresAt };
    } catch (err) {
      // Couldn't reach the server — fall through to the offline grace check below
    }
  }

  if (staleness >= OFFLINE_GRACE_DAYS) {
    return { status: 'NEEDS_ONLINE_CHECK' };
  }

  const daysLeft = daysUntil(state.expiresAt);
  return { status: 'OK', expiresAt: state.expiresAt, expiringSoonDays: daysLeft <= EXPIRY_WARNING_DAYS ? Math.ceil(daysLeft) : null };
};