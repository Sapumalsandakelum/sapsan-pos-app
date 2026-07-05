// src/printUtils.js
// 🖨️ Shared printing engine: Bluetooth / USB / Serial thermal printer support,
// Bill Design settings (store name, logo, paper size), and receipt generators.
// Used by both BillingScreen.jsx (actual printing) and AdminPanel.jsx (design + test print).

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
// GS ! n — character size. n=0x11 = double width + double height, n=0x00 = normal
export const ESC_SIZE_LARGE = new Uint8Array([0x1D, 0x21, 0x11]);
export const ESC_SIZE_NORMAL = new Uint8Array([0x1D, 0x21, 0x00]);

const BT_SERVICE_UUIDS = ['000018f0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb'];

// ==========================================
// 🧾 BILL DESIGN SETTINGS (localStorage-backed)
// ==========================================
const BILL_DESIGN_KEY = 'pos_bill_design_settings';

export const DEFAULT_BILL_DESIGN = {
  storeName: 'SAPSAN RESTAURANT',
  storeAddress: 'Matara, Sri Lanka',
  storePhone: '',
  footerMessage: 'Thank You! Come Again.',
  paperWidth: '80mm',   // '58mm' | '80mm'
  fontSize: 'NORMAL',   // 'NORMAL' | 'LARGE'
  logoBase64: '',
  showLogo: true,
  showAddress: true,
  showPhone: false,
};

// 3-inch bluetooth thermal printers are almost always sold/driven as "80mm" class printers
// (≈72mm actual print width). 58mm (2 inch) is the other common size, kept as an option.
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
// Converts an uploaded logo (base64 data URL) into a 1-bit monochrome raster
// image command that thermal printers understand natively.
export const imageToRasterBytes = (base64DataUrl, targetWidthPx) => {
  return new Promise((resolve, reject) => {
    if (!base64DataUrl) { resolve([]); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = targetWidthPx / img.width;
        const targetHeightPx = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidthPx;
        canvas.height = targetHeightPx;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);
        ctx.drawImage(img, 0, 0, targetWidthPx, targetHeightPx);

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

        // GS v 0 m xL xH yL yH [data]
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

// 🔵 Bluetooth — FIXED: reconnects to an already-authorized device via getDevices()
// instead of calling requestDevice() again on every print. requestDevice() needs a
// *fresh* user gesture and after any `await` earlier in the save/settle flow, that
// gesture has usually already expired — which is why prints were silently failing.
const printViaBluetoothDevice = async (storedDevice, targetRole, receiptDataArray) => {
  try {
    let device = null;

    // 1️⃣ Try to silently reuse permission already granted in Admin → Printer Settings
    if (navigator.bluetooth.getDevices) {
      const grantedDevices = await navigator.bluetooth.getDevices();
      device = grantedDevices.find(d => d.id === storedDevice.id);
    }

    // 2️⃣ Fallback only: ask the OS picker again (requires a fresh click just before this)
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

// 🎯 ROUTER — reads pos_printer_mapping / pos_paired_bluetooth_devices from localStorage
// (same storage the Admin Panel "Assign Printer Roles" step writes to — this IS the
// "default printer" per role: kot / bot / bill).
export const printViaBluetooth = async (targetRole, receiptDataArray) => {
  const mappingSaved = localStorage.getItem('pos_printer_mapping');
  const devicesSaved = localStorage.getItem('pos_paired_bluetooth_devices');
  if (!mappingSaved) return false;

  const mapping = JSON.parse(mappingSaved);
  const deviceId = mapping[targetRole];
  if (!deviceId) {
    console.log(`⚠️ No default printer assigned for role: ${targetRole.toUpperCase()}`);
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
  return await printViaBluetoothDevice(device, targetRole, receiptDataArray); // BLUETOOTH
};

// ==========================================
// 🔥 RECEIPT FORMAT GENERATORS (paper-width & bill-design aware)
// ==========================================
export const generateKitchenReceipt = (isTakeaway, tableName, typeLabel, itemsList) => {
  const { charsPerLine } = PAPER_WIDTH_CONFIG[getBillDesignSettings().paperWidth] || PAPER_WIDTH_CONFIG['80mm'];
  const data = [];
  data.push(ESC_ALIGN_CENTER);
  data.push(ESC_FONT_BOLD);
  data.push(textToBytes(`*** ${typeLabel} ***`));
  data.push(ESC_FONT_NORMAL);
  data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName}`));
  data.push(textToBytes(`Date: ${new Date().toLocaleTimeString()}`));
  data.push(textToBytes('-'.repeat(charsPerLine)));
  data.push(ESC_ALIGN_LEFT);

  itemsList.forEach(item => {
    data.push(textToBytes(`${item.quantity} x ${item.name}`));
  });

  data.push(textToBytes('-'.repeat(charsPerLine)));
  return data;
};

// Now async: may need to fetch + rasterize the store logo before building the receipt.
export const generateBillReceipt = async (isTakeaway, tableName, billTitle, sub, sc, disc, net, itemsList) => {
  const settings = getBillDesignSettings();
  const { rasterPx, charsPerLine } = PAPER_WIDTH_CONFIG[settings.paperWidth] || PAPER_WIDTH_CONFIG['80mm'];

  const data = [];
  data.push(ESC_ALIGN_CENTER);

  // Logo
  if (settings.showLogo && settings.logoBase64) {
    try {
      const logoBytes = await imageToRasterBytes(settings.logoBase64, rasterPx);
      data.push(...logoBytes);
    } catch (err) {
      console.error('Logo raster conversion failed, skipping logo on this print:', err);
    }
  }

  // Store name (optionally large/bold)
  data.push(ESC_FONT_BOLD);
  if (settings.fontSize === 'LARGE') data.push(ESC_SIZE_LARGE);
  data.push(textToBytes(settings.storeName || 'MY RESTAURANT'));
  if (settings.fontSize === 'LARGE') data.push(ESC_SIZE_NORMAL);
  data.push(ESC_FONT_NORMAL);

  if (settings.showAddress && settings.storeAddress) data.push(textToBytes(settings.storeAddress));
  if (settings.showPhone && settings.storePhone) data.push(textToBytes(`Tel: ${settings.storePhone}`));

  data.push(textToBytes(`--- ${billTitle} ---`));
  data.push(textToBytes(`${isTakeaway ? 'Type' : 'Table'}: ${tableName} | Date: ${new Date().toLocaleDateString()}`));
  data.push(textToBytes('-'.repeat(charsPerLine)));
  data.push(ESC_ALIGN_LEFT);

  itemsList.forEach(item => {
    const lineTotal = (item.sellingPrice * item.quantity).toFixed(0);
    data.push(textToBytes(`${item.name}`));
    data.push(ESC_ALIGN_RIGHT);
    data.push(textToBytes(`${item.quantity} x ${item.sellingPrice} = Rs.${lineTotal}`));
    data.push(ESC_ALIGN_LEFT);
  });

  data.push(textToBytes('-'.repeat(charsPerLine)));
  data.push(ESC_ALIGN_RIGHT);
  data.push(textToBytes(`Sub Total: Rs.${sub.toFixed(2)}`));
  data.push(textToBytes(`Service Charge: Rs.${sc.toFixed(2)}`));
  if (disc > 0) data.push(textToBytes(`Discount: -Rs.${disc.toFixed(2)}`));
  data.push(ESC_FONT_BOLD);
  data.push(textToBytes(`NET TOTAL: Rs.${net.toFixed(2)}`));
  data.push(ESC_FONT_NORMAL);
  data.push(ESC_ALIGN_CENTER);
  data.push(textToBytes(settings.footerMessage || 'Thank You! Come Again.'));
  return data;
};