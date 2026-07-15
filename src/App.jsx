// src/App.jsx
import React, { useState, useEffect } from 'react';
import POSFlow from './POSFlow';
import AdminPanel from './AdminPanel';
import DashboardScreen from './DashboardScreen';
import LoginPage from './LoginPage';
import DayEndReport from './DayEndReport';
import { getSession, clearSession } from './authUtils';
import { runDailyBackupIfNeeded } from './backupUtils';
import { initLanSync, onSyncConnectionChange, getSyncStatus } from './lanSync';
import { ensureDayStarted } from './dayEndUtils';
import LicenseGate from './LicenseGate';
import Swal from 'sweetalert2';

function AppContent() {
  const [session, setSession] = useState(() => getSession());
  const [currentScreen, setCurrentScreen] = useState('BILLING'); // BILLING, ADMIN, or DASHBOARD

  // Bumped every time the Billing tab is clicked — forces POSFlow to remount
  // fresh (back to the Main Category screen). Must live here, above the
  // early-return below, so this hook is always called on every render
  // regardless of login state — React requires the same hooks in the same
  // order on every render, and putting this after the early return caused a
  // hook-count mismatch between logged-out (fewer hooks) and logged-in
  // (more hooks) renders, which crashed the whole app on login/logout.
  const [billingResetKey, setBillingResetKey] = useState(0);

  // 🌐 Live LAN sync connection status, shown in the nav bar so it's visible
  // from any screen without needing to open Admin Panel to check
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());
  useEffect(() => {
    const unsubscribe = onSyncConnectionChange(setSyncStatus);
    return unsubscribe;
  }, []);

  // 💾 Runs once per app load — internally skips itself if today's backup already happened
  useEffect(() => {
    runDailyBackupIfNeeded();
    initLanSync();
  }, []);

  // 📅 Starts today's Day Session the moment someone logs in, if it hasn't
  // already been started today by anyone else. No-ops if already started.
  useEffect(() => {
    if (session) ensureDayStarted(session.username);
  }, [session]);

  // 🔐 Not logged in yet (or no accounts exist at all) — show login / first-time setup
  if (!session) {
    return <LoginPage onLoginSuccess={setSession} />;
  }

  const isAdmin = session.role === 'ADMIN';

  const handleLogout = () => {
    Swal.fire({
      title: 'Log out?',
      text: "You'll need to sign in again to continue.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Logout'
    }).then((result) => {
      if (result.isConfirmed) {
        clearSession();
        setSession(null);
        setCurrentScreen('BILLING');
      }
    });
  };

  // Cashiers see Billing and Day End — Dashboard/Admin Panel stay admin-only
  const handleTabClick = (screen) => {
    const cashierAllowed = screen === 'BILLING' || screen === 'DAY_END';
    if (!cashierAllowed && !isAdmin) return;
    if (screen === 'BILLING') setBillingResetKey((k) => k + 1);
    setCurrentScreen(screen);
  };

  return (
    <div className="w-full min-h-screen bg-gray-100 flex flex-col">
      {/* 🔝 TOP NAVIGATION BAR */}
      <nav className="bg-white border-b px-4 py-2 flex justify-between items-center shadow-sm shrink-0 z-40">
        <div className="flex items-center space-x-2">
          <span className="text-2xl font-black text-indigo-600 tracking-tighter">SapSan POS</span>
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md font-black">v2.0</span>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => handleTabClick('BILLING')}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'BILLING' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            🛒 Billing Screen
          </button>

          <button
            onClick={() => handleTabClick('DAY_END')}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'DAY_END' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            📊 Day End
          </button>

          {isAdmin && (
            <button
              onClick={() => handleTabClick('DASHBOARD')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'DASHBOARD' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              📈 Dashboard
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => handleTabClick('ADMIN')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'ADMIN' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ⚙️ Admin Panel
            </button>
          )}

          {/* 🌐 LAN Sync status — always visible, no need to open Admin Panel to check */}
          {syncStatus !== 'not_configured' && (
            <div
              title={
                syncStatus === 'connected' ? 'Syncing live with other PCs' :
                syncStatus === 'connecting' ? 'Connecting to Sync Server...' :
                'Not connected — working on local data only'
              }
              className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-xl font-black text-[10px] ml-2 ${
                syncStatus === 'connected' ? 'bg-emerald-50 text-emerald-600' :
                syncStatus === 'connecting' ? 'bg-amber-50 text-amber-600' :
                'bg-red-50 text-red-500'
              }`}
            >
              <span>{syncStatus === 'connected' ? '🟢' : syncStatus === 'connecting' ? '🟡' : '🔴'}</span>
              <span className="hidden sm:inline">{syncStatus === 'connected' ? 'Synced' : syncStatus === 'connecting' ? 'Syncing...' : 'Offline'}</span>
            </div>
          )}

          {/* 👤 Logged-in user + Logout — shown for both Admin and Cashier */}
          <div className="flex items-center space-x-2 ml-2 pl-3 border-l">
            <div className="flex items-center space-x-1.5 bg-gray-50 border rounded-xl px-2.5 py-1.5">
              <span className="text-sm">{isAdmin ? '👑' : '🧑‍💼'}</span>
              <div className="leading-tight">
                <div className="text-[11px] font-black text-gray-700">{session.username}</div>
                <div className="text-[9px] font-bold text-gray-400 uppercase">{session.role}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center space-x-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2.5 py-1.5 rounded-xl font-black text-[11px] transition"
            >
              <span>🚪</span>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </nav>

      {/* 📲 SCREEN RENDERING */}
      <main className="flex-1 overflow-hidden">
        {currentScreen === 'BILLING' && <POSFlow key={billingResetKey} currentUser={session} onLogout={handleLogout} />}

        {currentScreen === 'DAY_END' && (
          <DayEndReport onBack={() => setCurrentScreen('BILLING')} />
        )}

        {currentScreen === 'DASHBOARD' && isAdmin && (
          <DashboardScreen onBackToBilling={() => setCurrentScreen('BILLING')} />
        )}

        {currentScreen === 'ADMIN' && isAdmin && (
          <AdminPanel
            onBackToBilling={() => setCurrentScreen('BILLING')}
            onNavigate={(screen) => setCurrentScreen(screen)}
            currentUser={session}
            onLogout={handleLogout}
          />
        )}
      </main>
    </div>
  );
}

// License check happens before anything else — even before the login screen —
// since it's about this installation as a whole, not any particular user.
export default function App() {
  return (
    <LicenseGate>
      <AppContent />
    </LicenseGate>
  );
}