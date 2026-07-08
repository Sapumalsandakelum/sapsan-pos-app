// src/authUtils.js
// 🔐 Simple session management for the POS login system.
// The session is persisted in localStorage so staff stay logged in across page
// reloads on a shared terminal, until they explicitly log out.

const SESSION_KEY = 'pos_session';

export const getSession = () => {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.error('Failed to read session', e);
    return null;
  }
};

export const saveSession = (user) => {
  const session = {
    id: user.id,
    username: user.username,
    role: user.role, // 'ADMIN' | 'CASHIER'
    loginTime: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};