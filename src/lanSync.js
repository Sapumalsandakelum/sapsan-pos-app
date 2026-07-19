// src/lanSync.js
// 🌐 Real-time LAN sync — mirrors orders/items/categories/admins across every
// PC on the same local network (WiFi or Ethernet) in near-real-time, with no
// internet dependency. One PC runs the sync server (see /sapsan-lan-server);
// every other PC's app connects to it over the LAN.
//
// Design: each PC keeps using its own local Dexie database exactly as before
// (offline-first, zero changes needed to BillingScreen/AdminPanel/etc). This
// module hooks into Dexie's built-in create/update/delete hooks for the
// synced tables — every local write is relayed to the server, which
// broadcasts it to every other connected PC. Those PCs apply the change to
// their own local database. Since every screen already reads from local
// Dexie via useLiveQuery, they update automatically the instant the change
// lands — no changes needed anywhere else in the app.
//
// Why not just use each PC's local auto-increment id to identify records
// across PCs? Because two different PCs can independently create records
// that happen to get the same local id (e.g. both create their 5th order
// today) — syncing by that id would silently overwrite unrelated records.
// Instead, every synced record also gets a globally-unique `globalId`
// (a UUID) the first time it's created, and that's what's used to match
// "is this the same logical record" across different PCs' local copies.
import { io } from 'socket.io-client';
import { db } from './db';

const SYNC_SERVER_KEY = 'pos_lan_sync_server_url';
const SYNCED_TABLES = ['orders', 'items', 'categories', 'admins'];

export const getSyncServerUrl = () => localStorage.getItem(SYNC_SERVER_KEY) || '';
export const setSyncServerUrl = (url) => {
  const clean = url.trim().replace(/\/$/, '');
  localStorage.setItem(SYNC_SERVER_KEY, clean);
  return clean;
};
export const clearSyncServerUrl = () => localStorage.removeItem(SYNC_SERVER_KEY);

let socket = null;
let hooksAttached = false;
let isApplyingRemoteChange = false; // guard against relay feedback loops
let connectionListeners = [];

export const onSyncConnectionChange = (callback) => {
  connectionListeners.push(callback);
  callback(getSyncStatus()); // fire immediately with current state
  return () => { connectionListeners = connectionListeners.filter(cb => cb !== callback); };
};
const notifyConnectionListeners = (status) => connectionListeners.forEach(cb => cb(status));

const generateGlobalId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// One-time migration: records created before this sync system existed won't
// have a globalId yet — assign them one so they participate in sync too.
const backfillGlobalIds = async () => {
  for (const tableName of SYNCED_TABLES) {
    const table = db[tableName];
    const all = await table.toArray();
    const missing = all.filter(r => !r.globalId);
    if (missing.length > 0) {
      await table.bulkPut(missing.map(r => ({ ...r, globalId: generateGlobalId() })));
    }
  }
};

const findLocalByGlobalId = async (tableName, globalId) => {
  const table = db[tableName];
  const all = await table.toArray(); // a single restaurant's dataset is small — fine to scan
  return all.find(r => r.globalId === globalId) || null;
};

const applyRemoteChange = async (change) => {
  const { table: tableName, globalId, operation, payload } = change || {};
  if (!SYNCED_TABLES.includes(tableName) || !globalId) return;

  isApplyingRemoteChange = true;
  try {
    const table = db[tableName];
    const existing = await findLocalByGlobalId(tableName, globalId);

    if (operation === 'delete') {
      if (existing) await table.delete(existing.id);
      return;
    }

    if (existing) {
      // Already have this record locally — update it, keeping our own local id
      const { id, ...rest } = payload || {};
      await table.update(existing.id, { ...rest, globalId });
    } else {
      // New to us — insert as a new local record, let Dexie assign a local id
      const { id, ...rest } = payload || {};
      await table.add({ ...rest, globalId });
    }
  } catch (err) {
    console.error(`LAN sync: failed to apply remote change for ${tableName}:`, err);
  } finally {
    isApplyingRemoteChange = false;
  }
};

const pushLocalChange = (tableName, operation, obj) => {
  if (isApplyingRemoteChange) return; // don't echo back a change we just received
  if (!socket || !socket.connected) return; // offline — server catches us up on reconnect
  if (!obj || !obj.globalId) return;
  socket.emit('push_change', { table: tableName, globalId: obj.globalId, operation, payload: obj });
};

const attachHooks = () => {
  if (hooksAttached) return;
  hooksAttached = true;

  SYNCED_TABLES.forEach((tableName) => {
    const table = db[tableName];

    table.hook('creating', function (primKey, obj) {
      if (!obj.globalId) obj.globalId = generateGlobalId();
      const snapshot = { ...obj };
      this.onsuccess = () => pushLocalChange(tableName, 'create', snapshot);
    });

    table.hook('updating', function (modifications, primKey, obj) {
      const merged = { ...obj, ...modifications };
      this.onsuccess = () => pushLocalChange(tableName, 'update', merged);
    });

    table.hook('deleting', function (primKey, obj) {
      const globalId = obj.globalId;
      this.onsuccess = () => {
        if (globalId) pushLocalChange(tableName, 'delete', { globalId });
      };
    });
  });
};

const runFullSync = () => {
  return new Promise((resolve) => {
    socket.emit('request_full_sync', SYNCED_TABLES, async (result) => {
      if (!result || !result.success) { resolve(); return; }
      isApplyingRemoteChange = true;
      try {
        for (const tableName of SYNCED_TABLES) {
          const table = db[tableName];
          const records = result.data[tableName] || [];
          for (const rec of records) {
            const existing = await findLocalByGlobalId(tableName, rec.globalId);
            const { id, ...rest } = rec.payload || {};
            if (existing) {
              await table.update(existing.id, { ...rest, globalId: rec.globalId });
            } else {
              await table.add({ ...rest, globalId: rec.globalId });
            }
          }
        }
      } catch (err) {
        console.error('LAN sync: full sync failed:', err);
      } finally {
        isApplyingRemoteChange = false;
        resolve();
      }
    });
  });
};

// Call once when the app loads. No-ops silently if no server has been configured yet.
export const initLanSync = async () => {
  const serverUrl = getSyncServerUrl();
  if (!serverUrl) return;

  await backfillGlobalIds();
  attachHooks();
  connectToServer(serverUrl);
};

export const connectToServer = (serverUrl) => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  attachHooks();

  notifyConnectionListeners('connecting');
  socket = io(serverUrl, { reconnectionDelay: 2000 });

  socket.on('connect', async () => {
    await runFullSync(); // catch up on anything missed while disconnected
    notifyConnectionListeners('connected');
  });

  socket.on('disconnect', () => notifyConnectionListeners('disconnected'));
  socket.on('connect_error', () => notifyConnectionListeners('error'));
  socket.on('remote_change', (change) => applyRemoteChange(change));
};

export const disconnectFromServer = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  clearSyncServerUrl();
  notifyConnectionListeners('not_configured');
};

export const getSyncStatus = () => {
  if (!getSyncServerUrl()) return 'not_configured';
  if (!socket) return 'disconnected';
  return socket.connected ? 'connected' : 'disconnected';
};