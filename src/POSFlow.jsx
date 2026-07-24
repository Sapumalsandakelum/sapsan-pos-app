// src/POSFlow.jsx
import React, { useState, useEffect } from 'react';
import MainCategorySelector from './MainCategorySelector';
import SubEntitySelector from './SubEntitySelector';
import BillingScreen from './BillingScreen';
import { ensureDefaultMainCategories } from './mainCategoryUtils';

export default function POSFlow({ currentUser, onLogout, activeDaySession, onNavigateToDayEnd }) {
  const [mainCategory, setMainCategory] = useState(null);
  const [entityName, setEntityName] = useState(null);

  useEffect(() => {
    ensureDefaultMainCategories();
  }, []);

  // Stage 1 — pick Dine-in / Take-Away / etc.
  if (!mainCategory) {
    return (
      <MainCategorySelector
        onSelect={setMainCategory}
        currentUser={currentUser}
        onNavigateToDayEnd={onNavigateToDayEnd}
      />
    );
  }

  // Stage 2 — pick a table or order slot within that category
  if (!entityName) {
    return (
      <SubEntitySelector
        mainCategory={mainCategory}
        currentUser={currentUser}
        onSelectEntity={setEntityName}
        onBack={() => setMainCategory(null)}
      />
    );
  }

  // Stage 3 — items + bill
  return (
    <BillingScreen
      mainCategory={mainCategory}
      entityName={entityName}
      currentUser={currentUser}
      activeDaySession={activeDaySession}
      onBack={() => setEntityName(null)}
    />
  );
}