// src/AdminPanel.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import {
  getBillDesignSettings,
  saveBillDesignSettings,
  PAPER_WIDTH_CONFIG,
  generateBillReceipt,
  generateKitchenReceipt,
  printViaBluetooth,
  DEVELOPER_CREDIT_LINE_1,
  DEVELOPER_CREDIT_LINE_2
} from './printUtils';
import {
  saveBackupSnapshot,
  listBackups,
  getBackupByDateKey,
  downloadBackupFile,
  readBackupFile,
  restoreFromBackup
} from './backupUtils';
import { clearSession } from './authUtils';

export default function AdminPanel({ onBackToBilling, currentUser, onLogout }) {
  // DB Live Queries
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const items = useLiveQuery(() => db.items.toArray()) || [];
  const settledOrders = useLiveQuery(() => db.orders.where('status').equals('SETTLED').toArray()) || [];

  // 👈 db.js එකේ ඇති db.admins ව්‍යුහය සෘජුවම ලබා ගැනීම
  const admins = useLiveQuery(() => db.admins.toArray()) || [];

  // Navigation state inside admin
  const [activeSubTab, setActiveSubTab] = useState('CATEGORIES'); // CATEGORIES, ITEMS, REPORTS, PRINTERS, BILL_DESIGN, PROFILE

  // ==========================================
  // 📊 REPORTS STATES — Advanced Report Portal
  // ==========================================
  const REPORT_GROUPS = [
    {
      key: 'OVERVIEW',
      label: '📊 Sales Overview',
      reports: [
        { key: 'SUMMARY', label: 'Sales Summary', icon: '📋' },
        { key: 'PAYMENT_METHOD', label: 'Payment Methods', icon: '💳' },
      ],
    },
    {
      key: 'PRODUCTS',
      label: '📦 Products',
      reports: [
        { key: 'PRODUCT', label: 'Sales by Product', icon: '📦' },
        { key: 'CATEGORY', label: 'Sales by Category', icon: '📂' },
        { key: 'BEST_SELLING', label: 'Best Sellers', icon: '🔥' },
      ],
    },
    {
      key: 'FINANCIAL',
      label: '💰 Financial',
      reports: [
        { key: 'PROFIT', label: 'Profit & Loss', icon: '📈' },
        { key: 'DISCOUNT', label: 'Discount Tracker', icon: '📉' },
      ],
    },
    {
      key: 'OPERATIONS',
      label: '🧑‍💼 Operations',
      reports: [
        { key: 'CUSTOMER', label: 'Sales by Table', icon: '🪑' },
        { key: 'CASHIER', label: 'Sales by Cashier', icon: '🧑‍💼' },
        { key: 'INVOICE', label: 'Invoice Log', icon: '🧾' },
      ],
    },
  ];

  const DATE_PRESETS = [
    { key: 'TODAY', label: 'Today' },
    { key: 'YESTERDAY', label: 'Yesterday' },
    { key: 'THIS_WEEK', label: 'This Week' },
    { key: 'THIS_MONTH', label: 'This Month' },
    { key: 'LAST_MONTH', label: 'Last Month' },
    { key: 'THIS_YEAR', label: 'This Year' },
    { key: 'CUSTOM', label: 'Custom Range' },
  ];

  const [activeReportGroup, setActiveReportGroup] = useState('OVERVIEW');
  const [reportType, setReportType] = useState('SUMMARY');
  const [datePreset, setDatePreset] = useState('TODAY');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedItemFilter, setSelectedItemFilter] = useState('ALL');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');
  const [selectedPaymentFilter, setSelectedPaymentFilter] = useState('ALL');
  const [selectedCashierFilter, setSelectedCashierFilter] = useState('ALL');
  const [selectedTableFilter, setSelectedTableFilter] = useState('ALL');
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });

  // Reset sort whenever the report type changes — different reports have different columns
  useEffect(() => {
    setSortConfig({ key: null, direction: 'desc' });
  }, [reportType]);

  const handleGroupClick = (groupKey) => {
    setActiveReportGroup(groupKey);
    const group = REPORT_GROUPS.find(g => g.key === groupKey);
    if (group) setReportType(group.reports[0].key);
  };

  const currentReportMeta = REPORT_GROUPS.flatMap(g => g.reports).find(r => r.key === reportType) || { label: 'Report', icon: '📊' };
  const dateRangeLabel = datePreset === 'CUSTOM'
    ? `${startDate} → ${endDate}`
    : (DATE_PRESETS.find(d => d.key === datePreset)?.label || '');

  const getDateRangeFromPreset = (preset, customStart, customEnd) => {
    const now = new Date();
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

    switch (preset) {
      case 'TODAY':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'YESTERDAY': {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        return { start: startOfDay(y), end: endOfDay(y) };
      }
      case 'THIS_WEEK': {
        const day = now.getDay();
        const diffToMonday = (day === 0 ? 6 : day - 1);
        const monday = new Date(now); monday.setDate(now.getDate() - diffToMonday);
        return { start: startOfDay(monday), end: endOfDay(now) };
      }
      case 'THIS_MONTH': {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: startOfDay(first), end: endOfDay(now) };
      }
      case 'LAST_MONTH': {
        const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        return { start: startOfDay(firstLastMonth), end: endOfDay(lastLastMonth) };
      }
      case 'THIS_YEAR': {
        const first = new Date(now.getFullYear(), 0, 1);
        return { start: startOfDay(first), end: endOfDay(now) };
      }
      case 'CUSTOM':
      default:
        return {
          start: customStart ? new Date(customStart + 'T00:00:00') : null,
          end: customEnd ? new Date(customEnd + 'T23:59:59') : null,
        };
    }
  };

  const { start: rangeStart, end: rangeEnd } = getDateRangeFromPreset(datePreset, startDate, endDate);

  // Options for the Cashier/Table filter dropdowns — built from ALL settled orders
  // (not the filtered set) so switching filters doesn't make other options disappear
  const uniqueCashiers = Array.from(new Set(settledOrders.map(o => o.cashierName || 'Admin Cashier'))).sort();
  const uniqueTables = Array.from(new Set(settledOrders.map(o => o.tableNumber || 'Walk-in'))).sort();

  const getProcessedReports = () => {
    return settledOrders.filter(order => {
      if (!order.settledDate) return false;
      const orderDate = new Date(order.settledDate);

      if (rangeStart && rangeStart > orderDate) return false;
      if (rangeEnd && rangeEnd < orderDate) return false;

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
      if (selectedPaymentFilter !== 'ALL' && order.paymentMethod !== selectedPaymentFilter) return false;
      if (selectedCashierFilter !== 'ALL' && (order.cashierName || 'Admin Cashier') !== selectedCashierFilter) return false;
      if (selectedTableFilter !== 'ALL' && (order.tableNumber || 'Walk-in') !== selectedTableFilter) return false;

      return true;
    });
  };

  const filteredOrders = getProcessedReports();

  const anyFilterActive = selectedItemFilter !== 'ALL' || selectedCategoryFilter !== 'ALL' || selectedPaymentFilter !== 'ALL' || selectedCashierFilter !== 'ALL' || selectedTableFilter !== 'ALL' || reportSearchTerm.trim() !== '';
  const clearAllFilters = () => {
    setSelectedItemFilter('ALL');
    setSelectedCategoryFilter('ALL');
    setSelectedPaymentFilter('ALL');
    setSelectedCashierFilter('ALL');
    setSelectedTableFilter('ALL');
    setReportSearchTerm('');
  };

  // Generic search + sort helpers applied to each report's rows
  const applySearch = (list, getSearchableText) => {
    const term = reportSearchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter(row => getSearchableText(row).toLowerCase().includes(term));
  };
  const applySort = (list, defaultKey, defaultDir = 'desc') => {
    const key = sortConfig.key || defaultKey;
    const dir = sortConfig.key ? sortConfig.direction : defaultDir;
    return [...list].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === 'asc' ? (av - bv) : (bv - av);
    });
  };
  const handleSort = (key) => {
    setSortConfig(prev => prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' });
  };
  const sortArrow = (key) => sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';
  const sortableTh = (label, key, extraClass = '') => (
    <th onClick={() => handleSort(key)} className={`p-2 cursor-pointer select-none hover:bg-gray-200 transition ${extraClass}`}>
      {label}{sortArrow(key)}
    </th>
  );

  // METRICS COUNTERS
  let totalNetSales = 0;
  let totalDiscounts = 0;
  let totalServiceCharges = 0;
  let totalCostOfSales = 0;
  let totalItemsSold = 0;

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
    if (!customerSalesMap[customerKey]) customerSalesMap[customerKey] = { revenue: 0, count: 0 };
    customerSalesMap[customerKey].revenue += order.netTotal || 0;
    customerSalesMap[customerKey].count += 1;

    const cashierKey = order.cashierName || 'Admin Cashier';
    if (!cashierSalesMap[cashierKey]) cashierSalesMap[cashierKey] = { revenue: 0, count: 0 };
    cashierSalesMap[cashierKey].revenue += order.netTotal || 0;
    cashierSalesMap[cashierKey].count += 1;

    order.items.forEach(item => {
      const lineTotal = item.sellingPrice * item.quantity;
      totalItemsSold += item.quantity;

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

  const totalOrdersCount = filteredOrders.length;
  const avgOrderValue = totalOrdersCount > 0 ? totalNetSales / totalOrdersCount : 0;

  const productSalesList = applySort(
    applySearch(Object.entries(productSalesMap).map(([name, data]) => ({ name, ...data })), (p) => p.name),
    'revenue'
  );

  const bestSellersList = applySort(
    applySearch(Object.entries(productSalesMap).map(([name, data]) => ({ name, ...data })), (p) => p.name),
    'qty'
  );

  const categorySalesList = applySort(
    applySearch(Object.entries(categorySalesMap).map(([name, revenue]) => ({ name, revenue })), (c) => c.name),
    'revenue'
  );

  const customerSalesList = applySort(
    applySearch(Object.entries(customerSalesMap).map(([name, d]) => ({ name, ...d })), (c) => c.name),
    'revenue'
  );

  const cashierSalesList = applySort(
    applySearch(Object.entries(cashierSalesMap).map(([name, d]) => ({ name, ...d })), (c) => c.name),
    'revenue'
  );

  const paymentMethodTotal = Object.values(paymentMethodMap).reduce((a, b) => a + b, 0) || 1;
  const paymentMethodList = Object.entries(paymentMethodMap).map(([method, amount]) => ({
    method,
    amount,
    percent: (amount / paymentMethodTotal) * 100
  }));

  const discountedOrdersList = applySort(
    applySearch(
      filteredOrders.filter(o => (o.discountAmount || 0) > 0),
      (o) => `${o.tableNumber || 'Walk-in'} ${o.cashierName || ''} ${o.paymentMethod || ''}`
    ),
    'discountAmount'
  );

  const sortedInvoiceList = applySort(
    applySearch(
      [...filteredOrders],
      (o) => `${o.tableNumber || 'Walk-in'} ${o.cashierName || ''} ${o.paymentMethod || ''} ${o.dailyOrderNumber || ''}`
    ),
    'settledDate'
  );

  // ==========================================
  // 📤 CSV EXPORT
  // ==========================================
  const escapeCsvValue = (val) => {
    const str = String(val ?? '');
    return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const downloadCsv = (filename, headers, rows) => {
    const lines = [headers.join(','), ...rows.map(row => row.map(escapeCsvValue).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${reportType.toLowerCase()}-report-${dateStr}.csv`;
    let headers = [];
    let rows = [];

    if (reportType === 'SUMMARY' || reportType === 'INVOICE') {
      headers = ['Date/Time', 'Bill No', 'Table', 'Cashier', 'Payment', 'Items', 'Discount', 'Net Total'];
      rows = sortedInvoiceList.map(o => [
        o.settledDate ? new Date(o.settledDate).toLocaleString() : '-',
        o.dailyOrderNumber ?? '',
        o.tableNumber || 'Walk-in',
        o.cashierName || 'Admin Cashier',
        o.paymentMethod || '',
        (o.items || []).map(it => `${it.name} x${it.quantity}`).join('; '),
        (o.discountAmount || 0).toFixed(2),
        (o.netTotal || 0).toFixed(2),
      ]);
    } else if (reportType === 'PRODUCT' || reportType === 'PROFIT') {
      headers = ['Item', 'Qty Sold', 'Revenue', '% of Sales'];
      rows = productSalesList.map(p => [p.name, p.qty, p.revenue.toFixed(2), totalNetSales > 0 ? ((p.revenue / totalNetSales) * 100).toFixed(1) : '0.0']);
    } else if (reportType === 'CATEGORY') {
      headers = ['Category', 'Revenue', '% of Sales'];
      rows = categorySalesList.map(c => [c.name, c.revenue.toFixed(2), totalNetSales > 0 ? ((c.revenue / totalNetSales) * 100).toFixed(1) : '0.0']);
    } else if (reportType === 'BEST_SELLING') {
      headers = ['Rank', 'Item', 'Qty Sold', 'Revenue'];
      rows = bestSellersList.map((p, i) => [i + 1, p.name, p.qty, p.revenue.toFixed(2)]);
    } else if (reportType === 'CUSTOMER') {
      headers = ['Table', 'Orders', 'Revenue'];
      rows = customerSalesList.map(c => [c.name, c.count, c.revenue.toFixed(2)]);
    } else if (reportType === 'CASHIER') {
      headers = ['Cashier', 'Orders', 'Revenue'];
      rows = cashierSalesList.map(c => [c.name, c.count, c.revenue.toFixed(2)]);
    } else if (reportType === 'PAYMENT_METHOD') {
      headers = ['Method', 'Amount', '% of Sales'];
      rows = paymentMethodList.map(p => [p.method, p.amount.toFixed(2), p.percent.toFixed(1)]);
    } else if (reportType === 'DISCOUNT') {
      headers = ['Date', 'Table', 'Discount', 'Net Total'];
      rows = discountedOrdersList.map(o => [o.settledDate ? new Date(o.settledDate).toLocaleString() : '-', o.tableNumber || 'Walk-in', (o.discountAmount || 0).toFixed(2), (o.netTotal || 0).toFixed(2)]);
    }

    if (rows.length === 0) {
      Swal.fire({ icon: 'info', title: 'Nothing to Export', text: 'There is no data in the current report to export.' });
      return;
    }
    downloadCsv(filename, headers, rows);
  };

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
  const [isLoadingUSB, setIsLoadingUSB] = useState(false);

  useEffect(() => {
    localStorage.setItem('pos_paired_bluetooth_devices', JSON.stringify(pairedDevices));
  }, [pairedDevices]);
  useEffect(() => {
    localStorage.setItem('pos_printer_mapping', JSON.stringify(printerMapping));
  }, [printerMapping]);

  const addDevice = (newDevice) => {
    setPairedDevices(prev => {
      if (prev.some(d => d.id === newDevice.id)) return prev;
      return [...prev, newDevice];
    });
  };

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
      if (err.name === 'NotFoundError') {
        Swal.fire({
          icon: 'info',
          title: 'No USB Printer Found in List',
          html: `If the picker showed an empty list, Windows has likely already claimed the printer with its normal driver — WebUSB can't see it until that's changed.<br/><br/>Try <b>🔄 Refresh USB Devices</b> below, or use <b>Zadig</b> to switch the printer to the WinUSB driver, or connect it via Bluetooth instead.`
        });
      } else {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'USB Connection Failed', text: err.message });
      }
    }
  };

  // 🔄 Refresh: silently re-check devices this browser already has permission for
  // (no picker popup) — useful if the printer was granted access before but dropped
  // out of the paired list, e.g. after a browser restart.
  const handleLoadPairedUSB = async () => {
    if (!navigator.usb) {
      Swal.fire({ icon: 'error', title: 'WebUSB not Supported!', text: 'Use Chrome or Edge browser (v61+).' });
      return;
    }
    setIsLoadingUSB(true);
    try {
      const grantedDevices = await navigator.usb.getDevices();
      if (grantedDevices.length === 0) {
        Swal.fire({
          icon: 'info',
          title: 'No Authorized USB Devices Found',
          html: `This browser hasn't been granted permission to any USB printer yet, or Windows is still holding the device with its standard driver.<br/><br/>Try <b>Connect USB Printer</b> first to grant permission, or use Zadig to switch the printer's driver to WinUSB.`
        });
        return;
      }
      let addedCount = 0;
      grantedDevices.forEach(device => {
        const name = device.productName || `USB Printer (${device.vendorId.toString(16).toUpperCase()})`;
        const id = `usb-${device.vendorId}-${device.productId}`;
        if (!pairedDevices.some(d => d.id === id)) addedCount++;
        addDevice({ id, name, type: 'USB', vendorId: device.vendorId, productId: device.productId });
      });
      Swal.fire({
        icon: 'success',
        title: addedCount > 0 ? `${addedCount} USB device(s) refreshed!` : 'USB devices refreshed (already up to date)',
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2000
      });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Failed to Refresh USB Devices', text: err.message });
    } finally {
      setIsLoadingUSB(false);
    }
  };

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

  const handleRemoveDevice = (deviceId) => {
    setPairedDevices(prev => prev.filter(d => d.id !== deviceId));
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
  // 🧾 BILL DESIGN (Store info, Logo, Paper size, Layout)
  // ==========================================
  const [billDesignForm, setBillDesignForm] = useState(() => getBillDesignSettings());
  const [isSendingTestPrint, setIsSendingTestPrint] = useState(false);

  const handleBillDesignChange = (field, value) => {
    setBillDesignForm(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Swal.fire({ icon: 'error', title: 'Invalid File', text: 'Please choose an image file (PNG/JPG).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => handleBillDesignChange('logoBase64', reader.result);
    reader.onerror = () => Swal.fire({ icon: 'error', title: 'Could not read image' });
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => handleBillDesignChange('logoBase64', '');

  const handleSaveBillDesign = () => {
    saveBillDesignSettings(billDesignForm);
    Swal.fire({ icon: 'success', title: 'Bill Design Saved! 🧾', toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
  };

  const handleTestPrint = async () => {
    // Persist first so generateBillReceipt (which reads from storage) uses the current form
    saveBillDesignSettings(billDesignForm);
    setIsSendingTestPrint(true);
    try {
      const sampleItems = [
        { name: 'Sample Item 1', sellingPrice: 250, quantity: 2 },
        { name: 'Sample Item 2', sellingPrice: 450, quantity: 1 },
      ];
      const receipt = await generateBillReceipt(false, 'Test Table', 'TEST PRINT', 950, 95, 0, 1045, sampleItems, 999);
      const success = await printViaBluetooth('bill', receipt);
      if (success) {
        Swal.fire({ icon: 'success', title: 'Test Print Sent! ✅', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
      } else {
        Swal.fire({ icon: 'warning', title: 'No Bill Printer Assigned', text: 'Go to Step ③ "Assign Printer Roles" above and set a printer for BILL first.' });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Test Print Failed', text: err.message });
    } finally {
      setIsSendingTestPrint(false);
    }
  };

  const handleTestKotBotPrint = async (role) => {
    saveBillDesignSettings(billDesignForm);
    setIsSendingTestPrint(true);
    try {
      const sampleItems = [
        { quantity: 2, name: 'Chicken Fried Rice' },
        { quantity: 1, name: 'Iced Coffee' },
      ];
      const receipt = generateKitchenReceipt(false, 'Test Table', role === 'kot' ? 'KOT (KITCHEN)' : 'BOT (BAR)', sampleItems, 999);
      const success = await printViaBluetooth(role, receipt);
      if (success) {
        Swal.fire({ icon: 'success', title: `${role.toUpperCase()} Test Print Sent! ✅`, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
      } else {
        Swal.fire({ icon: 'warning', title: `No ${role.toUpperCase()} Printer Assigned`, text: `Go to Step ③ "Assign Printer Roles" above and set a printer for ${role.toUpperCase()} first.` });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Test Print Failed', text: err.message });
    } finally {
      setIsSendingTestPrint(false);
    }
  };

  const previewCharsWidth = billDesignForm.paperWidth === '58mm' ? '230px' : '300px';

  // Maps NORMAL/LARGE/XLARGE/HUGE to a preview font-size in px (for the mockup only —
  // the actual print uses real ESC/POS size commands, this is just visual approximation)
  const PREVIEW_SIZE_PX = { NORMAL: '9px', LARGE: '12px', XLARGE: '15px', HUGE: '19px' };
  const previewSizePx = (tier) => PREVIEW_SIZE_PX[tier] || PREVIEW_SIZE_PX.NORMAL;
  const PREVIEW_SIZE_SEQUENCE = ['NORMAL', 'LARGE', 'XLARGE', 'HUGE'];
  const bumpPreviewSize = (tier) => {
    const idx = Math.min(PREVIEW_SIZE_SEQUENCE.indexOf(tier) + 1, PREVIEW_SIZE_SEQUENCE.length - 1);
    return PREVIEW_SIZE_SEQUENCE[idx] || 'NORMAL';
  };

  // ==========================================
  // 💾 BACKUP & RESTORE
  // ==========================================
  const [backupList, setBackupList] = useState([]);
  const [isBackingUpNow, setIsBackingUpNow] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(true);

  const refreshBackupList = async () => {
    setIsLoadingBackups(true);
    try {
      const list = await listBackups();
      setBackupList(list);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    refreshBackupList();
  }, []);

  const handleBackupNow = async () => {
    setIsBackingUpNow(true);
    try {
      await saveBackupSnapshot();
      await refreshBackupList();
      Swal.fire({ icon: 'success', title: 'Backup Created! 💾', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Backup Failed', text: err.message });
    } finally {
      setIsBackingUpNow(false);
    }
  };

  const handleDownloadBackup = async (dateKey) => {
    try {
      const backup = dateKey ? await getBackupByDateKey(dateKey) : await saveBackupSnapshot();
      if (!backup) {
        Swal.fire({ icon: 'error', title: 'Backup Not Found' });
        return;
      }
      downloadBackupFile(backup);
      if (!dateKey) refreshBackupList();
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Download Failed', text: err.message });
    }
  };

  const runRestore = async (backup) => {
    setIsRestoring(true);
    try {
      await restoreFromBackup(backup);
      Swal.fire({
        icon: 'success',
        title: 'Data Restored! ✅',
        text: 'Everything has been restored. The app will now reload and you\'ll need to log in again.',
        confirmButtonColor: '#4f46e5',
        confirmButtonText: 'OK, Reload Now'
      }).then(() => {
        clearSession();
        window.location.reload();
      });
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Restore Failed', text: err.message });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreFromDate = async (dateKey) => {
    const backup = await getBackupByDateKey(dateKey);
    if (!backup) {
      Swal.fire({ icon: 'error', title: 'Backup Not Found' });
      return;
    }
    Swal.fire({
      title: `Restore backup from ${dateKey}?`,
      html: `This will <b>replace everything currently in the system</b> — categories, items, orders, and all user accounts — with what's in this backup.<br/><br/><b>This cannot be undone.</b> Consider downloading a backup of today's data first.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Restore & Replace Everything',
      cancelButtonText: 'Cancel'
    }).then((result) => {
      if (result.isConfirmed) runRestore(backup);
    });
  };

  const handleRestoreFromFile = (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    Swal.fire({
      title: 'Restore from this file?',
      html: `This will <b>replace everything currently in the system</b> with the contents of <b>${file.name}</b>.<br/><br/><b>This cannot be undone.</b>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Restore & Replace Everything',
      cancelButtonText: 'Cancel'
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      setIsRestoring(true);
      try {
        const backup = await readBackupFile(file);
        setIsRestoring(false);
        await runRestore(backup);
      } catch (err) {
        setIsRestoring(false);
        console.error(err);
        Swal.fire({ icon: 'error', title: 'Restore Failed', text: err.message });
      }
    });
  };


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
  const [itemCostPrice, setItemCostPrice] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [serviceCharge, setServiceCharge] = useState('10');
  const [editingItemId, setEditingItemId] = useState(null);

  const handleSaveItem = async (e) => {
    e.preventDefault(); if (!itemName.trim() || !itemPrice || !itemCategory) return;
    const data = {
      name: itemName,
      costPrice: parseFloat(itemCostPrice) || 0,
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

    const data = {
      username: adminUsername.trim(),
      password: adminPassword.trim(),
      role: adminRole
    };

    try {
      if (editingAdminId) {
        await db.admins.update(editingAdminId, data);
        Swal.fire({ icon: 'success', title: 'Profile Updated! ✅', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      } else {
        const existing = await db.admins.where('username').equalsIgnoreCase(data.username).first();
        if (existing) {
          Swal.fire({ icon: 'error', title: 'Username Already Exists!', text: 'Use a different username.' });
          return;
        }
        await db.admins.add(data);
        Swal.fire({ icon: 'success', title: 'Account Created! 🎉', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      }

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
            <p className="text-xs text-gray-400">
              POS System Administration and User Management
              {currentUser && <span className="ml-1">· Logged in as <b>{currentUser.username}</b></span>}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={onBackToBilling} className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-xl font-bold text-xs transition">
            ⬅️ Back to Counter
          </button>
          {onLogout && (
            <button onClick={onLogout} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-xl font-bold text-xs transition">
              🚪 Logout
            </button>
          )}
        </div>
      </div>

      {/* Tab Bar Navigation */}
      <div className="flex space-x-2 border-b pb-2 mb-4 shrink-0 overflow-x-auto scrollbar-none">
        <button onClick={() => setActiveSubTab('CATEGORIES')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'CATEGORIES' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>📂 Manage Categories</button>
        <button onClick={() => setActiveSubTab('ITEMS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'ITEMS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🍔 Manage Food Items</button>
        <button onClick={() => setActiveSubTab('REPORTS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'REPORTS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>📊 Premium Reports</button>
        <button onClick={() => setActiveSubTab('PRINTERS')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'PRINTERS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🖨️ Printer Settings</button>
        <button onClick={() => setActiveSubTab('BILL_DESIGN')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'BILL_DESIGN' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🧾 Bill Design</button>
        <button onClick={() => setActiveSubTab('PROFILE')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'PROFILE' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>🧑‍💼 Profile Settings</button>
        <button onClick={() => setActiveSubTab('BACKUP')} className={`px-4 py-2 rounded-xl font-black text-xs whitespace-nowrap ${activeSubTab === 'BACKUP' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-gray-600'}`}>💾 Backup &amp; Restore</button>
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

        {/* REPORTS WORKSPACE — Advanced Report Portal */}
        {activeSubTab === 'REPORTS' && (
          <div className="col-span-12 bg-white p-4 rounded-2xl border h-full flex flex-col overflow-hidden">

            {/* 🖨️ Print-only header (hidden on screen, shown when printing) */}
            <div className="hidden print:block mb-4">
              <h1 className="text-lg font-black">{getBillDesignSettings().storeName || 'Restaurant'}</h1>
              <p className="text-sm font-bold">{currentReportMeta.icon} {currentReportMeta.label} — {dateRangeLabel}</p>
              <p className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</p>
            </div>

            {/* 🗂️ REPORT GROUP + TYPE SELECTOR */}
            <div className="shrink-0 mb-3 print:hidden">
              <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none">
                {REPORT_GROUPS.map(g => (
                  <button
                    key={g.key}
                    onClick={() => handleGroupClick(g.key)}
                    className={`px-3 py-1.5 rounded-lg font-black text-[11px] whitespace-nowrap transition ${activeReportGroup === g.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="flex space-x-2 overflow-x-auto pt-2 scrollbar-none">
                {(REPORT_GROUPS.find(g => g.key === activeReportGroup)?.reports || []).map(r => (
                  <button
                    key={r.key}
                    onClick={() => setReportType(r.key)}
                    className={`px-3 py-2 rounded-xl font-black text-xs whitespace-nowrap transition border ${reportType === r.key ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  >
                    {r.icon} {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 🔍 FILTER BAR */}
            <div className="bg-gray-50 p-3 rounded-xl border mb-3 shrink-0 print:hidden space-y-2">
              {/* Date presets */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] font-black text-gray-400 uppercase mr-1">📅 Range:</span>
                {DATE_PRESETS.map(dp => (
                  <button
                    key={dp.key}
                    onClick={() => setDatePreset(dp.key)}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition ${datePreset === dp.key ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-500 hover:bg-gray-100'}`}
                  >
                    {dp.label}
                  </button>
                ))}
                {datePreset === 'CUSTOM' && (
                  <>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="p-1.5 border rounded-lg font-bold text-[11px]" />
                    <span className="text-gray-400 text-[10px]">to</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="p-1.5 border rounded-lg font-bold text-[11px]" />
                  </>
                )}
              </div>

              {/* Filters + search */}
              <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 text-xs items-end">
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
                <div className="col-span-1 sm:col-span-2">
                  <label className="block font-bold text-gray-400">Payment</label>
                  <select value={selectedPaymentFilter} onChange={(e) => setSelectedPaymentFilter(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold bg-white">
                    <option value="ALL">All Methods</option>
                    <option value="CASH">💵 Cash</option>
                    <option value="CARD">💳 Card</option>
                    <option value="TRANSFER">🏦 Transfer</option>
                  </select>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="block font-bold text-gray-400">Cashier</label>
                  <select value={selectedCashierFilter} onChange={(e) => setSelectedCashierFilter(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold bg-white">
                    <option value="ALL">All Cashiers</option>
                    {uniqueCashiers.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="block font-bold text-gray-400">Table</label>
                  <select value={selectedTableFilter} onChange={(e) => setSelectedTableFilter(e.target.value)} className="w-full p-1.5 border rounded-lg font-bold bg-white">
                    <option value="ALL">All Tables</option>
                    {uniqueTables.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label className="block font-bold text-gray-400">🔎 Search</label>
                  <input
                    type="text"
                    value={reportSearchTerm}
                    onChange={(e) => setReportSearchTerm(e.target.value)}
                    placeholder="Search results..."
                    className="w-full p-1.5 border rounded-lg font-bold bg-white"
                  />
                </div>
                {anyFilterActive && (
                  <div className="col-span-2 sm:col-span-12 flex justify-end">
                    <button onClick={clearAllFilters} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-black text-[10px]">
                      ✕ Clear All Filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 📊 KPI SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3 shrink-0">
              <div className="bg-gray-900 text-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Net Revenue</span>
                <div className="text-base font-black text-emerald-400">Rs.{totalNetSales.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Total Orders</span>
                <div className="text-base font-black text-gray-800">{totalOrdersCount}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border">
                <span className="text-[9px] text-gray-400 uppercase font-black">Items Sold</span>
                <div className="text-base font-black text-gray-800">{totalItemsSold}</div>
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
              <div className="bg-white p-3 border-b font-black text-xs text-indigo-700 uppercase flex justify-between items-center shrink-0 print:hidden">
                <span>{currentReportMeta.icon} {currentReportMeta.label} <span className="text-gray-400 font-bold normal-case ml-1">· {dateRangeLabel}</span></span>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400 font-bold normal-case">{totalOrdersCount} record(s)</span>
                  <button onClick={handleExportCsv} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg font-black text-[10px] transition">
                    ⬇️ CSV
                  </button>
                  <button onClick={() => window.print()} className="bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 px-2.5 py-1 rounded-lg font-black text-[10px] transition">
                    🖨️ Print
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto text-xs bg-white p-2">

                {filteredOrders.length === 0 && (
                  <div className="text-center text-gray-400 font-bold py-12">No data available for the selected filters.</div>
                )}

                {/* SALES SUMMARY (replaces old Daily/Monthly — now driven by date presets above) */}
                {filteredOrders.length > 0 && reportType === 'SUMMARY' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        {sortableTh('Date / Time', 'settledDate')}
                        <th className="p-2">Bill No</th>
                        <th className="p-2">Table</th>
                        <th className="p-2">Cashier</th>
                        <th className="p-2">Payment</th>
                        {sortableTh('Net Total', 'netTotal', 'text-right')}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedInvoiceList.map((o, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2">{o.settledDate ? new Date(o.settledDate).toLocaleString() : '-'}</td>
                          <td className="p-2 text-gray-500">{o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : '-'}</td>
                          <td className="p-2 font-bold">{o.tableNumber || 'Walk-in'}</td>
                          <td className="p-2">{o.cashierName || 'Admin Cashier'}</td>
                          <td className="p-2">{o.paymentMethod || '-'}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{(o.netTotal || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {filteredOrders.length > 0 && reportType === 'PRODUCT' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        {sortableTh('Item', 'name')}
                        {sortableTh('Qty Sold', 'qty', 'text-right')}
                        {sortableTh('Revenue', 'revenue', 'text-right')}
                        <th className="p-2 text-right">% of Sales</th>
                      </tr>
                    </thead>
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

                {filteredOrders.length > 0 && reportType === 'CATEGORY' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        {sortableTh('Category', 'name')}
                        {sortableTh('Revenue', 'revenue', 'text-right')}
                        <th className="p-2 text-right">% of Sales</th>
                      </tr>
                    </thead>
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

                {filteredOrders.length > 0 && reportType === 'BEST_SELLING' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        <th className="p-2">#</th>
                        {sortableTh('Item', 'name')}
                        {sortableTh('Qty Sold', 'qty', 'text-right')}
                        {sortableTh('Revenue', 'revenue', 'text-right')}
                      </tr>
                    </thead>
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

                {filteredOrders.length > 0 && reportType === 'CUSTOMER' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        {sortableTh('Table / Customer', 'name')}
                        {sortableTh('Orders', 'count', 'text-right')}
                        {sortableTh('Revenue', 'revenue', 'text-right')}
                      </tr>
                    </thead>
                    <tbody>
                      {customerSalesList.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">🪑 {c.name}</td>
                          <td className="p-2 text-right">{c.count}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{c.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {filteredOrders.length > 0 && reportType === 'CASHIER' && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        {sortableTh('Cashier', 'name')}
                        {sortableTh('Orders', 'count', 'text-right')}
                        {sortableTh('Revenue', 'revenue', 'text-right')}
                      </tr>
                    </thead>
                    <tbody>
                      {cashierSalesList.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-bold">🧑‍💼 {c.name}</td>
                          <td className="p-2 text-right">{c.count}</td>
                          <td className="p-2 text-right font-bold text-emerald-600">Rs.{c.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

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
                      <thead>
                        <tr className="bg-gray-100">
                          {sortableTh('Item', 'name')}
                          {sortableTh('Qty', 'qty', 'text-right')}
                          {sortableTh('Revenue', 'revenue', 'text-right')}
                        </tr>
                      </thead>
                      <tbody>
                        {productSalesList.map((p, i) => (
                          <tr key={i} className="border-b"><td className="p-2 font-bold">{p.name}</td><td className="p-2 text-right">{p.qty}</td><td className="p-2 text-right font-bold text-emerald-600">Rs.{p.revenue.toFixed(2)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {reportType === 'DISCOUNT' && (
                  discountedOrdersList.length === 0 ? (
                    <div className="text-center text-gray-400 font-bold py-12">No discounted orders found for the selected filters.</div>
                  ) : (
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-gray-100 sticky top-0">
                          {sortableTh('Date', 'settledDate')}
                          <th className="p-2">Table</th>
                          {sortableTh('Discount', 'discountAmount', 'text-right')}
                          {sortableTh('Net Total', 'netTotal', 'text-right')}
                        </tr>
                      </thead>
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

                {filteredOrders.length > 0 && reportType === 'INVOICE' && (
                  <div className="space-y-2">
                    {sortedInvoiceList.map((o, i) => (
                      <div key={i} className="border rounded-lg p-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-black text-gray-700">
                            🧾 {o.tableNumber || 'Walk-in'} {o.dailyOrderNumber != null && <span className="text-indigo-500">· #{o.dailyOrderNumber}</span>}
                            <span className="text-gray-400 font-bold"> · {o.settledDate ? new Date(o.settledDate).toLocaleString() : '-'}</span>
                          </span>
                          <span className="font-black text-emerald-600">Rs.{(o.netTotal || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {(o.items || []).map((it, idx) => (
                            <span key={idx}>{it.name} × {it.quantity}{idx < o.items.length - 1 ? ', ' : ''}</span>
                          ))}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1 flex justify-between">
                          <span>Cashier: {o.cashierName || 'Admin Cashier'} · Payment: {o.paymentMethod || '-'}</span>
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
                    <button
                      onClick={handleLoadPairedUSB}
                      disabled={isLoadingUSB}
                      className="w-full bg-white border border-yellow-400 hover:bg-yellow-100 text-yellow-700 text-[11px] font-black py-2 rounded-lg transition disabled:opacity-50"
                    >
                      {isLoadingUSB ? '⏳ Refreshing...' : '🔄 Refresh USB Devices'}
                    </button>
                    <div className="text-[9px] text-yellow-700 bg-yellow-100 rounded-lg p-1.5 text-center">
                      Chrome / Edge v61+ <br/>USB cable printer directly connect
                    </div>
                  </div>

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

              {/* ── STEP 3: Assign to Roles (this IS your default printer per function) ── */}
              <div>
                <h3 className="text-xs font-black text-gray-400 uppercase mb-2">③ Assign Default Printers (per function)</h3>
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
                <p className="text-[10px] text-gray-400 mt-2">
                  💡 The printer assigned to <b>BILL</b> here is used automatically for Pre-Bill and Final Invoice prints — this is your "default" bill printer. If it stops printing after being unplugged/out of range, tap "Load Paired BT Devices" above to refresh it.
                </p>
              </div>

            </div>
          </div>
        )}

        {/* 🧾 BILL DESIGN WORKSPACE */}
        {activeSubTab === 'BILL_DESIGN' && (
          <>
            {/* Form Column */}
            <div className="md:col-span-7 bg-white p-4 rounded-2xl border h-full overflow-y-auto space-y-5">
              <div>
                <h3 className="text-sm font-black text-gray-700 uppercase">🧾 Bill, KOT &amp; BOT Layout</h3>
                <p className="text-[11px] text-gray-400">Customize everything that prints on the customer bill, kitchen ticket (KOT), and bar ticket (BOT).</p>
              </div>

              {/* Store Info */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-black text-gray-400 uppercase">Store Details</h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Store Name</label>
                  <input type="text" value={billDesignForm.storeName} onChange={(e) => handleBillDesignChange('storeName', e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="SAPSAN RESTAURANT" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-500">Store Address</label>
                  <label className="flex items-center space-x-1 text-[10px] font-bold text-gray-400">
                    <input type="checkbox" checked={billDesignForm.showAddress} onChange={(e) => handleBillDesignChange('showAddress', e.target.checked)} />
                    <span>Show on bill</span>
                  </label>
                </div>
                <input type="text" value={billDesignForm.storeAddress} onChange={(e) => handleBillDesignChange('storeAddress', e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="Matara, Sri Lanka" />

                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-500">Phone Number</label>
                  <label className="flex items-center space-x-1 text-[10px] font-bold text-gray-400">
                    <input type="checkbox" checked={billDesignForm.showPhone} onChange={(e) => handleBillDesignChange('showPhone', e.target.checked)} />
                    <span>Show on bill</span>
                  </label>
                </div>
                <input type="text" value={billDesignForm.storePhone} onChange={(e) => handleBillDesignChange('storePhone', e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="077 123 4567" />

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Footer Message</label>
                  <input type="text" value={billDesignForm.footerMessage} onChange={(e) => handleBillDesignChange('footerMessage', e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs" placeholder="Thank You! Come Again." />
                </div>
              </div>

              {/* Logo */}
              <div className="space-y-2 border-t pt-4">
                <h4 className="text-[11px] font-black text-gray-400 uppercase">Store Logo</h4>
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-1 text-[11px] font-bold text-gray-500">
                    <input type="checkbox" checked={billDesignForm.showLogo} onChange={(e) => handleBillDesignChange('showLogo', e.target.checked)} />
                    <span>Print Logo on Bill</span>
                  </label>
                </div>
                <div className="flex items-center space-x-3">
                  <label className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-[11px] font-black px-3 py-2 rounded-lg cursor-pointer transition">
                    📤 Upload Logo
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                  {billDesignForm.logoBase64 && (
                    <button onClick={handleRemoveLogo} className="text-red-500 text-[11px] font-black hover:underline">✕ Remove Logo</button>
                  )}
                </div>
                {billDesignForm.logoBase64 && (
                  <div className="border rounded-xl p-2 bg-gray-50 inline-block">
                    <img src={billDesignForm.logoBase64} alt="Logo Preview" className="h-16 object-contain" />
                  </div>
                )}
                <p className="text-[10px] text-gray-400">Any logo you upload is automatically fit to a fixed <b>{`full roll width × 1.5 inch`}</b> box (proportional, centered) — so it always prints the same size no matter the source image.</p>
              </div>

              {/* Printer Paper Size & Bill Sizing */}
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-[11px] font-black text-gray-400 uppercase">Print Size</h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Thermal Paper Width</label>
                  <select value={billDesignForm.paperWidth} onChange={(e) => handleBillDesignChange('paperWidth', e.target.value)} className="w-full p-2.5 border rounded-xl font-bold text-xs bg-white">
                    {Object.entries(PAPER_WIDTH_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1">Small Bluetooth 3-inch thermal printers should use <b>80mm (3 inch)</b>.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Minimum Bill Length (inches)</label>
                  <input
                    type="number" min="1" step="0.5"
                    value={billDesignForm.minBillHeightInch}
                    onChange={(e) => handleBillDesignChange('minBillHeightInch', parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 border rounded-xl font-bold text-xs"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">If the bill content is shorter than this, extra paper is fed before the cut so every bill is at least this long (Pre-Bill &amp; Final Invoice only — not KOT/BOT).</p>
                </div>
              </div>

              {/* Order Number */}
              <div className="border-t pt-4">
                <label className="flex items-center space-x-2 text-xs font-bold text-gray-500">
                  <input type="checkbox" checked={billDesignForm.showOrderNumber} onChange={(e) => handleBillDesignChange('showOrderNumber', e.target.checked)} />
                  <span>Print Order No. on Bill / KOT / BOT</span>
                </label>
                <p className="text-[10px] text-gray-400 mt-1 ml-6">Auto-resets to 1 every day — always starts fresh with the first order of the day. Printed HUGE at the top of every ticket so it's easy to spot.</p>
              </div>

              {/* Bill Font Sizes */}
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-[11px] font-black text-gray-400 uppercase">Bill Font Size</h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Store Name</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleBillDesignChange('storeNameFontSize', 'NORMAL')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.storeNameFontSize === 'NORMAL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Normal</button>
                    <button onClick={() => handleBillDesignChange('storeNameFontSize', 'LARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.storeNameFontSize === 'LARGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Large</button>
                    <button onClick={() => handleBillDesignChange('storeNameFontSize', 'XLARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.storeNameFontSize === 'XLARGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Extra Large</button>
                    <button onClick={() => handleBillDesignChange('storeNameFontSize', 'HUGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.storeNameFontSize === 'HUGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Huge</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Bill Body Text (items, totals)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleBillDesignChange('billFontSize', 'NORMAL')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.billFontSize === 'NORMAL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Normal</button>
                    <button onClick={() => handleBillDesignChange('billFontSize', 'LARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.billFontSize === 'LARGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Large</button>
                    <button onClick={() => handleBillDesignChange('billFontSize', 'XLARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.billFontSize === 'XLARGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Extra Large</button>
                    <button onClick={() => handleBillDesignChange('billFontSize', 'HUGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.billFontSize === 'HUGE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500'}`}>Huge</button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1"><b>NET TOTAL</b> always prints bold and one size step bigger than this, automatically.</p>
                </div>
              </div>

              {/* KOT / BOT Settings */}
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-[11px] font-black text-gray-400 uppercase">🔥 KOT &amp; BOT Ticket Layout</h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Font Size</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleBillDesignChange('kotBotFontSize', 'NORMAL')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.kotBotFontSize === 'NORMAL' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500'}`}>Normal</button>
                    <button onClick={() => handleBillDesignChange('kotBotFontSize', 'LARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.kotBotFontSize === 'LARGE' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500'}`}>Large</button>
                    <button onClick={() => handleBillDesignChange('kotBotFontSize', 'XLARGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.kotBotFontSize === 'XLARGE' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500'}`}>Extra Large</button>
                    <button onClick={() => handleBillDesignChange('kotBotFontSize', 'HUGE')} className={`py-2 rounded-lg font-black text-xs border ${billDesignForm.kotBotFontSize === 'HUGE' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500'}`}>Huge</button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">This controls the ticket title and item lines. The Order No. at the top is always printed HUGE regardless of this setting.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center space-x-2 text-[11px] font-bold text-gray-500 bg-gray-50 border rounded-lg p-2">
                    <input type="checkbox" checked={billDesignForm.kotBotShowDate} onChange={(e) => handleBillDesignChange('kotBotShowDate', e.target.checked)} />
                    <span>Show Date</span>
                  </label>
                  <label className="flex items-center space-x-2 text-[11px] font-bold text-gray-500 bg-gray-50 border rounded-lg p-2">
                    <input type="checkbox" checked={billDesignForm.kotBotShowTime} onChange={(e) => handleBillDesignChange('kotBotShowTime', e.target.checked)} />
                    <span>Show Time</span>
                  </label>
                  <label className="flex items-center space-x-2 text-[11px] font-bold text-gray-500 bg-gray-50 border rounded-lg p-2">
                    <input type="checkbox" checked={billDesignForm.kotBotShowTable} onChange={(e) => handleBillDesignChange('kotBotShowTable', e.target.checked)} />
                    <span>Show Table</span>
                  </label>
                  <label className="flex items-center space-x-2 text-[11px] font-bold text-gray-500 bg-gray-50 border rounded-lg p-2">
                    <input type="checkbox" checked={billDesignForm.kotBotShowOrderNumber} onChange={(e) => handleBillDesignChange('kotBotShowOrderNumber', e.target.checked)} />
                    <span>Show Order No.</span>
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 border-t pt-4">
                <button onClick={handleSaveBillDesign} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl font-black text-xs transition">
                  💾 Save Bill Design
                </button>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={handleTestPrint} disabled={isSendingTestPrint} className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white p-2.5 rounded-xl font-black text-[11px] transition">
                    🧾 Test Bill
                  </button>
                  <button onClick={() => handleTestKotBotPrint('kot')} disabled={isSendingTestPrint} className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white p-2.5 rounded-xl font-black text-[11px] transition">
                    🔥 Test KOT
                  </button>
                  <button onClick={() => handleTestKotBotPrint('bot')} disabled={isSendingTestPrint} className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white p-2.5 rounded-xl font-black text-[11px] transition">
                    🍹 Test BOT
                  </button>
                </div>
              </div>
            </div>

            {/* Live Preview Column */}
            <div className="md:col-span-5 bg-gray-100 p-4 rounded-2xl border h-full overflow-y-auto flex flex-col items-center space-y-6">

              {/* Bill Preview */}
              <div className="w-full flex flex-col items-center">
                <h4 className="text-[11px] font-black text-gray-400 uppercase mb-3 self-start">👀 Bill Preview</h4>
                <div
                  className="bg-white shadow-md p-3"
                  style={{ width: previewCharsWidth, fontFamily: 'monospace', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
                >
                  {billDesignForm.showLogo && billDesignForm.logoBase64 && (
                    <div className="mx-auto mb-2 flex items-center justify-center bg-white" style={{ width: '100%', height: '48px' }}>
                      <img src={billDesignForm.logoBase64} alt="logo" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  <div className="text-center font-black leading-tight" style={{ fontSize: previewSizePx(billDesignForm.storeNameFontSize) }}>
                    {billDesignForm.storeName || 'MY RESTAURANT'}
                  </div>
                  {billDesignForm.showAddress && billDesignForm.storeAddress && (
                    <div className="text-center text-[9px] text-gray-600">{billDesignForm.storeAddress}</div>
                  )}
                  {billDesignForm.showPhone && billDesignForm.storePhone && (
                    <div className="text-center text-[9px] text-gray-600">Tel: {billDesignForm.storePhone}</div>
                  )}
                  <div className="text-center text-[9px] font-bold my-1">--- FINAL INVOICE ---</div>
                  {billDesignForm.showOrderNumber && (
                    <div className="text-center font-black my-1" style={{ fontSize: previewSizePx('NORMAL') }}>Order #999</div>
                  )}
                  <div className="text-[9px] border-t border-b border-dashed border-gray-400 py-1 my-1 flex justify-between">
                    <span>Table: Table 1</span>
                  </div>
                  <div className="text-[9px] text-center mb-1">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</div>
                  <div className="text-[9px] space-y-0.5 py-1" style={{ fontSize: previewSizePx(billDesignForm.billFontSize) }}>
                    <div className="flex justify-between"><span>Sample Item 1</span><span></span></div>
                    <div className="flex justify-between text-gray-500"><span>2 x 250</span><span>= Rs.500</span></div>
                    <div className="flex justify-between"><span>Sample Item 2</span><span></span></div>
                    <div className="flex justify-between text-gray-500"><span>1 x 450</span><span>= Rs.450</span></div>
                  </div>
                  <div className="border-t border-dashed border-gray-400 my-1"></div>
                  <div className="text-[9px] space-y-0.5">
                    <div className="flex justify-between"><span>Sub Total:</span><span>Rs.950.00</span></div>
                    <div className="flex justify-between"><span>Service Charge:</span><span>Rs.95.00</span></div>
                    <div
                      className="flex justify-between font-black border-t border-dashed pt-1 mt-1"
                      style={{ fontSize: previewSizePx(bumpPreviewSize(billDesignForm.billFontSize)) }}
                    >
                      <span>NET TOTAL:</span><span>Rs.1045.00</span>
                    </div>
                  </div>
                  <div className="text-center text-[9px] mt-2">{billDesignForm.footerMessage || 'Thank You! Come Again.'}</div>
                  <div className="text-center text-[7px] text-gray-400 mt-2 leading-tight">
                    <div>{DEVELOPER_CREDIT_LINE_1}</div>
                    <div>{DEVELOPER_CREDIT_LINE_2}</div>
                  </div>
                </div>
              </div>

              {/* KOT/BOT Preview */}
              <div className="w-full flex flex-col items-center">
                <h4 className="text-[11px] font-black text-gray-400 uppercase mb-3 self-start">🔥 KOT / BOT Preview</h4>
                <div
                  className="bg-white shadow-md p-3"
                  style={{ width: previewCharsWidth, fontFamily: 'monospace', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
                >
                  {billDesignForm.kotBotShowOrderNumber && (
                    <div className="text-center font-black" style={{ fontSize: previewSizePx('LARGE') }}>Order #999</div>
                  )}
                  <div className="text-center font-black" style={{ fontSize: previewSizePx(billDesignForm.kotBotFontSize) }}>*** KOT (KITCHEN) ***</div>
                  {billDesignForm.kotBotShowTable && <div className="text-[9px] text-center">Table: Table 1</div>}
                  {(billDesignForm.kotBotShowDate || billDesignForm.kotBotShowTime) && (
                    <div className="text-[9px] text-center">
                      {billDesignForm.kotBotShowDate ? `Date: ${new Date().toLocaleDateString()}` : ''}
                      {billDesignForm.kotBotShowDate && billDesignForm.kotBotShowTime ? '  ' : ''}
                      {billDesignForm.kotBotShowTime ? `Time: ${new Date().toLocaleTimeString()}` : ''}
                    </div>
                  )}
                  <div className="border-t border-dashed border-gray-400 my-1"></div>
                  <div className="text-left space-y-0.5" style={{ fontSize: previewSizePx(billDesignForm.kotBotFontSize) }}>
                    <div>2 x Chicken Fried Rice</div>
                    <div>1 x Iced Coffee</div>
                  </div>
                  <div className="border-t border-dashed border-gray-400 my-1"></div>
                </div>
              </div>

              <p className="text-[10px] text-gray-400 text-center px-4">Previews are an approximation — actual thermal print spacing depends on your printer's firmware. Order No. always prints HUGE, no matter the ticket's font size setting.</p>
            </div>
          </>
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

        {/* 💾 BACKUP & RESTORE WORKSPACE */}
        {activeSubTab === 'BACKUP' && (
          <div className="col-span-12 bg-white rounded-2xl border h-full flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              <div>
                <h3 className="text-sm font-black text-gray-700 uppercase">💾 Backup &amp; Restore</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Everything — categories, food items, orders, admin/cashier accounts, printer setup, and bill design — is backed up automatically once a day on this device. You can also save or restore a backup manually at any time.
                </p>
              </div>

              {/* ── Auto Backup Status + Manual Actions ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border rounded-xl p-4 bg-emerald-50 border-emerald-200">
                  <div className="text-[11px] font-black text-emerald-700 uppercase mb-1">✅ Automatic Daily Backup</div>
                  <div className="text-[11px] text-emerald-700">
                    {backupList.length > 0
                      ? <>Last backup: <b>{new Date(backupList[0].createdAt).toLocaleString()}</b></>
                      : 'No backup has run yet — it will run automatically the next time the app is opened.'}
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-1">Keeps a full year (365 days) of daily backups, older ones are removed automatically.</div>
                </div>
                <div className="border rounded-xl p-4 bg-indigo-50 border-indigo-200 flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-black text-indigo-700 uppercase mb-1">Manual Backup</div>
                    <div className="text-[11px] text-indigo-700">Create a backup right now, or download today's data as a file to store off-device.</div>
                  </div>
                  <div className="flex space-x-2 mt-2">
                    <button onClick={handleBackupNow} disabled={isBackingUpNow} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-[11px] font-black py-2 rounded-lg transition">
                      {isBackingUpNow ? '⏳ Saving...' : '📸 Backup Now'}
                    </button>
                    <button onClick={() => handleDownloadBackup(null)} className="flex-1 bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-700 text-[11px] font-black py-2 rounded-lg transition">
                      📥 Download File
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Restore from a file ── */}
              <div className="border rounded-xl p-4 bg-amber-50 border-amber-200">
                <div className="text-[11px] font-black text-amber-700 uppercase mb-1">📤 Restore from a Backup File</div>
                <div className="text-[11px] text-amber-700 mb-2">Upload a previously downloaded <code>.json</code> backup file to restore from it. This replaces everything currently in the system.</div>
                <label className="inline-block bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-black px-4 py-2 rounded-lg cursor-pointer transition">
                  📤 Choose Backup File
                  <input type="file" accept="application/json,.json" onChange={handleRestoreFromFile} disabled={isRestoring} className="hidden" />
                </label>
              </div>

              {/* ── List of daily auto-backups ── */}
              <div>
                <h4 className="text-[11px] font-black text-gray-400 uppercase mb-2">🗓️ Daily Backups on This Device ({backupList.length})</h4>
                {isLoadingBackups ? (
                  <div className="text-center text-gray-400 text-xs font-bold py-8 border rounded-xl bg-gray-50">Loading backups...</div>
                ) : backupList.length === 0 ? (
                  <div className="text-center text-gray-400 text-xs font-bold py-8 border rounded-xl bg-gray-50">
                    No backups yet. Tap "Backup Now" above to create your first one.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {backupList.map((b) => (
                      <div key={b.dateKey} className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2.5">
                        <div>
                          <div className="font-black text-xs text-gray-800">{b.dateKey}</div>
                          <div className="text-[10px] text-gray-400">
                            {b.counts.categories} categories · {b.counts.items} items · {b.counts.orders} orders · {b.counts.admins} accounts
                          </div>
                          <div className="text-[9px] text-gray-300">Saved {new Date(b.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleDownloadBackup(b.dateKey)}
                            title="Download this backup as a file"
                            className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg px-2 py-1.5 text-[11px] font-black transition"
                          >
                            📥
                          </button>
                          <button
                            onClick={() => handleRestoreFromDate(b.dateKey)}
                            disabled={isRestoring}
                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[11px] font-black px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                          >
                            ♻️ Restore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-[10px] text-gray-400">
                ⚠️ Backups live in this browser on this device. Clearing browser data/site data will remove them — download a file copy periodically if you want a copy that survives that.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}