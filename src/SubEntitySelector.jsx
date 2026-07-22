// src/SubEntitySelector.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import Swal from 'sweetalert2';
import { getSubEntities, saveSubEntities, defaultSubEntities } from './mainCategoryUtils';

const sortByTrailingNumber = (list) => [...list].sort((a, b) => {
  const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
  return na - nb;
});

export default function SubEntitySelector({ mainCategory, currentUser, onSelectEntity, onBack }) {
  const activeOrders = useLiveQuery(() => db.orders.where('status').equals('PENDING').toArray()) || [];
  const ordersForThisCategory = activeOrders.filter(o => o.mainCategoryName === mainCategory.name);

  const isAdmin = currentUser?.role === 'ADMIN';

  const [entities, setEntities] = useState(() => {
    const saved = getSubEntities(mainCategory.id);
    if (saved && saved.length > 0) return saved;
    return defaultSubEntities(mainCategory.usesTables);
  });

  useEffect(() => {
    saveSubEntities(mainCategory.id, entities);
  }, [entities, mainCategory.id]);

  useEffect(() => {
    // Auto-clean any empty pending orders with 0 items so tables never stay active without items
    const emptyOrders = activeOrders.filter(o => !o.items || o.items.length === 0);
    for (const emptyOrd of emptyOrders) {
      db.orders.delete(emptyOrd.id);
    }
  }, [activeOrders]);

  const addEntity = () => {
    const numbers = entities.map(t => parseInt(t.replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    let next = 1;
    while (numbers.includes(next)) next++;
    const newName = mainCategory.usesTables ? `Table ${next}` : `Order ${String(next).padStart(2, '0')}`;
    setEntities(sortByTrailingNumber([...entities, newName]));
    Swal.fire({ icon: 'success', title: `${newName} Added!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
  };

  const handleReset = () => {
    Swal.fire({
      title: 'Reset this list?',
      text: 'Slots you added will be lost.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#4f46e5',
      confirmButtonText: 'Yes, Reset',
    }).then((result) => {
      if (result.isConfirmed) {
        setEntities(defaultSubEntities(mainCategory.usesTables));
      }
    });
  };

  return (
    <div className="min-h-screen w-full bg-gray-100 p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6 max-w-4xl mx-auto">
        <button onClick={onBack} className="bg-white border px-4 py-2 rounded-xl font-black text-sm text-gray-600 hover:bg-gray-50 transition shadow-sm">
          ← Back
        </button>
        <h1 className="text-lg sm:text-xl font-black text-gray-800">{mainCategory.icon} {mainCategory.name}</h1>
        {isAdmin ? (
          <button onClick={handleReset} className="bg-white border px-3 py-2 rounded-xl font-bold text-[11px] text-gray-400 hover:bg-gray-50 transition shadow-sm">
            ↺ Reset
          </button>
        ) : (
          <div className="w-[60px]" />
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
        {entities.map((name) => {
          const activeSplitOrders = activeOrders.filter(o => o.parentTableNumber === name && o.status === 'PENDING');
          const mainOrder = activeOrders.find(o => o.tableNumber === name && o.status === 'PENDING' && o.items && o.items.length > 0);

          const hasOrder = !!mainOrder || activeSplitOrders.length > 0;
          const order = mainOrder || activeSplitOrders[0];
          const isOwnedByOthers = hasOrder && !isAdmin && order?.cashierName && order.cashierName !== currentUser?.username;

          return (
            <div
              key={name}
              onClick={() => {
                if (isOwnedByOthers) {
                  Swal.fire({
                    icon: 'warning',
                    title: 'Table Locked',
                    text: `This table is managed by ${order?.cashierName || 'another cashier'}.`,
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2500
                  });
                  return;
                }
                onSelectEntity(name);
              }}
              className={`w-24 h-24 sm:w-28 sm:h-28 rounded-2xl flex flex-col items-center justify-center transition active:scale-95 shadow-sm relative ${
                isOwnedByOthers 
                  ? 'bg-rose-600 text-white cursor-not-allowed border border-rose-700 shadow-lg' 
                  : hasOrder 
                    ? 'bg-amber-500 text-white animate-pulse cursor-pointer shadow-lg' 
                    : 'bg-white hover:bg-indigo-50 text-gray-700 border hover:border-indigo-300 cursor-pointer'
              }`}
            >
              <span className="text-2xl mb-1">{isOwnedByOthers ? '🔒' : (mainCategory.usesTables ? '🪑' : '🧾')}</span>
              <span className="font-black text-xs">{name}</span>
              {isOwnedByOthers && (
                <span className="absolute top-1.5 right-1.5 text-[8px] font-black bg-rose-800 text-white px-1.5 py-0.5 rounded">LOCKED</span>
              )}
              {hasOrder && !isOwnedByOthers && (
                <span className="absolute top-1.5 right-1.5 text-[8px] font-black bg-white text-amber-600 px-1.5 py-0.5 rounded">
                  {activeSplitOrders.length > 0 ? `SPLIT (${activeSplitOrders.length})` : 'ACTIVE'}
                </span>
              )}
              {hasOrder && order && (
                <span className="absolute bottom-1.5 text-[8px] font-black text-white/90 bg-black/15 px-1.5 py-0.5 rounded uppercase truncate max-w-[92%]">
                  👤 {order.cashierName || 'Cashier'}
                </span>
              )}
            </div>
          );
        })}
        {isAdmin && (
          <div onClick={addEntity} className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-500 flex flex-col items-center justify-center cursor-pointer transition active:scale-95">
            <span className="text-2xl font-light mb-1">➕</span>
            <span className="font-bold text-[10px] uppercase">Add</span>
          </div>
        )}
      </div>
    </div>
  );
}