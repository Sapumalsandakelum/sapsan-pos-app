// src/BillingScreen.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';

export default function BillingScreen({ isTakeaway = false }) {
  // DB Live Queries
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const items = useLiveQuery(() => db.items.toArray()) || [];
  const activeOrders = useLiveQuery(() => db.orders.where('status').equals('PENDING').toArray()) || [];

  // UI States
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedTable, setSelectedTable] = useState(null); 
  const [cart, setCart] = useState([]); 
  
  // Dynamic Tables State
  const [tables, setTables] = useState(() => {
    const savedTables = localStorage.getItem('restaurant_tables');
    return savedTables ? JSON.parse(savedTables) : ['Table 1', 'Table 2', 'Table 3', 'Table 4'];
  });

  useEffect(() => {
    localStorage.setItem('restaurant_tables', JSON.stringify(tables));
  }, [tables]);

  // Workflow Trackers
  const [isSavedForTable, setIsSavedForTable] = useState(false);
  const [isPreBillPrinted, setIsPreBillPrinted] = useState(false);

  // Admin Password Security States
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState(''); // 👈 Admin Username field අලුතින් එකතු කළා
  const [adminPassword, setAdminPassword] = useState('');
  const [adminCheckLoading, setAdminCheckLoading] = useState(false); // 👈 db query වෙද්දී button එක disable කරන්න
  const [pendingAction, setPendingAction] = useState(null); 

  // Settlement Modals
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  const currentDisplayName = isTakeaway ? 'Takeaway Order' : (selectedTable || 'No Table Selected');

  // ==========================================
  // ⚡ BLUETOOTH PRINTING CORE LOGIC
  // ==========================================
  const textToBytes = (text) => {
    const encoder = new TextEncoder();
    return encoder.encode(text + '\n');
  };

  const ESC_ALIGN_CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
  const ESC_ALIGN_LEFT = new Uint8Array([0x1B, 0x61, 0x00]);
  const ESC_ALIGN_RIGHT = new Uint8Array([0x1B, 0x61, 0x02]);
  const ESC_FONT_BOLD = new Uint8Array([0x1B, 0x45, 0x01]);
  const ESC_FONT_NORMAL = new Uint8Array([0x1B, 0x45, 0x00]);
  const ESC_FEED_PAPER = new Uint8Array([0x1D, 0x56, 0x42, 0x03]);

  // 🔵 Bluetooth (Wireless) Printer වෙත print කිරීම
  const printViaBluetoothDevice = async (targetPrinterName, targetRole, receiptDataArray) => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: targetPrinterName }],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb']
      });

      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();
      if (services.length === 0) throw new Error("No Bluetooth Services found");
      
      const characteristics = await services[0].getCharacteristics();
      const writeCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

      if (!writeCharacteristic) throw new Error("No Write Characteristic found");

      for (const data of receiptDataArray) {
        await writeCharacteristic.writeValue(data);
      }
      
      await writeCharacteristic.writeValue(ESC_FEED_PAPER);
      await server.disconnect();
      return true;
    } catch (err) {
      console.error(`Bluetooth Printing Error on ${targetRole}: `, err);
      Swal.fire({
        icon: 'error',
        title: `${targetRole.toUpperCase()} Print Failed!`,
        text: 'Check the Bluetooth printer connection and ensure it is powered on.',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000
      });
      return false;
    }
  };

  // 🔌 Cable (USB) Printer වෙත print කිරීම - PC/Laptop එකක Web Serial API එක හරහා
  const printViaUsbCableDevice = async (vendorId, productId, targetRole, receiptDataArray) => {
    if (!navigator.serial) {
      Swal.fire({
        icon: 'error',
        title: `${targetRole.toUpperCase()} Cable Print Failed!`,
        text: 'This Browser does not support USB/Cable Printing. Use Chrome or Edge (Desktop).',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3500
      });
      return false;
    }

    let matchedPort = null;
    try {
      const ports = await navigator.serial.getPorts();
      matchedPort = ports.find(p => {
        const info = p.getInfo ? p.getInfo() : {};
        return String(info.usbVendorId) === String(vendorId) && String(info.usbProductId) === String(productId);
      });

      if (!matchedPort) {
        Swal.fire({
          icon: 'error',
          title: `${targetRole.toUpperCase()} Cable Printer Not Found!`,
          text: 'Admin Panel → Printer Settings go and reconnect the USB printer.',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3500
        });
        return false;
      }

      await matchedPort.open({ baudRate: 9600 });
      const writer = matchedPort.writable.getWriter();

      for (const data of receiptDataArray) {
        await writer.write(data);
      }
      await writer.write(ESC_FEED_PAPER);

      writer.releaseLock();
      await matchedPort.close();
      return true;
    } catch (err) {
      console.error(`USB Cable Printing Error on ${targetRole}: `, err);
      try { if (matchedPort && matchedPort.readable) await matchedPort.close(); } catch (closeErr) { /* ignore */ }
      Swal.fire({
        icon: 'error',
        title: `${targetRole.toUpperCase()} Cable Print Failed!`,
        text: 'Check the USB printer connection and ensure it is powered on.',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3500
      });
      return false;
    }
  };

  // 🟡 WebUSB Printer (cable, USB port) — navigator.usb API
  const printViaWebUSB = async (deviceInfo, targetRole, receiptDataArray) => {
    if (!navigator.usb) {
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Print Failed!`, text: 'WebUSB Supported නැත. Chrome / Edge (Desktop) use කරන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
      return false;
    }
    let usbDevice = null;
    try {
      const granted = await navigator.usb.getDevices();
      usbDevice = granted.find(d => d.vendorId === deviceInfo.vendorId && d.productId === deviceInfo.productId);
      if (!usbDevice) {
        Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Printer Not Found!`, text: 'Admin Panel → Printer Settings වෙත ගොස් USB printer නැවත Connect කරන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
        return false;
      }
      await usbDevice.open();
      if (usbDevice.configuration === null) await usbDevice.selectConfiguration(1);
      await usbDevice.claimInterface(0);

      for (const data of receiptDataArray) await usbDevice.transferOut(1, data);
      await usbDevice.transferOut(1, ESC_FEED_PAPER);
      await usbDevice.close();
      return true;
    } catch (err) {
      console.error(`WebUSB Print Error on ${targetRole}:`, err);
      try { if (usbDevice) await usbDevice.close(); } catch (_) { /* ignore */ }
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Print Failed!`, text: 'Printer cable connect කර on කර ඇතිදැයි බලන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
      return false;
    }
  };

  // 🟢 Serial/COM Port Printer — navigator.serial API
  const printViaSerialPort = async (deviceInfo, targetRole, receiptDataArray) => {
    if (!navigator.serial) {
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} Serial Print Failed!`, text: 'Web Serial Supported නැත. Chrome / Edge v89+ use කරන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
      return false;
    }
    let port = null;
    try {
      const ports = await navigator.serial.getPorts();
      port = ports[0]; // Admin panel ekenma authorize karapu port eka
      if (!port) {
        Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} COM Printer Not Found!`, text: 'Admin Panel → Printer Settings වෙත ගොස් Serial printer නැවත Connect කරන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
        return false;
      }
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      for (const data of receiptDataArray) await writer.write(data);
      await writer.write(ESC_FEED_PAPER);
      writer.releaseLock();
      await port.close();
      return true;
    } catch (err) {
      console.error(`Serial Print Error on ${targetRole}:`, err);
      try { if (port) await port.close(); } catch (_) { /* ignore */ }
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} Serial Print Failed!`, text: 'COM port printer cable connect කර on කර ඇතිදැයි බලන්න.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
      return false;
    }
  };

  // 🎯 ROUTER: mapping[role] = deviceId → pairedDevices list ෙකන් type find කරලා නිවැරදි function ෙ යවනවා
  const printViaBluetooth = async (targetRole, receiptDataArray) => {
    const mappingSaved = localStorage.getItem('pos_printer_mapping');
    const devicesSaved = localStorage.getItem('pos_paired_bluetooth_devices');
    if (!mappingSaved) return false;

    const mapping = JSON.parse(mappingSaved);
    const deviceId = mapping[targetRole];

    if (!deviceId) {
      console.log(`⚠️ Printer not assigned for: ${targetRole.toUpperCase()}`);
      return false;
    }

    const allDevices = devicesSaved ? JSON.parse(devicesSaved) : [];
    const device = allDevices.find(d => d.id === deviceId);

    if (!device) {
      console.log(`⚠️ Device not found in paired list: ${deviceId}`);
      return false;
    }

    if (device.type === 'USB') return await printViaWebUSB(device, targetRole, receiptDataArray);
    if (device.type === 'SERIAL') return await printViaSerialPort(device, targetRole, receiptDataArray);
    return await printViaBluetoothDevice(device.name, targetRole, receiptDataArray); // BLUETOOTH
  };

  // ==========================================
  // 🔥 RECEIPT FORMAT GENERATORS
  // ==========================================
  const generateKitchenReceipt = (tableName, typeLabel, itemsList) => {
    const data = [];
    data.push(ESC_ALIGN_CENTER);
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes(`*** ${typeLabel} ***`));
    data.push(ESC_FONT_NORMAL);
    data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName}`));
    data.push(textToBytes(`Date: ${new Date().toLocaleTimeString()}`));
    data.push(textToBytes('--------------------------------'));
    data.push(ESC_ALIGN_LEFT);
    
    itemsList.forEach(item => {
      data.push(textToBytes(`${item.quantity} x ${item.name}`));
    });
    
    data.push(textToBytes('--------------------------------'));
    return data;
  };

  const generateBillReceipt = (tableName, billTitle, sub, sc, disc, net, itemsList) => {
    const data = [];
    data.push(ESC_ALIGN_CENTER);
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes('SAPSAN RESTAURANT'));
    data.push(ESC_FONT_NORMAL);
    data.push(textToBytes('Matara, Sri Lanka'));
    data.push(textToBytes(`--- ${billTitle} ---`));
    data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName} | Date: ${new Date().toLocaleDateString()}`));
    data.push(textToBytes('--------------------------------'));
    data.push(ESC_ALIGN_LEFT);

    itemsList.forEach(item => {
      const lineTotal = (item.sellingPrice * item.quantity).toFixed(0);
      data.push(textToBytes(`${item.name}`));
      data.push(ESC_ALIGN_RIGHT);
      data.push(textToBytes(`${item.quantity} x ${item.sellingPrice} = Rs.${lineTotal}`));
      data.push(ESC_ALIGN_LEFT);
    });

    data.push(textToBytes('--------------------------------'));
    data.push(ESC_ALIGN_RIGHT);
    data.push(textToBytes(`Sub Total: Rs.${sub.toFixed(2)}`));
    data.push(textToBytes(`Service Charge: Rs.${sc.toFixed(2)}`));
    if (disc > 0) data.push(textToBytes(`Discount: -Rs.${disc.toFixed(2)}`));
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes(`NET TOTAL: Rs.${net.toFixed(2)}`));
    data.push(ESC_FONT_NORMAL);
    data.push(ESC_ALIGN_CENTER);
    data.push(textToBytes('Thank You! Come Again.'));
    return data;
  };

  // ==========================================
  // HANDLERS & OPERATIONS
  // ==========================================
  
  // ✅ FIX/UPDATE: Table 1 ඉඳන් පිළිවෙළට අඩුවෙන් තියෙන අංකය හොයලා Add කරන ක්‍රමය
  const addNewTable = () => {
    const currentNumbers = tables
      .map(t => parseInt(t.replace('Table ', '')))
      .filter(num => !isNaN(num));

    // 1 සිට ඉහළට පරීක්ෂා කර පද්ධතියේ දැනට නැති අඩුම අංකය සොයා ගැනීම
    let nextNumber = 1;
    while (currentNumbers.includes(nextNumber)) {
      nextNumber++;
    }

    const newTableName = `Table ${nextNumber}`;
    
    // මේස අංක පිළිවෙළට සකස් කර ලිස්ට් එකට එකතු කිරීම
    const updatedTables = [...tables, newTableName].sort((a, b) => {
      const numA = parseInt(a.replace('Table ', '')) || 0;
      const numB = parseInt(b.replace('Table ', '')) || 0;
      return numA - numB;
    });

    setTables(updatedTables);
    Swal.fire({ icon: 'success', title: `${newTableName} Created!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000, timerProgressBar: true });
  };

  // ✅ NEW METHOD: අවුල් වුණු මේස ආයෙත් 1 සිට 4 වෙනකන් Default Reset කරගැනීමට
  const handleResetTables = () => {
    Swal.fire({
      title: 'Reset Tables?',
      text: "deleted tables will be lost and cart will be cleared.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#4f46e5',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, Reset',
      cancelButtonText: 'No, Cancel'
    }).then((result) => {
      if (result.isConfirmed) {
        setTables(['Table 1', 'Table 2', 'Table 3', 'Table 4']);
        setSelectedTable(null);
        setCart([]);
        setIsSavedForTable(false);
        setIsPreBillPrinted(false);
        Swal.fire({ icon: 'success', title: 'Tables Reset Successfully!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
      }
    });
  };

  const handleTableSelect = (tableName) => {
    if (isTakeaway) return;
    setSelectedTable(tableName);
    const existingOrder = activeOrders.find(o => o.tableNumber === tableName);
    if (existingOrder) {
      setCart(existingOrder.items.map(i => ({ ...i, isSaved: true })));
      setIsSavedForTable(true);
      setIsPreBillPrinted(existingOrder.isPreBillPrinted || false);
    } else {
      setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
    }
  };

  useEffect(() => {
    setSelectedTable(null);
    setCart([]);
    setIsSavedForTable(false);
    setIsPreBillPrinted(false);
  }, [isTakeaway]);

  const addToCart = (item) => {
    if (!isTakeaway && !selectedTable) {
      Swal.fire({ icon: 'warning', title: 'Select a Table!', text: 'Please select a table first, then add items to the cart.', confirmButtonColor: '#4f46e5' });
      return;
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
    let newCart = [...cart];
    const newQty = targetItem.quantity + amount;
    if (newQty > 0) newCart[cartIndex].quantity = newQty;
    else newCart = newCart.filter((_, idx) => idx !== cartIndex);
    setCart(newCart); setIsSavedForTable(false); setIsPreBillPrinted(false); 
  };

  const triggerAdminCheck = (actionType) => {
    setPendingAction(actionType); setIsAdminModalOpen(true);
  };

  // ✅ FIXED: දැන් db.admins table එක against username + password දෙකම check කරනවා (hardcoded '1234' ඉවත් කළා)
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
        else if (pendingAction === 'CLEAR_BILL') executeClearTableBill();
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
    const orderIdentifier = isTakeaway ? 'Takeaway' : selectedTable;

    try {
      const existingOrder = activeOrders.find(o => o.tableNumber === orderIdentifier);
      let currentPreBillState = isPreBillPrinted;

      if (existingOrder) {
        currentPreBillState = false;
        await db.orders.update(existingOrder.id, { subTotal, totalServiceCharge, netTotal, isPreBillPrinted: false, items: finalItemsForDb });
      } else {
        await db.orders.add({ orderDate: new Date(), tableNumber: orderIdentifier, subTotal, totalServiceCharge, discountAmount: 0, netTotal, paymentMethod: 'PENDING', status: 'PENDING', isPreBillPrinted: false, items: finalItemsForDb });
        currentPreBillState = false;
      }

      setCart(finalItemsForDb.map(i => ({ ...i, isSaved: true })));
      setIsSavedForTable(true); 
      setIsPreBillPrinted(currentPreBillState);

      if (kotItems.length > 0) {
        const kotReceipt = generateKitchenReceipt(orderIdentifier, 'KOT (KITCHEN)', kotItems);
        await printViaBluetooth('kot', kotReceipt);
      }
      if (botItems.length > 0) {
        const botReceipt = generateKitchenReceipt(orderIdentifier, 'BOT (BAR)', botItems);
        await printViaBluetooth('bot', botReceipt);
      }

      let printerReceipts = '';
      if (kotItems.length > 0) printerReceipts += `<li>🔥 <b>KOT Sent to Printer</b> (${kotItems.length} items)</li>`;
      if (botItems.length > 0) printerReceipts += `<li>🍹 <b>BOT Sent to Printer</b> (${botItems.length} items)</li>`;

      Swal.fire({
        icon: 'success',
        title: `${orderIdentifier} Data Saved!`,
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
    
    const orderIdentifier = isTakeaway ? 'Takeaway' : selectedTable;
    const existingOrder = activeOrders.find(o => o.tableNumber === orderIdentifier);
    if (existingOrder) {
      await db.orders.update(existingOrder.id, { isPreBillPrinted: true });
    }

    const preBillReceipt = generateBillReceipt(orderIdentifier, 'PRE-BILL RECEIPT', subTotal, totalServiceCharge, 0, netTotal, cart);
    await printViaBluetooth('bill', preBillReceipt);

    Swal.fire({ icon: 'info', title: '📄 Pre-Bill Printing...', html: `<b>${orderIdentifier}</b> Gross Total: <span class="text-indigo-600 font-bold">Rs.${netTotal.toFixed(2)}</span>`, showConfirmButton: false, timer: 2500, timerProgressBar: true });
    setIsPreBillPrinted(true); 
  };

  const handleFinalSettle = async () => {
    const orderIdentifier = isTakeaway ? 'Takeaway' : selectedTable;
    const existingOrder = activeOrders.find(o => o.tableNumber === orderIdentifier);
    if (!existingOrder) return;

    try {
      await db.orders.update(existingOrder.id, { discountAmount, netTotal: finalTotal, paymentMethod, status: 'SETTLED', settledDate: new Date() });
      const finalReceipt = generateBillReceipt(orderIdentifier, 'FINAL INVOICE', subTotal, totalServiceCharge, discountAmount, finalTotal, cart);
      await printViaBluetooth('bill', finalReceipt);

      Swal.fire({ icon: 'success', title: 'Settlement Successful! ✅', text: `🧾 Final Invoice Printed (${paymentMethod} Mode)`, confirmButtonColor: '#111827' });
      setIsSettleModalOpen(false); setSelectedTable(null); setCart([]); setIsSavedForTable(false); setIsPreBillPrinted(false);
    } catch (err) {
      console.error(err);
    }
  };

  const executeClearTableBill = async () => {
    if (!selectedTable) return;
    try {
      const existingOrder = activeOrders.find(o => o.tableNumber === selectedTable);
      if (existingOrder) {
        await db.orders.delete(existingOrder.id);
      }
      setCart([]);
      setIsSavedForTable(false);
      setIsPreBillPrinted(false);
      Swal.fire({ icon: 'success', title: 'Bill Cleared Successfully! 🗑️', text: 'The table is now empty.', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
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
      if (!isTakeaway) {
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
    <div className="grid grid-cols-1 lg:grid-cols-12 h-[calc(100vh-64px)] w-full bg-gray-100 overflow-hidden p-2 gap-2 text-gray-800 box-border">
      
      {/* LEFT PANEL */}
      <div className="lg:col-span-5 bg-white rounded-2xl p-3 flex flex-col h-full overflow-hidden border">
        <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none shrink-0">
          <button onClick={() => setSelectedCategory('ALL')} className={`px-4 py-2.5 rounded-xl font-bold text-xs ${selectedCategory === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>All Items</button>
          {categories.map(cat => (
            <button key={cat.id} onClick={() => setSelectedCategory(cat.id.toString())} className={`px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap ${selectedCategory === cat.id.toString() ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>{cat.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto flex-1 content-start pt-1">
          {filteredItems.map(item => (
            <div key={item.id} onClick={() => addToCart(item)} className="bg-gray-50 hover:bg-indigo-50 p-3 rounded-xl border active:scale-95 transition cursor-pointer flex flex-col justify-between h-24">
              <div className="font-bold text-xs text-gray-700 line-clamp-2">{item.name}</div>
              <div className="text-indigo-600 font-black text-sm">Rs.{item.sellingPrice.toFixed(0)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MIDDLE PANEL */}
      <div className={`lg:col-span-3 bg-white rounded-2xl p-3 flex flex-col h-full overflow-hidden border transition-all ${isTakeaway ? 'opacity-40 pointer-events-none select-none bg-gray-50' : ''}`}>
        
        {/* ✅ UPDATED HEADER AREA WITH RESET BUTTON */}
        <div className="flex justify-between items-center mb-2 shrink-0">
          <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider">📋 Restaurant Tables</h2>
       
        </div>

        <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 content-start pr-1">
          {tables.map(tName => {
            const hasOrder = activeOrders.some(o => o.tableNumber === tName);
            const isCurrent = selectedTable === tName;
            return (
              <div key={tName} onClick={() => handleTableSelect(tName)} className={`p-3 rounded-xl border flex flex-col items-center justify-center cursor-pointer transition active:scale-95 h-24 relative overflow-hidden ${isCurrent ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : hasOrder ? 'bg-amber-500 border-amber-500 text-white animate-pulse' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}`}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/20 mb-1 border border-white/10 text-xl shadow-inner">🪑</div>
                <span className="font-black text-xs tracking-wide">{tName}</span>
                {hasOrder && <span className="absolute top-1 right-2 text-[8px] font-black bg-white text-amber-600 px-1 rounded">OCCUPIED</span>}
              </div>
            );
          })}
          <div onClick={addNewTable} className="p-3 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-500 flex flex-col items-center justify-center cursor-pointer transition active:scale-95 h-24">
            <span className="text-2xl font-light mb-1">➕</span><span className="font-bold text-[11px] uppercase tracking-wider">Add Table</span>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="lg:col-span-4 bg-white rounded-2xl p-3 flex flex-col h-full overflow-hidden border shadow-sm">
        <div className="flex justify-between items-center border-b pb-2 shrink-0">
          <h2 className="text-base font-black text-gray-800">🛒 {currentDisplayName}</h2>
        </div>
        <div className="flex-1 overflow-y-auto my-2 space-y-2 pr-1">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-300">
              <span className="text-4xl">{isTakeaway ? '🛍️' : '🧾'}</span>
              <p className="text-xs font-bold mt-1">{isTakeaway ? 'Takeaway Order එකක් ඇතුළත් කරන්න' : 'Order එකක් ඇතුළත් කරන්න'}</p>
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
              </div>
            ))
          )}
        </div>

        {/* Workflow Bottom Section */}
        <div className="border-t pt-2 space-y-2 shrink-0 bg-white text-xs">
          <div className="flex justify-between text-gray-500"><span>Sub Total</span><span className="font-bold">Rs.{subTotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-amber-600 font-bold">
            <span>Service Charge {isTakeaway && '(0%)'}</span>
            <span>+Rs.{totalServiceCharge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-black text-indigo-700 border-t pt-1"><span>Net Total</span><span>Rs.{netTotal.toFixed(2)}</span></div>
          
          {(isTakeaway ? cart.length > 0 : selectedTable) && (
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

              {selectedTable && cart.length > 0 && (
                <button 
                  onClick={() => triggerAdminCheck('CLEAR_BILL')} 
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl font-black transition text-xs shadow-sm mt-1"
                >
                  🗑️ Clear Table Bill (Admin Required)
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ADMIN SECURITY MODAL */}
      {isAdminModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 rounded-2xl max-w-xs w-full space-y-3 text-center text-xs">
            <span className="text-3xl">🛡️</span><h3 className="text-sm font-black text-gray-800">Admin Authorization Required</h3>

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
              <button onClick={() => { setIsAdminModalOpen(false); setAdminUsername(''); setAdminPassword(''); }} className="bg-gray-100 hover:bg-gray-200 py-2 rounded-xl font-bold">Cancel</button>
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
              <h3 className="text-base font-black text-gray-800">Settle & Close: {isTakeaway ? 'Takeaway' : selectedTable}</h3>
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