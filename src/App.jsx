// src/App.jsx
import React, { useState, useEffect } from 'react';
import POSFlow from './POSFlow';
import AdminPanel from './AdminPanel';
import DashboardScreen from './DashboardScreen';
import LoginPage from './LoginPage';
import { getSession, clearSession } from './authUtils';
import { runDailyBackupIfNeeded } from './backupUtils';
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

  // 💾 Runs once per app load — internally skips itself if today's backup already happened
  useEffect(() => {
    runDailyBackupIfNeeded();
  }, []);

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

  // Cashiers only ever see Billing — guards direct calls too, not just hidden buttons
  const handleTabClick = (screen) => {
    if (screen !== 'BILLING' && !isAdmin) return;
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