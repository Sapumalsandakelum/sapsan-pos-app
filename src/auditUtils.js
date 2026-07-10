// src/auditUtils.js
// 🗑️ Audit trail for destructive actions — deleted items (removed from a saved order
// after KOT/BOT was sent) and deleted bills (an entire table's order cleared).
// Both require Admin authorization already (enforced in BillingScreen.jsx); this module
// just records *what* was deleted, *when*, and *by whom* so it's reportable afterward.
//
// Stored in its own dedicated IndexedDB database — separate from the main POS schema
// in db.js — so it never needs a schema change there and can't conflict with it.

import Dexie from 'dexie';

export const auditDb = new Dexie('SapSanPOS_AuditLog');
auditDb.version(1).stores({
  deletedItems: '++id, deletedAt, tableNumber',
  deletedBills: '++id, deletedAt, tableNumber',
});

// Call when a single item is removed from an already-saved order
export const logDeletedItem = async ({ tableNumber, isTakeaway, item, dailyOrderNumber, deletedBy }) => {
  try {
    await auditDb.deletedItems.add({
      deletedAt: new Date().toISOString(),
      tableNumber: tableNumber || 'Walk-in',
      isTakeaway: !!isTakeaway,
      itemName: item.name,
      quantity: item.quantity,
      sellingPrice: item.sellingPrice,
      lineTotal: (item.sellingPrice || 0) * (item.quantity || 0),
      dailyOrderNumber: dailyOrderNumber ?? null,
      deletedBy: deletedBy || 'Unknown',
    });
  } catch (err) {
    console.error('Failed to log deleted item (deletion itself still succeeded):', err);
  }
};

// Call when an entire table's order/bill is cleared/deleted
export const logDeletedBill = async ({ order, deletedBy }) => {
  try {
    await auditDb.deletedBills.add({
      deletedAt: new Date().toISOString(),
      tableNumber: order.tableNumber || 'Walk-in',
      dailyOrderNumber: order.dailyOrderNumber ?? null,
      subTotal: order.subTotal || 0,
      totalServiceCharge: order.totalServiceCharge || 0,
      netTotal: order.netTotal || 0,
      itemCount: (order.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0),
      items: order.items || [],
      deletedBy: deletedBy || 'Unknown',
    });
  } catch (err) {
    console.error('Failed to log deleted bill (deletion itself still succeeded):', err);
  }
};