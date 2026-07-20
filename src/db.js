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