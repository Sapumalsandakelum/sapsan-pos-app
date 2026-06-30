// src/db.js
import Dexie from 'dexie';

export const db = new Dexie('SapsanPosDB');

// version එක 3 දක්වා වැඩි කරන්න (ව්‍යුහය වෙනස් කරන නිසා)
db.version(3).stores({
  categories: '++id, name, printerType',
  items: '++id, name, categoryId, costPrice, sellingPrice, serviceChargePercentage, status',
  orders: '++id, orderDate, tableNumber, subTotal, totalServiceCharge, discountAmount, netTotal, paymentMethod, status, settledDate',
  orderItems: '++id, orderId, itemId, quantity, unitPrice, calculatedServiceCharge',
  admins: '++id, username, password, role' // 👈 මෙතනට password සහ role එකතු කරන්න
});