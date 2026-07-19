// src/dayEndUtils.js
// 📅 Day Session tracking — records when each business day starts and ends,
// and who did it. Kept in its own dedicated IndexedDB database, same safe
// pattern as backups/audit log/main categories — never touches the main POS
// schema in db.js.
import Dexie from 'dexie';

export const daySessionDb = new Dexie('SapSanPOS_DaySessions');
daySessionDb.version(2).stores({
  sessions: '++id, dateKey, status'
});

const todayKey = () => new Date().toISOString().split('T')[0];

// Returns the currently active (OPEN) day session if any exists
export const getActiveSession = async () => {
  return (await daySessionDb.sessions.where('status').equals('OPEN').first()) || null;
};

// Returns the most recently started session, whether OPEN or CLOSED
export const getMostRecentSession = async () => {
  const all = await daySessionDb.sessions.toArray();
  if (all.length === 0) return null;
  // Sort descending by startedAt
  all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return all[0];
};

// Manually start a new day session
export const startNewDaySession = async (username) => {
  const openSession = await getActiveSession();
  if (openSession) return openSession;

  const dateKey = todayKey();
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

// Maintained for backward compatibility or direct calls
export const ensureDayStarted = async (username) => {
  return await startNewDaySession(username);
};

// Returns the session for the Day End screen (the most recent session)
export const getCurrentDaySession = async () => {
  return await getMostRecentSession();
};

// Closes the currently active open session (records who closed the day and when, plus cash reconciliation if provided)
export const closeDay = async (username, cashData = {}) => {
  const session = await getActiveSession();
  if (!session) throw new Error('No open day session found.');

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