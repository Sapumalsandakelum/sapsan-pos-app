// src/LicenseGate.jsx
import React, { useState, useEffect } from 'react';
import { activateLicense, checkLicenseStatus } from './licenseUtils';
import { DEVELOPER_CREDIT_LINE_1, DEVELOPER_CREDIT_LINE_2 } from './printUtils';

const BLOCK_MESSAGES = {
  ALREADY_ACTIVATED_ELSEWHERE: 'This license key is already active on a different device. Each key can only be used on one PC.',
  REVOKED: 'This license has been deactivated.',
  EXPIRED: 'This license has expired.',
  INVALID_KEY: 'This license key was not found. Please check it and try again.',
  NETWORK_ERROR: 'Could not reach the license server. Please check your internet connection and try again.',
};

export default function LicenseGate({ children }) {
  const [status, setStatus] = useState('CHECKING');
  const [blockReason, setBlockReason] = useState(null);
  const [expiryInfo, setExpiryInfo] = useState(null); // { expiresAt, expiringSoonDays }
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [dismissedWarning, setDismissedWarning] = useState(false);

  const runCheck = async () => {
    setStatus('CHECKING');
    const result = await checkLicenseStatus();
    setStatus(result.status);
    setBlockReason(result.reason || null);
    if (result.status === 'OK') {
      setExpiryInfo({ expiresAt: result.expiresAt, expiringSoonDays: result.expiringSoonDays });
    }
  };

  useEffect(() => {
    runCheck();
  }, []);

  const handleActivate = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!licenseKeyInput.trim()) {
      setErrorMsg('Please enter your license key.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await activateLicense(licenseKeyInput);
      if (result.success) {
        setStatus('OK');
        setExpiryInfo({ expiresAt: result.expiresAt, expiringSoonDays: null });
      } else {
        setErrorMsg(BLOCK_MESSAGES[result.reason] || 'Could not activate. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'CHECKING') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white/60 text-sm font-bold animate-pulse">Checking license...</div>
      </div>
    );
  }

  if (status === 'OK') {
    return (
      <>
        {expiryInfo?.expiringSoonDays != null && !dismissedWarning && (
          <div className="bg-amber-500 text-white text-xs font-black px-4 py-2 flex items-center justify-between print:hidden">
            <span>
              ⚠️ Your license expires in {expiryInfo.expiringSoonDays} day{expiryInfo.expiringSoonDays === 1 ? '' : 's'}
              {' '}— contact {DEVELOPER_CREDIT_LINE_1} ({DEVELOPER_CREDIT_LINE_2}) to renew.
            </span>
            <button onClick={() => setDismissedWarning(true)} className="ml-3 text-white/80 hover:text-white font-black">✕</button>
          </div>
        )}
        {children}
      </>
    );
  }

  // NEEDS_ACTIVATION, BLOCKED, or NEEDS_ONLINE_CHECK all render this screen
  const isBlocked = status === 'BLOCKED';
  const needsOnline = status === 'NEEDS_ONLINE_CHECK';

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-200">
            {isBlocked ? '🔒' : '🔑'}
          </div>
          <h2 className="text-lg font-black text-gray-800">
            {isBlocked ? 'License Issue' : needsOnline ? 'Verification Needed' : 'Activate SapSan POS'}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {isBlocked && (BLOCK_MESSAGES[blockReason] || 'There is a problem with this license.')}
            {needsOnline && 'This device hasn\'t checked in for a while. Please connect to the internet so we can verify your license.'}
            {!isBlocked && !needsOnline && 'Enter the license key provided by SapSan Technologies to activate this installation.'}
          </p>
        </div>

        {isBlocked ? (
          <div className="text-center space-y-3">
            <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl p-3">
              Please contact {DEVELOPER_CREDIT_LINE_1} at {DEVELOPER_CREDIT_LINE_2} to resolve this{blockReason === 'EXPIRED' ? ' and renew your license' : ''}.
            </div>
            <button onClick={runCheck} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 p-2.5 rounded-xl font-black text-xs transition">
              🔄 Check Again
            </button>
          </div>
        ) : needsOnline ? (
          <button onClick={runCheck} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl font-black text-sm transition">
            🔄 Try Again
          </button>
        ) : (
          <form onSubmit={handleActivate} className="space-y-3">
            <input
              type="text"
              value={licenseKeyInput}
              onChange={(e) => setLicenseKeyInput(e.target.value)}
              placeholder="SAPSAN-XXXX-XXXX-XXXX"
              className="w-full p-3 border rounded-xl font-bold text-sm text-center tracking-wider uppercase focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              autoFocus
              autoComplete="off"
            />
            {errorMsg && (
              <div className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{errorMsg}</div>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white p-3 rounded-xl font-black text-sm transition"
            >
              {isSubmitting ? '⏳ Activating...' : '🔓 Activate'}
            </button>
            <p className="text-[10px] text-gray-400 text-center pt-1">
              Don't have a key? Contact {DEVELOPER_CREDIT_LINE_1} — {DEVELOPER_CREDIT_LINE_2}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}