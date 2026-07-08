// src/backupUtils.js
// 💾 Local data backup & restore — snapshots everything (categories, items, orders,
// admin accounts/passwords, and all app settings) into the browser's own local
// storage once a day automatically, plus lets you download/restore a full backup
// file manually.
//
// Note: browsers can't silently write files to a folder on disk without a user
// gesture each time (security sandboxing) — so the daily backup is auto-saved
// inside the app's own local storage (no interaction needed, survives restarts),
// and a manual "download" button is provided to save an actual .json file whenever
// you want an off-device copy.

import { db } from './db';

const BACKUP_INDEX_KEY = 'pos_backup_index';   // list of backup dates currently kept
const BACKUP_PREFIX = 'pos_backup_';           // + YYYY-MM-DD = one day's snapshot
const LAST_BACKUP_DATE_KEY = 'pos_last_backup_date';
const MAX_BACKUPS_KEPT = 14; // rolling window — oldest auto-pruned beyond this

// All the localStorage keys that hold app configuration outside the Dexie database
const LOCAL_STORAGE_KEYS = [
  'pos_printer_mapping',
  'pos_paired_bluetooth_devices',
  'pos_bill_design_settings',
  'restaurant_tables',
  'pos_daily_order_counter',
];

const todayKey = () => new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// Builds one full snapshot of everything in the system right now
export const buildFullBackup = async () => {
  const [categories, items, orders, admins] = await Promise.all([
    db.categories.toArray(),
    db.items.toArray(),
    db.orders.toArray(),
    db.admins.toArray(),
  ]);

  const settings = {};
  LOCAL_STORAGE_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  });

  return {
    _backupType: 'SAPSAN_POS_BACKUP',
    _backupVersion: 1,
    createdAt: new Date().toISOString(),
    data: { categories, items, orders, admins },
    settings,
  };
};

// Saves a snapshot into local storage under today's date, pruning old ones beyond
// the rolling window. Returns the backup object.
export const saveBackupSnapshot = async () => {
  const backup = await buildFullBackup();
  const dateKey = todayKey();

  localStorage.setItem(`${BACKUP_PREFIX}${dateKey}`, JSON.stringify(backup));

  let index = [];
  try {
    const savedIndex = localStorage.getItem(BACKUP_INDEX_KEY);
    index = savedIndex ? JSON.parse(savedIndex) : [];
  } catch (e) {
    index = [];
  }

  if (!index.includes(dateKey)) index.push(dateKey);
  index.sort();

  while (index.length > MAX_BACKUPS_KEPT) {
    const oldest = index.shift();
    localStorage.removeItem(`${BACKUP_PREFIX}${oldest}`);
  }

  localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(index));
  localStorage.setItem(LAST_BACKUP_DATE_KEY, dateKey);

  return backup;
};

// Call once when the app loads — runs the backup only if it hasn't already run today.
// Returns true if a backup was actually taken, false if one already existed for today.
export const runDailyBackupIfNeeded = async () => {
  const lastBackupDate = localStorage.getItem(LAST_BACKUP_DATE_KEY);
  if (lastBackupDate === todayKey()) return false;
  try {
    await saveBackupSnapshot();
    return true;
  } catch (err) {
    console.error('Auto-backup failed:', err);
    return false;
  }
};

// Lists all backups currently kept, newest first, with row counts for display
export const listBackups = () => {
  try {
    const savedIndex = localStorage.getItem(BACKUP_INDEX_KEY);
    const index = savedIndex ? JSON.parse(savedIndex) : [];
    return index
      .map((dateKey) => {
        try {
          const raw = localStorage.getItem(`${BACKUP_PREFIX}${dateKey}`);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return {
            dateKey,
            createdAt: parsed.createdAt,
            counts: {
              categories: parsed.data?.categories?.length || 0,
              items: parsed.data?.items?.length || 0,
              orders: parsed.data?.orders?.length || 0,
              admins: parsed.data?.admins?.length || 0,
            },
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  } catch (e) {
    return [];
  }
};

export const getBackupByDateKey = (dateKey) => {
  try {
    const raw = localStorage.getItem(`${BACKUP_PREFIX}${dateKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

// Triggers a browser download of a backup object as a .json file
export const downloadBackupFile = (backup) => {
  const filename = `sapsan-pos-backup-${backup.createdAt.split('T')[0]}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Reads an uploaded .json backup file into a JS object
export const readBackupFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(new Error('Could not read this file — it may not be a valid backup.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsText(file);
  });
};

// Restores a backup object — REPLACES all current categories, items, orders, and
// admin accounts with what's in the backup, and restores app settings too.
// Caller is responsible for confirming with the user first (this is destructive).
export const restoreFromBackup = async (backup) => {
  if (!backup || backup._backupType !== 'SAPSAN_POS_BACKUP' || !backup.data) {
    throw new Error('This does not look like a valid SapSan POS backup file.');
  }

  const { categories = [], items = [], orders = [], admins = [] } = backup.data;

  await db.transaction('rw', db.categories, db.items, db.orders, db.admins, async () => {
    await db.categories.clear();
    await db.items.clear();
    await db.orders.clear();
    await db.admins.clear();

    if (categories.length) await db.categories.bulkPut(categories);
    if (items.length) await db.items.bulkPut(items);
    if (orders.length) await db.orders.bulkPut(orders);
    if (admins.length) await db.admins.bulkPut(admins);
  });

  if (backup.settings) {
    Object.entries(backup.settings).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
  }
};