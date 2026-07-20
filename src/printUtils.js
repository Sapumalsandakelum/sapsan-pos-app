// src/printUtils.js
// 🖨️ Shared printing engine: Bluetooth / USB / Serial thermal printer support,
// Bill Design settings (store name, logo, paper size, order number, min height),
// and receipt generators for Bill / KOT / BOT.

import Swal from 'sweetalert2';

// ==========================================
// 🔧 ESC/POS COMMAND CONSTANTS
// ==========================================
export const textToBytes = (text) => {
  const encoder = new TextEncoder();
  return encoder.encode(text + '\n');
};

export const ESC_ALIGN_CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
export const ESC_ALIGN_LEFT = new Uint8Array([0x1B, 0x61, 0x00]);
export const ESC_ALIGN_RIGHT = new Uint8Array([0x1B, 0x61, 0x02]);
export const ESC_FONT_BOLD = new Uint8Array([0x1B, 0x45, 0x01]);
export const ESC_FONT_NORMAL = new Uint8Array([0x1B, 0x45, 0x00]);
export const ESC_FEED_PAPER = new Uint8Array([0x1D, 0x56, 0x42, 0x03]);

// GS ! n — character size. Upper nibble = width magnification, lower nibble = height magnification.
export const ESC_SIZE_NORMAL = new Uint8Array([0x1D, 0x21, 0x00]); // 1x1
export const ESC_SIZE_LARGE = new Uint8Array([0x1D, 0x21, 0x11]);  // 2x2
export const ESC_SIZE_XLARGE = new Uint8Array([0x1D, 0x21, 0x22]); // 3x3
export const ESC_SIZE_HUGE = new Uint8Array([0x1D, 0x21, 0x33]);   // 4x4

// Ordered smallest → biggest, used to "bump" a size up by N steps (e.g. NET TOTAL / Order No.)
const SIZE_SEQUENCE = ['NORMAL', 'LARGE', 'XLARGE', 'HUGE'];
const SIZE_BYTES = { NORMAL: ESC_SIZE_NORMAL, LARGE: ESC_SIZE_LARGE, XLARGE: ESC_SIZE_XLARGE, HUGE: ESC_SIZE_HUGE };
export const sizeBytesFor = (tier) => SIZE_BYTES[tier] || ESC_SIZE_NORMAL;
// Approximate printed line heights in mm per size tier — used only to estimate total
// bill length so we know how much extra paper to feed to hit the minimum bill height.
const LINE_HEIGHT_MM = { NORMAL: 3.75, LARGE: 7.5, XLARGE: 11.25, HUGE: 15 };

// Returns the size tier N steps up (capped at HUGE) — used so NET TOTAL / Order No.
// always look bigger than the body text no matter which size the body is set to.
const bumpSizeKey = (sizeKey, steps = 1) => {
  const idx = Math.min(SIZE_SEQUENCE.indexOf(sizeKey) + steps, SIZE_SEQUENCE.length - 1);
  return SIZE_SEQUENCE[idx] || 'NORMAL';
};

// ESC J n — print and feed paper n dots (used to pad bills to a minimum length)
export const escFeedDots = (dots) => {
  const commands = [];
  let remaining = Math.max(0, Math.round(dots));
  while (remaining > 0) {
    const n = Math.min(remaining, 255);
    commands.push(new Uint8Array([0x1B, 0x4A, n]));
    remaining -= n;
  }
  return commands;
};

const BT_SERVICE_UUIDS = ['000018f0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb'];

// Fixed technical constants — not user-editable by design
export const PRINTER_DPI = 203;       // standard resolution for the vast majority of thermal printers
export const LOGO_HEIGHT_INCH = 1.5;  // fixed logo box height, per spec
export const DEVELOPER_CREDIT_LINE_1 = 'SapSan Technologies';
export const DEVELOPER_CREDIT_LINE_2 = '0779040332';

// ==========================================
// 🔢 DAILY ORDER NUMBER (resets to 1 every new day)
// ==========================================
const DAILY_ORDER_COUNTER_KEY = 'pos_daily_order_counter';

const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Call this exactly ONCE per NEW order (not on re-save/update) to assign it a permanent
// order number for the day. The very first order of each day starts back at 1.
export const getNextDailyOrderNumber = (sessionDateKey) => {
  const dayKey = sessionDateKey || getTodayDateString();
  let counter = { date: dayKey, lastNumber: 0 };
  try {
    const saved = localStorage.getItem(DAILY_ORDER_COUNTER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.date === dayKey) counter = parsed; // same business day — keep counting up
      // different business day — counter above already starts fresh at 0
    }
  } catch (e) {
    console.error('Failed to read daily order counter, restarting from 1', e);
  }
  counter.lastNumber += 1;
  localStorage.setItem(DAILY_ORDER_COUNTER_KEY, JSON.stringify(counter));
  return counter.lastNumber;
};

// ==========================================
// 🧾 BILL DESIGN SETTINGS (localStorage-backed)
// ==========================================
const BILL_DESIGN_KEY = 'pos_bill_design_settings';

export const DEFAULT_BILL_DESIGN = {
  // Store branding
  storeName: 'SAPSAN RESTAURANT',
  storeAddress: 'Matara, Sri Lanka',
  storePhone: '',
  footerMessage: 'Thank You! Come Again.',
  showAddress: true,
  showPhone: false,

  // Logo
  logoBase64: '',
  showLogo: true,

  // Paper & sizing
  paperWidth: '80mm',       // '58mm' | '80mm'
  minBillHeightInch: 6,     // minimum printed length for Pre-Bill / Final Invoice only
  printEngine: 'THERMAL',   // 'THERMAL' (Raw ESC/POS WebUSB/BT/Serial) | 'WINDOWS_DRIVER' (Browser/System Print Dialog)

  // Bill (customer receipt) settings
  showOrderNumber: true,        // daily-resetting sequential order number, printed big at the top
  storeNameFontSize: 'LARGE',   // NORMAL | LARGE | XLARGE | HUGE
  billFontSize: 'NORMAL',       // NORMAL | LARGE | XLARGE | HUGE — overall body text size

  // KOT / BOT (kitchen & bar ticket) settings
  kotBotFontSize: 'NORMAL',     // NORMAL | LARGE | XLARGE | HUGE
  kotBotShowDate: true,
  kotBotShowTime: true,
  kotBotShowTable: true,
  kotBotShowOrderNumber: true,
};

export const PAPER_WIDTH_CONFIG = {
  '58mm': { rasterPx: 384, charsPerLine: 32, label: '58mm (2 inch)' },
  '80mm': { rasterPx: 576, charsPerLine: 48, label: '80mm (3 inch)' },
};

export const getBillDesignSettings = () => {
  try {
    const saved = localStorage.getItem(BILL_DESIGN_KEY);
    return saved ? { ...DEFAULT_BILL_DESIGN, ...JSON.parse(saved) } : { ...DEFAULT_BILL_DESIGN };
  } catch (e) {
    console.error('Failed to read bill design settings', e);
    return { ...DEFAULT_BILL_DESIGN };
  }
};

export const saveBillDesignSettings = (settings) => {
  localStorage.setItem(BILL_DESIGN_KEY, JSON.stringify(settings));
};

// ==========================================
// 🖼️ LOGO IMAGE → ESC/POS RASTER BITMAP (GS v 0)
// ==========================================
// Renders the logo into a FIXED-SIZE box (targetWidthPx x targetHeightPx), fitting
// it inside (contain — preserves aspect ratio, centered, padded with white) so any
// logo you upload always prints at the same, predictable size.
export const imageToRasterBytes = (base64DataUrl, targetWidthPx, targetHeightPx) => {
  return new Promise((resolve, reject) => {
    if (!base64DataUrl) { resolve([]); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidthPx;
        canvas.height = targetHeightPx;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);

        // Contain-fit: scale to fit inside the box without cropping or stretching
        const scale = Math.min(targetWidthPx / img.width, targetHeightPx / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const offsetX = (targetWidthPx - drawWidth) / 2;
        const offsetY = (targetHeightPx - drawHeight) / 2;
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        const { data } = ctx.getImageData(0, 0, targetWidthPx, targetHeightPx);
        const widthBytes = Math.ceil(targetWidthPx / 8);
        const bitmap = new Uint8Array(widthBytes * targetHeightPx);

        for (let y = 0; y < targetHeightPx; y++) {
          for (let x = 0; x < targetWidthPx; x++) {
            const idx = (y * targetWidthPx + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
            const gray = a === 0 ? 255 : (r * 0.3 + g * 0.59 + b * 0.11);
            if (gray < 150) {
              const byteIndex = y * widthBytes + (x >> 3);
              bitmap[byteIndex] |= (0x80 >> (x % 8));
            }
          }
        }

        const xL = widthBytes & 0xFF;
        const xH = (widthBytes >> 8) & 0xFF;
        const yL = targetHeightPx & 0xFF;
        const yH = (targetHeightPx >> 8) & 0xFF;

        const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
        const fullCommand = new Uint8Array(header.length + bitmap.length);
        fullCommand.set(header, 0);
        fullCommand.set(bitmap, header.length);

        resolve([fullCommand]);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load logo image for printing'));
    img.src = base64DataUrl;
  });
};

// ==========================================
// 🔌 LOW-LEVEL PRINTER TRANSPORTS
// ==========================================

// 🔵 Bluetooth — reconnects to an already-authorized device via getDevices() instead
// of calling requestDevice() again on every print (which needs a fresh user gesture
// that's usually already expired by print time, causing silent failures).
const printViaBluetoothDevice = async (storedDevice, targetRole, receiptDataArray) => {
  try {
    let device = null;
    if (navigator.bluetooth.getDevices) {
      const grantedDevices = await navigator.bluetooth.getDevices();
      device = grantedDevices.find(d => d.id === storedDevice.id);
    }
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: storedDevice.name }],
        optionalServices: BT_SERVICE_UUIDS
      });
    }

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    if (services.length === 0) throw new Error('No Bluetooth Services found');

    const characteristics = await services[0].getCharacteristics();
    const writeCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!writeCharacteristic) throw new Error('No Write Characteristic found');

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
      text: 'Could not reconnect to the Bluetooth printer. Go to Admin → Printer Settings and tap "Load Paired BT Devices" again, then re-assign it to this role.',
      toast: true, position: 'top-end', showConfirmButton: false, timer: 4000
    });
    return false;
  }
};

// 🟡 WebUSB (cable, USB port)
const printViaWebUSB = async (deviceInfo, targetRole, receiptDataArray) => {
  if (!navigator.usb) {
    Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Print Failed!`, text: 'WebUSB not supported. Use Chrome / Edge (Desktop).', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
    return false;
  }
  let usbDevice = null;
  try {
    const granted = await navigator.usb.getDevices();
    usbDevice = granted.find(d => d.vendorId === deviceInfo.vendorId && d.productId === deviceInfo.productId);
    if (!usbDevice) {
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Printer Not Found!`, text: 'Go to Admin Panel → Printer Settings and reconnect the USB printer.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
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
    Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} USB Print Failed!`, text: 'Check the printer cable connection and ensure it is powered on.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
    return false;
  }
};

// 🟢 Serial/COM Port Printer
const printViaSerialPort = async (deviceInfo, targetRole, receiptDataArray) => {
  if (!navigator.serial) {
    Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} Serial Print Failed!`, text: 'Web Serial not supported. Use Chrome / Edge v89+.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
    return false;
  }
  let port = null;
  try {
    const ports = await navigator.serial.getPorts();
    port = ports.find(p => {
      const info = p.getInfo ? p.getInfo() : {};
      return String(info.usbVendorId) === String(deviceInfo.vendorId) || ports.length === 1;
    }) || ports[0];
    if (!port) {
      Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} COM Printer Not Found!`, text: 'Go to Admin Panel → Printer Settings and reconnect the Serial printer.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
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
    Swal.fire({ icon: 'error', title: `${targetRole.toUpperCase()} Serial Print Failed!`, text: 'Check the COM port printer cable connection.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3500 });
    return false;
  }
};

// ==========================================
// 🖨️ WINDOWS DRIVER PRINT MODE (window.print())
// ==========================================
export const printViaWindowsDriver = async (htmlContent) => {
  try {
    let container = document.getElementById('pos-printable-receipt');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pos-printable-receipt';
      document.body.appendChild(container);
    }
    container.innerHTML = htmlContent;

    // ⚡ Silent Print in Electron App (No print dialog / no asking user to print!)
    if (window.require) {
      try {
        const electron = window.require('electron');
        if (electron && electron.ipcRenderer) {
          const res = await electron.ipcRenderer.invoke('print-silent');
          setTimeout(() => { if (container) container.innerHTML = ''; }, 500);
          if (res && res.success) return true;
        }
      } catch (e) {
        console.warn('Electron silent print invocation failed, falling back to browser print:', e);
      }
    }

    // Fallback for browser outside Electron
    window.print();
    setTimeout(() => { if (container) container.innerHTML = ''; }, 1000);
    return true;
  } catch (err) {
    console.error('Windows Driver print failed:', err);
    return false;
  }
};

// 🎯 ROUTER — routes to Direct Thermal or Windows Driver Mode based on settings & fallback.
export const printViaBluetooth = async (targetRole, receiptDataArray, htmlContent = null) => {
  const settings = getBillDesignSettings();

  // 1️⃣ Windows Driver Print Mode selected in Settings
  if (settings.printEngine === 'WINDOWS_DRIVER') {
    if (htmlContent) {
      return printViaWindowsDriver(htmlContent);
    }
  }

  const mappingSaved = localStorage.getItem('pos_printer_mapping');
  const devicesSaved = localStorage.getItem('pos_paired_bluetooth_devices');
  
  if (!mappingSaved) {
    if (htmlContent) return printViaWindowsDriver(htmlContent);
    return false;
  }

  const mapping = JSON.parse(mappingSaved);
  const deviceId = mapping[targetRole];
  if (!deviceId) {
    if (htmlContent) return printViaWindowsDriver(htmlContent);
    console.log(`⚠️ No default printer assigned for role: ${targetRole.toUpperCase()}`);
    return false;
  }

  const allDevices = devicesSaved ? JSON.parse(devicesSaved) : [];
  const device = allDevices.find(d => d.id === deviceId);
  if (!device) {
    if (htmlContent) return printViaWindowsDriver(htmlContent);
    console.log(`⚠️ Device not found in paired list: ${deviceId}`);
    return false;
  }

  if (device.type === 'USB') return await printViaWebUSB(device, targetRole, receiptDataArray);
  if (device.type === 'SERIAL') return await printViaSerialPort(device, targetRole, receiptDataArray);
  return await printViaBluetoothDevice(device, targetRole, receiptDataArray); // BLUETOOTH
};

// ==========================================
// 🔥 RECEIPT FORMAT GENERATORS
// ==========================================

// KOT / BOT — kitchen & bar tickets. orderNumber is the daily-resetting sequential
// number (from getNextDailyOrderNumber()), printed big & bold near the top.
export const generateKitchenReceipt = (isTakeaway, tableName, typeLabel, itemsList, orderNumber) => {
  const settings = getBillDesignSettings();
  const { charsPerLine } = PAPER_WIDTH_CONFIG[settings.paperWidth] || PAPER_WIDTH_CONFIG['80mm'];
  const bodySizeKey = settings.kotBotFontSize || 'NORMAL';
  const bodySize = SIZE_BYTES[bodySizeKey] || ESC_SIZE_NORMAL;

  const data = [];
  data.push(ESC_ALIGN_CENTER);

  // Order Number — the very first thing printed, HUGE & bold, so kitchen/bar staff
  // can spot and call it out instantly. Always HUGE regardless of kotBotFontSize.
  if (settings.kotBotShowOrderNumber && orderNumber !== undefined && orderNumber !== null) {
    data.push(ESC_FONT_BOLD);
    data.push(ESC_SIZE_HUGE);
    data.push(textToBytes(`Order #${orderNumber}`));
    data.push(ESC_SIZE_NORMAL);
    data.push(ESC_FONT_NORMAL);
  }

  data.push(ESC_FONT_BOLD);
  data.push(bodySize);
  data.push(textToBytes(`*** ${typeLabel} ***`));
  data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);

  if (settings.kotBotShowTable) {
    data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName}`));
  }

  const now = new Date();
  if (settings.kotBotShowDate && settings.kotBotShowTime) {
    data.push(textToBytes(`Date: ${now.toLocaleDateString()}  Time: ${now.toLocaleTimeString()}`));
  } else if (settings.kotBotShowDate) {
    data.push(textToBytes(`Date: ${now.toLocaleDateString()}`));
  } else if (settings.kotBotShowTime) {
    data.push(textToBytes(`Time: ${now.toLocaleTimeString()}`));
  }

  data.push(textToBytes('-'.repeat(charsPerLine)));
  data.push(ESC_ALIGN_LEFT);
  data.push(bodySize);

  itemsList.forEach(item => {
    data.push(textToBytes(`${item.quantity} x ${item.name}`));
  });

  data.push(ESC_SIZE_NORMAL);
  data.push(textToBytes('-'.repeat(charsPerLine)));
  return data;
};

// Cancellation ticket — sent to the kitchen/bar printer when a saved item is removed
// from an order *after* its KOT/BOT was already sent, so kitchen/bar staff know to
// stop preparing (or discard) it. Same order number as the original KOT/BOT.
export const generateCancellationReceipt = (isTakeaway, tableName, item, orderNumber) => {
  const settings = getBillDesignSettings();
  const { charsPerLine } = PAPER_WIDTH_CONFIG[settings.paperWidth] || PAPER_WIDTH_CONFIG['80mm'];
  const bodySizeKey = settings.kotBotFontSize || 'NORMAL';
  const bodySize = SIZE_BYTES[bodySizeKey] || ESC_SIZE_NORMAL;

  const data = [];
  data.push(ESC_ALIGN_CENTER);

  // Order Number — same treatment as the original KOT/BOT: HUGE, first thing printed
  if (settings.kotBotShowOrderNumber && orderNumber !== undefined && orderNumber !== null) {
    data.push(ESC_FONT_BOLD);
    data.push(ESC_SIZE_HUGE);
    data.push(textToBytes(`Order #${orderNumber}`));
    data.push(ESC_SIZE_NORMAL);
    data.push(ESC_FONT_NORMAL);
  }

  data.push(ESC_FONT_BOLD);
  data.push(ESC_SIZE_LARGE);
  data.push(textToBytes('*** ITEM CANCELLED ***'));
  data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);

  if (settings.kotBotShowTable) {
    data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName}`));
  }

  const now = new Date();
  if (settings.kotBotShowDate && settings.kotBotShowTime) {
    data.push(textToBytes(`Date: ${now.toLocaleDateString()}  Time: ${now.toLocaleTimeString()}`));
  } else if (settings.kotBotShowDate) {
    data.push(textToBytes(`Date: ${now.toLocaleDateString()}`));
  } else if (settings.kotBotShowTime) {
    data.push(textToBytes(`Time: ${now.toLocaleTimeString()}`));
  }

  data.push(textToBytes('-'.repeat(charsPerLine)));
  data.push(ESC_ALIGN_LEFT);
  data.push(ESC_FONT_BOLD);
  data.push(bodySize);
  data.push(textToBytes(`${item.quantity} x ${item.name}`));
  data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);
  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes('>> STOP / DISCARD <<'));
  data.push(textToBytes('-'.repeat(charsPerLine)));
  return data;
};

// Bill / Pre-Bill / Final Invoice — fully customizable via Bill Design settings.
// orderNumber is the daily-resetting sequential number (from getNextDailyOrderNumber()),
// printed big & bold near the top; omit/null to hide it even if showOrderNumber is on.
export const generateBillReceipt = async (isTakeaway, tableName, billTitle, sub, sc, disc, net, itemsList, orderNumber, advancePaid = 0) => {
  const settings = getBillDesignSettings();
  const { rasterPx, charsPerLine } = PAPER_WIDTH_CONFIG[settings.paperWidth] || PAPER_WIDTH_CONFIG['80mm'];

  const bodySizeKey = settings.billFontSize || 'NORMAL';
  const bodySize = SIZE_BYTES[bodySizeKey] || ESC_SIZE_NORMAL;
  const bodyLineMm = LINE_HEIGHT_MM[bodySizeKey] || LINE_HEIGHT_MM.NORMAL;

  // NET TOTAL is always one size step bigger than body text, and always bold
  const netTotalSizeKey = bumpSizeKey(bodySizeKey, 1);
  const netTotalSize = SIZE_BYTES[netTotalSizeKey];
  const netTotalLineMm = LINE_HEIGHT_MM[netTotalSizeKey];

  let heightMm = 0;
  const data = [];
  data.push(ESC_ALIGN_CENTER);
  data.push(bodySize);

  // Logo — fixed size box: width = full paper roll width, height = 1.5 inch (any logo fits inside)
  if (settings.showLogo && settings.logoBase64) {
    try {
      const logoHeightPx = Math.round(LOGO_HEIGHT_INCH * PRINTER_DPI);
      const logoBytes = await imageToRasterBytes(settings.logoBase64, rasterPx, logoHeightPx);
      if (logoBytes.length > 0) {
        data.push(ESC_SIZE_NORMAL); // raster block is unaffected by char-size mode; keep clean
        data.push(...logoBytes);
        data.push(bodySize);
        heightMm += LOGO_HEIGHT_INCH * 25.4;
      }
    } catch (err) {
      console.error('Logo raster conversion failed, skipping logo on this print:', err);
    }
  }

  // Store name
  data.push(ESC_FONT_BOLD);
  const nameSizeKey = settings.storeNameFontSize || 'LARGE';
  const nameSize = SIZE_BYTES[nameSizeKey] || ESC_SIZE_LARGE;
  data.push(nameSize);
  data.push(textToBytes(settings.storeName || 'MY RESTAURANT'));
  heightMm += LINE_HEIGHT_MM[nameSizeKey] || LINE_HEIGHT_MM.LARGE;
  data.push(bodySize);
  data.push(ESC_FONT_NORMAL);

  if (settings.showAddress && settings.storeAddress) {
    data.push(textToBytes(settings.storeAddress));
    heightMm += bodyLineMm;
  }
  if (settings.showPhone && settings.storePhone) {
    data.push(textToBytes(`Tel: ${settings.storePhone}`));
    heightMm += bodyLineMm;
  }

  data.push(textToBytes(`--- ${billTitle} ---`));
  heightMm += bodyLineMm;

  // Order Number — always printed HUGE & bold, right at the top of the bill
  if (settings.showOrderNumber && orderNumber !== undefined && orderNumber !== null) {
    data.push(ESC_FONT_BOLD);
    data.push(ESC_SIZE_HUGE);
    data.push(textToBytes(`Order #${orderNumber}`));
    heightMm += LINE_HEIGHT_MM.HUGE;
    data.push(bodySize);
    data.push(ESC_FONT_NORMAL);
  }

  data.push(textToBytes('-'.repeat(charsPerLine)));
  heightMm += bodyLineMm;

  data.push(ESC_ALIGN_LEFT);
  data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName}`));
  heightMm += bodyLineMm;

  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes('-'.repeat(charsPerLine)));
  heightMm += bodyLineMm;

  const now = new Date();
  data.push(textToBytes(`${now.toLocaleDateString()} ${now.toLocaleTimeString()}`));
  heightMm += bodyLineMm;

  data.push(ESC_ALIGN_LEFT);
  itemsList.forEach(item => {
    const lineTotal = (item.sellingPrice * item.quantity).toFixed(0);
    data.push(textToBytes(`${item.name}`));
    heightMm += bodyLineMm;
    data.push(ESC_ALIGN_RIGHT);
    data.push(textToBytes(`${item.quantity} x ${item.sellingPrice} = Rs.${lineTotal}`));
    heightMm += bodyLineMm;
    data.push(ESC_ALIGN_LEFT);
  });

  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes('-'.repeat(charsPerLine)));
  heightMm += bodyLineMm;

  data.push(ESC_ALIGN_RIGHT);
  data.push(textToBytes(`Sub Total: Rs.${sub.toFixed(2)}`));
  heightMm += bodyLineMm;
  data.push(textToBytes(`Service Charge: Rs.${sc.toFixed(2)}`));
  heightMm += bodyLineMm;
  if (disc > 0) {
    data.push(textToBytes(`Discount: -Rs.${disc.toFixed(2)}`));
    heightMm += bodyLineMm;
  }
  if (advancePaid > 0) {
    data.push(textToBytes(`Advance Deposit: -Rs.${advancePaid.toFixed(2)}`));
    heightMm += bodyLineMm;
  }

  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes('-'.repeat(charsPerLine)));
  heightMm += bodyLineMm;

  // NET TOTAL — bold + visibly larger than the rest of the bill
  data.push(ESC_FONT_BOLD);
  data.push(netTotalSize);
  data.push(textToBytes(`NET TOTAL: Rs.${net.toFixed(2)}`));
  heightMm += netTotalLineMm;
  data.push(bodySize);
  data.push(ESC_FONT_NORMAL);

  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes(settings.footerMessage || 'Thank You! Come Again.'));
  heightMm += bodyLineMm;

  // Small fixed developer credit line (always included, smallest size)
  data.push(ESC_SIZE_NORMAL);
  data.push(textToBytes(DEVELOPER_CREDIT_LINE_1));
  data.push(textToBytes(DEVELOPER_CREDIT_LINE_2));
  heightMm += LINE_HEIGHT_MM.NORMAL * 2;

  // based on typical line heights per font size — close enough in practice.
  const minHeightMm = (settings.minBillHeightInch || 6) * 25.4;
  if (heightMm < minHeightMm) {
    const remainingMm = minHeightMm - heightMm;
    const remainingDots = remainingMm * (PRINTER_DPI / 25.4);
    data.push(...escFeedDots(remainingDots));
  }

  return data;
};

// Day End Report — thermal receipt version. Condensed to fit narrow paper
// (58/80mm), following the same styling conventions as the bill/KOT/BOT
// receipts (store branding, paper-width-aware line width, etc).
export const generateDayEndReceipt = (reportData) => {
  const {
    daySession, totalNetSales, totalDiscounts, totalServiceCharge, totalItemsSold,
    totalOrders, paymentMap, cashierList, topProducts,
    cashExpected, cashCounted, cashVariance,
    deletedItemsCount, deletedBillsCount, isClosed,
  } = reportData;

  const settings = getBillDesignSettings();
  const { charsPerLine } = PAPER_WIDTH_CONFIG[settings.paperWidth] || PAPER_WIDTH_CONFIG['80mm'];
  const sep = '-'.repeat(charsPerLine);

  const data = [];
  data.push(ESC_ALIGN_CENTER);

  // Store name
  data.push(ESC_FONT_BOLD);
  data.push(ESC_SIZE_LARGE);
  data.push(textToBytes(settings.storeName || 'MY RESTAURANT'));
  data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);

  data.push(ESC_FONT_BOLD);
  data.push(textToBytes('*** DAY END REPORT ***'));
  data.push(ESC_FONT_NORMAL);

  const now = new Date();
  data.push(textToBytes(`${now.toLocaleDateString()}  ${now.toLocaleTimeString()}`));
  data.push(textToBytes(sep));

  data.push(ESC_ALIGN_LEFT);
  if (daySession) {
    data.push(textToBytes(`Business Date: ${daySession.dateKey}`));
    data.push(textToBytes(`Started: ${new Date(daySession.startedAt).toLocaleString()} by ${daySession.startedBy}`));
    if (isClosed && daySession.endedAt) {
      data.push(textToBytes(`Closed: ${new Date(daySession.endedAt).toLocaleString()} by ${daySession.endedBy}`));
    }
  }
  data.push(textToBytes(sep));

  // KPIs
  data.push(ESC_FONT_BOLD);
  data.push(textToBytes(`Total Orders: ${totalOrders}`));
  data.push(textToBytes(`Items Sold: ${totalItemsSold}`));
  data.push(ESC_FONT_NORMAL);
  data.push(textToBytes(`Service Charge: Rs.${totalServiceCharge.toFixed(2)}`));
  data.push(textToBytes(`Discounts: Rs.${totalDiscounts.toFixed(2)}`));
  data.push(textToBytes(sep));

  // Payment breakdown
  data.push(ESC_FONT_BOLD);
  data.push(textToBytes('PAYMENT METHODS'));
  data.push(ESC_FONT_NORMAL);
  data.push(textToBytes(`Cash:     Rs.${paymentMap.CASH.toFixed(2)}`));
  data.push(textToBytes(`Card:     Rs.${paymentMap.CARD.toFixed(2)}`));
  data.push(textToBytes(`Transfer: Rs.${paymentMap.TRANSFER.toFixed(2)}`));
  data.push(textToBytes(sep));

  // Cash reconciliation
  if (cashCounted != null) {
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes('CASH RECONCILIATION'));
    data.push(ESC_FONT_NORMAL);
    data.push(textToBytes(`Expected: Rs.${cashExpected.toFixed(2)}`));
    data.push(textToBytes(`Counted:  Rs.${cashCounted.toFixed(2)}`));
    const varLabel = cashVariance === 0 ? 'MATCH' : cashVariance > 0 ? `OVER Rs.${cashVariance.toFixed(2)}` : `SHORT Rs.${Math.abs(cashVariance).toFixed(2)}`;
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes(`Variance: ${varLabel}`));
    data.push(ESC_FONT_NORMAL);
    data.push(textToBytes(sep));
  }

  // Sales by cashier
  if (cashierList && cashierList.length > 0) {
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes('SALES BY CASHIER'));
    data.push(ESC_FONT_NORMAL);
    cashierList.forEach(c => {
      data.push(textToBytes(`${c.name}`));
      data.push(ESC_ALIGN_RIGHT);
      data.push(textToBytes(`Rs.${c.revenue.toFixed(2)}`));
      data.push(ESC_ALIGN_LEFT);
    });
    data.push(textToBytes(sep));
  }

  // Top 5 sellers (condensed — full top 10 available on screen)
  if (topProducts && topProducts.length > 0) {
    data.push(ESC_FONT_BOLD);
    data.push(textToBytes('TOP SELLERS'));
    data.push(ESC_FONT_NORMAL);
    topProducts.slice(0, 5).forEach((p, i) => {
      data.push(textToBytes(`${i + 1}. ${p.name} x${p.qty}`));
    });
    data.push(textToBytes(sep));
  }

  // Deleted/voided
  if (deletedItemsCount > 0 || deletedBillsCount > 0) {
    data.push(textToBytes(`Deleted Items: ${deletedItemsCount}`));
    data.push(textToBytes(`Voided Bills: ${deletedBillsCount}`));
    data.push(textToBytes(sep));
  }

  // Net total — bold + large, same treatment as the bill
  data.push(ESC_ALIGN_CENTER);
  data.push(ESC_FONT_BOLD);
  data.push(ESC_SIZE_LARGE);
  data.push(textToBytes(`NET SALES: Rs.${totalNetSales.toFixed(2)}`));
  data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);

  data.push(textToBytes(sep));
  data.push(ESC_SIZE_NORMAL);
  data.push(textToBytes(DEVELOPER_CREDIT_LINE_1));
  data.push(textToBytes(DEVELOPER_CREDIT_LINE_2));

  return data;
};

// ==========================================
// 🌐 HTML RECEIPT GENERATORS MATCHING BILL DESIGN TAB PREVIEW
// ==========================================
export const generateBillReceiptHtml = (isTakeaway, tableName, billTitle, sub, sc, disc, net, itemsList, orderNumber, advancePaid = 0) => {
  const settings = getBillDesignSettings();
  const widthPx = settings.paperWidth === '58mm' ? '230px' : '300px';

  const PREVIEW_SIZE_PX = { NORMAL: '11px', LARGE: '14px', XLARGE: '17px', HUGE: '22px' };
  const previewSizePx = (tier) => PREVIEW_SIZE_PX[tier] || PREVIEW_SIZE_PX.NORMAL;
  const PREVIEW_SIZE_SEQUENCE = ['NORMAL', 'LARGE', 'XLARGE', 'HUGE'];
  const bumpPreviewSize = (tier) => {
    const idx = Math.min(PREVIEW_SIZE_SEQUENCE.indexOf(tier) + 1, PREVIEW_SIZE_SEQUENCE.length - 1);
    return PREVIEW_SIZE_SEQUENCE[idx] || 'NORMAL';
  };

  const storeNameFont = previewSizePx(settings.storeNameFontSize);
  const bodyFont = previewSizePx(settings.billFontSize);
  const netTotalFont = previewSizePx(bumpPreviewSize(settings.billFontSize));
  const now = new Date();
  const grossTotal = sub + sc;

  let html = `<div style="width: ${widthPx}; font-family: monospace; font-size: ${bodyFont}; color: #000; margin: 0 auto; background: #fff; padding: 12px; box-sizing: border-box; line-height: 1.3;">`;

  if (settings.showLogo && settings.logoBase64) {
    html += `<div style="margin: 0 auto 8px auto; display: flex; align-items: center; justify-content: center; width: 100%; height: 48px;"><img src="${settings.logoBase64}" alt="logo" style="max-width: 100%; max-height: 100%; object-fit: contain;" /></div>`;
  }

  html += `<div style="text-align: center; font-weight: 900; line-height: 1.2; font-size: ${storeNameFont};">${settings.storeName || 'MY RESTAURANT'}</div>`;

  if (settings.showAddress && settings.storeAddress) {
    html += `<div style="text-align: center; font-size: 10px; color: #4b5563;">${settings.storeAddress}</div>`;
  }
  if (settings.showPhone && settings.storePhone) {
    html += `<div style="text-align: center; font-size: 10px; color: #4b5563;">Tel: ${settings.storePhone}</div>`;
  }

  html += `<div style="text-align: center; font-size: 10px; font-weight: bold; margin: 4px 0;">--- ${billTitle} ---</div>`;

  if (settings.showOrderNumber && orderNumber !== undefined && orderNumber !== null) {
    html += `<div style="text-align: center; font-weight: 900; font-size: ${previewSizePx('HUGE')}; margin: 4px 0;">Order #${orderNumber}</div>`;
  }

  html += `<div style="font-size: 10px; border-top: 1px dashed #9ca3af; border-bottom: 1px dashed #9ca3af; padding: 4px 0; margin: 4px 0; display: flex; justify-content: space-between;"><span>${isTakeaway ? 'Type' : 'Table'}: ${tableName}</span></div>`;
  html += `<div style="font-size: 10px; text-align: center; margin-bottom: 4px;">${now.toLocaleDateString()} ${now.toLocaleTimeString()}</div>`;

  html += `<div style="font-size: ${bodyFont}; padding: 4px 0;">`;
  itemsList.forEach(item => {
    const total = (item.sellingPrice * item.quantity).toFixed(0);
    html += `<div style="display: flex; justify-content: space-between; font-weight: bold;"><span>${item.name}</span><span></span></div>`;
    html += `<div style="display: flex; justify-content: space-between; color: #6b7280; font-size: 10px; margin-bottom: 2px;"><span>${item.quantity} x ${item.sellingPrice}</span><span>= Rs.${total}</span></div>`;
  });
  html += `</div>`;

  html += `<div style="border-top: 1px dashed #9ca3af; margin: 4px 0;"></div>`;

  html += `<div style="font-size: 10px;">`;
  html += `<div style="display: flex; justify-content: space-between;"><span>Sub Total:</span><span>Rs.${sub.toFixed(2)}</span></div>`;
  html += `<div style="display: flex; justify-content: space-between;"><span>Service Charge:</span><span>Rs.${sc.toFixed(2)}</span></div>`;
  html += `<div style="display: flex; justify-content: space-between; font-weight: bold;"><span>Gross Total:</span><span>Rs.${grossTotal.toFixed(2)}</span></div>`;
  if (advancePaid > 0) {
    html += `<div style="display: flex; justify-content: space-between;"><span>Advance Deposit:</span><span>-Rs.${advancePaid.toFixed(2)}</span></div>`;
  }
  if (disc > 0) {
    html += `<div style="display: flex; justify-content: space-between;"><span>Discount:</span><span>-Rs.${disc.toFixed(2)}</span></div>`;
  }
  html += `<div style="display: flex; justify-content: space-between; font-weight: 900; border-top: 1px dashed #9ca3af; padding-top: 4px; margin-top: 4px; font-size: ${netTotalFont};"><span>NET TOTAL:</span><span>Rs.${net.toFixed(2)}</span></div>`;
  html += `</div>`;

  html += `<div style="text-align: center; font-size: 10px; margin-top: 8px;">${settings.footerMessage || 'Thank You! Come Again.'}</div>`;
  html += `<div style="text-align: center; font-size: 8px; color: #9ca3af; margin-top: 8px; line-height: 1.2;"><div>${DEVELOPER_CREDIT_LINE_1}</div><div>${DEVELOPER_CREDIT_LINE_2}</div></div>`;

  html += `</div>`;
  return html;
};

export const generateKitchenReceiptHtml = (isTakeaway, tableName, typeLabel, itemsList, orderNumber) => {
  const settings = getBillDesignSettings();
  const widthPx = settings.paperWidth === '58mm' ? '230px' : '300px';

  const PREVIEW_SIZE_PX = { NORMAL: '11px', LARGE: '14px', XLARGE: '17px', HUGE: '22px' };
  const previewSizePx = (tier) => PREVIEW_SIZE_PX[tier] || PREVIEW_SIZE_PX.NORMAL;
  const kotFont = previewSizePx(settings.kotBotFontSize);
  const now = new Date();

  let html = `<div style="width: ${widthPx}; font-family: monospace; font-size: ${kotFont}; color: #000; margin: 0 auto; background: #fff; padding: 12px; box-sizing: border-box; line-height: 1.3;">`;

  if (settings.kotBotShowOrderNumber && orderNumber !== undefined && orderNumber !== null) {
    html += `<div style="text-align: center; font-weight: 900; font-size: ${previewSizePx('HUGE')};">Order #${orderNumber}</div>`;
  }

  html += `<div style="text-align: center; font-weight: 900; font-size: ${kotFont}; text-transform: uppercase;">*** ${typeLabel} ***</div>`;

  if (settings.kotBotShowTable) {
    html += `<div style="font-size: 10px; text-align: center; font-weight: bold;">${isTakeaway ? 'Type' : 'Table'}: ${tableName}</div>`;
  }

  if (settings.kotBotShowDate || settings.kotBotShowTime) {
    html += `<div style="font-size: 10px; text-align: center; margin-bottom: 4px;">`;
    if (settings.kotBotShowDate) html += `Date: ${now.toLocaleDateString()}`;
    if (settings.kotBotShowDate && settings.kotBotShowTime) html += `  `;
    if (settings.kotBotShowTime) html += `Time: ${now.toLocaleTimeString()}`;
    html += `</div>`;
  }

  html += `<div style="border-top: 1px dashed #9ca3af; margin: 4px 0;"></div>`;
  html += `<div style="text-align: left; font-size: ${kotFont}; font-weight: bold; padding: 4px 0;">`;
  itemsList.forEach(item => {
    html += `<div>${item.quantity} x ${item.name}</div>`;
  });
  html += `</div>`;
  html += `<div style="border-top: 1px dashed #9ca3af; margin: 4px 0;"></div>`;

  html += `</div>`;
  return html;
};

export const generateDayEndReceiptHtml = (reportData) => {
  const {
    daySession, totalNetSales, totalDiscounts, totalServiceCharge, totalItemsSold,
    totalOrders, paymentMap, isClosed,
  } = reportData;

  const settings = getBillDesignSettings();
  const widthPx = settings.paperWidth === '58mm' ? '230px' : '300px';
  const now = new Date();

  let html = `<div style="width: ${widthPx}; font-family: monospace; font-size: 11px; color: #000; margin: 0 auto; background: #fff; padding: 12px; box-sizing: border-box; line-height: 1.3;">`;
  html += `<div style="text-align: center; font-weight: bold; font-size: 15px;">${settings.storeName || 'MY RESTAURANT'}</div>`;
  html += `<div style="text-align: center; font-weight: 900; font-size: 14px; margin: 2px 0;">*** DAY END REPORT ***</div>`;
  html += `<div style="text-align: center; font-size: 10px; margin-bottom: 6px;">${now.toLocaleDateString()} ${now.toLocaleTimeString()}</div>`;

  html += `<div style="border-top: 1px dashed #9ca3af; border-bottom: 1px dashed #9ca3af; padding: 4px 0; font-size: 10px;">`;
  if (daySession) {
    html += `<div>Business Date: <b>${daySession.dateKey}</b></div>`;
    html += `<div>Started: ${new Date(daySession.startedAt).toLocaleString()}</div>`;
    if (isClosed && daySession.endedAt) {
      html += `<div>Closed: ${new Date(daySession.endedAt).toLocaleString()}</div>`;
    }
  }
  html += `</div>`;

  html += `<div style="padding: 4px 0; font-size: 10px;">`;
  html += `<div style="font-weight: bold;">Total Orders: ${totalOrders}</div>`;
  html += `<div style="font-weight: bold;">Items Sold: ${totalItemsSold}</div>`;
  html += `<div>Service Charge: Rs.${totalServiceCharge.toFixed(2)}</div>`;
  html += `<div>Discounts: Rs.${totalDiscounts.toFixed(2)}</div>`;
  html += `</div>`;

  html += `<div style="border-top: 1px dashed #9ca3af; padding: 4px 0; font-size: 10px;">`;
  html += `<div style="font-weight: bold;">PAYMENT METHODS</div>`;
  html += `<div>Cash: Rs.${paymentMap.CASH.toFixed(2)}</div>`;
  html += `<div>Card: Rs.${paymentMap.CARD.toFixed(2)}</div>`;
  html += `<div>Transfer: Rs.${paymentMap.TRANSFER.toFixed(2)}</div>`;
  html += `</div>`;

  html += `<div style="text-align: center; font-weight: 900; font-size: 15px; border-top: 1px dashed #9ca3af; border-bottom: 1px dashed #9ca3af; padding: 4px 0; margin-top: 6px;">NET SALES: Rs.${totalNetSales.toFixed(2)}</div>`;
  html += `<div style="text-align: center; font-size: 8px; color: #9ca3af; margin-top: 8px; line-height: 1.2;"><div>${DEVELOPER_CREDIT_LINE_1}</div><div>${DEVELOPER_CREDIT_LINE_2}</div></div>`;
  html += `</div>`;

  return html;
};

export const generateAdvanceReceiptHtml = (booking) => {
  const settings = getBillDesignSettings();
  const widthPx = settings.paperWidth === '58mm' ? '230px' : '300px';
  const now = new Date();

  return `
    <div style="width: ${widthPx}; font-family: monospace; font-size: 11px; color: #000; margin: 0 auto; background: #fff; padding: 12px; box-sizing: border-box; line-height: 1.3;">
      <div style="text-align: center; font-weight: bold; font-size: 14px;">${settings.storeName || 'MY RESTAURANT'}</div>
      <div style="text-align: center; font-weight: 900; font-size: 13px; margin: 4px 0;">*** ADVANCE BOOKING RECEIPT ***</div>
      <div style="text-align: center; font-size: 10px; margin-bottom: 4px;">Issued: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</div>
      <div style="border-top: 1px dashed #9ca3af; border-bottom: 1px dashed #9ca3af; padding: 6px 0; margin: 4px 0;">
        <div>Customer: <b>${booking.customerName}</b></div>
        <div>Phone: <b>${booking.phone || 'N/A'}</b></div>
        <div>Booking Date: <b>${booking.bookingDate}</b></div>
        ${booking.notes ? `<div>Notes: ${booking.notes}</div>` : ''}
      </div>
      <div style="font-size: 12px; font-weight: 900; text-align: center; margin: 8px 0;">
        ADVANCE PAID: Rs.${parseFloat(booking.amount || 0).toFixed(2)} (${booking.paymentMethod})
      </div>
      <div style="border-top: 1px dashed #9ca3af; margin: 6px 0;"></div>
      <div style="text-align: center; font-size: 10px;">Please present this receipt upon final billing.</div>
      <div style="text-align: center; font-size: 8px; color: #9ca3af; margin-top: 8px; line-height: 1.2;"><div>${DEVELOPER_CREDIT_LINE_1}</div><div>${DEVELOPER_CREDIT_LINE_2}</div></div>
    </div>
  `;
};