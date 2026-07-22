// src/QuickCalculatorModal.jsx
import React, { useState, useEffect } from 'react';

export default function QuickCalculatorModal({ isOpen, onClose }) {
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');
  const [isCalculated, setIsCalculated] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
      else if (e.key === '.') handleDot();
      else if (e.key === '+') handleOperator('+');
      else if (e.key === '-') handleOperator('-');
      else if (e.key === '*') handleOperator('×');
      else if (e.key === '/') { e.preventDefault(); handleOperator('÷'); }
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); handleEqual(); }
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, display, equation, isCalculated]);

  if (!isOpen) return null;

  const handleDigit = (digit) => {
    if (isCalculated) {
      setDisplay(digit);
      setEquation('');
      setIsCalculated(false);
    } else {
      if (display === '0') setDisplay(digit);
      else setDisplay(display + digit);
    }
  };

  const handleDot = () => {
    if (isCalculated) {
      setDisplay('0.');
      setEquation('');
      setIsCalculated(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleOperator = (op) => {
    setIsCalculated(false);
    setEquation(`${display} ${op} `);
    setDisplay('0');
  };

  const handleClear = () => {
    setDisplay('0');
    setEquation('');
    setIsCalculated(false);
  };

  const handleBackspace = () => {
    if (isCalculated) {
      handleClear();
      return;
    }
    if (display.length === 1 || (display.length === 2 && display.startsWith('-'))) {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handleEqual = () => {
    if (!equation) return;
    try {
      const sanitized = (equation + display)
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/,/g, '');

      // Evaluate safely
      // eslint-disable-next-line no-eval
      const result = eval(sanitized);
      if (typeof result === 'number' && !isNaN(result)) {
        const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(2);
        setEquation(`${equation}${display} =`);
        setDisplay(formatted);
        setIsCalculated(true);
      } else {
        setDisplay('Error');
        setIsCalculated(true);
      }
    } catch (err) {
      setDisplay('Error');
      setIsCalculated(true);
    }
  };

  const btnClass = "p-3 rounded-2xl font-black text-sm transition active:scale-95 shadow-sm flex items-center justify-center";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 text-white p-5 rounded-3xl max-w-xs w-full shadow-2xl space-y-3 border border-slate-700">
        
        {/* Header */}
        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2 font-black text-sm text-indigo-400">
            <span>🧮</span>
            <span>Quick POS Calculator</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-sm px-2 py-1">✕</button>
        </div>

        {/* Display Box */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-right space-y-1">
          <div className="text-[11px] font-bold text-slate-500 h-4 overflow-hidden truncate">
            {equation || ' '}
          </div>
          <div className="text-2xl font-black tracking-wider text-emerald-400 overflow-x-auto scrollbar-none">
            {display}
          </div>
        </div>

        {/* Keypad Grid */}
        <div className="grid grid-cols-4 gap-2 text-slate-100">
          <button onClick={handleClear} className={`${btnClass} bg-rose-600 hover:bg-rose-700 text-white font-bold`}>C</button>
          <button onClick={handleBackspace} className={`${btnClass} bg-slate-800 hover:bg-slate-700 text-slate-300`}>⌫</button>
          <button onClick={() => handleOperator('÷')} className={`${btnClass} bg-indigo-600 hover:bg-indigo-700 text-white`}>÷</button>
          <button onClick={() => handleOperator('×')} className={`${btnClass} bg-indigo-600 hover:bg-indigo-700 text-white`}>×</button>

          <button onClick={() => handleDigit('7')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>7</button>
          <button onClick={() => handleDigit('8')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>8</button>
          <button onClick={() => handleDigit('9')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>9</button>
          <button onClick={() => handleOperator('-')} className={`${btnClass} bg-indigo-600 hover:bg-indigo-700 text-white`}>-</button>

          <button onClick={() => handleDigit('4')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>4</button>
          <button onClick={() => handleDigit('5')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>5</button>
          <button onClick={() => handleDigit('6')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>6</button>
          <button onClick={() => handleOperator('+')} className={`${btnClass} bg-indigo-600 hover:bg-indigo-700 text-white`}>+</button>

          <button onClick={() => handleDigit('1')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>1</button>
          <button onClick={() => handleDigit('2')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>2</button>
          <button onClick={() => handleDigit('3')} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>3</button>
          <button onClick={handleEqual} className={`${btnClass} bg-emerald-600 hover:bg-emerald-700 text-white row-span-2 text-lg`}>=</button>

          <button onClick={() => handleDigit('0')} className={`${btnClass} bg-slate-800 hover:bg-slate-700 col-span-2`}>0</button>
          <button onClick={handleDot} className={`${btnClass} bg-slate-800 hover:bg-slate-700`}>.</button>
        </div>

        <div className="text-[10px] text-slate-500 text-center font-bold pt-1">
          Keyboard shortcuts supported (0-9, +, -, *, /, Enter, Esc)
        </div>
      </div>
    </div>
  );
}
