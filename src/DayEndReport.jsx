// src/DayEndReport.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { getCurrentDaySession, closeDay } from './dayEndUtils';
import { auditDb } from './auditUtils';

export default function DayEndReport({ onBack }) {
  const settledOrders = useLiveQuery(() => db.orders.where('status').equals('SETTLED').toArray()) || [];
  const deletedItemsLog = useLiveQuery(() => auditDb.deletedItems.toArray()) || [];
  const deletedBillsLog = useLiveQuery(() => auditDb.deletedBills.toArray()) || [];

  const [daySession, setDaySession] = useState(null);
  const [cashCounted, setCashCounted] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminCheckLoading, setAdminCheckLoading] = useState(false);

  useEffect(() => {
    getCurrentDaySession().then(setDaySession);
  }, []);

  const todayStr = new Date().toDateString();
  const todaysOrders = settledOrders.filter(o => o.settledDate && new Date(o.settledDate).toDateString() === todayStr);
  const todaysDeletedItems = deletedItemsLog.filter(l => new Date(l.deletedAt).toDateString() === todayStr);
  const todaysDeletedBills = deletedBillsLog.filter(l => new Date(l.deletedAt).toDateString() === todayStr);

  // Metrics
  let totalNetSales = 0, totalDiscounts = 0, totalServiceCharge = 0, totalItemsSold = 0;
  const paymentMap = { CASH: 0, CARD: 0, TRANSFER: 0 };
  const cashierMap = {};
  const productMap = {};

  todaysOrders.forEach(o => {
    totalNetSales += o.netTotal || 0;
    totalDiscounts += o.discountAmount || 0;
    totalServiceCharge += o.totalServiceCharge || 0;
    if (paymentMap[o.paymentMethod] !== undefined) paymentMap[o.paymentMethod] += o.netTotal || 0;
    const cashierKey = o.cashierName || 'Admin Cashier';
    cashierMap[cashierKey] = (cashierMap[cashierKey] || 0) + (o.netTotal || 0);
    (o.items || []).forEach(item => {
      totalItemsSold += item.quantity;
      if (!productMap[item.name]) productMap[item.name] = { qty: 0, revenue: 0 };
      productMap[item.name].qty += item.quantity;
      productMap[item.name].revenue += item.sellingPrice * item.quantity;
    });
  });

  const topProducts = Object.entries(productMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.qty - a.qty).slice(0, 10);
  const cashierList = Object.entries(cashierMap).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);

  const cashExpected = paymentMap.CASH;
  const cashCountedNum = parseFloat(cashCounted) || 0;
  const cashVariance = cashCounted !== '' ? (cashCountedNum - cashExpected) : null;

  const isAlreadyClosed = daySession?.status === 'CLOSED';

  const handleCloseDayClick = () => {
    if (isAlreadyClosed) {
      Swal.fire({ icon: 'info', title: 'Already Closed', text: `This day was already closed by ${daySession.endedBy} at ${new Date(daySession.endedAt).toLocaleTimeString()}.` });
      return;
    }
    setIsAdminModalOpen(true);
  };

  const handleAdminVerify = async () => {
    const usernameInput = adminUsername.trim();
    const passwordInput = adminPassword.trim();
    if (!usernameInput || !passwordInput) {
      Swal.fire({ icon: 'error', title: 'Enter Username and Password!', confirmButtonColor: '#ef4444' });
      return;
    }
    setAdminCheckLoading(true);
    try {
      const matchedAdmin = await db.admins.where('username').equalsIgnoreCase(usernameInput).first();
      const isValid = matchedAdmin && matchedAdmin.password === passwordInput && matchedAdmin.role === 'ADMIN';
      if (isValid) {
        setIsAdminModalOpen(false); setAdminUsername(''); setAdminPassword('');
        setIsClosing(true);
        const updated = await closeDay(matchedAdmin.username, {
          expected: cashExpected,
          counted: cashCounted !== '' ? cashCountedNum : null,
        });
        setDaySession(updated);
        setIsClosing(false);
        Swal.fire({ icon: 'success', title: 'Day Closed Successfully! ✅', text: `Closed by ${matchedAdmin.username}`, confirmButtonColor: '#059669' });
      } else {
        Swal.fire({ icon: 'error', title: 'Invalid Credentials!', text: 'Username or Password is incorrect, or you do not have Admin privileges.', confirmButtonColor: '#ef4444' });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    } finally {
      setAdminCheckLoading(false);
    }
  };

  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Date', new Date().toLocaleDateString()],
      ['Total Orders', todaysOrders.length],
      ['Net Sales', totalNetSales.toFixed(2)],
      ['Items Sold', totalItemsSold],
      ['Service Charge', totalServiceCharge.toFixed(2)],
      ['Discounts Given', totalDiscounts.toFixed(2)],
      ['Cash Sales', paymentMap.CASH.toFixed(2)],
      ['Card Sales', paymentMap.CARD.toFixed(2)],
      ['Transfer Sales', paymentMap.TRANSFER.toFixed(2)],
      ['Deleted Items', todaysDeletedItems.length],
      ['Deleted Bills', todaysDeletedBills.length],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `day-end-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full bg-gray-100 p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-4 pb-10">

        {/* Header */}
        <div className="flex items-center justify-between bg-white rounded-2xl border px-4 py-3 shadow-sm print:hidden">
          <button onClick={onBack} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-xl font-black text-xs transition">← Back</button>
          <h1 className="text-lg font-black text-gray-800">📊 Day End Report</h1>
          <div className="flex space-x-2">
            <button onClick={handleExportCsv} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg font-black text-[10px] transition">⬇️ CSV</button>
            <button onClick={() => window.print()} className="bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg font-black text-[10px] transition">🖨️ Print</button>
          </div>
        </div>

        <div className="hidden print:block">
          <h1 className="text-xl font-black">Day End Report — {new Date().toLocaleDateString()}</h1>
        </div>

        {/* Day session status */}
        <div className={`rounded-2xl border p-4 ${isAlreadyClosed ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className={`text-xs font-black uppercase mb-1 ${isAlreadyClosed ? 'text-red-700' : 'text-emerald-700'}`}>
            {isAlreadyClosed ? '🔒 Day Closed' : '🟢 Day In Progress'}
          </div>
          <div className="text-[11px] text-gray-600 space-y-0.5">
            {daySession && <div>Started: <b>{new Date(daySession.startedAt).toLocaleString()}</b> by <b>{daySession.startedBy}</b></div>}
            {isAlreadyClosed && <div>Closed: <b>{new Date(daySession.endedAt).toLocaleString()}</b> by <b>{daySession.endedBy}</b></div>}
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900 text-white p-4 rounded-2xl">
            <div className="text-[10px] text-gray-400 uppercase font-black">Net Sales</div>
            <div className="text-xl font-black text-emerald-400">Rs.{totalNetSales.toFixed(2)}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border">
            <div className="text-[10px] text-gray-400 uppercase font-black">Total Orders</div>
            <div className="text-xl font-black text-gray-800">{todaysOrders.length}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border">
            <div className="text-[10px] text-gray-400 uppercase font-black">Items Sold</div>
            <div className="text-xl font-black text-gray-800">{totalItemsSold}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border">
            <div className="text-[10px] text-gray-400 uppercase font-black">Service Charge</div>
            <div className="text-xl font-black text-indigo-600">Rs.{totalServiceCharge.toFixed(2)}</div>
          </div>
        </div>

        {/* Payment Method Breakdown */}
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="text-xs font-black text-gray-500 uppercase mb-3">💳 Payment Methods</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-[10px] text-gray-400 font-bold">💵 Cash</div><div className="font-black text-lg">Rs.{paymentMap.CASH.toFixed(2)}</div></div>
            <div><div className="text-[10px] text-gray-400 font-bold">💳 Card</div><div className="font-black text-lg">Rs.{paymentMap.CARD.toFixed(2)}</div></div>
            <div><div className="text-[10px] text-gray-400 font-bold">🏦 Transfer</div><div className="font-black text-lg">Rs.{paymentMap.TRANSFER.toFixed(2)}</div></div>
          </div>
        </div>

        {/* Cash Reconciliation */}
        {!isAlreadyClosed && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 print:hidden">
            <h3 className="text-xs font-black text-amber-700 uppercase mb-3">🧮 Cash Reconciliation</h3>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">Expected Cash (from Cash sales)</label>
                <div className="p-2.5 bg-white border rounded-xl font-black text-sm">Rs.{cashExpected.toFixed(2)}</div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">Actual Cash Counted</label>
                <input type="number" value={cashCounted} onChange={(e) => setCashCounted(e.target.value)} className="w-full p-2.5 border rounded-xl font-black text-sm" placeholder="0.00" />
              </div>
            </div>
            {cashVariance !== null && (
              <div className={`mt-2 text-xs font-black ${cashVariance === 0 ? 'text-emerald-600' : cashVariance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {cashVariance === 0 ? '✅ Exact Match' : cashVariance > 0 ? `⬆️ Over by Rs.${cashVariance.toFixed(2)}` : `⬇️ Short by Rs.${Math.abs(cashVariance).toFixed(2)}`}
              </div>
            )}
          </div>
        )}
        {isAlreadyClosed && daySession.cashCounted != null && (
          <div className="bg-gray-50 rounded-2xl border p-4">
            <h3 className="text-xs font-black text-gray-500 uppercase mb-2">🧮 Cash Reconciliation (Recorded)</h3>
            <div className="text-xs text-gray-600">
              Expected: Rs.{daySession.cashExpected?.toFixed(2)} · Counted: Rs.{daySession.cashCounted?.toFixed(2)} · Variance:{' '}
              <b className={daySession.cashVariance === 0 ? 'text-emerald-600' : daySession.cashVariance > 0 ? 'text-blue-600' : 'text-red-600'}>
                Rs.{daySession.cashVariance?.toFixed(2)}
              </b>
            </div>
          </div>
        )}

        {/* Sales by Cashier */}
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="text-xs font-black text-gray-500 uppercase mb-3">🧑‍💼 Sales by Cashier</h3>
          {cashierList.length === 0 ? <div className="text-xs text-gray-400">No sales yet today.</div> : (
            <table className="w-full text-xs">
              <tbody>
                {cashierList.map((c, i) => (
                  <tr key={i} className="border-b last:border-0"><td className="py-1.5 font-bold">{c.name}</td><td className="py-1.5 text-right font-black text-emerald-600">Rs.{c.revenue.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="text-xs font-black text-gray-500 uppercase mb-3">🔥 Top Selling Items Today</h3>
          {topProducts.length === 0 ? <div className="text-xs text-gray-400">No sales yet today.</div> : (
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400"><th className="text-left pb-1">Item</th><th className="text-right pb-1">Qty</th><th className="text-right pb-1">Revenue</th></tr></thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={i} className="border-t"><td className="py-1.5 font-bold">{i + 1}. {p.name}</td><td className="py-1.5 text-right">{p.qty}</td><td className="py-1.5 text-right font-black text-emerald-600">Rs.{p.revenue.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Deleted Items/Bills */}
        {(todaysDeletedItems.length > 0 || todaysDeletedBills.length > 0) && (
          <div className="bg-red-50 rounded-2xl border border-red-200 p-4">
            <h3 className="text-xs font-black text-red-700 uppercase mb-2">⚠️ Deleted/Voided Today</h3>
            <div className="text-[11px] text-red-600">{todaysDeletedItems.length} item(s) deleted, {todaysDeletedBills.length} bill(s) voided — see Admin Panel → Reports → Deleted/Voided for full details.</div>
          </div>
        )}

        {/* Financial Summary */}
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="text-xs font-black text-gray-500 uppercase mb-3">📈 Financial Summary</h3>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b"><td className="py-1.5 font-bold text-gray-600">Gross Sales</td><td className="py-1.5 text-right font-bold">Rs.{(totalNetSales + totalDiscounts).toFixed(2)}</td></tr>
              <tr className="border-b"><td className="py-1.5 font-bold text-gray-600">Discounts Given</td><td className="py-1.5 text-right font-bold text-red-500">-Rs.{totalDiscounts.toFixed(2)}</td></tr>
              <tr className="bg-emerald-50"><td className="py-1.5 font-black text-emerald-700">Net Sales</td><td className="py-1.5 text-right font-black text-emerald-700">Rs.{totalNetSales.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Close Day Button */}
        <div className="print:hidden">
          <button
            onClick={handleCloseDayClick}
            disabled={isClosing}
            className={`w-full py-4 rounded-2xl font-black text-sm shadow-lg transition ${isAlreadyClosed ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 text-white'}`}
          >
            {isAlreadyClosed ? '🔒 Day Already Closed' : isClosing ? '⏳ Closing...' : '🔒 Close Day End (Admin Required)'}
          </button>
        </div>
      </div>

      {/* Admin Modal */}
      {isAdminModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-2xl max-w-xs w-full space-y-3 text-center text-xs">
            <span className="text-3xl">🛡️</span>
            <h3 className="text-sm font-black text-gray-800">Admin Authorization Required</h3>
            <p className="text-[11px] text-gray-500 -mt-1">Confirming this will officially close today's business day.</p>
            <input type="text" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className="w-full p-2.5 border rounded-xl text-center font-black text-sm" placeholder="Admin Username" autoComplete="off" />
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !adminCheckLoading) handleAdminVerify(); }} className="w-full p-2.5 border rounded-xl text-center font-black tracking-widest text-base" placeholder="••••" />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => { setIsAdminModalOpen(false); setAdminUsername(''); setAdminPassword(''); }} className="bg-gray-100 hover:bg-gray-200 py-2 rounded-xl font-bold">Cancel</button>
              <button onClick={handleAdminVerify} disabled={adminCheckLoading} className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white py-2 rounded-xl font-bold">{adminCheckLoading ? 'Checking...' : 'Confirm Close'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}