// src/mainCategoryUtils.js
// 🗂️ Main Categories — the top-level "order type" selector shown right after
// login (e.g. Dine-in, Take-Away). Fully admin-manageable: each one controls
// whether it uses named tables or auto-numbered orders, and whether service
// charge applies to orders placed under it. Kept in its own dedicated
// IndexedDB database, same safe pattern as backups/audit log — never touches
// the main POS schema in db.js.
import Dexie from 'dexie';

export const mainCategoryDb = new Dexie('SapSanPOS_MainCategories');
mainCategoryDb.version(1).stores({
  categories: '++id, sortOrder'
});

const DEFAULTS = [
  { name: 'Dine-in', icon: '🍽️', usesTables: true, serviceChargeEnabled: true, sortOrder: 1 },
  { name: 'Take-Away', icon: '🛍️', usesTables: false, serviceChargeEnabled: false, sortOrder: 2 },
];

// Called once on app load — seeds the two defaults if nothing exists yet, so
// existing behavior (Dine-in with service charge, Takeaway without) keeps
// working exactly as before with zero manual setup required.
export const ensureDefaultMainCategories = async () => {
  const count = await mainCategoryDb.categories.count();
  if (count === 0) {
    await mainCategoryDb.categories.bulkAdd(DEFAULTS);
  }
};

export const addMainCategory = async (data) => {
  const last = await mainCategoryDb.categories.orderBy('sortOrder').last();
  const sortOrder = last ? last.sortOrder + 1 : 1;
  return await mainCategoryDb.categories.add({ ...data, sortOrder });
};

export const updateMainCategory = async (id, data) => {
  await mainCategoryDb.categories.update(id, data);
};

export const deleteMainCategory = async (id) => {
  await mainCategoryDb.categories.delete(id);
  localStorage.removeItem(SUBENTITY_PREFIX + id);
};

// ==========================================
// Tables / Order-numbers per main category — the selectable "slots" shown
// after picking a main category (e.g. Table 1, Table 2 / Order 01, Order 02)
// ==========================================
const SUBENTITY_PREFIX = 'pos_subentities_';

export const getSubEntities = (mainCategoryId) => {
  try {
    const saved = localStorage.getItem(SUBENTITY_PREFIX + mainCategoryId);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
};

export const saveSubEntities = (mainCategoryId, list) => {
  localStorage.setItem(SUBENTITY_PREFIX + mainCategoryId, JSON.stringify(list));
};

// Default starting slots for a brand-new main category, based on its mode
export const defaultSubEntities = (usesTables) => {
  if (usesTables) return ['Table 1', 'Table 2', 'Table 3', 'Table 4'];
  return ['Order 01', 'Order 02', 'Order 03', 'Order 04'];
};