// src/LoginPage.jsx
import React, { useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { saveSession } from './authUtils';
import { DEVELOPER_CREDIT_LINE_1, DEVELOPER_CREDIT_LINE_2 } from './printUtils';

const FEATURES = [
  { icon: '🖨️', title: 'Bluetooth Thermal Printing', desc: 'KOT, BOT & Bills print instantly — Bluetooth, USB, or Serial.' },
  { icon: '🧾', title: 'Fully Customizable Bills', desc: 'Your logo, store info, font sizes — every bill your way.' },
  { icon: '📊', title: 'Live Sales Reports', desc: 'Daily, monthly, per-item, per-cashier — always up to date.' },
  { icon: '🔐', title: 'Role-Based Access', desc: 'Admins and cashiers get exactly the access they need.' },
  { icon: '📶', title: 'Works Fully Offline', desc: 'Runs entirely on your device — no internet, no downtime.' },
];

export default function LoginPage({ onLoginSuccess }) {
  const adminCount = useLiveQuery(() => db.admins.count());
  const isLoading = adminCount === undefined;
  const isBootstrapping = adminCount === 0; // no accounts exist yet — first-time setup

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState(''); // setup mode only
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    const usernameInput = username.trim();
    const passwordInput = password.trim();
    if (!usernameInput || !passwordInput) {
      setErrorMsg('Please enter both username and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      const matchedUser = await db.admins.where('username').equalsIgnoreCase(usernameInput).first();
      if (matchedUser && matchedUser.password === passwordInput) {
        const session = saveSession(matchedUser);
        onLoginSuccess(session);
      } else {
        setErrorMsg('Incorrect username or password.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    const usernameInput = username.trim();
    const passwordInput = password.trim();
    if (!usernameInput || !passwordInput) {
      setErrorMsg('Please choose a username and password.');
      return;
    }
    if (passwordInput.length < 4) {
      setErrorMsg('Password should be at least 4 characters.');
      return;
    }
    if (passwordInput !== confirmPassword.trim()) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      const newId = await db.admins.add({ username: usernameInput, password: passwordInput, role: 'ADMIN' });
      const newUser = { id: newId, username: usernameInput, role: 'ADMIN' };
      const session = saveSession(newUser);
      Swal.fire({ icon: 'success', title: 'Admin Account Created! 🎉', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
      onLoginSuccess(session);
    } catch (err) {
      console.error(err);
      setErrorMsg('Could not create the account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white/60 text-sm font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-white">

      {/* LEFT — Branding & Marketing Panel */}
      <div className="relative lg:w-[55%] bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white p-8 sm:p-12 flex flex-col justify-between overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl"></div>
        <div className="pointer-events-none absolute bottom-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl"></div>

        <div className="relative z-10">
          <div className="flex items-center space-x-2 mb-8">
            <span className="text-3xl">🍽️</span>
            <span className="text-xs font-black tracking-[0.2em] text-indigo-300 uppercase">{DEVELOPER_CREDIT_LINE_1}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black leading-tight mb-3">
            Restaurant POS<br/>System
          </h1>
          <p className="text-indigo-200 text-sm max-w-md mb-10">
            Fast, offline-first billing built for busy restaurants — printing, kitchen tickets, and reports, all in one place.
          </p>

          <div className="space-y-4 max-w-md">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start space-x-3">
                <span className="text-xl shrink-0">{f.icon}</span>
                <div>
                  <div className="font-black text-sm">{f.title}</div>
                  <div className="text-indigo-300 text-xs">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 mt-10 bg-white/10 backdrop-blur border border-white/10 rounded-2xl p-4 max-w-md">
          <div className="text-xs font-black text-indigo-200 uppercase tracking-wide mb-1">Want this system for your restaurant?</div>
          <div className="text-sm font-bold">Call {DEVELOPER_CREDIT_LINE_1}</div>
          <div className="text-lg font-black text-emerald-400">{DEVELOPER_CREDIT_LINE_2}</div>
        </div>
      </div>

      {/* RIGHT — Login / First-Time Setup Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-200">🔐</div>
            <h2 className="text-xl font-black text-gray-800">{isBootstrapping ? 'Create Admin Account' : 'Welcome Back'}</h2>
            <p className="text-xs text-gray-400 mt-1">
              {isBootstrapping ? 'Set up the first admin account to get started.' : 'Sign in to continue to your POS.'}
            </p>
          </div>

          <form onSubmit={isBootstrapping ? handleSetup : handleLogin} className="space-y-3 bg-white p-6 rounded-2xl border shadow-sm">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-3 border rounded-xl font-bold text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                placeholder="e.g. manager1"
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 pr-12 border rounded-xl font-bold text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  placeholder="••••••••"
                  autoComplete={isBootstrapping ? 'new-password' : 'current-password'}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {isBootstrapping && (
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-3 border rounded-xl font-bold text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            )}

            {errorMsg && (
              <div className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{errorMsg}</div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white p-3 rounded-xl font-black text-sm transition shadow-md shadow-indigo-100"
            >
              {isSubmitting ? '⏳ Please wait...' : isBootstrapping ? '🚀 Create Account & Continue' : '🔓 Login'}
            </button>

            {!isBootstrapping && (
              <p className="text-[10px] text-gray-400 text-center pt-1">Forgot your password? Ask an Admin to reset it from Profile Settings.</p>
            )}
          </form>

          <p className="text-center text-[10px] text-gray-300 mt-6 font-bold tracking-wide">
            {DEVELOPER_CREDIT_LINE_1} · {DEVELOPER_CREDIT_LINE_2}
          </p>
        </div>
      </div>
    </div>
  );
}