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
import { getActiveSession, startNewDaySession } from './dayEndUtils';
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

  const [activeDaySession, setActiveDaySession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const checkActiveSession = async () => {
    if (!session) {
      setLoadingSession(false);
      return;
    }
    try {
      const active = await getActiveSession();
      setActiveDaySession(active);
      if (active) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (active.dateKey !== todayStr) {
          Swal.fire({
            title: '⚠️ Previous Day Not Closed!',
            html: `The business day for <b>${active.dateKey}</b> (started by ${active.startedBy}) was not closed.<br/><br/>Please perform Day End to close it.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '📊 Go to Day End',
            cancelButtonText: '🔄 Continue Shift',
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#6b7280'
          }).then((result) => {
            if (result.isConfirmed) {
              setCurrentScreen('DAY_END');
            }
          });
        }
      }
    } catch (err) {
      console.error('Failed to check active session', err);
    } finally {
      setLoadingSession(false);
    }
  };

  const triggerStartDayPrompt = () => {
    if (!session) return;
    const todayStr = new Date().toISOString().split('T')[0];
    Swal.fire({
      title: '🟢 Start Business Day?',
      html: `Would you like to start the business day for <b>${todayStr}</b>?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '🚀 Start Day',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#059669',
      cancelButtonColor: '#6b7280'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const newSession = await startNewDaySession(session.username);
          setActiveDaySession(newSession);
          Swal.fire({
            title: 'Day Started! ✅',
            text: `Business day for ${newSession.dateKey} is now open.`,
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
          });
        } catch (err) {
          Swal.fire({
            title: 'Error starting day',
            text: err.message,
            icon: 'error'
          });
        }
      }
    });
  };

  useEffect(() => {
    checkActiveSession();
  }, [session]);

  // Automatically prompt to start the day when entering the Billing Screen if day session is not started
  useEffect(() => {
    if (currentScreen === 'BILLING' && !activeDaySession && !loadingSession) {
      triggerStartDayPrompt();
    }
  }, [currentScreen, activeDaySession, loadingSession]);

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
      <main className="flex-1 overflow-hidden flex flex-col h-full">
        {currentScreen === 'BILLING' && (
          activeDaySession ? (
            <POSFlow key={billingResetKey} currentUser={session} onLogout={handleLogout} activeDaySession={activeDaySession} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
              <div className="max-w-md w-full text-center space-y-6 bg-white p-8 rounded-3xl border border-gray-200 shadow-xl relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
                <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-emerald-400 via-teal-500 to-indigo-600"></div>
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 text-5xl mb-2">
                  🗓️
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black text-gray-800 tracking-tight">Business Day Not Started</h2>
                  <p className="text-xs font-semibold text-gray-500 leading-relaxed max-w-sm mx-auto">
                    You need to start the business day before you can place orders, print tickets, or manage billing.
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    onClick={triggerStartDayPrompt}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm shadow-md hover:shadow-lg transition-all duration-150 flex items-center justify-center space-x-2 group cursor-pointer"
                  >
                    <span>🚀</span>
                    <span>Start Business Day</span>
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {currentScreen === 'DAY_END' && (
          <DayEndReport onBack={() => setCurrentScreen('BILLING')} onDayClosed={checkActiveSession} />
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