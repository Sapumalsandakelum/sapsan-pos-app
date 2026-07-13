// src/MainCategorySelector.jsx
import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { mainCategoryDb } from './mainCategoryUtils';

export default function MainCategorySelector({ onSelect, onLogout, currentUser }) {
  const categories = useLiveQuery(() => mainCategoryDb.categories.orderBy('sortOrder').toArray()) || [];

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 p-6 relative">
      {onLogout && (
        <button
          onClick={onLogout}
          className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white px-3 py-2 rounded-xl font-black text-xs transition"
        >
          🚪 Logout{currentUser ? ` (${currentUser.username})` : ''}
        </button>
      )}

      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-black text-white mb-2">What are you starting?</h1>
        <p className="text-indigo-300 text-sm">Select an order type to begin</p>
      </div>

      <div className="flex flex-wrap justify-center gap-4 sm:gap-6 max-w-3xl">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat)}
            className="w-36 h-36 sm:w-44 sm:h-44 bg-white hover:bg-indigo-50 rounded-3xl p-6 flex flex-col items-center justify-center shadow-2xl hover:scale-105 transition-transform border-4 border-transparent hover:border-indigo-400"
          >
            <span className="text-5xl mb-3">{cat.icon || '📋'}</span>
            <span className="font-black text-gray-800 text-lg text-center">{cat.name}</span>
          </button>
        ))}
        {categories.length === 0 && (
          <div className="col-span-full text-center text-indigo-300 text-sm max-w-sm">
            No order types set up yet. Ask an Admin to add some in Admin Panel → Main Categories.
          </div>
        )}
      </div>
    </div>
  );
}