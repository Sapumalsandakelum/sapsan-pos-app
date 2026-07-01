// src/DashboardScreen.jsx
import React from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';

export default function DashboardScreen() {
  // SETTLED තත්ත්වයේ ඇති සියලුම ඕඩර්ස් ලයිව් ක්වෙරි කර ගැනීම
  const settledOrders = useLiveQuery(() => 
    db.orders.where('status').equals('SETTLED').toArray()
  ) || [];

  // 1. අද දවසේ දිනය (Today's Date String) සැසඳීමට
  const todayStr = new Date().toDateString();

  // 2. අද දවසේ ඕඩර්ස් විතරක් ෆිල්ටර් කර ගැනීම
  const todaysOrders = settledOrders.filter(order => {
    if (!order.settledDate) return false;
    return new Date(order.settledDate).toDateString() === todayStr;
  });

  // ==========================================
  // 📈 ගණනය කිරීම් (CALCULATIONS)
  // ==========================================
  
  let todayRevenue = 0;
  let todayCash = 0;
  let todayCard = 0;
  let todayTransfer = 0;
  const itemSalesMap = {}; // වැඩිපුරම විකිණිච්ච අයිටම්ස් ට්‍රැක් කරන්න

  todaysOrders.forEach(order => {
    todayRevenue += order.netTotal || 0;

    // පේමන්ට් මෙතඩ් අනුව බෙදා වෙන් කිරීම
    if (order.paymentMethod === 'CASH') todayCash += order.netTotal || 0;
    else if (order.paymentMethod === 'CARD') todayCard += order.netTotal || 0;
    else if (order.paymentMethod === 'TRANSFER') todayTransfer += order.netTotal || 0;

    // අයිටම්ස් වල ප්‍රමාණයන් එකතු කිරීම
    order.items.forEach(item => {
      if (itemSalesMap[item.name]) {
        itemSalesMap[item.name] += item.quantity;
      } else {
        itemSalesMap[item.name] = item.quantity;
      }
    });
  });

  // වැඩිපුරම විකිණිච්ච අයිටම්ස් ටොප් 5 Sort කර ගැනීම
  const topSellingItems = Object.entries(itemSalesMap)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return (
    <div className="h-[calc(100vh-57px)] w-full bg-gray-100 overflow-y-auto p-4 text-gray-800 space-y-4">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-2xl border shrink-0 gap-2">
        <div>
          <h1 className="text-xl font-black tracking-tight text-gray-900">📈 Sales Dashboard & Analytics</h1>
          <p className="text-xs text-gray-400 font-medium">Daily sales and business analytics</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl text-indigo-700 font-bold text-xs">
          📅 Today: {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* 4 SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Revenue */}
        <div className="bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Today's Revenue</span>
            <div className="text-xl font-black text-gray-900">Rs.{todayRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-bold">💰</div>
        </div>

        {/* Total Invoices */}
        <div className="bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bills Settled</span>
            <div className="text-xl font-black text-gray-900">{todaysOrders.length} Invoices</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold">🧾</div>
        </div>

        {/* Cash Drawer */}
        <div className="bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cash in Drawer</span>
            <div className="text-xl font-black text-emerald-600">Rs.{todayCash.toLocaleString()}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl font-bold">💵</div>
        </div>

        {/* Digital Payments */}
        <div className="bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Card & Transfer</span>
            <div className="text-xl font-black text-blue-600">Rs.{(todayCard + todayTransfer).toLocaleString()}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl font-bold">💳</div>
        </div>
      </div>

      {/* MIDDLE SECTION - BREAKDOWNS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* LEFT: PAYMENT MODE BREAKDOWN */}
        <div className="lg:col-span-5 bg-white p-4 rounded-2xl border shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black text-gray-700 uppercase tracking-wider mb-4">💳 Payment Mode Breakdown</h3>
            <div className="space-y-4">
              {/* Cash Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-gray-600">💵 Cash Payments</span>
                  <span className="text-gray-900">Rs.{todayCash.toFixed(2)}</span>
                </div>
                <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: `${todayRevenue > 0 ? (todayCash / todayRevenue) * 100 : 0}%` }}></div>
                </div>
              </div>

              {/* Card Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-gray-600">💳 Card Payments</span>
                  <span className="text-gray-900">Rs.{todayCard.toFixed(2)}</span>
                </div>
                <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: `${todayRevenue > 0 ? (todayCard / todayRevenue) * 100 : 0}%` }}></div>
                </div>
              </div>

              {/* Transfer Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-gray-600">🏦 Bank Transfers</span>
                  <span className="text-gray-900">Rs.{todayTransfer.toFixed(2)}</span>
                </div>
                <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${todayRevenue > 0 ? (todayTransfer / todayRevenue) * 100 : 0}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-gray-400 font-medium mt-4 pt-3 border-t text-center">
            All data is updated in real-time.
          </div>
        </div>

        {/* RIGHT: TOP SELLING ITEMS */}
        <div className="lg:col-span-7 bg-white p-4 rounded-2xl border shadow-sm">
          <h3 className="text-sm font-black text-gray-700 uppercase tracking-wider mb-3">🔥 Top 5 Best Selling Items (Today)</h3>
          <div className="divide-y text-xs">
            {topSellingItems.length === 0 ? (
              <div className="py-8 text-center text-gray-400 font-bold">No best-selling items for today yet.</div>
            ) : (
              topSellingItems.map((item, idx) => (
                <div key={idx} className="py-2.5 flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-[10px] ${idx === 0 ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{idx + 1}</span>
                    <span className="font-bold text-gray-700">{item.name}</span>
                  </div>
                  <span className="bg-indigo-50 text-indigo-700 font-black px-2 py-0.5 rounded-full text-[11px]">{item.qty} Sold</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: RECENT SETTLED ORDERS TABLE */}
      <div className="bg-white p-4 rounded-2xl border shadow-sm">
        <h3 className="text-sm font-black text-gray-700 uppercase tracking-wider mb-3">📋 Today's Settled Orders</h3>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 font-black text-gray-500 border-b">
                <th className="p-3">Table</th>
                <th className="p-3">Time</th>
                <th className="p-3">Items Count</th>
                <th className="p-3Header">Method</th>
                <th className="p-3 text-right">Net Bill Total</th>
              </tr>
            </thead>
            <tbody className="divide-y font-medium text-gray-700">
              {todaysOrders.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-6 text-center text-gray-400 font-bold">No settled bills for today yet.</td>
                </tr>
              ) : (
                todaysOrders.map((order, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50">
                    <td className="p-3 font-black text-gray-900">{order.tableNumber}</td>
                    <td className="p-3 text-gray-400">{new Date(order.settledDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="p-3">{order.items.reduce((acc, i) => acc + i.quantity, 0)} Items</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md font-black text-[10px] ${order.paymentMethod === 'CASH' ? 'bg-amber-100 text-amber-800' : order.paymentMethod === 'CARD' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'}`}>
                        {order.paymentMethod}
                      </span>
                    </td>
                    <td className="p-3 text-right font-black text-gray-900">Rs.{order.netTotal.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}