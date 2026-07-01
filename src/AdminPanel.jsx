// src/AdminPanel.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';

export default function AdminPanel({ onBackToBilling }) {
  // DB Live Queries
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const items = useLiveQuery(() => db.items.toArray()) || [];
  const settledOrders = useLiveQuery(() => db.orders.where('status').equals('SETTLED').toArray()) || [];
  
  // 👈 db.js එකේ ඇති db.admins ව්‍යුහය සෘජුවම ලබා ගැනීම
  const admins = useLiveQuery(() => db.admins.toArray()) || [];

  // Navigation state inside admin
  const [activeSubTab, setActiveSubTab] = useState('CATEGORIES'); // CATEGORIES, ITEMS, REPORTS, PRINTERS, PROFILE

  // ==========================================
  // 📊 REPORTS STATES
  // ==========================================
  const [reportType, setReportType] = useState('DAILY');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedItemFilter, setSelectedItemFilter] = useState('ALL');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');

  // මධ්‍යගත ෆිල්ටරින් ලොජික් එක
  const getProcessedReports = () => {
    const now = new Date();
    return settledOrders.filter(order => {
      if (!order.settledDate) return false;
      const orderDate = new Date(order.settledDate);

      if (reportType === 'DAILY') {
        if (orderDate.toDateString() !== now.toDateString()) return false;
      } else if (reportType === 'MONTHLY') {
        if (orderDate.getMonth() !== now.getMonth() || orderDate.getFullYear() !== now.getFullYear()) return false;
      } else {
        if (startDate && new Date(startDate + 'T00:00:00') > orderDate) return false;
        if (endDate && new Date(endDate + 'T23:59:59') < orderDate) return false;
      }

      if (selectedItemFilter !== 'ALL') {
        const hasItem = order.items.some(i => i.name === selectedItemFilter);
        if (!hasItem) return false;
      }

      if (selectedCategoryFilter !== 'ALL') {
        const hasCategory = order.items.some(item => {
          const matchedItem = items.find(i => i.name === item.name);
          return matchedItem && matchedItem.categoryId === parseInt(selectedCategoryFilter);
        });
        if (!hasCategory) return false;
      }
      return true;
    });
  };

  const filteredOrders = getProcessedReports();

  // METRICS COUNTERS
  let totalNetSales = 0;
  let totalDiscounts = 0;
  let totalServiceCharges = 0;
  let totalCostOfSales = 0;

  const productSalesMap = {};
  const categorySalesMap = {};
  const customerSalesMap = {};
  const cashierSalesMap = {};
  const paymentMethodMap = { CASH: 0, CARD: 0, TRANSFER: 0 };

  filteredOrders.forEach(order => {
    totalNetSales += order.netTotal || 0;
    totalDiscounts += order.discountAmount || 0;
    totalServiceCharges += order.totalServiceCharge || 0;
    
    if (paymentMethodMap[order.paymentMethod] !== undefined) {
      paymentMethodMap[order.paymentMethod] += order.netTotal || 0;
    }

    const customerKey = order.tableNumber || 'Walk-in';
    customerSalesMap[customerKey] = (customerSalesMap[customerKey] || 0) + order.netTotal;
    
    const cashierKey = order.cashierName || 'Admin Cashier';
    cashierSalesMap[cashierKey] = (cashierSalesMap[cashierKey] || 0) + order.netTotal;

    order.items.forEach(item => {
      const lineTotal = item.sellingPrice * item.quantity;

      // 👈 Actual cost price එක items table එකෙන් සොයාගෙන profit calculate කිරීම
      const itemDbInfoForCost = items.find(i => i.name === item.name);
      const unitCost = itemDbInfoForCost && itemDbInfoForCost.costPrice ? itemDbInfoForCost.costPrice : (item.sellingPrice * 0.6);
      totalCostOfSales += unitCost * item.quantity;

      if (selectedItemFilter !== 'ALL' && item.name !== selectedItemFilter) return;

      if (!productSalesMap[item.name]) productSalesMap[item.name] = { qty: 0, revenue: 0 };
      productSalesMap[item.name].qty += item.quantity;
      productSalesMap[item.name].revenue += lineTotal;

      const itemDbInfo = items.find(i => i.name === item.name);
      const catInfo = itemDbInfo ? categories.find(c => c.id === itemDbInfo.categoryId) : null;
      const catName = catInfo ? catInfo.name : 'Uncategorized';

      if (selectedCategoryFilter !== 'ALL' && catInfo && catInfo.id !== parseInt(selectedCategoryFilter)) return;
      categorySalesMap[catName] = (categorySalesMap[catName] || 0) + lineTotal;
    });
  });

  const totalCalculatedProfit = totalNetSales - totalCostOfSales;
  const profitMarginPercent = totalNetSales > 0 ? (totalCalculatedProfit / totalNetSales) * 100 : 0;
  const bestSellersList = Object.entries(productSalesMap).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.qty - a.qty);

  // 👈 REPORTS TAB එක සඳහා අමතර derived lists - professional report views සඳහා
  const totalOrdersCount = filteredOrders.length;
  const avgOrderValue = totalOrdersCount > 0 ? totalNetSales / totalOrdersCount : 0;

  const productSalesList = Object.entries(productSalesMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue);

  const categorySalesList = Object.entries(categorySalesMap)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const customerSalesList = Object.entries(customerSalesMap)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const cashierSalesList = Object.entries(cashierSalesMap)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const paymentMethodTotal = Object.values(paymentMethodMap).reduce((a, b) => a + b, 0) || 1;
  const paymentMethodList = Object.entries(paymentMethodMap).map(([method, amount]) => ({
    method,
    amount,
    percent: (amount / paymentMethodTotal) * 100
  }));

  const discountedOrdersList = filteredOrders
    .filter(o => (o.discountAmount || 0) > 0)
    .sort((a, b) => (b.discountAmount || 0) - (a.discountAmount || 0));

  const sortedInvoiceList = [...filteredOrders].sort((a, b) => new Date(b.settledDate) - new Date(a.settledDate));

  // ==========================================
  // 🖨️ PRINTER CONFIG (Bluetooth + USB + Serial)
  // ==========================================
  const [pairedDevices, setPairedDevices] = useState(() => {
    const saved = localStorage.getItem('pos_paired_bluetooth_devices');
    return saved ? JSON.parse(saved) : [];
  });
  const [printerMapping, setPrinterMapping] = useState(() => {
    const saved = localStorage.getItem('pos_printer_mapping');
    return saved ? JSON.parse(saved) : { kot: '', bot: '', bill: '' };
  });
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    localStorage.setItem('pos_paired_bluetooth_devices', JSON.stringify(pairedDevices));
  }, [pairedDevices]);
  useEffect(() => {
    localStorage.setItem('pos_printer_mapping', JSON.stringify(printerMapping));
  }, [printerMapping]);

  // 🔵 Device eka list eke add karanna helper
  const addDevice = (newDevice) => {
    setPairedDevices(prev => {
      if (prev.some(d => d.id === newDevice.id)) return prev;
      return [...prev, newDevice];
    });
  };

  // 🔵 දැනටමත් OS level eka paired/authorized BT devices load කිරීම (re-scan නොකර)
  const handleLoadPairedBluetooth = async () => {
    if (!navigator.bluetooth) {
      Swal.fire({ icon: 'error', title: 'Bluetooth Supported නැත!', text: 'Chrome හෝ Edge browser use කරන්න.' });
      return;
    }
    try {
      const devices = await navigator.bluetooth.getDevices();
      const named = devices.filter(d => d.name);
      if (named.length === 0) {
        Swal.fire({ icon: 'info', title: 'No Paired devices found', text: 'Try "Scan New BT Device" to add a new printer.' });
        return;
      }
      named.forEach(d => addDevice({ id: d.id, name: d.name, type: 'BLUETOOTH' }));
      Swal.fire({ icon: 'success', title: `${named.length} Bluetooth device(s) load successfully!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Failed to Load Devices!', text: err.message });
    }
  };

  // 🔵 නව Bluetooth printer scan කිරීම (OS pair dialog ගෙනෙනවා)
  const handleScanBluetooth = async () => {
    if (!navigator.bluetooth) {
      Swal.fire({ icon: 'error', title: 'Bluetooth not Supported!', text: 'Use Chrome or Edge browser' });
      return;
    }
    setIsScanning(true);
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      if (device.name) {
        addDevice({ id: device.id, name: device.name, type: 'BLUETOOTH' });
        Swal.fire({ icon: 'success', title: `✅ ${device.name} Add successfully!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
      }
    } catch (err) {
      if (err.name !== 'NotFoundError') console.error(err);
    } finally { setIsScanning(false); }
  };

  // 🟡 USB Cable printer connect කිරීම (PC සඳහා)
  const handleConnectUSB = async () => {
    if (!navigator.usb) {
      Swal.fire({ icon: 'error', title: 'WebUSB not Supported!', text: 'Use Chrome or Edge browser (v61+)' });
      return;
    }
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      const name = device.productName || `USB Printer (${device.vendorId.toString(16).toUpperCase()})`;
      const id = `usb-${device.vendorId}-${device.productId}`;
      addDevice({ id, name, type: 'USB', vendorId: device.vendorId, productId: device.productId });
      Swal.fire({ icon: 'success', title: `✅ ${name} Added successfully!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
    } catch (err) {
      if (err.name !== 'NotFoundError') console.error(err);
    }
  };

  // 🟢 COM Port / Serial printer connect කිරීම (PC cable printers සඳහා)
  const handleConnectSerial = async () => {
    if (!navigator.serial) {
      Swal.fire({ icon: 'error', title: 'Web Serial not Supported!', text: 'Use Chrome or Edge browser (v89+)' });
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      const info = port.getInfo();
      const id = `serial-${info.usbVendorId || 'com'}-${info.usbProductId || Date.now()}`;
      const name = (info.usbVendorId) ? `Serial Printer (VID:${info.usbVendorId.toString(16).toUpperCase()})` : 'COM Port Printer';
      addDevice({ id, name, type: 'SERIAL' });
      Swal.fire({ icon: 'success', title: `✅ ${name} Added successfully!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
    } catch (err) {
      if (err.name !== 'NotFoundError') console.error(err);
    }
  };

  // 🔴 Device eka list එකෙන් ඉවත් කිරීම
  const handleRemoveDevice = (deviceId) => {
    setPairedDevices(prev => prev.filter(d => d.id !== deviceId));
    // Mapping eke eka use kara tibba nam clear karanna
    setPrinterMapping(prev => {
      const updated = { ...prev };
      const removed = pairedDevices.find(d => d.id === deviceId);
      if (removed) {
        Object.keys(updated).forEach(role => {
          if (updated[role] === removed.name) updated[role] = '';
        });
      }
      return updated;
    });
  };

  const handleMappingChange = (role, deviceId) => {
    const device = pairedDevices.find(d => d.id === deviceId);
    setPrinterMapping(prev => ({ ...prev, [role]: deviceId, [`${role}_name`]: device ? device.name : '' }));
  };

  // Type badge color helper
  const typeColor = (type) => {
    if (type === 'BLUETOOTH') return 'bg-blue-100 text-blue-700';
    if (type === 'USB') return 'bg-yellow-100 text-yellow-700';
    if (type === 'SERIAL') return 'bg-green-100 text-green-700';
    return 'bg-gray-100 text-gray-600';
  };
  const typeLabel = (type) => {
    if (type === 'BLUETOOTH') return '🔵 BT';
    if (type === 'USB') return '🟡 USB';
    if (type === 'SERIAL') return '🟢 COM';
    return type;
  };

  // ==========================================
  // 📂 CATEGORY OPERATIONALS
  // ==========================================
  const [catName, setCatName] = useState('');
  const [printerType, setPrinterType] = useState('KOT');
  const [editingCatId, setEditingCatId] = useState(null);

  const handleSaveCategory = async (e) => {
    e.preventDefault(); if (!catName.trim()) return;
    if (editingCatId) await db.categories.update(editingCatId, { name: catName, printerType });
    else await db.categories.add({ name: catName, printerType });
    setCatName(''); setPrinterType('KOT'); setEditingCatId(null);
    Swal.fire({ icon: 'success', title: 'Saved!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
  };

  const handleDeleteCategory = async (id) => {
    const result = await Swal.fire({ title: 'Are you sure?', text: "Delete this category?", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Yes' });
    if (result.isConfirmed) { await db.categories.delete(id); }
  };

  // ==========================================
  // 🍔 FOOD ITEM OPERATIONALS
  // ==========================================
  const [itemName, setItemName] = useState('');
  const [itemCostPrice, setItemCostPrice] = useState(''); // 👈 අලුතින් එකතු කළ Cost Price state
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [serviceCharge, setServiceCharge] = useState('10');
  const [editingItemId, setEditingItemId] = useState(null);

  const handleSaveItem = async (e) => {
    e.preventDefault(); if (!itemName.trim() || !itemPrice || !itemCategory) return;
    const data = {
      name: itemName,
      costPrice: parseFloat(itemCostPrice) || 0, // 👈 Cost Price db.items වෙත save කිරීම
      sellingPrice: parseFloat(itemPrice),
      categoryId: parseInt(itemCategory),
      serviceChargePercentage: parseFloat(serviceCharge) || 0
    };
    if (editingItemId) await db.items.update(editingItemId, data);
    else await db.items.add(data);
    setItemName(''); setItemCostPrice(''); setItemPrice(''); setItemCategory(''); setServiceCharge('10'); setEditingItemId(null);
    Swal.fire({ icon: 'success', title: 'Saved!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
  };

  const handleDeleteItem = async (id) => {
    const result = await Swal.fire({ title: 'Are you sure?', text: "Delete this item?", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Yes' });
    if (result.isConfirmed) { await db.items.delete(id); }
  };

  // ==========================================
  // 🧑‍💼 ADMIN PROFILE MANAGEMENT LOGIC (FIXED FOR db.admins)
  // ==========================================
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminRole, setAdminRole] = useState('ADMIN');
  const [editingAdminId, setEditingAdminId] = useState(null);

  const handleSaveAdmin = async (e) => {
    e.preventDefault(); 
    if (!adminUsername.trim() || !adminPassword.trim()) return;
    
    // db.js එකේ තියෙන ව්‍යුහයටම දත්ත සකස් කිරීම
    const data = { 
      username: adminUsername.trim(), 
      password: adminPassword.trim(), // Login Form එකෙන් චෙක් කරන Field එක
      role: adminRole 
    };
    
    try {
      if (editingAdminId) {
        await db.admins.update(editingAdminId, data);
        Swal.fire({ icon: 'success', title: 'Profile Updated! ✅', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      } else {
        // Duplicate එකක්දැයි පරීක්ෂා කිරීම
        const existing = await db.admins.where('username').equalsIgnoreCase(data.username).first();
        if (existing) {
          Swal.fire({ icon: 'error', title: 'Username Already Exists!', text: 'Use a different username.' });
          return;
        }
        await db.admins.add(data);
        Swal.fire({ icon: 'success', title: 'Account Created! 🎉', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      }
      
      // Form එක Reset කිරීම
      setAdminUsername(''); 
      setAdminPassword(''); 
      setAdminRole('ADMIN'); 
      setEditingAdminId(null);
    } catch (error) {
      console.error("Error saving admin:", error);
      Swal.fire({ icon: 'error', title: 'Database Error', text: 'Error saving admin.' });
    }
  };

  const handleDeleteAdmin = async (id) => {
    const result = await Swal.fire({ 
      title: 'Are you sure?', 
      text: "Delete this admin account?", 
      icon: 'warning', 
      showCancelButton: true, 
      confirmButtonColor: '#ef4444', 
      confirmButtonText: 'Yes, Delete' 
    });
    
    if (result.isConfirmed) {
      await db.admins.delete(id);
      Swal.fire({ icon: 'success', title: 'Deleted Successfully!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-57px)] w-full bg-gray-100 p-4 overflow-hidden text-gray-800">
      
      {/* Top Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border shadow-sm mb-4 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">⚙️</span>
          <div>
            <h1 className="text-lg font-black tracking-wide">Admin Control Panel</h1>
            <p className="text-xs text-gray-400">POS System Administration and User Management</p>
          </div>
        </div>
        <button onClick={onBackToBilling} className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-xl font-bold text-xs transition">
          ⬅️ Back to Counter
        </button>
      </div>

      {/* Tab Bar Navigation */}
      <div className="flex space-x-2 border-b pb-2 mb-4 shrink-0 overflow-x-auto scrollbar-none">
        <button onClick={() => setActiveSubTab('CATEGORIES')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'CATEGORIES' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>📂 Manage Categories</button>
        <button onClick={() => setActiveSubTab('ITEMS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'ITEMS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🍔 Manage Food Items</button>
        <button onClick={() => setActiveSubTab('REPORTS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'REPORTS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>📊 Premium Reports</button>
        <button onClick={() => setActiveSubTab('PRINTERS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'PRINTERS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🖨️ Printer Settings</button>
        <button onClick={() => setActiveSubTab('PROFILE')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'PROFILE' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🧑‍💼 Profile Settings</button>
      </div>

      {/* Main Container Workspaces */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* CATEGORIES WORKSPACE */}
        {activeSubTab === 'CATEGORIES' && (
          <>
            <div className="md:col-span-4 bg-white p-4 rounded-2xl border h-full flex flex-col justify-between">
              <form onSubmit={handleSaveCategory} className="space-y-4">
                <h3 className="text-sm font-black text-gray-700 uppercase">{editingCatId ? '📝 Edit Category' : '➕ Add Category'}</h3>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Category Name</label>
                  <input type="text" value={catName} onChange={(e) => setCatName(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Target Printer Station</label>
                  <select value={printerType} onChange={(e) => setPrinterType(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs">
                    <option value="KOT">KOT (Kitchen)</option>
                    <option value="BOT">BOT (Bar)</option>
                  </select>
                </div>
                <button type="submit" className="w-full bg-indigo-600 text-white p-3 rounded-xl font-black text-xs">Save</button>
              </form>
            </div>
            <div className="md:col-span-8 bg-white p-4 rounded-2xl border h-full overflow-y-auto">
              <table className="w-full text-left text-xs"><thead className="bg-gray-50 font-bold text-gray-500 border-b"><tr><th className="p-3">Category</th><th className="p-3">Type</th><th className="p-3 text-center">Action</th></tr></thead><tbody>{categories.map(c => <tr key={c.id} className="border-b"><td className="p-3 font-bold">{c.name}</td><td className="p-3">{c.printerType}</td><td className="p-3 text-center space-x-2"><button onClick={() => {setEditingCatId(c.id); setCatName(c.name); setPrinterType(c.printerType);}} className="text-indigo-600 font-bold hover:underline">Edit</button><button onClick={() => handleDeleteCategory(c.id)} className="text-red-500 font-bold hover:underline">Delete</button></td></tr>)}</tbody></table>
            </div>
          </>
        )}

        {/* ITEMS WORKSPACE */}
        {activeSubTab === 'ITEMS' && (
          <>
            <div className="md:col-span-4 bg-white p-4 rounded-2xl border h-full flex flex-col justify-between overflow-y-auto">
              <form onSubmit={handleSaveItem} className="space-y-3">
                <h3 className="text-sm font-black text-gray-700 uppercase">{editingItemId ? '📝 Edit Food Item' : '🍔 Food Item'}</h3>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Item Name</label>
                  <input type="text" value={itemName} onChange={(e) => setItemName(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="Item Name" required />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Category</label>
                  <select value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" required>
                    <option value="">Select Category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Cost Price (Rs.)</label>
                    <input type="number" step="0.01" min="0" value={itemCostPrice} onChange={(e) => setItemCostPrice(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Selling Price (Rs.)</label>
                    <input type="number" step="0.01" min="0" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="0.00" required />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Service Charge (%)</label>
                  <input type="number" step="0.01" min="0" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="10" required />
                </div>

                {itemCostPrice && itemPrice && (
                  <div className="text-[11px] font-bold text-gray-500 bg-gray-50 border rounded-xl p-2">
                    Profit / Item: <span className="text-emerald-600">Rs.{(parseFloat(itemPrice || 0) - parseFloat(itemCostPrice || 0)).toFixed(2)}</span>
                  </div>
                )}

                <button type="submit" className="w-full bg-emerald-600 text-white p-3 rounded-xl font-black text-xs">Save Item</button>
              </form>
            </div>
            <div className="md:col-span-8 bg-white p-4 rounded-2xl border h-full overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-3">Item Name</th>
                    <th className="p-3">Cost Price</th>
                    <th className="p-3">Selling Price</th>
                    <th className="p-3">Service Chg.</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.id} className="border-b">
                      <td className="p-3 font-bold">{i.name}</td>
                      <td className="p-3 text-gray-500">Rs.{(i.costPrice || 0).toFixed ? i.costPrice.toFixed(2) : i.costPrice || '0.00'}</td>
                      <td className="p-3">Rs.{i.sellingPrice}</td>
                      <td className="p-3">{i.serviceChargePercentage || 0}%</td>
                      <td className="p-3 text-center space-x-2">
                        <button
                          onClick={() => {
                            setEditingItemId(i.id);
                            setItemName(i.name);
                            setItemCostPrice(i.costPrice !== undefined && i.costPrice !== null ? i.costPrice.toString() : '');
                            setItemPrice(i.sellingPrice.toString());
                            setItemCategory(i.categoryId.toString());
                            setServiceCharge(i.serviceChargePercentage.toString());
                          }}
                          className="text-indigo-600 font-bold hover:underline"
                        >
                          Edit
                        </button>
                        <button onClick={() => handleDeleteItem(i.id)} className="text-red-500 font-bold hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* REPORTS WORKSPACE */}
        {activeSubTab === 'REPORTS' && (
          <div className="col-span-12 bg-white p-4 rounded-2xl border h-full flex flex-col overflow-hidden">

            {/* 🔍 FILTER BAR */}
            <div className="bg-gray-50 p-3 rounded-xl border mb-3 grid grid-cols-2 sm:grid-cols-12 gap-2 text-xs items-end shrink-0">
              <div className="col-span-2 sm:col-span-3">
                <label className="block font-black text-gray-500 mb-0.5">📋 Report Type</label>
                <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="w-full p-2 border rounded-lg font-black bg-white text-indigo-700 border-indigo-200">
                  <option value="DAILY">☀️ Daily Sales Summary</option>
                  <option value="MONTHLY">📅 Monthly Sales Summary</option>
                  <option value="PRODUCT">📦 Sales by Product</option>
                  <option value="CATEGORY">📂 Sales by Category</option>
                  <option value="BEST_SELLING">🔥 Best Selling Products</option>
                  <option value="CUSTOMER">🪑 Sales by Table</option>
                  <option value="CASHIER">🧑‍💼 Sales by Cashier</option>
                  <option value="PAYMENT_METHOD">💳 Payment Method Breakdown</option>
                  <option value="PROFIT">📈 Profit &amp; Loss</option>
                  <option value="DISCOUNT">📉 Discount Tracker</option>
                  <option value="INVOICE">🧾 Detailed Invoice Log</option>
                </select>
              </div>

              {reportType !== 'DAILY' && reportType !== 'MONTHLY' && (
                <>
                  <div className="col-span-1 sm:col-span-2">
                    <label className="block font-bold text-gray-400">Start Date</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold" />
                  </div>
                  <div className="col-span-1 sm:col-span-2">
                    <label className="block font-bold text-gray-400">End Date</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold" />
                  </div>
                </>
              )}

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-gray-400">Item</label>
                <select value={selectedItemFilter} onChange={(e) => setSelectedItemFilter(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold bg-white">
                  <option value="ALL">All Items</option>
                  {items.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
                </select>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-gray-400">Category</label>
                <select value={selectedCategoryFilter} onChange={(e) => setSelectedCategoryFilter(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold bg-white">
                  <option value="ALL">All Categories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {(selectedItemFilter !== 'ALL' || selectedCategoryFilter !== 'ALL') && (
                <div className="col-span-2 sm:col-span-1 flex">
                  <button
                    onClick={() => { setSelectedItemFilter('ALL'); setSelectedCategoryFilter('ALL'); }}
                    className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded-lg font-black text-[10px]"
                  >
                    ✕ Clear
                  </button>
                </div>
              )}
            </div>

            {/* 📊 KPI SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3 shrink-0">
              <div className="bg-gray-900 text-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Net Revenue</span>
                <div className="text-base font-black text-emerald-400">Rs.{totalNetSales.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Total Orders</span>
                <div className="text-base font-black text-gray-800">{totalOrdersCount}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Avg. Order Value</span>
                <div className="text-base font-black text-gray-800">Rs.{avgOrderValue.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Service Charge</span>
                <div className="text-base font-black text-indigo-600">Rs.{totalServiceCharges.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Discounts Given</span>
                <div className="text-base font-black text-red-500">Rs.{totalDiscounts.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Net Profit</span>
                <div className="text-base font-black text-emerald-600">Rs.{totalCalculatedProfit.toFixed(2)}</div>
              </div>
            </div>

            {/* 📄 REPORT OUTPUT */}
            <div className="flex-1 overflow-y-auto border rounded-xl bg-gray-50 flex flex-col">
              <div className="bg-white p-3 border-b font-black text-xs text-indigo-700 uppercase flex justify-between items-center shrink-0">
                <span>📊 Report Output</span>
                <span className="text-gray-400 font-bold normal-case">{totalOrdersCount} record(s) found</span>
              </div>

              <div className="flex-1 overflow-y-auto text-xs bg-white p-2">

                {filteredOrders.length === 0 && (
                  <div className="text-center text-gray-400 font-bold py-12">No data available for the selected filters.</div>
                )}

                {/* DAILY / MONTHLY — order-level summary */}
                {filteredOrders.length > 0 && (reportType === 'DAILY' || reportType === 'MONTHLY') && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Date / Time</th><th className="p-2">Table</th><th className="p-2">Payment</th><th className="p-2 text-right">Net Total</th></tr></thead>
                    <tbody>
                      {sortedInvoiceList.map((o, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2">{o.settledDate ? new Date(o.settledDate).toLocaleString() : '-'}</td>
                          <td className="p-2 font-bold">{o.tableNumber || 'Walk-in'}</td>
                          <td className="p-2">{o.paymentMethod || '-'}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{(o.netTotal || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* PRODUCT — sales by item */}
                {filteredOrders.length > 0 && reportType === 'PRODUCT' && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Item</th><th className="p-2 text-right">Qty Sold</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">% of Sales</th></tr></thead>
                    <tbody>
                      {productSalesList.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">{p.name}</td>
                          <td className="p-2 text-right">{p.qty}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{p.revenue.toFixed(2)}</td>
                          <td className="p-2 text-right text-gray-500">{totalNetSales > 0 ? ((p.revenue / totalNetSales) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* CATEGORY — sales by category */}
                {filteredOrders.length > 0 && reportType === 'CATEGORY' && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Category</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">% of Sales</th></tr></thead>
                    <tbody>
                      {categorySalesList.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">{c.name}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{c.revenue.toFixed(2)}</td>
                          <td className="p-2 text-right text-gray-500">{totalNetSales > 0 ? ((c.revenue / totalNetSales) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* BEST SELLING — ranked products */}
                {filteredOrders.length > 0 && reportType === 'BEST_SELLING' && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">#</th><th className="p-2">Item</th><th className="p-2 text-right">Qty Sold</th><th className="p-2 text-right">Revenue</th></tr></thead>
                    <tbody>
                      {bestSellersList.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-black text-gray-400">{i + 1}</td>
                          <td className="p-2 font-bold">{i === 0 ? '🔥 ' : ''}{p.name}</td>
                          <td className="p-2 text-right font-bold">{p.qty}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{p.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* CUSTOMER — sales by table */}
                {filteredOrders.length > 0 && reportType === 'CUSTOMER' && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Table / Customer</th><th className="p-2 text-right">Orders</th><th className="p-2 text-right">Revenue</th></tr></thead>
                    <tbody>
                      {customerSalesList.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">🪑 {c.name}</td>
                          <td className="p-2 text-right">{filteredOrders.filter(o => (o.tableNumber || 'Walk-in') === c.name).length}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{c.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* CASHIER — sales by cashier */}
                {filteredOrders.length > 0 && reportType === 'CASHIER' && (
                  <table className="w-full text-left">
                    <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Cashier</th><th className="p-2 text-right">Orders</th><th className="p-2 text-right">Revenue</th></tr></thead>
                    <tbody>
                      {cashierSalesList.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">🧑‍💼 {c.name}</td>
                          <td className="p-2 text-right">{filteredOrders.filter(o => (o.cashierName || 'Admin Cashier') === c.name).length}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{c.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* PAYMENT METHOD — breakdown with bars */}
                {filteredOrders.length > 0 && reportType === 'PAYMENT_METHOD' && (
                  <div className="space-y-3 p-2">
                    {paymentMethodList.map((p, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[11px] font-bold mb-1">
                          <span>{p.method === 'CASH' ? '💵' : p.method === 'CARD' ? '💳' : '🏦'} {p.method}</span>
                          <span>Rs.{p.amount.toFixed(2)} <span className="text-gray-400">({p.percent.toFixed(1)}%)</span></span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${p.percent}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* PROFIT & LOSS */}
                {filteredOrders.length > 0 && reportType === 'PROFIT' && (
                  <div className="p-2 space-y-3">
                    <table className="w-full text-left">
                      <tbody>
                        <tr className="border-b"><td className="p-2 font-bold text-gray-600">Gross Revenue (Net Sales)</td><td className="p-2 text-right font-bold">Rs.{totalNetSales.toFixed(2)}</td></tr>
                        <tr className="border-b"><td className="p-2 font-bold text-gray-600">Less: Cost of Goods Sold</td><td className="p-2 text-right font-bold text-red-500">- Rs.{totalCostOfSales.toFixed(2)}</td></tr>
                        <tr className="border-b bg-emerald-50"><td className="p-2 font-black text-emerald-700">Net Profit</td><td className="p-2 text-right font-black text-emerald-700">Rs.{totalCalculatedProfit.toFixed(2)}</td></tr>
                        <tr><td className="p-2 font-bold text-gray-600">Profit Margin</td><td className="p-2 text-right font-bold">{profitMarginPercent.toFixed(1)}%</td></tr>
                      </tbody>
                    </table>
                    <div className="font-black text-gray-500 uppercase text-[11px] pt-1">Profit Breakdown by Item</div>
                    <table className="w-full text-left">
                      <thead><tr className="bg-gray-100"><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Revenue</th></tr></thead>
                      <tbody>
                        {productSalesList.map((p, i) => (
                          <tr key={i} className="border-b"><td className="p-2 font-bold">{p.name}</td><td className="p-2 text-right">{p.qty}</td><td className="p-2 text-right font-bold text-emerald-600">Rs.{p.revenue.toFixed(2)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* DISCOUNT TRACKER */}
                {reportType === 'DISCOUNT' && (
                  discountedOrdersList.length === 0 ? (
                    <div className="text-center text-gray-400 font-bold py-12">No discounted orders found in this range.</div>
                  ) : (
                    <table className="w-full text-left">
                      <thead><tr className="bg-gray-100 sticky top-0"><th className="p-2">Date</th><th className="p-2">Table</th><th className="p-2 text-right">Discount</th><th className="p-2 text-right">Net Total</th></tr></thead>
                      <tbody>
                        {discountedOrdersList.map((o, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            <td className="p-2">{o.settledDate ? new Date(o.settledDate).toLocaleString() : '-'}</td>
                            <td className="p-2 font-bold">{o.tableNumber || 'Walk-in'}</td>
                            <td className="p-2 text-right font-bold text-red-500">- Rs.{(o.discountAmount || 0).toFixed(2)}</td>
                            <td className="p-2 text-right font-bold">Rs.{(o.netTotal || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}

                {/* DETAILED INVOICE LOG */}
                {filteredOrders.length > 0 && reportType === 'INVOICE' && (
                  <div className="space-y-2">
                    {sortedInvoiceList.map((o, i) => (
                      <div key={i} className="border rounded-lg p-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-black text-gray-700">🧾 {o.tableNumber || 'Walk-in'} <span className="text-gray-400 font-bold">· {o.settledDate ? new Date(o.settledDate).toLocaleString() : '-'}</span></span>
                          <span className="font-black text-emerald-600">Rs.{(o.netTotal || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {(o.items || []).map((it, idx) => (
                            <span key={idx}>{it.name} × {it.quantity}{idx < o.items.length - 1 ? ', ' : ''}</span>
                          ))}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1 flex justify-between">
                          <span>Payment: {o.paymentMethod || '-'}</span>
                          {(o.discountAmount || 0) > 0 && <span className="text-red-400">Discount: Rs.{o.discountAmount.toFixed(2)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* PRINTERS WORKSPACE */}
        {activeSubTab === 'PRINTERS' && (
          <div className="col-span-12 bg-white rounded-2xl border h-full flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* ── STEP 1: Add Printers ── */}
              <div>
                <h3 className="text-xs font-black text-gray-400 uppercase mb-2">① Add Printers</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

                  {/* Bluetooth section */}
                  <div className="border rounded-xl p-3 bg-blue-50 space-y-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🔵</span>
                      <div>
                        <div className="font-black text-xs text-blue-800">Bluetooth Printer</div>
                        <div className="text-[10px] text-blue-500">Mobile / Tablet for</div>
                      </div>
                    </div>
                    <button
                      onClick={handleLoadPairedBluetooth}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black py-2 rounded-lg transition"
                    >
                      📋 Load Paired BT Devices
                    </button>
                    <button
                      onClick={handleScanBluetooth}
                      disabled={isScanning}
                      className="w-full bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 text-[11px] font-black py-2 rounded-lg transition disabled:opacity-50"
                    >
                      {isScanning ? '⏳ Scanning...' : '🔍 Scan New BT Device'}
                    </button>
                  </div>

                  {/* USB Cable section */}
                  <div className="border rounded-xl p-3 bg-yellow-50 space-y-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🟡</span>
                      <div>
                        <div className="font-black text-xs text-yellow-800">USB Cable Printer</div>
                        <div className="text-[10px] text-yellow-600">PC / Laptop (USB port)</div>
                      </div>
                    </div>
                    <button
                      onClick={handleConnectUSB}
                      className="w-full bg-yellow-500 hover:bg-yellow-600 text-white text-[11px] font-black py-2 rounded-lg transition"
                    >
                      🔌 Connect USB Printer
                    </button>
                    <div className="text-[9px] text-yellow-700 bg-yellow-100 rounded-lg p-1.5 text-center">
                      Chrome / Edge v61+ <br/>USB cable printer directly connect
                    </div>
                  </div>

                  {/* Serial / COM Port section */}
                  <div className="border rounded-xl p-3 bg-green-50 space-y-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🟢</span>
                      <div>
                        <div className="font-black text-xs text-green-800">COM / Serial Printer</div>
                        <div className="text-[10px] text-green-600">PC COM Port / RS232</div>
                      </div>
                    </div>
                    <button
                      onClick={handleConnectSerial}
                      className="w-full bg-green-600 hover:bg-green-700 text-white text-[11px] font-black py-2 rounded-lg transition"
                    >
                      🔗 Connect Serial Printer
                    </button>
                    <div className="text-[9px] text-green-700 bg-green-100 rounded-lg p-1.5 text-center">
                      Chrome / Edge v89+ <br/>COM port printer / RS232 adapter
                    </div>
                  </div>
                </div>
              </div>

              {/* ── STEP 2: Added Devices List ── */}
              <div>
                <h3 className="text-xs font-black text-gray-400 uppercase mb-2">② Added Printers ({pairedDevices.length})</h3>
                {pairedDevices.length === 0 ? (
                  <div className="text-center text-gray-400 text-xs font-bold py-6 border rounded-xl bg-gray-50">
                   No Printer devices added. Use the buttons above.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pairedDevices.map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                        <div className="flex items-center space-x-2">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${typeColor(d.type)}`}>{typeLabel(d.type)}</span>
                          <span className="font-bold text-xs text-gray-800">{d.name}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveDevice(d.id)}
                          className="text-red-400 hover:text-red-600 text-[10px] font-black px-2 py-1 rounded-lg hover:bg-red-50"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── STEP 3: Assign to Roles ── */}
              <div>
                <h3 className="text-xs font-black text-gray-400 uppercase mb-2">③ Assign Printer Roles</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { role: 'kot', label: '🔥 KOT', desc: 'Kitchen Order Ticket', color: 'border-orange-200 bg-orange-50' },
                    { role: 'bot', label: '🍹 BOT', desc: 'Bar Order Ticket', color: 'border-blue-200 bg-blue-50' },
                    { role: 'bill', label: '🧾 BILL', desc: 'Customer Bill / Receipt', color: 'border-emerald-200 bg-emerald-50' },
                  ].map(({ role, label, desc, color }) => (
                    <div key={role} className={`border-2 p-4 rounded-xl ${color}`}>
                      <div className="font-black text-sm text-gray-700 mb-0.5">{label}</div>
                      <div className="text-[10px] text-gray-400 mb-2">{desc}</div>
                      <select
                        value={printerMapping[role] || ''}
                        onChange={(e) => handleMappingChange(role, e.target.value)}
                        className="w-full p-2 border rounded-lg bg-white text-xs font-bold"
                      >
                        <option value="">— No Printer Assigned —</option>
                        {pairedDevices.map(d => (
                          <option key={d.id} value={d.id}>
                            {typeLabel(d.type)} {d.name}
                          </option>
                        ))}
                      </select>
                      {printerMapping[role] && (
                        <div className="text-[10px] text-gray-500 mt-1 font-bold">
                          ✅ {pairedDevices.find(d => d.id === printerMapping[role])?.name || 'Assigned'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 🧑‍💼 PROFILE SETTINGS WORKSPACE */}
        {activeSubTab === 'PROFILE' && (
          <>
            {/* Form Column */}
            <div className="md:col-span-4 bg-white p-4 rounded-2xl border h-full flex flex-col justify-between">
              <form onSubmit={handleSaveAdmin} className="space-y-4">
                <div>
                  <h3 className="text-sm font-black text-gray-700 uppercase">
                    {editingAdminId ? '📝 Edit Profile User' : '➕ Add System Account'}
                  </h3>
                  <p className="text-[11px] text-gray-400">Cashier and Admin Account Management</p>
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Username / Name</label>
                  <input 
                    type="text" 
                    value={adminUsername} 
                    onChange={(e) => setAdminUsername(e.target.value)} 
                    className="w-full p-2.5 border rounded-xl font-bold text-xs" 
                    required 
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Secure Password</label>
                  <input 
                    type="password" 
                    value={adminPassword} 
                    onChange={(e) => setAdminPassword(e.target.value)} 
                    className="w-full p-2.5 border rounded-xl font-bold text-xs" 
                    required 
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Permission Role</label>
                  <select 
                    value={adminRole} 
                    onChange={(e) => setAdminRole(e.target.value)} 
                    className="w-full p-2.5 border rounded-xl font-bold text-xs"
                  >
                    <option value="ADMIN">ADMIN (Full Access)</option>
                    <option value="CASHIER">CASHIER (Billing View Only)</option>
                  </select>
                </div>

                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl font-black text-xs transition">
                  {editingAdminId ? 'Update Account' : 'Create Profile Account'}
                </button>

                {editingAdminId && (
                  <button 
                    type="button" 
                    onClick={() => { setEditingAdminId(null); setAdminUsername(''); setAdminPassword(''); setAdminRole('ADMIN'); }} 
                    className="w-full bg-gray-200 text-gray-700 p-2 rounded-xl font-bold text-xs mt-1"
                  >
                    Cancel Edit
                  </button>
                )}
              </form>
            </div>

            {/* Table Display Column */}
            <div className="md:col-span-8 bg-white p-4 rounded-2xl border h-full overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 font-bold text-gray-500 border-b">
                  <tr>
                    <th className="p-3">Profile Username</th>
                    <th className="p-3">System Role</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {admins.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="p-3 font-bold text-gray-800">👤 {a.username}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wide ${a.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
                          {a.role}
                        </span>
                      </td>
                      <td className="p-3 text-center space-x-3 font-bold">
                        <button 
                          onClick={() => {
                            setEditingAdminId(a.id); 
                            setAdminUsername(a.username); 
                            setAdminPassword(a.password || ''); 
                            setAdminRole(a.role || 'ADMIN');
                          }} 
                          className="text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteAdmin(a.id)} 
                          className="text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {admins.length === 0 && (
                    <tr>
                      <td colSpan="3" className="p-8 text-center text-gray-400 font-bold">No accounts registered yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>
    </div>
  );
}