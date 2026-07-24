// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import POSFlow from './POSFlow';
import AdminPanel from './AdminPanel';
import DashboardScreen from './DashboardScreen';
import ErrorBoundary from './ErrorBoundary';
import LoginPage from './LoginPage';
import DayEndReport from './DayEndReport';
import { getSession, clearSession } from './authUtils';
import { runDailyBackupIfNeeded } from './backupUtils';
import { initLanSync, onSyncConnectionChange, getSyncStatus } from './lanSync';
import { getActiveSession, startNewDaySession } from './dayEndUtils';
import { logActivity } from './auditUtils';
import LicenseGate, { useLicense } from './LicenseGate';
import { DEVELOPER_CREDIT_LINE_1, DEVELOPER_CREDIT_LINE_2 } from './printUtils';
import Swal from 'sweetalert2';
import QuickCalculatorModal from './QuickCalculatorModal';

import { db, cleanupOrphanedPendingOrders } from './db';

function AppContent() {
  const { daysRemaining, expiringSoonDays, expiresAt, licenseKey, clientName } = useLicense();
  const [session, setSession] = useState(() => getSession());
  const [currentScreen, setCurrentScreen] = useState('BILLING'); // BILLING, ADMIN, or DASHBOARD
  const [isCalcOpen, setIsCalcOpen] = useState(false);

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
    cleanupOrphanedPendingOrders();
  }, []);

  const [activeDaySession, setActiveDaySession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [showDayStatusModal, setShowDayStatusModal] = useState(false);

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
          setShowDayStatusModal(true);
        }
      }
    } catch (err) {
      console.error('Failed to check active session', err);
    } finally {
      setLoadingSession(false);
    }
  };

  const isStartDayPromptOpenRef = useRef(false);

  const triggerStartDayPrompt = () => {
    if (!session) return;
    if (isStartDayPromptOpenRef.current || Swal.isVisible()) return;
    isStartDayPromptOpenRef.current = true;

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
      isStartDayPromptOpenRef.current = false;
      if (result.isConfirmed) {
        try {
          const newSession = await startNewDaySession(session.username);
          setActiveDaySession(newSession);
          await logActivity({
            actionType: 'DAY_OPEN',
            category: 'SESSION',
            description: `Started business day for ${newSession.dateKey}`,
            details: { dateKey: newSession.dateKey, startedAt: newSession.startedAt },
            performedBy: session.username
          });
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

  const handleDayClosed = async () => {
    await checkActiveSession();
    setBillingResetKey((k) => k + 1);
    setCurrentScreen('BILLING');
  };

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

  // Cashiers see Billing and Day End — Dashboard/Admin Panel stay admin-only.
  // STRICT GATING: Without an active open day session, navigation to Billing, Dashboard, or Admin is blocked.
  const handleTabClick = (screen) => {
    if (!activeDaySession && screen !== 'DAY_END') {
      Swal.fire({
        icon: 'warning',
        title: 'Business Day Closed 🔒',
        text: 'You must open/start the business day first before accessing any other section.',
        confirmButtonColor: '#059669',
        confirmButtonText: '🚀 Open Day'
      }).then((result) => {
        if (result.isConfirmed) triggerStartDayPrompt();
      });
      return;
    }
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
          
          {/* Day Status Badge */}
          <button
            onClick={() => setShowDayStatusModal(true)}
            title="Click to view current business day status, perform Day End, or start shift"
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-black ml-2 border cursor-pointer hover:opacity-80 transition ${
              activeDaySession 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <span>{activeDaySession ? '🟢' : '🔴'}</span>
            <span>{activeDaySession ? `Day Open (${activeDaySession.dateKey})` : 'Day Closed'}</span>
          </button>

          {/* Quick Calculator Button (Icon Only) */}
          <button
            onClick={() => setIsCalcOpen(true)}
            title="Open Calculator"
            className="flex items-center justify-center px-2 py-1 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-black transition shadow-xs cursor-pointer ml-1"
          >
            <span>🧮</span>
          </button>

          {/* 🔑 License Status Badge — Shown ONLY when 15 days or fewer remain before license expiration */}
          {daysRemaining != null && daysRemaining <= 15 && (
            <button
              onClick={() => {
                Swal.fire({
                  title: '🔑 License Expiration Warning',
                  html: `
                    <div class="text-left space-y-3 text-xs font-bold text-gray-700">
                      <div class="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl space-y-2">
                        <div class="flex justify-between items-center">
                          <span class="text-gray-500">License Status:</span>
                          <span class="font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md text-[11px]">EXPIRING SOON</span>
                        </div>
                        <div class="flex justify-between items-center">
                          <span class="text-gray-500">Days Remaining:</span>
                          <span class="font-black text-red-600 text-sm">
                            ${daysRemaining} Days
                          </span>
                        </div>
                        ${expiresAt ? `<div class="flex justify-between items-center"><span class="text-gray-500">Expiration Date:</span><span class="font-black text-gray-800">${new Date(expiresAt).toLocaleDateString()}</span></div>` : ''}
                        ${clientName ? `<div class="flex justify-between items-center"><span class="text-gray-500">Licensed To:</span><span class="font-bold text-gray-700">${clientName}</span></div>` : ''}
                      </div>
                      <p class="text-[11px] text-gray-400 text-center pt-1">
                        To renew or extend your subscription, contact:<br/>
                        <b class="text-gray-700">${DEVELOPER_CREDIT_LINE_1}</b> (${DEVELOPER_CREDIT_LINE_2})
                      </p>
                    </div>
                  `,
                  confirmButtonText: 'Close',
                  confirmButtonColor: '#f59e0b',
                  customClass: { popup: 'rounded-3xl' }
                });
              }}
              title="License expiring soon! Click to view details"
              className="flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-black border cursor-pointer hover:opacity-80 transition ml-1 bg-amber-100 border-amber-300 text-amber-900 animate-pulse shadow-xs"
            >
              <span>🔑</span>
              <span>{daysRemaining}d Left</span>
            </button>
          )}
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => handleTabClick('BILLING')}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'BILLING' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            🛒 Billing Screen {!activeDaySession && '🔒'}
          </button>

          {isAdmin && (
            <button
              onClick={() => handleTabClick('DASHBOARD')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'DASHBOARD' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              📈 Dashboard {!activeDaySession && '🔒'}
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => handleTabClick('ADMIN')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'ADMIN' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              ⚙️ Admin Panel {!activeDaySession && '🔒'}
            </button>
          )}

          {/* 🌐 LAN Sync status */}
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

          {/* 👤 Logged-in user + Logout */}
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

      {/* 📅 DAY SESSION STATUS OVERVIEW MODAL */}
      {showDayStatusModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl text-center text-xs relative overflow-hidden border">
            <div className={`absolute top-0 left-0 right-0 h-2 ${
              activeDaySession 
                ? (activeDaySession.dateKey !== new Date().toISOString().split('T')[0] ? 'bg-amber-500' : 'bg-emerald-500') 
                : 'bg-red-500'
            }`}></div>
            
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl mx-auto ${
              activeDaySession 
                ? (activeDaySession.dateKey !== new Date().toISOString().split('T')[0] ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200')
                : 'bg-red-50 text-red-600 border border-red-200'
            }`}>
              {activeDaySession ? (activeDaySession.dateKey !== new Date().toISOString().split('T')[0] ? '⚠️' : '🗓️') : '🔒'}
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-black text-gray-800">
                {activeDaySession 
                  ? (activeDaySession.dateKey !== new Date().toISOString().split('T')[0]
                      ? '⚠️ Previous Day Still Active'
                      : 'Business Day Currently Active') 
                  : 'Business Day Closed'}
              </h3>
              <p className="text-[11px] text-gray-500">
                {activeDaySession 
                  ? (activeDaySession.dateKey !== new Date().toISOString().split('T')[0]
                      ? `System date is ${new Date().toISOString().split('T')[0]}, but the session started on ${activeDaySession.dateKey} is still open.`
                      : 'Details of the business day currently started:') 
                  : 'No business day is currently open.'}
              </p>
            </div>

            {activeDaySession ? (
              <div className="bg-gray-50 border rounded-2xl p-3 text-left space-y-1.5 font-medium text-[11px] text-gray-700">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-gray-400">Started Day:</span>
                  <span className={`font-black ${activeDaySession.dateKey !== new Date().toISOString().split('T')[0] ? 'text-amber-600 font-black' : 'text-emerald-700'}`}>
                    {activeDaySession.dateKey} {activeDaySession.dateKey !== new Date().toISOString().split('T')[0] && '(Yesterday / Previous)'}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-gray-400">Started At:</span>
                  <span className="font-bold">{new Date(activeDaySession.startedAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-gray-400">Started By:</span>
                  <span className="font-bold text-gray-900">{activeDaySession.startedBy}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-gray-400">License Status:</span>
                  <span className={`font-black ${daysRemaining != null && daysRemaining <= 15 ? 'text-red-600' : 'text-emerald-700'}`}>
                    🔑 {daysRemaining != null ? `${daysRemaining} Days Left` : 'Active'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-red-700 font-bold text-center">
                🔴 Day Status: CLOSED
                {daysRemaining != null && (
                  <div className="text-[11px] font-black text-gray-600 mt-1">
                    🔑 License: <span className={daysRemaining <= 15 ? 'text-red-600 font-black' : 'text-emerald-700'}>{daysRemaining} Days Remaining</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 pt-1">
              {activeDaySession ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setShowDayStatusModal(false); setCurrentScreen('DAY_END'); }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-black transition text-xs shadow-md"
                  >
                    📊 Day End
                  </button>
                  <button
                    onClick={() => setShowDayStatusModal(false)}
                    className="bg-gray-800 hover:bg-black text-white py-3 rounded-xl font-black transition text-xs"
                  >
                    🔄 Continue Shift
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowDayStatusModal(false); triggerStartDayPrompt(); }}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-xl font-black transition text-xs shadow-md"
                >
                  🚀 Open / Start New Day
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 📲 SCREEN RENDERING & DAY OPEN GATING */}
      <main className="flex-1 overflow-hidden flex flex-col h-full">
        {!activeDaySession && currentScreen !== 'DAY_END' ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-gray-100 p-6">
            <div className="max-w-md w-full text-center space-y-6 bg-white p-8 rounded-3xl border border-gray-200 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500"></div>
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-5xl mb-2 shadow-inner">
                🗓️
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-gray-800 tracking-tight">Business Day Closed</h2>
                <p className="text-xs font-semibold text-gray-500 leading-relaxed max-w-sm mx-auto">
                  System Access Locked: You must open the business day before using Billing, Tables, or Admin Settings.
                </p>
              </div>
              <div className="pt-2">
                <button
                  onClick={triggerStartDayPrompt}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm shadow-lg hover:shadow-xl transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>🚀</span>
                  <span>Open / Start Business Day</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {currentScreen === 'BILLING' && (
              <POSFlow
                key={billingResetKey}
                currentUser={session}
                onLogout={handleLogout}
                activeDaySession={activeDaySession}
                onNavigateToDayEnd={() => setCurrentScreen('DAY_END')}
              />
            )}

            {currentScreen === 'DAY_END' && (
              <DayEndReport onBack={() => setCurrentScreen('BILLING')} onDayClosed={handleDayClosed} />
            )}

            {currentScreen === 'DASHBOARD' && isAdmin && (
              <DashboardScreen onBackToBilling={() => setCurrentScreen('BILLING')} />
            )}

            {currentScreen === 'ADMIN' && isAdmin && (
              <ErrorBoundary>
                <AdminPanel
                  onBackToBilling={() => setCurrentScreen('BILLING')}
                  onNavigate={(screen) => setCurrentScreen(screen)}
                  currentUser={session}
                  onLogout={handleLogout}
                />
              </ErrorBoundary>
            )}
          </>
        )}
      </main>

      <QuickCalculatorModal isOpen={isCalcOpen} onClose={() => setIsCalcOpen(false)} />
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