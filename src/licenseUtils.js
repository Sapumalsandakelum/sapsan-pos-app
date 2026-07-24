// src/licenseUtils.js
import { db } from './db';

const LICENSE_API_BASE = 'https://sapsanpos.vercel.app';

const DEVICE_ID_KEY = 'pos_device_id';
const LICENSE_STATE_KEY = 'pos_license_state';

const EXPIRY_WARNING_DAYS = 15;     // start showing a "renew soon" notice 15 days out
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

// Synchronous get from localStorage
export const getLicenseState = () => {
  try {
    const saved = localStorage.getItem(LICENSE_STATE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
};

// Async get from multi-layer storage (localStorage + IndexedDB backup)
export const getLicenseStateAsync = async () => {
  try {
    let state = getLicenseState();
    if (state) return state;

    // Fallback to IndexedDB local disk store if localStorage was cleared
    if (db && db.license) {
      const dbSaved = await db.license.get('active_license');
      if (dbSaved) {
        localStorage.setItem(LICENSE_STATE_KEY, JSON.stringify(dbSaved));
        return dbSaved;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Multi-layer local store: writes to localStorage AND IndexedDB
const saveLicenseState = (state) => {
  try {
    localStorage.setItem(LICENSE_STATE_KEY, JSON.stringify(state));
    if (db && db.license) {
      db.license.put({ id: 'active_license', ...state }).catch(err => console.error('IndexedDB license save warning:', err));
    }
  } catch (e) {
    console.error('Error saving license state locally:', e);
  }
};

export const clearLicenseState = () => {
  localStorage.removeItem(LICENSE_STATE_KEY);
  if (db && db.license) {
    db.license.delete('active_license').catch(() => {});
  }
};

// Helper to get days remaining on the active license
export const getLicenseDaysRemaining = () => {
  const state = getLicenseState();
  if (!state || !state.expiresAt) return null;
  const daysLeft = daysUntil(state.expiresAt);
  return daysLeft !== Infinity ? Math.max(0, Math.ceil(daysLeft)) : null;
};

export const getDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateUuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
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

// Call when the app loads (and periodically while it stays open). Returns:
//   { status: 'NEEDS_ACTIVATION' }
//   { status: 'OK', expiresAt, daysRemaining, expiringSoonDays: number|null }
//   { status: 'BLOCKED', reason: 'REVOKED' | 'EXPIRED' | 'ALREADY_ACTIVATED_ELSEWHERE', expiresAt? }
export const checkLicenseStatus = async () => {
  const state = await getLicenseStateAsync();
  if (!state) return { status: 'NEEDS_ACTIVATION' };

  // 1. Try online verification with license server
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
      const daysRemaining = daysLeft !== Infinity ? Math.max(0, Math.ceil(daysLeft)) : null;
      const expiringSoonDays = daysRemaining != null && daysRemaining <= EXPIRY_WARNING_DAYS ? daysRemaining : null;
      return { status: 'OK', expiresAt: data.expiresAt, daysRemaining, expiringSoonDays, clientName: data.clientName, licenseKey: state.licenseKey };
    }
    // Server explicitly rejected (e.g. key revoked) — genuinely blocked
    return { status: 'BLOCKED', reason: data.reason, expiresAt: data.expiresAt };
  } catch (err) {
    // Couldn't reach server (offline / no internet connection)
  }

  // 2. Offline Mode — Fallback to local stored license!
  // If the locally stored license is valid and unexpired (Date.now() < expiresAt), allow POS to run 100% offline!
  const daysLeft = daysUntil(state.expiresAt);
  if (daysLeft <= 0) {
    return { status: 'BLOCKED', reason: 'EXPIRED', expiresAt: state.expiresAt };
  }

  const daysRemaining = daysLeft !== Infinity ? Math.max(0, Math.ceil(daysLeft)) : null;
  const expiringSoonDays = daysRemaining != null && daysRemaining <= EXPIRY_WARNING_DAYS ? daysRemaining : null;
  return { status: 'OK', expiresAt: state.expiresAt, daysRemaining, expiringSoonDays, clientName: state.clientName, licenseKey: state.licenseKey };
};