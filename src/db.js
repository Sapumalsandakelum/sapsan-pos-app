// src/db.js
import Dexie from 'dexie';

export const db = new Dexie('SapsanPosDB');

db.version(4).stores({
  categories: '++id, name, printerType',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate, advanceBookingId',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role',
  advanceBookings: '++id, customerName, phone, bookingDate, amount, paymentMethod, status, createdAt, redeemedOrderId'
});

// v5: visibility filter field (unused now, preserved for schema continuity)
db.version(5).stores({
  categories: '++id, name, printerType',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate, advanceBookingId',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role',
  advanceBookings: '++id, customerName, phone, bookingDate, amount, paymentMethod, status, createdAt, redeemedOrderId'
});

// v6: adds mainCategoryId to categories so each main category can have its own
// private menu. mainCategoryId = null/undefined means global (backward compat).
db.version(6).stores({
  categories: '++id, name, printerType, mainCategoryId',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate, advanceBookingId',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role',
  advanceBookings: '++id, customerName, phone, bookingDate, amount, paymentMethod, status, createdAt, redeemedOrderId'
});

// v7: adds isInclusiveServiceCharge, inclusivePrice to items schema
db.version(7).stores({
  categories: '++id, name, printerType, mainCategoryId',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status, isInclusiveServiceCharge, inclusivePrice',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate, advanceBookingId',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role',
  advanceBookings: '++id, customerName, phone, bookingDate, amount, paymentMethod, status, createdAt, redeemedOrderId'
});

// v8: adds license table for persistent local offline license storage
db.version(8).stores({
  categories: '++id, name, printerType, mainCategoryId',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status, isInclusiveServiceCharge, inclusivePrice',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate, advanceBookingId',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role',
  advanceBookings: '++id, customerName, phone, bookingDate, amount, paymentMethod, status, createdAt, redeemedOrderId',
  license: 'id'
});

export const cleanupOrphanedPendingOrders = async () => {
  try {
    const allOrders = await db.orders.toArray();
    for (const ord of allOrders) {
      // 1. Delete empty 0-item orders (whether PENDING or SETTLED)
      if (!ord.items || ord.items.length === 0 || (ord.netTotal === 0 && (!ord.items || ord.items.length === 0))) {
        await db.orders.delete(ord.id);
        continue;
      }
      // 2. Auto-settle stranded split orders whose main table is no longer pending
      if (ord.status === 'PENDING' && (ord.parentTableNumber || (ord.tableNumber && ord.tableNumber.includes('(Split')))) {
        const parentName = ord.parentTableNumber || ord.tableNumber.split(' (Split')[0].trim();
        const mainPendingOrder = allOrders.find(p => p.status === 'PENDING' && p.tableNumber === parentName && p.items && p.items.length > 0 && p.id !== ord.id);
        if (!mainPendingOrder) {
          await db.orders.update(ord.id, {
            status: 'SETTLED',
            paymentMethod: ord.paymentMethod && ord.paymentMethod !== 'PENDING' ? ord.paymentMethod : 'CASH',
            settledDate: ord.settledDate || ord.createdDate || new Date()
          });
        }
      }
    }
  } catch (err) {
    console.error('Error in cleanupOrphanedPendingOrders:', err);
  }
};