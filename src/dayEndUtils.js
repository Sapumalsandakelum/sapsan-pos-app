// src/dayEndUtils.js
// 📅 Day Session tracking — records when each business day starts and ends,
// and who did it. Kept in its own dedicated IndexedDB database, same safe
// pattern as backups/audit log/main categories — never touches the main POS
// schema in db.js.
import Dexie from 'dexie';

export const daySessionDb = new Dexie('SapSanPOS_DaySessions');
daySessionDb.version(1).stores({
  sessions: '++id, dateKey'
});

const todayKey = () => new Date().toISOString().split('T')[0];

// Call once when a user logs in — starts today's session automatically if
// one doesn't already exist (e.g. first login of a new day).
export const ensureDayStarted = async (username) => {
  const dateKey = todayKey();
  const existing = await daySessionDb.sessions.where('dateKey').equals(dateKey).first();
  if (existing) return existing;

  const id = await daySessionDb.sessions.add({
    dateKey,
    startedAt: new Date().toISOString(),
    startedBy: username || 'Unknown',
    endedAt: null,
    endedBy: null,
    status: 'OPEN',
    cashExpected: null,
    cashCounted: null,
    cashVariance: null,
  });
  return await daySessionDb.sessions.get(id);
};

export const getCurrentDaySession = async () => {
  const dateKey = todayKey();
  return (await daySessionDb.sessions.where('dateKey').equals(dateKey).first()) || null;
};

// Closes today's session — this is a reporting/audit checkpoint (records who
// closed the day and when, plus cash reconciliation if provided). It does
// NOT block new orders from being created afterward — sales can continue
// normally; this just formally marks the close-of-day moment.
export const closeDay = async (username, cashData = {}) => {
  const session = await getCurrentDaySession();
  if (!session) throw new Error('No open day session found for today.');

  const updates = {
    endedAt: new Date().toISOString(),
    endedBy: username,
    status: 'CLOSED',
    cashExpected: cashData.expected ?? null,
    cashCounted: cashData.counted ?? null,
    cashVariance: (cashData.counted != null && cashData.expected != null) ? (cashData.counted - cashData.expected) : null,
  };
  await daySessionDb.sessions.update(session.id, updates);
  return { ...session, ...updates };
};

export const getDaySessionHistory = async () => {
  return await daySessionDb.sessions.orderBy('dateKey').reverse().toArray();
};