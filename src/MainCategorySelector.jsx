// src/MainCategorySelector.jsx
import React, { useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { mainCategoryDb } from './mainCategoryUtils';
import { printViaBluetooth, generateAdvanceReceiptHtml } from './printUtils';

export default function MainCategorySelector({ onSelect, currentUser, onNavigateToDayEnd }) {
  const categories = useLiveQuery(() => mainCategoryDb.categories.orderBy('sortOrder').toArray()) || [];
  const allAdvanceBookings = useLiveQuery(() => db.advanceBookings.toArray()) || [];
  const activeAdvanceBookings = allAdvanceBookings.filter(b => b.status === 'ACTIVE');

  // Advance Deposit Modals
  const [isAddAdvanceOpen, setIsAddAdvanceOpen] = useState(false);
  const [isListAdvanceOpen, setIsListAdvanceOpen] = useState(false);
  const [advCustomerName, setAdvCustomerName] = useState('');
  const [advPhone, setAdvPhone] = useState('');
  const [advBookingDate, setAdvBookingDate] = useState(new Date().toISOString().split('T')[0]);
  const [advAmount, setAdvAmount] = useState('');
  const [advPaymentMethod, setAdvPaymentMethod] = useState('CASH');
  const [advNotes, setAdvNotes] = useState('');

  const handleSaveAdvanceBooking = async (e) => {
    e.preventDefault();
    if (!advCustomerName.trim() || !advAmount || parseFloat(advAmount) <= 0) {
      Swal.fire({ icon: 'error', title: 'Enter Name & Valid Amount!', confirmButtonColor: '#ef4444' });
      return;
    }

    try {
      const bookingData = {
        customerName: advCustomerName.trim(),
        phone: advPhone.trim(),
        bookingDate: advBookingDate,
        amount: parseFloat(advAmount),
        paymentMethod: advPaymentMethod,
        notes: advNotes.trim(),
        status: 'ACTIVE',
        createdAt: new Date()
      };

      await db.advanceBookings.add(bookingData);
      const receiptHtml = generateAdvanceReceiptHtml(bookingData);
      printViaBluetooth('bill', [], receiptHtml);

      setIsAddAdvanceOpen(false);
      setAdvCustomerName(''); setAdvPhone(''); setAdvAmount(''); setAdvNotes('');
      setAdvBookingDate(new Date().toISOString().split('T')[0]); setAdvPaymentMethod('CASH');

      Swal.fire({
        icon: 'success',
        title: 'Advance Deposit Received! 💳',
        text: `Rs.${parseFloat(advAmount).toFixed(2)} recorded from ${advCustomerName} (${advPaymentMethod})`,
        confirmButtonColor: '#059669'
      });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Save Failed', text: err.message });
    }
  };

  const handleCancelAdvanceBooking = async (booking) => {
    const { value: formValues } = await Swal.fire({
      title: '🛡️ Admin Authorization Required',
      html: `
        <div class="text-xs text-left space-y-3 pt-1">
          <div class="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-xl font-medium">
            Cancelling advance deposit of <b>Rs.${booking.amount.toFixed(2)}</b> for <b>${booking.customerName}</b>.
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">Admin Username</label>
            <input id="swal-admin-user" class="swal2-input !m-0 !w-full !text-sm" placeholder="Admin Username" autocomplete="off" />
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">Admin Password</label>
            <input id="swal-admin-pass" type="password" class="swal2-input !m-0 !w-full !text-sm" placeholder="••••" />
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Verify & Refund Deposit',
      confirmButtonColor: '#ef4444',
      preConfirm: () => {
        const u = document.getElementById('swal-admin-user').value.trim();
        const p = document.getElementById('swal-admin-pass').value.trim();
        if (!u || !p) {
          Swal.showValidationMessage('Enter Admin Username & Password');
          return false;
        }
        return { u, p };
      }
    });

    if (formValues) {
      try {
        const matchedAdmin = await db.admins.where('username').equalsIgnoreCase(formValues.u).first();
        if (matchedAdmin && matchedAdmin.password === formValues.p && matchedAdmin.role === 'ADMIN') {
          await db.advanceBookings.update(booking.id, {
            status: 'CANCELLED',
            cancelledBy: matchedAdmin.username,
            cancelledAt: new Date()
          });
          Swal.fire({
            icon: 'success',
            title: 'Advance Deposit Cancelled',
            text: `Rs.${booking.amount.toFixed(2)} deposit refunded by Admin "${matchedAdmin.username}".`,
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Admin Verification Failed!',
            text: 'Username or Password is incorrect, or user is not an Admin.',
            confirmButtonColor: '#ef4444'
          });
        }
      } catch (err) {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
      }
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 p-6 relative">
      {/* 📊 DAY END BUTTON IN TOP RIGHT CORNER */}
      {onNavigateToDayEnd && (
        <button
          onClick={onNavigateToDayEnd}
          className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white/90 hover:text-white px-4 py-2.5 rounded-xl font-black text-xs transition flex items-center gap-2 border border-white/20 shadow-md cursor-pointer"
        >
          <span>📊</span>
          <span>Day End</span>
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-black text-white mb-2">What are you starting?</h1>
          <p className="text-indigo-300 text-sm">Select an order type to begin</p>
        </div>

        <div className="flex flex-wrap justify-center gap-4 sm:gap-6 max-w-3xl">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelect(cat)}
              className="w-36 h-36 sm:w-44 sm:h-44 bg-white hover:bg-indigo-50 rounded-3xl p-6 flex flex-col items-center justify-center shadow-2xl hover:scale-105 transition-transform border-4 border-transparent hover:border-indigo-400"
            >
              <span className="text-5xl mb-3">{cat.icon || '📋'}</span>
              <span className="font-black text-gray-800 text-lg text-center">{cat.name}</span>
            </button>
          ))}
          {categories.length === 0 && (
            <div className="col-span-full text-center text-indigo-300 text-sm max-w-sm">
              No order types set up yet. Ask an Admin to add some in Admin Panel → Main Categories.
            </div>
          )}
        </div>
      </div>

      {/* 💳 ADVANCE PAYMENT BOTTOM BAR IN MAIN CATEGORIES SECTION */}
      <div className="max-w-3xl mx-auto w-full mt-6 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-white">
        <div className="flex items-center space-x-3 text-xs">
          <span className="text-2xl">💳</span>
          <div>
            <div className="font-black text-sm text-white">Early Booking & Advance Payments</div>
            <div className="text-[11px] text-indigo-200">Receive advance deposit & deduct automatically during final settlement</div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsListAdvanceOpen(true)}
            className="bg-white/20 hover:bg-white/30 text-white px-3.5 py-2.5 rounded-xl font-bold text-xs transition border border-white/20"
          >
            📋 Active Deposits ({activeAdvanceBookings.length})
          </button>
          <button
            onClick={() => setIsAddAdvanceOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-black text-xs transition shadow-lg"
          >
            ➕ Receive Advance Deposit
          </button>
        </div>
      </div>

      {/* MODAL: NEW ADVANCE DEPOSIT */}
      {isAddAdvanceOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl text-xs text-gray-800">
            <div className="flex justify-between border-b pb-2">
              <h3 className="text-base font-black text-gray-800">💳 New Advance Deposit / Booking</h3>
              <button onClick={() => setIsAddAdvanceOpen(false)} className="text-gray-400 font-bold text-sm">✕</button>
            </div>

            <form onSubmit={handleSaveAdvanceBooking} className="space-y-3">
              <div>
                <label className="block font-bold text-gray-500 mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  value={advCustomerName}
                  onChange={(e) => setAdvCustomerName(e.target.value)}
                  className="w-full p-2.5 border rounded-xl font-bold text-sm"
                  placeholder="e.g. John Perera"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-gray-500 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={advPhone}
                    onChange={(e) => setAdvPhone(e.target.value)}
                    className="w-full p-2 border rounded-xl font-bold text-xs"
                    placeholder="0771234567"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-500 mb-1">Booking Date</label>
                  <input
                    type="date"
                    required
                    value={advBookingDate}
                    onChange={(e) => setAdvBookingDate(e.target.value)}
                    className="w-full p-2 border rounded-xl font-bold text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-500 mb-1">Advance Amount Paid (Rs.) *</label>
                <input
                  type="number"
                  required
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                  className="w-full p-2.5 border rounded-xl font-black text-base text-emerald-700"
                  placeholder="2000"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-500 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['CASH', 'CARD', 'TRANSFER'].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAdvPaymentMethod(m)}
                      className={`py-2 rounded-xl font-black border transition ${advPaymentMethod === m ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-50 text-gray-600'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-500 mb-1">Notes / Reserved Table (Optional)</label>
                <input
                  type="text"
                  value={advNotes}
                  onChange={(e) => setAdvNotes(e.target.value)}
                  className="w-full p-2 border rounded-xl font-bold text-xs"
                  placeholder="e.g. Birthday Party Table 5"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddAdvanceOpen(false)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-600 py-2.5 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-black shadow-md"
                >
                  💾 Save & Print Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ACTIVE ADVANCE DEPOSITS LIST */}
      {isListAdvanceOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-3xl max-w-lg w-full space-y-4 shadow-2xl text-xs text-gray-800 max-h-[85vh] flex flex-col">
            <div className="flex justify-between border-b pb-2 shrink-0">
              <div>
                <h3 className="text-base font-black text-gray-800">📋 Active Advance Deposits</h3>
                <p className="text-[10px] text-gray-400">Deposits available for deduction upon bill settlement</p>
              </div>
              <button onClick={() => setIsListAdvanceOpen(false)} className="text-gray-400 font-bold text-sm">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {activeAdvanceBookings.length === 0 ? (
                <div className="text-center text-gray-400 font-bold py-10">No active advance deposits found.</div>
              ) : (
                activeAdvanceBookings.map(b => (
                  <div key={b.id} className="border rounded-2xl p-3 bg-gray-50 flex items-center justify-between">
                    <div>
                      <div className="font-black text-gray-800 text-sm">{b.customerName} <span className="text-[10px] font-bold text-emerald-600">({b.paymentMethod})</span></div>
                      <div className="text-gray-500 text-[10px]">📞 {b.phone || 'No phone'} · 📅 Booking Date: <b>{b.bookingDate}</b></div>
                      {b.notes && <div className="text-gray-400 text-[9px] mt-0.5">📝 {b.notes}</div>}
                    </div>
                    <div className="text-right space-y-1">
                      <div className="font-black text-emerald-600 text-base">Rs.{b.amount.toFixed(2)}</div>
                      <button
                        onClick={() => handleCancelAdvanceBooking(b)}
                        className="text-[10px] text-red-500 font-bold hover:underline block ml-auto"
                      >
                        Cancel / Refund
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setIsListAdvanceOpen(false)}
              className="w-full bg-gray-800 text-white py-2.5 rounded-xl font-bold shrink-0 mt-2"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}