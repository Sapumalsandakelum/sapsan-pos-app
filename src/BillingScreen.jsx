// src/BillingScreen.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { printViaBluetooth, generateKitchenReceipt, generateBillReceipt, generateCancellationReceipt, getNextDailyOrderNumber } from './printUtils';
import { logDeletedItem, logDeletedBill } from './auditUtils';

// mainCategory: { id, name, icon, usesTables, serviceChargeEnabled }
// entityName: the selected table/order slot name, e.g. "Table 1" or "Order 01"
export default function BillingScreen({ mainCategory, entityName, onBack, currentUser }) {
  const isTakeawayLike = !mainCategory.usesTables; // controls "Table:"/"Type:" labels on receipts
  const serviceChargeApplies = !!mainCategory.serviceChargeEnabled;

  // DB Live Queries
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const items = useLiveQuery(() => db.items.toArray()) || [];
  const activeOrders = useLiveQuery(() => db.orders.where('status').equals('PENDING').toArray()) || [];

  const existingOrder = activeOrders.find(o => o.tableNumber === entityName && o.mainCategoryName === mainCategory.name);

  // UI States
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [cart, setCart] = useState([]);

  // Workflow Trackers
  const [isSavedForTable, setIsSavedForTable] = useState(false);
  const [isPreBillPrinted, setIsPreBillPrinted] = useState(false);

  // Admin Password Security States
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminCheckLoading, setAdminCheckLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState(null);

  // Settlement Modals
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  // Load this table/order's existing cart — re-runs when navigating to a
  // different table/order, AND when this order's data finishes loading from
  // the database (Dexie's live query resolves asynchronously, so on first
  // arrival `existingOrder` may briefly be undefined even if a saved order
  // actually exists — this catches it once the real data comes in).
  // Deliberately keyed on the order's *id* rather than the whole object: the
  // id only changes when we're truly looking at a different order, whereas
  // the object reference changes on every unrelated database write too —
  // depending on the object would reset/clobber any unsaved local edits
  // every time some other table's order changed anywhere in the system.
  const existingOrderId = existingOrder?.id;
  useEffect(() => {
    if (existingOrder) {
      setCart(existingOrder.items.map(i => ({ ...i, isSaved: true })));
      setIsSavedForTable(true);
      setIsPreBillPrinted(existingOrder.isPreBillPrinted || false);
    } else {
      setCart([]);
      setIsSavedForTable(false);
      setIsPreBillPrinted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityName, mainCategory.id, existingOrderId]);

  // ==========================================
  // HANDLERS & OPERATIONS
  // ==========================================

  const addToCart = (item) => {
    const unsavedIndex = cart.findIndex(c => c.id === item.id && !c.isSaved);
    let newCart = [...cart];
    if (unsavedIndex > -1) newCart[unsavedIndex].quantity += 1;
    else newCart.push({ ...item, quantity: 1, isSaved: false });
    setCart(newCart); setIsSavedForTable(false); setIsPreBillPrinted(false);
  };

  const updateQuantity = (cartIndex, amount) => {
    const targetItem = cart[cartIndex];
    if (targetItem.isSaved) {
      Swal.fire({ icon: 'error', title: '🔒 Action Restricted!', text: 'You cannot modify items that are already saved.', confirmButtonColor: '#ef4444' });
      return;
    }
    let newCart = [...cart];
    const newQty = targetItem.quantity + amount;
    if (newQty > 0) newCart[cartIndex].quantity = newQty;
    else newCart = newCart.filter((_, idx) => idx !== cartIndex);
    setCart(newCart); setIsSavedForTable(false); setIsPreBillPrinted(false);
  };

  // 🗑️ Remove an item from the cart/order.
  // - Not yet saved: free to remove immediately (just a confirm to avoid mis-taps).
  // - Already saved (already sent to KOT/BOT): requires Admin authorization, and once
  //   confirmed, sends a cancellation ticket to the kitchen/bar printer so staff know
  //   to stop preparing / discard it.
  const handleDeleteItemClick = (cartIndex) => {
    const targetItem = cart[cartIndex];
    if (!targetItem) return;

    if (!targetItem.isSaved) {
      Swal.fire({
        title: 'Remove this item?',
        text: `Remove "${targetItem.name}" from the order?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Yes, Remove'
      }).then((result) => {
        if (result.isConfirmed) {
          setCart(prev => prev.filter((_, idx) => idx !== cartIndex));
        }
      });
      return;
    }

    setPendingDeleteIndex(cartIndex);
    triggerAdminCheck('DELETE_ITEM');
  };

  const executeDeleteItem = async (cartIndex, deletedByAdmin) => {
    const targetItem = cart[cartIndex];
    if (!targetItem) { setPendingDeleteIndex(null); return; }

    const updatedCart = cart.filter((_, idx) => idx !== cartIndex);

    try {
      if (existingOrder) {
        const remainingSavedItems = updatedCart.filter(i => i.isSaved);
        let newSubTotal = 0, newServiceCharge = 0;
        remainingSavedItems.forEach(i => {
          const lineTotal = i.sellingPrice * i.quantity;
          newSubTotal += lineTotal;
          if (serviceChargeApplies) newServiceCharge += (lineTotal * i.serviceChargePercentage) / 100;
        });
        const newNetTotal = newSubTotal + newServiceCharge;

        if (remainingSavedItems.length === 0) {
          // Nothing left on this order — clear it entirely
          await db.orders.delete(existingOrder.id);
          setIsSavedForTable(false);
          setIsPreBillPrinted(false);
        } else {
          await db.orders.update(existingOrder.id, {
            items: remainingSavedItems,
            subTotal: newSubTotal,
            totalServiceCharge: newServiceCharge,
            netTotal: newNetTotal,
            isPreBillPrinted: false // totals changed — force a fresh Pre-Bill before settling
          });
          setIsPreBillPrinted(false);
        }

        // 🔔 Tell the kitchen/bar to stop preparing this item
        const cat = categories.find(c => c.id === targetItem.categoryId);
        const cancelRole = (cat && cat.printerType === 'BOT') ? 'bot' : 'kot';
        const cancelReceipt = generateCancellationReceipt(isTakeawayLike, entityName, targetItem, existingOrder.dailyOrderNumber);
        await printViaBluetooth(cancelRole, cancelReceipt);

        // 📝 Record the deletion in the audit trail
        await logDeletedItem({
          tableNumber: entityName,
          isTakeaway: isTakeawayLike,
          item: targetItem,
          dailyOrderNumber: existingOrder.dailyOrderNumber,
          deletedBy: deletedByAdmin,
        });
      }

      setCart(updatedCart);
      setPendingDeleteIndex(null);
      Swal.fire({ icon: 'success', title: 'Item Removed', text: `"${targetItem.name}" removed — a cancellation notice was sent to the kitchen/bar.`, toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
    } catch (err) {
      console.error(err);
      setPendingDeleteIndex(null);
      Swal.fire({ icon: 'error', title: 'Failed to Remove Item', text: err.message });
    }
  };

  const triggerAdminCheck = (actionType) => {
    setPendingAction(actionType); setIsAdminModalOpen(true);
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
        if (pendingAction === 'RE_SAVE') executeSaveOrder();
        else if (pendingAction === 'RE_PRINT') executePrintPreBill();
        else if (pendingAction === 'CLEAR_BILL') executeClearTableBill(matchedAdmin.username);
        else if (pendingAction === 'DELETE_ITEM') executeDeleteItem(pendingDeleteIndex, matchedAdmin.username);
      } else {
        Swal.fire({ icon: 'error', title: 'Invalid Credentials!', text: 'Username or Password is incorrect, or you do not have Admin privileges.', confirmButtonColor: '#ef4444' });
      }
    } catch (err) {
      console.error('Admin verification error:', err);
      Swal.fire({ icon: 'error', title: 'Database Error', text: 'An error occurred while verifying admin credentials.', confirmButtonColor: '#ef4444' });
    } finally {
      setAdminCheckLoading(false);
    }
  };

  const handleSaveOrderClick = () => {
    const hasUnsavedItems = cart.some(i => !i.isSaved);
    if (isSavedForTable && !hasUnsavedItems) triggerAdminCheck('RE_SAVE');
    else executeSaveOrder();
  };

  const executeSaveOrder = async () => {
    if (cart.length === 0) {
      Swal.fire({ icon: 'info', title: 'Cart is Empty!', confirmButtonColor: '#4f46e5' });
      return;
    }

    const unsavedItems = cart.filter(i => !i.isSaved);
    const kotItems = [];
    const botItems = [];

    unsavedItems.forEach(item => {
      const cat = categories.find(c => c.id === item.categoryId);
      if (cat && cat.printerType === 'BOT') botItems.push(item);
      else kotItems.push(item);
    });

    const mergedCartMap = {};
    cart.forEach(item => {
      if (mergedCartMap[item.id]) mergedCartMap[item.id].quantity += item.quantity;
      else mergedCartMap[item.id] = { ...item, isSaved: true };
    });
    const finalItemsForDb = Object.values(mergedCartMap);

    try {
      let currentPreBillState = isPreBillPrinted;
      let savedOrderId;
      let orderNumber;

      if (existingOrder) {
        currentPreBillState = false;
        // Re-saving an existing order — reuse its already-assigned daily order number,
        // do NOT generate a new one (that would break the sequence).
        orderNumber = existingOrder.dailyOrderNumber;
        await db.orders.update(existingOrder.id, { subTotal, totalServiceCharge, netTotal, isPreBillPrinted: false, items: finalItemsForDb });
        savedOrderId = existingOrder.id;
      } else {
        // Brand new order — assign the next number in today's sequence (auto-resets daily)
        orderNumber = getNextDailyOrderNumber();
        savedOrderId = await db.orders.add({
          orderDate: new Date(),
          tableNumber: entityName,
          mainCategoryName: mainCategory.name,
          subTotal, totalServiceCharge, discountAmount: 0, netTotal,
          paymentMethod: 'PENDING', status: 'PENDING', isPreBillPrinted: false,
          items: finalItemsForDb, dailyOrderNumber: orderNumber,
          cashierName: currentUser?.username || 'Admin Cashier',
        });
        currentPreBillState = false;
      }

      setCart(finalItemsForDb.map(i => ({ ...i, isSaved: true })));
      setIsSavedForTable(true);
      setIsPreBillPrinted(currentPreBillState);

      if (kotItems.length > 0) {
        const kotReceipt = generateKitchenReceipt(isTakeawayLike, entityName, 'KOT (KITCHEN)', kotItems, orderNumber);
        await printViaBluetooth('kot', kotReceipt);
      }
      if (botItems.length > 0) {
        const botReceipt = generateKitchenReceipt(isTakeawayLike, entityName, 'BOT (BAR)', botItems, orderNumber);
        await printViaBluetooth('bot', botReceipt);
      }

      let printerReceipts = '';
      if (kotItems.length > 0) printerReceipts += `<li>🔥 <b>KOT Sent to Printer</b> (${kotItems.length} items)</li>`;
      if (botItems.length > 0) printerReceipts += `<li>🍹 <b>BOT Sent to Printer</b> (${botItems.length} items)</li>`;

      Swal.fire({
        icon: 'success',
        title: `${entityName} Data Saved!`,
        html: `<div class="text-left text-xs bg-gray-50 p-3 rounded-xl mt-2 border"><ul class="list-disc pl-4 space-y-1">${printerReceipts || '<li>No new items to print.</li>'}</ul></div>`,
        confirmButtonColor: '#059669',
        confirmButtonText: 'Done'
      });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Failed to Save Data!', text: err.message });
    }
  };

  const handlePrintPreBillClick = () => {
    if (isPreBillPrinted) triggerAdminCheck('RE_PRINT');
    else executePrintPreBill();
  };

  const executePrintPreBill = async () => {
    if (cart.length === 0) return;

    if (existingOrder) {
      await db.orders.update(existingOrder.id, { isPreBillPrinted: true });
    }

    Swal.fire({ title: 'Printing Pre-Bill...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, showConfirmButton: false });
    const preBillReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'PRE-BILL RECEIPT', subTotal, totalServiceCharge, 0, netTotal, cart, existingOrder ? existingOrder.dailyOrderNumber : null);
    const printed = await printViaBluetooth('bill', preBillReceipt);
    Swal.close();

    if (printed) {
      Swal.fire({ icon: 'info', title: '📄 Pre-Bill Printed', html: `<b>${entityName}</b> Gross Total: <span class="text-indigo-600 font-bold">Rs.${netTotal.toFixed(2)}</span>`, showConfirmButton: false, timer: 2500, timerProgressBar: true });
    } else {
      Swal.fire({ icon: 'warning', title: 'No Bill Printer Assigned!', text: 'Go to Admin Panel → Printer Settings → Assign Printer Roles and set a printer for BILL.', confirmButtonColor: '#4f46e5' });
    }
    setIsPreBillPrinted(true);
  };

  const handleFinalSettle = async () => {
    if (!existingOrder) return;

    try {
      await db.orders.update(existingOrder.id, { discountAmount, netTotal: finalTotal, paymentMethod, status: 'SETTLED', settledDate: new Date() });

      Swal.fire({ title: 'Printing Final Invoice...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, showConfirmButton: false });
      const finalReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'FINAL INVOICE', subTotal, totalServiceCharge, discountAmount, finalTotal, cart, existingOrder.dailyOrderNumber);
      const printed = await printViaBluetooth('bill', finalReceipt);
      Swal.close();

      Swal.fire({
        icon: 'success',
        title: 'Settlement Successful! ✅',
        text: printed ? `🧾 Final Invoice Printed (${paymentMethod} Mode)` : `Settled (${paymentMethod} Mode) — no bill printer assigned, so nothing was printed.`,
        confirmButtonColor: '#111827'
      });
      setIsSettleModalOpen(false);
      setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
      onBack(); // settlement done — head back to the table/order grid
    } catch (err) {
      console.error(err);
      Swal.close();
      Swal.fire({ icon: 'error', title: 'Settlement Failed', text: err.message });
    }
  };

  const executeClearTableBill = async (deletedByAdmin) => {
    try {
      if (existingOrder) {
        // 📝 Record the full bill in the audit trail before it's gone
        await logDeletedBill({ order: existingOrder, deletedBy: deletedByAdmin });
        await db.orders.delete(existingOrder.id);
      }
      setCart([]);
      setIsSavedForTable(false);
      setIsPreBillPrinted(false);
      Swal.fire({ icon: 'success', title: 'Bill Cleared Successfully! 🗑️', text: 'This slot is now empty.', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Failed to Clear Bill!', text: err.message });
    }
  };

  // Calculations Logic
  const calculateTotals = () => {
    let subTotal = 0;
    let totalServiceCharge = 0;
    cart.forEach(item => {
      const itemTotal = item.sellingPrice * item.quantity;
      subTotal += itemTotal;
      if (serviceChargeApplies) {
        totalServiceCharge += (itemTotal * item.serviceChargePercentage) / 100;
      }
    });
    return { subTotal, totalServiceCharge, netTotal: subTotal + totalServiceCharge };
  };
  const { subTotal, totalServiceCharge, netTotal } = calculateTotals();

  const getSettlementTotals = () => {
    let discountAmount = 0;
    if (discountType === 'PERCENT') discountAmount = (netTotal * parseFloat(discountValue || 0)) / 100;
    else discountAmount = parseFloat(discountValue || 0);
    return { discountAmount, finalTotal: Math.max(0, netTotal - discountAmount) };
  };
  const { discountAmount, finalTotal } = getSettlementTotals();

  const filteredItems = selectedCategory === 'ALL' ? items : items.filter(i => i.categoryId === parseInt(selectedCategory));

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] w-full bg-gray-100 p-2 gap-2 text-gray-800 box-border overflow-hidden">

      {/* TOP BREADCRUMB / BACK NAV */}
      <div className="shrink-0 flex items-center justify-between bg-white rounded-2xl border px-4 py-2.5 shadow-sm">
        <button onClick={onBack} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-xl font-black text-xs transition">
          ← Back
        </button>
        <div className="font-black text-sm text-gray-700">
          {mainCategory.icon} {mainCategory.name} <span className="text-gray-300 mx-1">/</span> {entityName}
        </div>
        <div className="w-16"></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 gap-2 overflow-hidden">

        {/* LEFT PANEL — Items */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-3 flex flex-col h-full overflow-hidden border">
          <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none shrink-0">
            <button onClick={() => setSelectedCategory('ALL')} className={`px-4 py-2.5 rounded-xl font-bold text-xs ${selectedCategory === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>All Items</button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id.toString())} className={`px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap ${selectedCategory === cat.id.toString() ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>{cat.name}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 overflow-y-auto flex-1 content-start pt-1">
            {filteredItems.map(item => (
              <div key={item.id} onClick={() => addToCart(item)} className="bg-gray-50 hover:bg-indigo-50 p-3 rounded-xl border active:scale-95 transition cursor-pointer flex flex-col justify-between h-24">
                <div className="font-bold text-xs text-gray-700 line-clamp-2">{item.name}</div>
                <div className="text-indigo-600 font-black text-sm">Rs.{item.sellingPrice.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL — Bill */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-3 flex flex-col h-full overflow-hidden border shadow-sm">
          <div className="flex justify-between items-center border-b pb-2 shrink-0">
            <h2 className="text-base font-black text-gray-800">🛒 {entityName}</h2>
          </div>
          <div className="flex-1 overflow-y-auto my-2 space-y-2 pr-1">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-300">
                <span className="text-4xl">{isTakeawayLike ? '🛍️' : '🧾'}</span>
                <p className="text-xs font-bold mt-1">Order එකක් ඇතුළත් කරන්න</p>
              </div>
            ) : (
              cart.map((item, index) => (
                <div key={index} className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${item.isSaved ? 'bg-gray-100 border-gray-200 opacity-85' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="font-black text-gray-800 truncate">{item.name}</div>
                    <div className="text-[10px] text-gray-400">Rs.{item.sellingPrice} {item.isSaved && '🔒 (Saved)'}</div>
                  </div>
                  <div className="flex items-center space-x-2 bg-white px-1.5 py-0.5 rounded-lg border">
                    <button onClick={() => updateQuantity(index, -1)} disabled={item.isSaved} className="font-bold px-1 text-gray-600 disabled:text-gray-300">-</button>
                    <span className="font-bold">{item.quantity}</span>
                    <button onClick={() => updateQuantity(index, 1)} disabled={item.isSaved} className="font-bold px-1 text-indigo-600 disabled:text-gray-300">+</button>
                  </div>
                  <div className="font-black text-right w-16 pl-2 text-gray-700">Rs.{(item.sellingPrice * item.quantity).toFixed(0)}</div>
                  <button
                    onClick={() => handleDeleteItemClick(index)}
                    title={item.isSaved ? 'Remove (Admin authorization required)' : 'Remove item'}
                    className={`ml-1.5 shrink-0 rounded-lg p-1.5 text-sm transition ${item.isSaved ? 'text-amber-500 hover:bg-amber-50' : 'text-red-400 hover:bg-red-50 hover:text-red-600'}`}
                  >
                    {item.isSaved ? '🔒' : '🗑️'}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Workflow Bottom Section */}
          <div className="border-t pt-2 space-y-2 shrink-0 bg-white text-xs">
            <div className="flex justify-between text-gray-500"><span>Sub Total</span><span className="font-bold">Rs.{subTotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-amber-600 font-bold">
              <span>Service Charge {!serviceChargeApplies && '(0%)'}</span>
              <span>+Rs.{totalServiceCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-black text-indigo-700 border-t pt-1"><span>Net Total</span><span>Rs.{netTotal.toFixed(2)}</span></div>

            <div className="space-y-1.5 pt-1">
              <button onClick={handleSaveOrderClick} className={`w-full text-white py-3 rounded-xl font-black text-sm transition shadow-sm ${isSavedForTable && cart.filter(i => !i.isSaved).length === 0 ? 'bg-gray-400 hover:bg-gray-500' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {isSavedForTable && cart.filter(i => !i.isSaved).length === 0 ? '🔒 Re-Save (Admin Required)' : '💾 Save Order & Print KOT/BOT'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handlePrintPreBillClick} disabled={!isSavedForTable} className={`py-2.5 rounded-xl font-black transition text-white ${!isSavedForTable ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : isPreBillPrinted ? 'bg-gray-400 hover:bg-gray-500' : 'bg-orange-500 hover:bg-orange-600'}`}>
                  {isPreBillPrinted ? '🔒 Re-Print PreBill' : '🖨️ Print Pre-Bill'}
                </button>
                <button onClick={() => setIsSettleModalOpen(true)} disabled={!isPreBillPrinted} className={`py-2.5 rounded-xl font-black transition text-white ${!isPreBillPrinted ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black'}`}>💰 Settle Bill</button>
              </div>

              {cart.length > 0 && (
                <button
                  onClick={() => triggerAdminCheck('CLEAR_BILL')}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl font-black transition text-xs shadow-sm mt-1"
                >
                  🗑️ Clear Bill (Admin Required)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ADMIN SECURITY MODAL */}
      {isAdminModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-2xl max-w-xs w-full space-y-3 text-center text-xs">
            <span className="text-3xl">🛡️</span><h3 className="text-sm font-black text-gray-800">Admin Authorization Required</h3>
            {pendingAction === 'DELETE_ITEM' && pendingDeleteIndex !== null && cart[pendingDeleteIndex] && (
              <p className="text-[11px] text-gray-500 -mt-1">
                Removing <b>"{cart[pendingDeleteIndex].name}"</b> — a cancellation notice will be sent to the kitchen/bar.
              </p>
            )}
            {pendingAction === 'RE_SAVE' && <p className="text-[11px] text-gray-500 -mt-1">Re-saving items already sent to the kitchen/bar.</p>}
            {pendingAction === 'RE_PRINT' && <p className="text-[11px] text-gray-500 -mt-1">Re-printing the Pre-Bill.</p>}
            {pendingAction === 'CLEAR_BILL' && <p className="text-[11px] text-gray-500 -mt-1">Clearing this bill.</p>}

            <input
              type="text"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              className="w-full p-2.5 border rounded-xl text-center font-black text-sm"
              placeholder="Admin Username"
              autoComplete="off"
            />
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !adminCheckLoading) handleAdminVerify(); }}
              className="w-full p-2.5 border rounded-xl text-center font-black tracking-widest text-base"
              placeholder="••••"
            />

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => { setIsAdminModalOpen(false); setAdminUsername(''); setAdminPassword(''); setPendingDeleteIndex(null); }} className="bg-gray-100 hover:bg-gray-200 py-2 rounded-xl font-bold">Cancel</button>
              <button onClick={handleAdminVerify} disabled={adminCheckLoading} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white py-2 rounded-xl font-bold">
                {adminCheckLoading ? 'Checking...' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTLEMENT MODAL */}
      {isSettleModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl text-xs">
            <div className="flex justify-between border-b pb-2">
              <h3 className="text-base font-black text-gray-800">Settle & Close: {entityName}</h3>
              <button onClick={() => setIsSettleModalOpen(false)} className="text-gray-400 font-bold text-sm">✕</button>
            </div>
            <div>
              <label className="block font-bold text-gray-500 mb-1">Apply Discount</label>
              <div className="flex space-x-2 mb-1.5">
                <button onClick={() => setDiscountType('PERCENT')} className={`px-3 py-1.5 rounded-lg font-bold ${discountType === 'PERCENT' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>% Percent</button>
                <button onClick={() => setDiscountType('FIXED')} className={`px-3 py-1.5 rounded-lg font-bold ${discountType === 'FIXED' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>Rs. Fixed</button>
              </div>
              <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="w-full p-2 border rounded-xl font-black text-sm" placeholder="0" />
            </div>
            <div>
              <label className="block font-bold text-gray-500 mb-1">Payment Method</label>
              <div className="grid grid-cols-3 gap-1.5">
                {['CASH', 'CARD', 'TRANSFER'].map(m => <button key={m} onClick={() => setPaymentMethod(m)} className={`py-2 rounded-xl font-black border transition ${paymentMethod === m ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white text-gray-500'}`}>{m}</button>)}
              </div>
            </div>
            <div className="bg-gray-50 p-3 rounded-xl space-y-1 border font-medium">
              <div className="flex justify-between"><span>Gross Amount:</span><span>Rs.{netTotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-red-500"><span>Discount:</span><span>-Rs.{discountAmount.toFixed(2)}</span></div>
              <div className="flex justify-between text-base font-black text-gray-900 border-t pt-1.5 mt-1.5"><span>Net Payable:</span><span className="text-emerald-600">Rs.{finalTotal.toFixed(2)}</span></div>
            </div>
            <button onClick={handleFinalSettle} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl font-black text-sm shadow-md transition">🤝 Complete Settlement & Print Receipt</button>
          </div>
        </div>
      )}

    </div>
  );
}