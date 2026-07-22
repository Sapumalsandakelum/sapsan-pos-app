// src/BillingScreen.jsx
import React, { useState, useEffect } from 'react';
import { db, cleanupOrphanedPendingOrders } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { printViaBluetooth, generateKitchenReceipt, generateBillReceipt, generateCancellationReceipt, getNextDailyOrderNumber, generateBillReceiptHtml, generateKitchenReceiptHtml } from './printUtils';
import { logDeletedItem, logDeletedBill, logActivity } from './auditUtils';
import QuickCalculatorModal from './QuickCalculatorModal';

// mainCategory: { id, name, icon, usesTables, serviceChargeEnabled, allowedActions }
// allowedActions: { SAVE_KOT(permanent), ADVANCE, PRE_BILL, SPLIT_BILL, SETTLE, CLEAR_BILL }
// entityName: the selected table/order slot name, e.g. "Table 1" or "Order 01"
export default function BillingScreen({ mainCategory, entityName, onBack, currentUser, activeDaySession }) {
  const isTakeawayLike = !mainCategory.usesTables; // controls "Table:"/"Type:" labels on receipts
  const serviceChargeApplies = !!mainCategory.serviceChargeEnabled;
  // Resolve allowed billing buttons — default all true if not configured yet
  const aa = { SAVE_KOT: true, ADVANCE: true, PRE_BILL: true, SPLIT_BILL: true, SETTLE: true, CLEAR_BILL: true, ...(mainCategory.allowedActions || {}) };

  // DB Live Queries — filter by mainCategory
  const allCategories = useLiveQuery(() => db.categories.toArray()) || [];
  const allItems = useLiveQuery(() => db.items.toArray()) || [];

  // Show categories that belong to this main category (mainCategoryId === catId)
  // OR global categories that have no mainCategoryId set (backward compat with old data)
  const catId = mainCategory.id;
  const categories = allCategories.filter(c => {
    if (c.allowedMainCategoryIds && c.allowedMainCategoryIds.length > 0) {
      return c.allowedMainCategoryIds.includes(catId);
    }
    if (c.mainCategoryId) {
      return c.mainCategoryId === catId;
    }
    return true;
  });
  // Items are scoped indirectly — only show items whose parent category is visible
  const visibleCatIds = new Set(categories.map(c => c.id));
  const items = allItems.filter(i => visibleCatIds.has(i.categoryId));

  const activeOrders = useLiveQuery(() => db.orders.where('status').equals('PENDING').toArray()) || [];
  const allAdvanceBookings = useLiveQuery(() => db.advanceBookings.toArray()) || [];
  const activeAdvanceBookings = allAdvanceBookings.filter(b => b.status === 'ACTIVE');

  const existingOrder = activeOrders.find(o => o.tableNumber === entityName && o.mainCategoryName === mainCategory.name);

  const pendingSplitOrders = activeOrders.filter(o =>
    o.status === 'PENDING' &&
    o.parentTableNumber === entityName &&
    (existingOrder ? o.parentOrderId === existingOrder.id : true)
  );

  // UI States
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [cart, setCart] = useState([]);
  const [isCalcOpen, setIsCalcOpen] = useState(false);

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

  // Settlement Modals & Advance Selection
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [complementaryReason, setComplementaryReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH'); // CASH, CARD, TRANSFER, MULTI
  const [cashReceived, setCashReceived] = useState('');
  const [selectedAdvanceBookingId, setSelectedAdvanceBookingId] = useState('');

  // Multi-Payment States
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  // Split Billing States
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitMode, setSplitMode] = useState('EQUAL'); // 'EQUAL' or 'ITEM'
  const [equalSplitCount, setEqualSplitCount] = useState(2);
  const [settledShares, setSettledShares] = useState([]);
  const [selectedSplitItems, setSelectedSplitItems] = useState({});
  const [splitPaymentMethod, setSplitPaymentMethod] = useState('CASH');

  const existingOrderId = existingOrder?.id;
  useEffect(() => {
    if (existingOrder) {
      if ((!existingOrder.items || existingOrder.items.length === 0) && pendingSplitOrders.length === 0) {
        db.orders.delete(existingOrder.id);
        setCart([]);
        setIsSavedForTable(false);
        setIsPreBillPrinted(false);
        setSelectedAdvanceBookingId('');
      } else {
        setCart((existingOrder.items || []).map(i => ({ ...i, isSaved: true })));
        setIsSavedForTable((existingOrder.items || []).length > 0);
        setIsPreBillPrinted(existingOrder.isPreBillPrinted || false);
        if (existingOrder.advanceBookingId) {
          setSelectedAdvanceBookingId(existingOrder.advanceBookingId.toString());
        }
      }
    } else {
      setCart([]);
      setIsSavedForTable(false);
      setIsPreBillPrinted(false);
      setSelectedAdvanceBookingId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityName, mainCategory.id, existingOrderId, pendingSplitOrders.length]);

  // ==========================================
  // HANDLERS & OPERATIONS
  // ==========================================

  const addToCart = (item) => {
    if (item.isStockManaged) {
      const currentCartQty = cart
        .filter(c => c.id === item.id)
        .reduce((sum, c) => sum + c.quantity, 0);

      if (currentCartQty + 1 > item.stockLevel) {
        Swal.fire({
          icon: 'warning',
          title: 'Stock Limit Reached',
          text: `Only ${item.stockLevel} units of "${item.name}" are available.`,
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2500
        });
        return;
      }
    }

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

    if (amount > 0 && targetItem.isStockManaged) {
      const currentCartQty = cart
        .filter(c => c.id === targetItem.id)
        .reduce((sum, c) => sum + c.quantity, 0);

      if (currentCartQty + amount > targetItem.stockLevel) {
        Swal.fire({
          icon: 'warning',
          title: 'Stock Limit Reached',
          text: `Only ${targetItem.stockLevel} units of "${targetItem.name}" are available.`,
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2500
        });
        return;
      }
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
        // Return stock for deleted item
        const dbItem = await db.items.where('name').equals(targetItem.name).first();
        if (dbItem && dbItem.isStockManaged) {
          const newStock = (dbItem.stockLevel || 0) + targetItem.quantity;
          await db.items.update(dbItem.id, { stockLevel: newStock });
        }

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

  const adjustStockForOrder = async (newItems, oldItems = []) => {
    try {
      const oldQtyMap = {};
      oldItems.forEach(it => {
        oldQtyMap[it.name] = (oldQtyMap[it.name] || 0) + it.quantity;
      });

      const newQtyMap = {};
      newItems.forEach(it => {
        newQtyMap[it.name] = (newQtyMap[it.name] || 0) + it.quantity;
      });

      const allNames = Array.from(new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]));

      for (const name of allNames) {
        const oldQty = oldQtyMap[name] || 0;
        const newQty = newQtyMap[name] || 0;
        const diff = newQty - oldQty;

        if (diff === 0) continue;

        const dbItem = await db.items.where('name').equals(name).first();
        if (dbItem && dbItem.isStockManaged) {
          const newStock = Math.max(0, (dbItem.stockLevel || 0) - diff);
          await db.items.update(dbItem.id, { stockLevel: newStock });
        }
      }
    } catch (err) {
      console.error("Failed to adjust stock for order:", err);
    }
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

      await adjustStockForOrder(finalItemsForDb, existingOrder ? existingOrder.items : []);

      if (existingOrder) {
        currentPreBillState = false;
        orderNumber = existingOrder.dailyOrderNumber;
        await db.orders.update(existingOrder.id, { subTotal, totalServiceCharge, netTotal, advancePayment: advanceDeduction, advanceBookingId: selectedAdvanceBooking ? selectedAdvanceBooking.id : (existingOrder?.advanceBookingId || null), isPreBillPrinted: false, items: finalItemsForDb });
        savedOrderId = existingOrder.id;
      } else {
        orderNumber = getNextDailyOrderNumber(activeDaySession?.dateKey);
        savedOrderId = await db.orders.add({
          orderDate: new Date(),
          tableNumber: entityName,
          mainCategoryName: mainCategory.name,
          subTotal, totalServiceCharge, discountAmount: 0, netTotal,
          advancePayment: advanceDeduction,
          advanceBookingId: selectedAdvanceBooking ? selectedAdvanceBooking.id : null,
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
        const kotHtml = generateKitchenReceiptHtml(isTakeawayLike, entityName, 'KOT (KITCHEN)', kotItems, orderNumber);
        printViaBluetooth('kot', kotReceipt, kotHtml);
      }
      if (botItems.length > 0) {
        const botReceipt = generateKitchenReceipt(isTakeawayLike, entityName, 'BOT (BAR)', botItems, orderNumber);
        const botHtml = generateKitchenReceiptHtml(isTakeawayLike, entityName, 'BOT (BAR)', botItems, orderNumber);
        printViaBluetooth('bot', botReceipt, botHtml);
      }

      Swal.fire({
        icon: 'success',
        title: `${entityName} Saved`,
        toast: true, position: 'top-end', showConfirmButton: false, timer: 1200
      });

      // Auto-open Settlement if PRE_BILL is disabled but SETTLE is enabled
      // (i.e. this category skips Pre-Bill and goes straight to Settle after KOT)
      if (aa.SETTLE && !aa.PRE_BILL) {
        setIsSettleModalOpen(true);
      }
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

    const preBillReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'PRE-BILL RECEIPT', subTotal, totalServiceCharge, 0, netTotal, cart, existingOrder ? existingOrder.dailyOrderNumber : null, advanceDeduction);
    const preBillHtml = generateBillReceiptHtml(isTakeawayLike, entityName, 'PRE-BILL RECEIPT', subTotal, totalServiceCharge, 0, netTotal, cart, existingOrder ? existingOrder.dailyOrderNumber : null, advanceDeduction);
    printViaBluetooth('bill', preBillReceipt, preBillHtml);

    setIsPreBillPrinted(true);
    Swal.fire({
      icon: 'success',
      title: 'Pre-Bill Sent to Printer',
      toast: true, position: 'top-end', showConfirmButton: false, timer: 1200
    });
  };

  const handleFinalSettle = async () => {
    if (!existingOrder) return;

    try {
      let finalPaymentsBreakdown = null;
      let effectivePaymentMethod = paymentMethod;
      let authorizedAdminName = currentUser?.username || 'Cashier';

      if (discountType === 'COMPLEMENTARY') {
        if (!complementaryReason || !complementaryReason.trim()) {
          Swal.fire({
            icon: 'warning',
            title: 'Reason Required!',
            text: 'Please enter a valid reason for making this bill Complementary.',
            confirmButtonColor: '#7c3aed'
          });
          return;
        }

        // Admin Authorization Prompt for Complementary Bill
        const { value: adminCreds } = await Swal.fire({
          title: '🛡️ Admin Permission Required',
          html: `
            <div className="space-y-3 text-left text-xs">
              <p className="text-gray-600 font-medium">Bill total <b>Rs.${grossTotal.toFixed(2)}</b> will be waived as <b>100% Complementary</b>.</p>
              <div className="bg-purple-50 p-2.5 rounded-xl text-purple-900 font-bold border border-purple-200">
                Reason: "${complementaryReason.trim()}"<br/>
                Waived Amount: Rs.${grossTotal.toFixed(2)}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">Admin Username</label>
                <input id="swal-admin-user" class="swal2-input !m-0 !w-full text-xs font-bold" placeholder="Admin Username" autocomplete="off" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">Admin Password</label>
                <input id="swal-admin-pass" type="password" class="swal2-input !m-0 !w-full text-xs font-bold" placeholder="••••" />
              </div>
            </div>
          `,
          icon: 'shield',
          focusConfirm: false,
          showCancelButton: true,
          confirmButtonText: 'Authorize & Waive Bill',
          confirmButtonColor: '#7c3aed',
          preConfirm: async () => {
            const user = document.getElementById('swal-admin-user').value.trim();
            const pass = document.getElementById('swal-admin-pass').value.trim();
            if (!user || !pass) {
              Swal.showValidationMessage('Admin username and password are required!');
              return false;
            }
            const matchedAdmin = await db.admins.where('username').equalsIgnoreCase(user).first();
            if (!matchedAdmin || matchedAdmin.password !== pass || matchedAdmin.role !== 'ADMIN') {
              Swal.showValidationMessage('Invalid Admin Credentials or insufficient privileges!');
              return false;
            }
            return matchedAdmin.username;
          }
        });

        if (!adminCreds) return; // User cancelled or failed authorization
        authorizedAdminName = adminCreds;
        effectivePaymentMethod = 'COMPLEMENTARY';
        finalPaymentsBreakdown = [{
          method: 'COMPLEMENTARY',
          amount: 0,
          complementaryAmount: grossTotal,
          reason: complementaryReason.trim(),
          authorizedAdmin: adminCreds
        }];
      } else if (paymentMethod === 'MULTI') {
        finalPaymentsBreakdown = [];
        const cNum = parseFloat(cashAmount) || 0;
        const kNum = parseFloat(cardAmount) || 0;
        const tNum = parseFloat(transferAmount) || 0;

        if (cNum > 0) finalPaymentsBreakdown.push({ method: 'CASH', amount: cNum });
        if (kNum > 0) finalPaymentsBreakdown.push({ method: 'CARD', amount: kNum });
        if (tNum > 0) finalPaymentsBreakdown.push({ method: 'TRANSFER', amount: tNum });

        const totalMultiCollected = cNum + kNum + tNum;
        if (totalMultiCollected < finalTotal - 0.01) {
          Swal.fire({
            icon: 'error',
            title: 'Incomplete Multi-Payment',
            text: `Total payment collected (Rs.${totalMultiCollected.toFixed(2)}) is less than Net Total (Rs.${finalTotal.toFixed(2)}).`
          });
          return;
        }
      } else if (paymentMethod === 'CASH') {
        const given = parseFloat(cashReceived) || 0;
        const change = Math.max(0, given - finalTotal);
        finalPaymentsBreakdown = [{
          method: 'CASH',
          amount: finalTotal,
          cashReceived: given > 0 ? given : null,
          changeAmount: given > 0 ? change : null
        }];
      } else {
        finalPaymentsBreakdown = [{ method: paymentMethod, amount: finalTotal }];
      }

      if (selectedAdvanceBooking) {
        await db.advanceBookings.update(selectedAdvanceBooking.id, {
          status: 'REDEEMED',
          redeemedOrderId: existingOrder.id
        });
      }

      // Mark all pending orders for this table (main + any split orders) as SETTLED!
      const pendingOrdersForTable = await db.orders.filter(o =>
        o.status === 'PENDING' &&
        (o.tableNumber === entityName || o.parentTableNumber === entityName)
      ).toArray();

      for (const pOrd of pendingOrdersForTable) {
        await db.orders.update(pOrd.id, {
          discountAmount: discountType === 'COMPLEMENTARY' ? 0 : discountAmount,
          discountType,
          isComplementary: discountType === 'COMPLEMENTARY',
          complementaryReason: discountType === 'COMPLEMENTARY' ? complementaryReason.trim() : null,
          complementaryAmount: discountType === 'COMPLEMENTARY' ? grossTotal : 0,
          authorizedAdmin: discountType === 'COMPLEMENTARY' ? authorizedAdminName : null,
          advancePayment: advanceDeduction,
          advanceBookingId: selectedAdvanceBooking ? selectedAdvanceBooking.id : (existingOrder?.advanceBookingId || null),
          netTotal: finalTotal,
          paymentMethod: effectivePaymentMethod,
          paymentsBreakdown: finalPaymentsBreakdown,
          status: 'SETTLED',
          settledDate: new Date()
        });
      }

      await cleanupOrphanedPendingOrders();

      await logActivity({
        actionType: 'BILL_SETTLED',
        category: 'SALES',
        description: `Bill #${existingOrder.dailyOrderNumber || ''} settled for ${entityName} (Rs.${finalTotal.toFixed(2)}) via ${effectivePaymentMethod}`,
        details: { tableNumber: entityName, dailyOrderNumber: existingOrder.dailyOrderNumber, netTotal: finalTotal, paymentMethod: effectivePaymentMethod, paymentsBreakdown: finalPaymentsBreakdown },
        performedBy: currentUser?.username || 'Cashier'
      });

      const finalReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'FINAL INVOICE', subTotal, totalServiceCharge, discountAmount, finalTotal, cart, existingOrder.dailyOrderNumber, advanceDeduction, finalPaymentsBreakdown);
      const finalHtml = generateBillReceiptHtml(isTakeawayLike, entityName, 'FINAL INVOICE', subTotal, totalServiceCharge, discountAmount, finalTotal, cart, existingOrder.dailyOrderNumber, advanceDeduction, finalPaymentsBreakdown);
      printViaBluetooth('bill', finalReceipt, finalHtml);

      // Instantly finish settlement & return without blocking popups!
      setIsSettleModalOpen(false);
      setSelectedAdvanceBookingId('');
      setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
      onBack();
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Settlement Failed', text: err.message });
    }
  };

  // 🔀 SPLIT BILLING HANDLERS
  const handleSettleEqualShare = async (shareIndex) => {
    if (!existingOrder) return;
    const count = parseInt(equalSplitCount, 10) || 2;
    const shareSub = subTotal / count;
    const shareSc = totalServiceCharge / count;
    const shareDisc = discountAmount / count;
    const shareAdvance = advanceDeduction / count;
    const shareNet = finalTotal / count;

    window.setSwalShareMethod = (method) => {
      const input = document.getElementById('swal-share-method');
      if (input) input.value = method;
      ['CASH', 'CARD', 'TRANSFER'].forEach(m => {
        const btn = document.getElementById(`btn-share-${m}`);
        if (btn) {
          if (m === method) {
            btn.className = 'py-2.5 px-2 rounded-xl font-black text-xs border transition bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-300 scale-[1.02]';
          } else {
            btn.className = 'py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50';
          }
        }
      });
    };

    const { value: pMethod } = await Swal.fire({
      title: `Settle Share ${shareIndex + 1} of ${count}`,
      html: `
        <div class="text-left font-bold text-xs space-y-3 mb-2">
          <div class="bg-indigo-50 border border-indigo-200 p-3 rounded-2xl flex justify-between items-center">
            <span class="text-gray-600 text-xs font-bold">Share Net Total:</span>
            <span class="text-indigo-700 text-base font-black">Rs.${shareNet.toFixed(2)}</span>
          </div>
          <div>
            <label class="block text-gray-500 uppercase text-[10px] mb-2 font-black">Select Payment Method:</label>
            <input type="hidden" id="swal-share-method" value="CASH" />
            <div class="grid grid-cols-3 gap-2">
              <button type="button" id="btn-share-CASH" onclick="window.setSwalShareMethod('CASH')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-300 scale-[1.02]">💵 Cash</button>
              <button type="button" id="btn-share-CARD" onclick="window.setSwalShareMethod('CARD')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50">💳 Card</button>
              <button type="button" id="btn-share-TRANSFER" onclick="window.setSwalShareMethod('TRANSFER')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50">🏦 Transfer</button>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '💳 Pay & Print Share Invoice',
      confirmButtonColor: '#059669',
      preConfirm: () => document.getElementById('swal-share-method')?.value || 'CASH'
    });

    if (pMethod) {
      const splitInfoStr = `Share ${shareIndex + 1} of ${count}`;
      
      const shareReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'SPLIT INVOICE', shareSub, shareSc, shareDisc, shareNet, cart, existingOrder.dailyOrderNumber, shareAdvance, [{ method: pMethod, amount: shareNet }], splitInfoStr);
      const shareHtml = generateBillReceiptHtml(isTakeawayLike, entityName, 'SPLIT INVOICE', shareSub, shareSc, shareDisc, shareNet, cart, existingOrder.dailyOrderNumber, shareAdvance, [{ method: pMethod, amount: shareNet }], splitInfoStr);
      printViaBluetooth('bill', shareReceipt, shareHtml);

      await logActivity({
        actionType: 'BILL_SETTLED',
        category: 'SALES',
        description: `Split Share ${shareIndex + 1} of ${count} (Rs.${shareNet.toFixed(2)}) settled for ${entityName} via ${pMethod}`,
        details: { tableNumber: entityName, splitInfo: splitInfoStr, shareNet, pMethod },
        performedBy: currentUser?.username || 'Cashier'
      });

      const nextSettled = [...settledShares, shareIndex];
      setSettledShares(nextSettled);

      if (nextSettled.length >= count) {
        // All shares settled! Mark whole order settled
        await db.orders.update(existingOrder.id, {
          status: 'SETTLED',
          settledDate: new Date(),
          paymentMethod: 'SPLIT_EQUAL',
          netTotal: finalTotal
        });

        Swal.fire({
          icon: 'success',
          title: 'All Shares Settled! 🎉',
          text: `Table ${entityName} is now fully cleared.`,
          timer: 2000,
          showConfirmButton: false
        });

        setIsSplitModalOpen(false);
        setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
        onBack();
      } else {
        Swal.fire({
          icon: 'success',
          title: `Share ${shareIndex + 1} Settled! ✅`,
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 1500
        });
      }
    }
  };

  const handleSettleSelectedItemSplit = async () => {
    if (!existingOrder) return;
    const selectedIndices = Object.keys(selectedSplitItems).filter(idx => selectedSplitItems[idx] > 0);
    if (selectedIndices.length === 0) {
      Swal.fire({ icon: 'warning', title: 'No Items Selected', text: 'Select at least one item to split and settle.' });
      return;
    }

    const splitItemsList = selectedIndices.map(idx => {
      const original = cart[parseInt(idx, 10)];
      const qtyToSplit = selectedSplitItems[idx];
      return {
        ...original,
        quantity: qtyToSplit
      };
    });

    const splitSub = splitItemsList.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);
    const splitSc = serviceChargeApplies ? splitSub * 0.10 : 0;
    const splitNet = splitSub + splitSc;

    const splitInfoStr = `Item Split Bill`;

    const splitReceipt = await generateBillReceipt(isTakeawayLike, entityName, 'SPLIT INVOICE', splitSub, splitSc, 0, splitNet, splitItemsList, existingOrder.dailyOrderNumber, 0, [{ method: splitPaymentMethod, amount: splitNet }], splitInfoStr);
    const splitHtml = generateBillReceiptHtml(isTakeawayLike, entityName, 'SPLIT INVOICE', splitSub, splitSc, 0, splitNet, splitItemsList, existingOrder.dailyOrderNumber, 0, [{ method: splitPaymentMethod, amount: splitNet }], splitInfoStr);
    printViaBluetooth('bill', splitReceipt, splitHtml);

    await logActivity({
      actionType: 'BILL_SETTLED',
      category: 'SALES',
      description: `Item Split Bill (Rs.${splitNet.toFixed(2)}) settled for ${entityName} via ${splitPaymentMethod}`,
      details: { tableNumber: entityName, splitNet, items: splitItemsList, splitPaymentMethod },
      performedBy: currentUser?.username || 'Cashier'
    });

    // Deduct split items from the table's cart / order in IndexedDB
    const updatedCart = [];
    cart.forEach((item, idx) => {
      const splitQty = selectedSplitItems[idx] || 0;
      const remainQty = item.quantity - splitQty;
      if (remainQty > 0) {
        updatedCart.push({
          ...item,
          quantity: remainQty
        });
      }
    });

    const remainingSplits = await db.orders.filter(o =>
      o.status === 'PENDING' &&
      o.parentTableNumber === entityName
    ).toArray();

    if (updatedCart.length === 0 && remainingSplits.length === 0) {
      // Table is now empty AND no split bills remain, mark all table orders SETTLED!
      const allTablePendingOrders = await db.orders.filter(o =>
        o.status === 'PENDING' &&
        (o.tableNumber === entityName || o.parentTableNumber === entityName)
      ).toArray();

      for (const pOrd of allTablePendingOrders) {
        await db.orders.update(pOrd.id, {
          status: 'SETTLED',
          settledDate: new Date(),
          paymentMethod: splitPaymentMethod
        });
      }
      Swal.fire({
        icon: 'success',
        title: 'Table Fully Settled! 🎉',
        text: `All items and split bills settled for ${entityName}. Table is now open.`,
        timer: 2000,
        showConfirmButton: false
      });
      setIsSplitModalOpen(false);
      setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
      onBack();
    } else {
      // Update order in IndexedDB with remaining items
      const newSub = updatedCart.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);
      const newSc = serviceChargeApplies ? newSub * 0.10 : 0;
      const newNet = newSub + newSc;

      await db.orders.update(existingOrder.id, {
        items: updatedCart,
        subTotal: newSub,
        totalServiceCharge: newSc,
        netTotal: newNet
      });

      setCart(updatedCart);
      setSelectedSplitItems({});
      setIsSplitModalOpen(true);

      Swal.fire({
        icon: 'success',
        title: 'Items Settled! ✅',
        text: remainingSplits.length > 0
          ? `Settled Rs.${splitNet.toFixed(2)} — ${remainingSplits.length} split bill(s) remain.`
          : `Remaining items updated on ${entityName}.`,
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2200
      });
    }
  };

  const handlePrintEqualSharePreBill = async (shareIndex) => {
    if (!existingOrder) return;
    const count = parseInt(equalSplitCount, 10) || 2;
    const shareSub = subTotal / count;
    const shareSc = totalServiceCharge / count;
    const shareDisc = discountAmount / count;
    const shareAdvance = advanceDeduction / count;
    const shareNet = finalTotal / count;
    const splitInfoStr = `Pre-Bill: Share ${shareIndex + 1} of ${count}`;

    const preReceipt = await generateBillReceipt(
      isTakeawayLike,
      entityName,
      'PRE-BILL RECEIPT',
      shareSub,
      shareSc,
      shareDisc,
      shareNet,
      cart,
      existingOrder.dailyOrderNumber,
      shareAdvance,
      null,
      splitInfoStr
    );

    const preHtml = generateBillReceiptHtml(
      isTakeawayLike,
      entityName,
      'PRE-BILL RECEIPT',
      shareSub,
      shareSc,
      shareDisc,
      shareNet,
      cart,
      existingOrder.dailyOrderNumber,
      shareAdvance,
      null,
      splitInfoStr
    );

    printViaBluetooth('bill', preReceipt, preHtml);
    Swal.fire({
      icon: 'success',
      title: `Pre-Bill Printed for Share ${shareIndex + 1}! 🖨️`,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1800
    });
  };

  const handlePrintSelectedItemSplitPreBill = async () => {
    if (!existingOrder) return;
    const selectedIndices = Object.keys(selectedSplitItems).filter(idx => selectedSplitItems[idx] > 0);
    if (selectedIndices.length === 0) {
      Swal.fire({ icon: 'warning', title: 'No Items Selected', text: 'Select at least one item to print a split pre-bill.' });
      return;
    }

    const splitItemsList = selectedIndices.map(idx => {
      const original = cart[parseInt(idx, 10)];
      const qtyToSplit = selectedSplitItems[idx];
      return {
        ...original,
        quantity: qtyToSplit
      };
    });

    const splitSub = splitItemsList.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);
    const splitSc = serviceChargeApplies ? splitSub * 0.10 : 0;
    const splitNet = splitSub + splitSc;

    // Count existing split orders for this table to generate unique split name e.g. "Table 1 (Split 1)"
    const existingSplits = await db.orders.filter(o => o.tableNumber && o.tableNumber.startsWith(`${entityName} (Split`)).toArray();
    const splitIndex = existingSplits.length + 1;
    const splitTableName = `${entityName} (Split ${splitIndex})`;
    const splitOrderNumber = await getNextDailyOrderNumber();

    const splitInfoStr = `Split Pre-Bill: ${splitTableName}`;

    const preReceipt = await generateBillReceipt(
      isTakeawayLike,
      splitTableName,
      'PRE-BILL RECEIPT',
      splitSub,
      splitSc,
      0,
      splitNet,
      splitItemsList,
      splitOrderNumber,
      0,
      null,
      splitInfoStr
    );

    const preHtml = generateBillReceiptHtml(
      isTakeawayLike,
      splitTableName,
      'PRE-BILL RECEIPT',
      splitSub,
      splitSc,
      0,
      splitNet,
      splitItemsList,
      splitOrderNumber,
      0,
      null,
      splitInfoStr
    );

    printViaBluetooth('bill', preReceipt, preHtml);

    // Save the pre-billed split items as a separate staged order ready for settlement!
    await db.orders.add({
      parentOrderId: existingOrder?.id || null,
      parentTableNumber: entityName,
      mainCategoryId: mainCategory.id,
      tableNumber: splitTableName,
      mainCategoryName: mainCategory.name,
      subTotal: splitSub,
      totalServiceCharge: splitSc,
      discountAmount: 0,
      netTotal: splitNet,
      advancePayment: 0,
      paymentMethod: 'PENDING',
      status: 'PENDING',
      isPreBillPrinted: true, // Unlocks settlement for this split order!
      items: splitItemsList,
      dailyOrderNumber: splitOrderNumber,
      cashierName: currentUser?.username || 'Admin Cashier',
      createdDate: new Date()
    });

    await logActivity({
      actionType: 'BILL_SPLIT_PREBILL',
      category: 'SALES',
      description: `Split Pre-Bill printed for ${entityName} (Rs.${splitNet.toFixed(2)}) ➔ Created ${splitTableName}`,
      details: { originalTable: entityName, splitTableName, netTotal: splitNet, items: splitItemsList },
      performedBy: currentUser?.username || 'Cashier'
    });

    // Reset selection & keep main bill intact until settlement!
    setSelectedSplitItems({});
    setIsSplitModalOpen(true);

    Swal.fire({
      icon: 'success',
      title: 'Split Pre-Bill Saved! 🖨️',
      text: `"${splitTableName}" (Rs.${splitNet.toFixed(2)}) saved in Split Bill button. Main bill remains full until split payment is settled.`,
      timer: 2200,
      showConfirmButton: false
    });

    await logActivity({
      actionType: 'BILL_SPLIT_PREBILL',
      category: 'SALES',
      description: `Split Pre-Bill printed for ${entityName} (Rs.${splitNet.toFixed(2)}) ➔ Created ${splitTableName}`,
      details: { originalTable: entityName, splitTableName, netTotal: splitNet, items: splitItemsList },
      performedBy: currentUser?.username || 'Cashier'
    });

    // Reset selection & keep main bill intact until settlement!
    setSelectedSplitItems({});
    setIsSplitModalOpen(true);

    Swal.fire({
      icon: 'success',
      title: 'Pre-Bill Printed & Added! 🖨️',
      text: `"${splitTableName}" (Rs.${splitNet.toFixed(2)}) added to the split list. Main bill value remains normal until split settlement.`,
      timer: 2200,
      showConfirmButton: false
    });
  };

  const handleSettleExistingSplitOrder = async (splitOrderToSettle) => {
    window.setSwalMethod = (method) => {
      const input = document.getElementById('swal-split-settle-method');
      if (input) input.value = method;
      ['CASH', 'CARD', 'TRANSFER'].forEach(m => {
        const btn = document.getElementById(`btn-swal-${m}`);
        if (btn) {
          if (m === method) {
            btn.className = 'py-2.5 px-2 rounded-xl font-black text-xs border transition bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-300 scale-[1.02]';
          } else {
            btn.className = 'py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50';
          }
        }
      });
    };

    const { value: pMethod } = await Swal.fire({
      title: `Settle: ${splitOrderToSettle.tableNumber}`,
      html: `
        <div class="text-left font-bold text-xs space-y-3 mb-2">
          <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex justify-between items-center">
            <span class="text-gray-600 text-xs font-bold">Bill Amount:</span>
            <span class="text-emerald-700 text-base font-black">Rs.${(splitOrderToSettle.netTotal || 0).toFixed(2)}</span>
          </div>
          <div>
            <label class="block text-gray-500 uppercase text-[10px] mb-2 font-black">Select Payment Method:</label>
            <input type="hidden" id="swal-split-settle-method" value="CASH" />
            <div class="grid grid-cols-3 gap-2">
              <button type="button" id="btn-swal-CASH" onclick="window.setSwalMethod('CASH')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-300 scale-[1.02]">💵 Cash</button>
              <button type="button" id="btn-swal-CARD" onclick="window.setSwalMethod('CARD')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50">💳 Card</button>
              <button type="button" id="btn-swal-TRANSFER" onclick="window.setSwalMethod('TRANSFER')" class="py-2.5 px-2 rounded-xl font-black text-xs border transition bg-white text-gray-700 border-gray-200 hover:bg-gray-50">🏦 Transfer</button>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '💳 Settle & Print Final Receipt',
      confirmButtonColor: '#059669',
      preConfirm: () => document.getElementById('swal-split-settle-method')?.value || 'CASH'
    });

    if (pMethod) {
      const splitNet = splitOrderToSettle.netTotal || 0;
      const splitSub = splitOrderToSettle.subTotal || splitNet;
      const splitSc = splitOrderToSettle.totalServiceCharge || 0;

      await db.orders.update(splitOrderToSettle.id, {
        status: 'SETTLED',
        settledDate: new Date(),
        paymentMethod: pMethod
      });

      const finalReceipt = await generateBillReceipt(
        isTakeawayLike,
        splitOrderToSettle.tableNumber,
        'FINAL INVOICE',
        splitSub,
        splitSc,
        0,
        splitNet,
        splitOrderToSettle.items,
        splitOrderToSettle.dailyOrderNumber,
        0,
        [{ method: pMethod, amount: splitNet }],
        `Split Final Invoice`
      );

      const finalHtml = generateBillReceiptHtml(
        isTakeawayLike,
        splitOrderToSettle.tableNumber,
        'FINAL INVOICE',
        splitSub,
        splitSc,
        0,
        splitNet,
        splitOrderToSettle.items,
        splitOrderToSettle.dailyOrderNumber,
        0,
        [{ method: pMethod, amount: splitNet }],
        `Split Final Invoice`
      );

      printViaBluetooth('bill', finalReceipt, finalHtml);

      await logActivity({
        actionType: 'BILL_SETTLED',
        category: 'SALES',
        description: `${splitOrderToSettle.tableNumber} (Rs.${splitNet.toFixed(2)}) settled via ${pMethod}`,
        details: { tableNumber: splitOrderToSettle.tableNumber, netTotal: splitNet, paymentMethod: pMethod },
        performedBy: currentUser?.username || 'Cashier'
      });

      // DEDUCT SETTLED SPLIT ITEMS FROM MAIN TABLE ORDER AND CART!
      let remainingMainItemsCount = 0;
      if (existingOrder && existingOrder.items) {
        const splitItemsMap = {};
        (splitOrderToSettle.items || []).forEach(it => {
          splitItemsMap[it.name] = (splitItemsMap[it.name] || 0) + it.quantity;
        });

        const updatedMainItems = [];
        existingOrder.items.forEach(item => {
          const deductQty = splitItemsMap[item.name] || 0;
          const remainingQty = item.quantity - deductQty;
          if (remainingQty > 0) {
            updatedMainItems.push({
              ...item,
              quantity: remainingQty
            });
          }
        });

        remainingMainItemsCount = updatedMainItems.length;

        if (updatedMainItems.length === 0) {
          await db.orders.delete(existingOrder.id);
          setCart([]);
        } else {
          const newSub = updatedMainItems.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);
          const newSc = serviceChargeApplies ? newSub * 0.10 : 0;
          const newNet = newSub + newSc;

          await db.orders.update(existingOrder.id, {
            items: updatedMainItems,
            subTotal: newSub,
            totalServiceCharge: newSc,
            netTotal: newNet
          });
          setCart(updatedMainItems);
        }
      }

      // Check if all pending split orders for this table are now settled
      const remainingSplits = await db.orders.filter(o =>
        o.id !== splitOrderToSettle.id &&
        o.status === 'PENDING' &&
        o.parentTableNumber === entityName
      ).toArray();

      if (remainingSplits.length === 0 && remainingMainItemsCount === 0) {
        const allTablePendingOrders = await db.orders.filter(o =>
          o.status === 'PENDING' &&
          (o.tableNumber === entityName || o.parentTableNumber === entityName)
        ).toArray();

        for (const pOrd of allTablePendingOrders) {
          await db.orders.update(pOrd.id, {
            status: 'SETTLED',
            settledDate: new Date()
          });
        }
        await Swal.fire({
          icon: 'success',
          title: 'Table Fully Settled! 🎉',
          text: `All split bills and table items for ${entityName} have been settled. Table is now open.`,
          timer: 2000,
          showConfirmButton: false
        });
        setIsSplitModalOpen(false);
        setCart([]);
        setIsSavedForTable(false);
        setIsPreBillPrinted(false);
        onBack();
      } else {
        setIsSplitModalOpen(true);
        Swal.fire({
          icon: 'success',
          title: `${splitOrderToSettle.tableNumber} Settled! 🎉`,
          text: `Settled Rs.${splitNet.toFixed(2)} — ${remainingSplits.length} split bill(s) remaining in split view.`,
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2200
        });
      }
    }
  };

  const executeClearTableBill = async (deletedByAdmin) => {
    try {
      if (existingOrder) {
        await logActivity({
          actionType: 'BILL_VOIDED',
          category: 'SECURITY',
          description: `Bill voided for ${entityName} (Rs.${(existingOrder.netTotal || 0).toFixed(2)})`,
          details: { tableNumber: entityName, netTotal: existingOrder.netTotal },
          performedBy: deletedByAdmin || currentUser?.username || 'Admin'
        });
        if (existingOrder.items && existingOrder.items.length > 0) {
          for (const item of existingOrder.items) {
            const dbItem = await db.items.where('name').equals(item.name).first();
            if (dbItem && dbItem.isStockManaged) {
              const newStock = (dbItem.stockLevel || 0) + item.quantity;
              await db.items.update(dbItem.id, { stockLevel: newStock });
            }
          }
        }
        await logDeletedBill({
          tableNumber: entityName,
          isTakeaway: isTakeawayLike,
          items: existingOrder.items,
          netTotal: existingOrder.netTotal,
          dailyOrderNumber: existingOrder.dailyOrderNumber,
          deletedBy: deletedByAdmin,
        });
        await db.orders.delete(existingOrder.id);
      }
      setCart([]);
      setIsSavedForTable(false);
      setIsPreBillPrinted(false);
      setSelectedAdvanceBookingId('');
      Swal.fire({ icon: 'success', title: 'Bill Cleared Successfully! 🗑️', text: 'This slot is now empty.', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Failed to Clear Bill!', text: err.message });
    }
  };

  // Calculations Logic
  const selectedAdvanceBooking = activeAdvanceBookings.find(b => b.id.toString() === selectedAdvanceBookingId);
  const advanceDeduction = selectedAdvanceBooking ? selectedAdvanceBooking.amount : (existingOrder?.advancePayment || 0);

  const handleAdvanceDepositChange = async (bookingIdStr) => {
    setSelectedAdvanceBookingId(bookingIdStr);
    const booking = activeAdvanceBookings.find(b => b.id.toString() === bookingIdStr);
    const advAmt = booking ? booking.amount : 0;
    const advId = booking ? booking.id : null;

    if (existingOrder) {
      const gross = existingOrder.subTotal + existingOrder.totalServiceCharge;
      const newNet = Math.max(0, gross - advAmt);
      await db.orders.update(existingOrder.id, {
        advancePayment: advAmt,
        advanceBookingId: advId,
        netTotal: newNet
      });
    }
  };

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
    const grossTotal = subTotal + totalServiceCharge;
    const netTotal = Math.max(0, grossTotal - advanceDeduction);
    return { subTotal, totalServiceCharge, grossTotal, netTotal };
  };
  const { subTotal, totalServiceCharge, grossTotal, netTotal } = calculateTotals();

  const getSettlementTotals = () => {
    let discountAmount = 0;
    let complementaryAmount = 0;
    if (discountType === 'COMPLEMENTARY') {
      discountAmount = 0;
      complementaryAmount = Math.max(0, grossTotal - advanceDeduction);
    } else if (discountType === 'PERCENT') {
      discountAmount = (grossTotal * parseFloat(discountValue || 0)) / 100;
    } else {
      discountAmount = parseFloat(discountValue || 0);
    }
    const finalTotal = discountType === 'COMPLEMENTARY' ? 0 : Math.max(0, grossTotal - discountAmount - advanceDeduction);
    return { discountAmount, complementaryAmount, finalTotal };
  };
  const { discountAmount, complementaryAmount, finalTotal } = getSettlementTotals();

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
            {filteredItems.map(item => {
              const isOutOfStock = item.isStockManaged && (item.stockLevel || 0) <= 0;
              return (
                <div 
                  key={item.id} 
                  onClick={() => {
                    if (isOutOfStock) {
                      Swal.fire({ icon: 'warning', title: 'Out of Stock', text: `"${item.name}" is currently unavailable.`, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                      return;
                    }
                    addToCart(item);
                  }} 
                  className={`p-3 rounded-xl border transition relative flex flex-col justify-between h-24 ${
                    isOutOfStock 
                      ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-60' 
                      : 'bg-gray-50 hover:bg-indigo-50 hover:border-indigo-300 active:scale-95 cursor-pointer shadow-sm'
                  }`}
                >
                  <div className="font-bold text-xs text-gray-700 line-clamp-2 pr-4">{item.name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-indigo-600 font-black text-sm">
                      Rs.{(serviceChargeApplies && item.isInclusiveServiceCharge && item.inclusivePrice) ? item.inclusivePrice.toFixed(0) : item.sellingPrice.toFixed(0)}
                    </span>
                    {serviceChargeApplies && item.isInclusiveServiceCharge && (
                      <span className="text-[8px] font-black text-indigo-700 bg-indigo-100 px-1 rounded">Incl. SC</span>
                    )}
                    {item.isStockManaged && (
                      isOutOfStock ? (
                        <span className="text-[8px] font-black bg-red-100 text-red-600 px-1 rounded">OUT</span>
                      ) : (
                        <span className="text-[8px] font-black bg-indigo-100 text-indigo-600 px-1 rounded">{item.stockLevel} left</span>
                      )
                    )}
                  </div>
                </div>
              );
            })}
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
                <p className="text-xs font-bold mt-1">Select items to start an order</p>
              </div>
            ) : (
              cart.map((item, index) => (
                <div key={index} className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${item.isSaved ? 'bg-gray-100 border-gray-200 opacity-85' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="font-black text-gray-800 truncate">{item.name}</div>
                    <div className="text-[10px] text-gray-400">
                      Rs.{(serviceChargeApplies && item.isInclusiveServiceCharge && item.inclusivePrice) ? item.inclusivePrice.toFixed(2) : item.sellingPrice.toFixed(2)}
                      {serviceChargeApplies && item.isInclusiveServiceCharge && ' (Incl. SC)'}
                      {item.isSaved && ' 🔒 (Saved)'}
                    </div>
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
          <div className="border-t pt-2 space-y-1.5 shrink-0 bg-white text-xs">
            <div className="flex justify-between text-gray-500"><span>Sub Total</span><span className="font-bold">Rs.{subTotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-amber-600 font-bold">
              <span>Service Charge {!serviceChargeApplies && '(0%)'}</span>
              <span>+Rs.{totalServiceCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-700 font-bold">
              <span>Gross Total</span>
              <span>Rs.{grossTotal.toFixed(2)}</span>
            </div>
            {advanceDeduction > 0 && (
              <div className="flex justify-between text-emerald-600 font-bold">
                <span>Advance Deposit ({selectedAdvanceBooking?.customerName || 'Applied'})</span>
                <span>-Rs.{advanceDeduction.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-indigo-700 border-t pt-1"><span>Net Total</span><span>Rs.{netTotal.toFixed(2)}</span></div>

            <div className="space-y-1.5 pt-1">
              <button onClick={handleSaveOrderClick} className={`w-full text-white py-2.5 rounded-xl font-black text-xs transition shadow-sm ${isSavedForTable && cart.filter(i => !i.isSaved).length === 0 ? 'bg-gray-400 hover:bg-gray-500' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {isSavedForTable && cart.filter(i => !i.isSaved).length === 0 ? '🔒 Re-Save Order (Admin Required)' : '💾 Save Order & Print KOT/BOT'}
              </button>

              <div className={`grid gap-1.5 ${[aa.ADVANCE, aa.PRE_BILL, aa.SPLIT_BILL, aa.SETTLE].filter(Boolean).length === 4 ? 'grid-cols-4' : [aa.ADVANCE, aa.PRE_BILL, aa.SPLIT_BILL, aa.SETTLE].filter(Boolean).length === 3 ? 'grid-cols-3' : [aa.ADVANCE, aa.PRE_BILL, aa.SPLIT_BILL, aa.SETTLE].filter(Boolean).length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {aa.ADVANCE && (
                  <button
                    onClick={() => setIsAdvanceModalOpen(true)}
                    className={`py-2 rounded-xl font-black text-xs transition border flex flex-col items-center justify-center ${
                      advanceDeduction > 0
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    <span className="text-[9px]">💳 Advance</span>
                    <span className="text-[10px] truncate max-w-full">
                      {advanceDeduction > 0 ? `-Rs.${advanceDeduction.toFixed(0)}` : 'Select'}
                    </span>
                  </button>
                )}

                {aa.PRE_BILL && (
                  <button onClick={handlePrintPreBillClick} disabled={!isSavedForTable} className={`py-2 rounded-xl font-black transition text-xs text-white flex flex-col items-center justify-center ${!isSavedForTable ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : isPreBillPrinted ? 'bg-gray-400 hover:bg-gray-500' : 'bg-orange-500 hover:bg-orange-600'}`}>
                    <span className="text-[9px]">Pre-Bill</span>
                    <span className="text-[10px]">{isPreBillPrinted ? '🔒 Re-Print' : '🖨️ Print'}</span>
                  </button>
                )}

                {aa.SPLIT_BILL && (
                  <button
                    onClick={() => {
                      setSettledShares([]);
                      setSelectedSplitItems({});
                      setIsSplitModalOpen(true);
                    }}
                    disabled={!isSavedForTable || cart.length === 0}
                    className={`py-2 rounded-xl font-black transition text-xs text-white flex flex-col items-center justify-center relative ${!isSavedForTable || cart.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    <span className="text-[9px]">Split</span>
                    <span className="text-[10px] flex items-center gap-1">
                      <span>🔀 Split Bill</span>
                      {pendingSplitOrders.length > 0 && (
                        <span className="bg-amber-400 text-gray-900 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-xs">
                          {pendingSplitOrders.length}
                        </span>
                      )}
                    </span>
                  </button>
                )}

                {aa.SETTLE && (
                  <button
                    onClick={() => setIsSettleModalOpen(true)}
                    disabled={aa.PRE_BILL ? !isPreBillPrinted : !isSavedForTable}
                    className={`py-2 rounded-xl font-black transition text-xs text-white flex flex-col items-center justify-center ${(aa.PRE_BILL ? !isPreBillPrinted : !isSavedForTable) ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black'}`}
                  >
                    <span className="text-[9px]">Settlement</span>
                    <span className="text-[10px]">💰 Settle</span>
                  </button>
                )}
              </div>

              {aa.CLEAR_BILL && cart.length > 0 && (
                <button
                  onClick={() => triggerAdminCheck('CLEAR_BILL')}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-1.5 rounded-xl font-black transition text-[11px] shadow-sm mt-0.5"
                >
                  🗑️ Clear Bill (Admin Required)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 💳 ADVANCE BOOKING DEPOSIT SELECTION MODAL */}
      {isAdvanceModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl text-xs">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-black text-gray-800 flex items-center space-x-2">
                <span>💳</span>
                <span>Apply Advance Booking Deposit</span>
              </h3>
              <button onClick={() => setIsAdvanceModalOpen(false)} className="text-gray-400 font-bold text-sm">✕</button>
            </div>

            <div>
              <p className="text-[11px] text-gray-500 mb-2">Select an early booking deposit to deduct from this bill ({entityName}):</p>
              <select
                value={selectedAdvanceBookingId}
                onChange={(e) => {
                  handleAdvanceDepositChange(e.target.value);
                }}
                className="w-full p-3 border rounded-xl font-bold text-xs bg-emerald-50 border-emerald-300 text-emerald-900 focus:outline-none"
              >
                <option value="">-- No Advance Deposit Selected --</option>
                {activeAdvanceBookings.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.customerName} - Rs.{b.amount.toFixed(2)} ({b.paymentMethod} - {b.bookingDate})
                  </option>
                ))}
              </select>
            </div>

            {selectedAdvanceBooking && (
              <div className="bg-emerald-100/70 border border-emerald-300 rounded-xl p-3 text-emerald-900 space-y-1">
                <div className="font-black text-xs">✅ Selected Deposit Details</div>
                <div className="flex justify-between text-[11px]"><span>Customer:</span><span className="font-bold">{selectedAdvanceBooking.customerName}</span></div>
                <div className="flex justify-between text-[11px]"><span>Phone:</span><span className="font-bold">{selectedAdvanceBooking.phone || 'N/A'}</span></div>
                <div className="flex justify-between text-[11px]"><span>Booking Date:</span><span className="font-bold">{selectedAdvanceBooking.bookingDate}</span></div>
                <div className="flex justify-between text-[11px] font-black text-emerald-700 border-t border-emerald-200 pt-1 mt-1"><span>Deduction Amount:</span><span>-Rs.{selectedAdvanceBooking.amount.toFixed(2)}</span></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              {selectedAdvanceBookingId && (
                <button
                  onClick={() => { handleAdvanceDepositChange(''); }}
                  className="bg-red-50 text-red-600 hover:bg-red-100 py-2.5 rounded-xl font-black transition text-xs"
                >
                  Remove Deposit
                </button>
              )}
              <button
                onClick={() => setIsAdvanceModalOpen(false)}
                className={`bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-black transition text-xs ${!selectedAdvanceBookingId ? 'col-span-2' : ''}`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 🔀 SPLIT BILL MODAL */}
      {isSplitModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-3xl max-w-md w-full space-y-4 shadow-2xl text-xs overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-base font-black text-gray-800 flex items-center space-x-2">
                <span>🔀</span>
                <span>Split Bill & Order Settlement — {entityName}</span>
              </h3>
              <button onClick={() => setIsSplitModalOpen(false)} className="text-gray-400 font-bold text-sm">✕</button>
            </div>

            {/* Split Mode Sub-Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setSplitMode('EQUAL')}
                className={`py-2 rounded-lg font-black text-xs transition ${splitMode === 'EQUAL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                👥 Equal Share Split
              </button>
              <button
                onClick={() => setSplitMode('ITEM')}
                className={`py-2 rounded-lg font-black text-xs transition ${splitMode === 'ITEM' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                🍔 Item-by-Item Split
              </button>
            </div>

            {/* PRE-BILLED SPLITS READY FOR SETTLEMENT */}
            {(() => {
              const activeSplitOrders = activeOrders.filter(o =>
                o.status === 'PENDING' &&
                o.parentTableNumber === entityName &&
                (existingOrder ? o.parentOrderId === existingOrder.id : true)
              );
              if (activeSplitOrders.length === 0) return null;

              return (
                <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center font-black text-amber-900 text-xs">
                    <span>📋 Pre-Billed Splits Ready for Settlement ({activeSplitOrders.length})</span>
                    <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                      Rs.{activeSplitOrders.reduce((sum, o) => sum + (o.netTotal || 0), 0).toFixed(2)} Total
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {activeSplitOrders.map(splitOrd => (
                      <div key={splitOrd.id} className="bg-white p-2.5 rounded-xl border border-amber-200 flex justify-between items-center text-xs shadow-sm">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-black text-gray-800 truncate">{splitOrd.tableNumber} (Order #{splitOrd.dailyOrderNumber})</div>
                          <div className="text-[10px] text-gray-500 font-bold truncate">
                            {(splitOrd.items || []).map(i => `${i.name} x${i.quantity}`).join(', ')}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-black text-emerald-600 text-xs mb-1">Rs.{(splitOrd.netTotal || 0).toFixed(2)}</div>
                          <button
                            onClick={() => handleSettleExistingSplitOrder(splitOrd)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-xl font-black text-[11px] transition shadow-sm"
                          >
                            💳 Settle Bill
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* EQUAL SHARE SPLIT */}
            {splitMode === 'EQUAL' && (
              <div className="space-y-3">
                <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-2xl flex justify-between items-center">
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">Total Net Bill</span>
                    <span className="text-lg font-black text-indigo-700">Rs.{finalTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="font-bold text-gray-600 text-xs">Guests / Shares:</label>
                    <select
                      value={equalSplitCount}
                      onChange={(e) => {
                        setEqualSplitCount(parseInt(e.target.value, 10));
                        setSettledShares([]);
                      }}
                      className="p-1.5 border rounded-xl font-black text-xs bg-white"
                    >
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                        <option key={num} value={num}>{num} Shares</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-bold text-gray-500 uppercase text-[10px]">
                    Share Breakdown (Rs.{(finalTotal / equalSplitCount).toFixed(2)} per person):
                  </div>
                  {Array.from({ length: equalSplitCount }).map((_, idx) => {
                    const isPaid = settledShares.includes(idx);
                    const shareAmount = finalTotal / equalSplitCount;
                    return (
                      <div key={idx} className={`flex justify-between items-center p-3 rounded-2xl border text-xs ${isPaid ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                        <div>
                          <div className="font-black">Share {idx + 1} of {equalSplitCount}</div>
                          <div className="text-[11px] font-bold text-indigo-600">Rs.{shareAmount.toFixed(2)}</div>
                        </div>
                        {isPaid ? (
                          <span className="bg-emerald-600 text-white px-3 py-1 rounded-xl font-black text-[11px]">✅ Settled</span>
                        ) : (
                          <div className="flex items-center space-x-1.5">
                            <button
                              onClick={() => handlePrintEqualSharePreBill(idx)}
                              className="bg-orange-500 hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-xl font-black text-[11px] transition shadow-sm"
                            >
                              🖨️ Pre-Bill
                            </button>
                            <button
                              onClick={() => handleSettleEqualShare(idx)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-xl font-black text-[11px] transition shadow-sm"
                            >
                              💳 Settle
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ITEM-BY-ITEM SPLIT */}
            {splitMode === 'ITEM' && (() => {
              const activeSplitOrders = activeOrders.filter(o =>
                o.status === 'PENDING' &&
                o.parentTableNumber === entityName &&
                (existingOrder ? o.parentOrderId === existingOrder.id : true)
              );

              const preBilledQtyMap = {};
              activeSplitOrders.forEach(ord => {
                (ord.items || []).forEach(it => {
                  preBilledQtyMap[it.name] = (preBilledQtyMap[it.name] || 0) + it.quantity;
                });
              });

              return (
                <div className="space-y-3">
                  <p className="text-[11px] text-gray-500">Select items to split off into a separate bill for payment:</p>

                  <div className="border rounded-2xl overflow-hidden divide-y max-h-48 overflow-y-auto">
                    {cart.map((item, idx) => {
                      const preBilledQty = preBilledQtyMap[item.name] || 0;
                      const availableToSplit = Math.max(0, item.quantity - preBilledQty);
                      const selectedQty = selectedSplitItems[idx] || 0;
                      return (
                        <div key={idx} className="p-2.5 flex justify-between items-center bg-white text-xs">
                          <div className="flex-1 pr-2">
                            <div className="font-black text-gray-800">{item.name}</div>
                            <div className="text-[10px] text-gray-400">
                              Rs.{item.sellingPrice} x {item.quantity} (Available to split: <b className="text-indigo-600">{availableToSplit}</b>)
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <button
                              onClick={() => {
                                if (selectedQty > 0) {
                                  setSelectedSplitItems({ ...selectedSplitItems, [idx]: selectedQty - 1 });
                                }
                              }}
                              className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 font-black text-gray-700 flex items-center justify-center"
                            >
                              -
                            </button>
                            <span className="font-black w-5 text-center">{selectedQty}</span>
                            <button
                              onClick={() => {
                                if (selectedQty < availableToSplit) {
                                  setSelectedSplitItems({ ...selectedSplitItems, [idx]: selectedQty + 1 });
                                }
                              }}
                              disabled={selectedQty >= availableToSplit}
                              className="w-6 h-6 rounded-lg bg-indigo-100 hover:bg-indigo-200 disabled:bg-gray-100 disabled:text-gray-300 text-indigo-700 font-black flex items-center justify-center"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                {/* Selected Split Calculation Summary */}
                {(() => {
                  const selectedIndices = Object.keys(selectedSplitItems).filter(idx => {
                    const item = cart[parseInt(idx, 10)];
                    return item && selectedSplitItems[idx] > 0;
                  });
                  const splitSub = selectedIndices.reduce((sum, idx) => {
                    const item = cart[parseInt(idx, 10)];
                    return sum + (item ? (item.sellingPrice * (selectedSplitItems[idx] || 0)) : 0);
                  }, 0);
                  const splitSc = serviceChargeApplies ? splitSub * 0.10 : 0;
                  const splitNet = splitSub + splitSc;

                  return (
                    <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl space-y-2">
                      <div className="flex justify-between font-bold text-emerald-900"><span>Selected Items Total:</span><span>Rs.{splitSub.toFixed(2)}</span></div>
                      {serviceChargeApplies && (
                        <div className="flex justify-between text-[11px] text-emerald-700"><span>Service Charge (10%):</span><span>+Rs.{splitSc.toFixed(2)}</span></div>
                      )}
                      <div className="flex justify-between font-black text-sm text-emerald-900 border-t border-emerald-200 pt-1"><span>Net Split Payable:</span><span>Rs.{splitNet.toFixed(2)}</span></div>

                      <div className="pt-2">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Select Payment Method</label>
                        <div className="grid grid-cols-3 gap-1.5 mb-2">
                          {[
                            { key: 'CASH', label: '💵 Cash' },
                            { key: 'CARD', label: '💳 Card' },
                            { key: 'TRANSFER', label: '🏦 Transfer' }
                          ].map(m => (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => setSplitPaymentMethod(m.key)}
                              className={`py-2 px-1 rounded-xl font-black text-xs border transition flex items-center justify-center gap-1 ${
                                splitPaymentMethod === m.key
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-300 scale-[1.02]'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={handlePrintSelectedItemSplitPreBill}
                            disabled={selectedIndices.length === 0}
                            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white p-2.5 rounded-xl font-black text-xs shadow-md transition"
                          >
                            🖨️ Print Split Pre-Bill
                          </button>
                          <button
                            onClick={handleSettleSelectedItemSplit}
                            disabled={selectedIndices.length === 0}
                            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white p-2.5 rounded-xl font-black text-xs shadow-md transition"
                          >
                            💳 Pay &amp; Settle
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* SETTLEMENT MODAL */}
      {isSettleModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-3 z-50">
          <div className="bg-white p-4 sm:p-5 rounded-3xl max-w-sm w-full max-h-[92vh] flex flex-col shadow-2xl text-xs overflow-hidden">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b pb-2 shrink-0">
              <h3 className="text-base font-black text-gray-800">Settle &amp; Close: {entityName}</h3>
              <button onClick={() => setIsSettleModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-sm px-1.5 py-0.5">✕</button>
            </div>

            {/* Scrollable Body Content */}
            <div className="overflow-y-auto flex-1 space-y-3.5 pr-1 py-3 scrollbar-thin">

            {/* APPLY ADVANCE BOOKING DEPOSIT */}
            <div>
              <label className="block font-bold text-gray-500 mb-1">💳 Apply Booking Advance Deposit</label>
              <select
                value={selectedAdvanceBookingId}
                onChange={(e) => setSelectedAdvanceBookingId(e.target.value)}
                className="w-full p-2.5 border rounded-xl font-bold text-xs bg-emerald-50 border-emerald-300 text-emerald-900"
              >
                <option value="">-- No Advance Deposit Selected --</option>
                {activeAdvanceBookings.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.customerName} (Rs.{b.amount.toFixed(2)} - {b.paymentMethod} - {b.bookingDate})
                  </option>
                ))}
              </select>
              {selectedAdvanceBooking && (
                <div className="text-[10px] text-emerald-700 font-black mt-1">
                  ✅ Deducting Rs.{selectedAdvanceBooking.amount.toFixed(2)} ({selectedAdvanceBooking.customerName}'s Deposit)
                </div>
              )}
            </div>

            <div>
              <label className="block font-bold text-gray-500 mb-1">Apply Discount / Complementary</label>
              <div className="grid grid-cols-3 gap-1 mb-1.5">
                <button
                  type="button"
                  onClick={() => setDiscountType('PERCENT')}
                  className={`py-1.5 px-2 rounded-lg font-bold text-xs ${discountType === 'PERCENT' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  % Percent
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('FIXED')}
                  className={`py-1.5 px-2 rounded-lg font-bold text-xs ${discountType === 'FIXED' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  Rs. Fixed
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('COMPLEMENTARY')}
                  className={`py-1.5 px-2 rounded-lg font-black text-xs transition ${discountType === 'COMPLEMENTARY' ? 'bg-purple-600 text-white shadow-xs' : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'}`}
                >
                  🎁 Complementary
                </button>
              </div>

              {discountType === 'COMPLEMENTARY' ? (
                <div className="bg-purple-50/90 border border-purple-200 p-2.5 rounded-xl space-y-2">
                  <div className="font-black text-purple-900 text-xs flex justify-between">
                    <span>🎁 100% Complementary Waiver</span>
                    <span>Rs.{grossTotal.toFixed(2)} Off</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-purple-800 mb-0.5">Reason for Complementary (Required) *</label>
                    <input
                      type="text"
                      value={complementaryReason}
                      onChange={(e) => setComplementaryReason(e.target.value)}
                      className="w-full p-2 border rounded-xl font-bold text-xs bg-white border-purple-300 text-purple-900 focus:outline-none"
                      placeholder="e.g. VIP Guest / Courtesy / Complaint"
                      required
                    />
                  </div>
                  <div className="text-[10px] font-bold text-purple-700 bg-purple-100/80 p-1.5 rounded-lg flex items-center space-x-1">
                    <span>🛡️ Requires Admin Permission Authorization</span>
                  </div>
                </div>
              ) : (
                <input
                  type="number"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-full p-2 border rounded-xl font-black text-sm"
                  placeholder="0"
                />
              )}
            </div>

            <div>
              <label className="block font-bold text-gray-500 mb-1">Payment Method</label>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {['CASH', 'CARD', 'TRANSFER', 'MULTI'].map(m => (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`py-2 rounded-xl font-black border text-[11px] transition ${paymentMethod === m ? 'bg-gray-800 border-gray-800 text-white shadow-sm' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    {m === 'MULTI' ? '🔀 MULTI' : m}
                  </button>
                ))}
              </div>

              {/* CASH PAYMENT CHANGE CALCULATOR */}
              {paymentMethod === 'CASH' && (
                <div className="bg-emerald-50/80 border border-emerald-200 p-3 rounded-2xl space-y-2 mt-2">
                  <div className="flex justify-between items-center font-black text-emerald-900 text-xs">
                    <span>💵 Cash Received from Customer:</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    className="w-full p-2.5 border rounded-xl font-black text-sm bg-white text-emerald-900 border-emerald-300 focus:outline-none"
                    placeholder={`e.g. 5000`}
                  />
                  {/* Quick Cumulative Cash Preset Buttons */}
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setCashReceived(finalTotal.toString())}
                      className="px-2 py-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-black text-emerald-800 hover:bg-emerald-100 transition"
                    >
                      Exact (Rs.{finalTotal.toFixed(0)})
                    </button>
                    {[500, 1000, 2000, 5000].map(amt => (
                      <button
                        key={amt}
                        onClick={() => {
                          const current = parseFloat(cashReceived) || 0;
                          setCashReceived((current + amt).toString());
                        }}
                        className="px-2 py-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-black text-emerald-800 hover:bg-emerald-100 transition active:scale-95"
                      >
                        +Rs.{amt}
                      </button>
                    ))}
                    {cashReceived !== '' && (
                      <button
                        onClick={() => setCashReceived('')}
                        className="px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg text-[10px] font-black text-red-600 hover:bg-red-100 transition"
                      >
                        Clear (C)
                      </button>
                    )}
                  </div>

                  {(() => {
                    const given = parseFloat(cashReceived) || 0;
                    const change = given - finalTotal;
                    if (given <= 0) return null;
                    if (change >= 0) {
                      return (
                        <div className="bg-emerald-100 border border-emerald-300 p-2.5 rounded-xl text-center font-black text-emerald-900 space-y-0.5 shadow-xs">
                          <span className="text-[10px] uppercase block tracking-wider text-emerald-700 font-bold">🟢 Change / Balance to Return</span>
                          <span className="text-xl text-emerald-700 font-black">Rs.{change.toFixed(2)}</span>
                        </div>
                      );
                    } else {
                      return (
                        <div className="bg-red-50 border border-red-200 p-2 rounded-xl text-center font-bold text-red-600 text-xs">
                          🔴 Cash Short by Rs.{Math.abs(change).toFixed(2)}
                        </div>
                      );
                    }
                  })()}
                </div>
              )}

              {/* MULTI PAYMENT METHOD BREAKDOWN INPUTS */}
              {paymentMethod === 'MULTI' && (
                <div className="bg-indigo-50/70 border border-indigo-200 p-3 rounded-2xl space-y-2 mt-2">
                  <div className="font-black text-indigo-900 text-xs flex justify-between">
                    <span>🔀 Enter Split Payments:</span>
                    <span>Net: Rs.{finalTotal.toFixed(2)}</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500">💵 Cash Paid (Rs.)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      className="w-full p-2 border rounded-xl font-bold text-xs bg-white"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500">💳 Card Amount (Rs.)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cardAmount}
                      onChange={(e) => setCardAmount(e.target.value)}
                      className="w-full p-2 border rounded-xl font-bold text-xs bg-white"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500">🏦 Bank Transfer (Rs.)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      className="w-full p-2 border rounded-xl font-bold text-xs bg-white"
                      placeholder="0.00"
                    />
                  </div>

                  {(() => {
                    const cNum = parseFloat(cashAmount) || 0;
                    const kNum = parseFloat(cardAmount) || 0;
                    const tNum = parseFloat(transferAmount) || 0;
                    const collected = cNum + kNum + tNum;
                    const remaining = finalTotal - collected;

                    return (
                      <div className="border-t border-indigo-200 pt-2 text-[11px] font-bold flex justify-between items-center">
                        <span>Total Collected:</span>
                        <span className={remaining > 0.01 ? 'text-red-600 font-black' : 'text-emerald-700 font-black'}>
                          Rs.{collected.toFixed(2)} {remaining > 0.01 ? `(Left: Rs.${remaining.toFixed(2)})` : '✅ Ready'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Fixed Footer Summary & Action */}
            <div className="shrink-0 pt-2 border-t space-y-2.5">
              <div className="bg-gray-50 p-2.5 rounded-xl space-y-1 border font-medium">
                <div className="flex justify-between text-[11px]"><span>Gross Amount:</span><span>Rs.{grossTotal.toFixed(2)}</span></div>
                {advanceDeduction > 0 && (
                  <div className="flex justify-between text-[11px] text-emerald-600 font-bold"><span>Advance Deposit Deducted:</span><span>-Rs.{advanceDeduction.toFixed(2)}</span></div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-red-500"><span>Discount:</span><span>-Rs.{discountAmount.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between text-sm font-black text-gray-900 border-t pt-1 mt-1"><span>Net Payable:</span><span className="text-emerald-600">Rs.{finalTotal.toFixed(2)}</span></div>
              </div>

              <button onClick={handleFinalSettle} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl font-black text-xs sm:text-sm shadow-md transition active:scale-98">🤝 Complete Settlement &amp; Print Receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}