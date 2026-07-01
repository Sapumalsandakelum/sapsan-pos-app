// src/App.jsx
import React, { useState } from 'react';
import BillingScreen from './BillingScreen';
import AdminPanel from './AdminPanel';
import DashboardScreen from './DashboardScreen'; 
import Swal from 'sweetalert2';
import { db } from './db'; // 👈 db eka import karanawa

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('BILLING'); // BILLING, ADMIN, or DASHBOARD

  // Admin Tab එක ක්ලික් කරපුවාම ක්‍රියාත්මක වන ලොජික් එක
  const handleAdminTabClick = async () => {
    // 🟢 ලොක් වෙලා ඉන්නවනම් ආයෙත් password ඉල්ලන්නේ නැතිව කෙලින්ම Admin Panel එකට යවනවා
    if (currentScreen === 'ADMIN') return;

    const { value: formValues } = await Swal.fire({
      title: '🔐 Admin Authentication',
      html:
        '<div class="space-y-3 text-xs text-left">' +
        '<div><label class="font-bold text-gray-600">Username</label>' +
        '<input id="swal-input1" class="w-full p-2.5 border rounded-xl mt-1 focus:outline-indigo-500 font-bold" placeholder="Username"></div>' +
        '<div><label class="font-bold text-gray-600">Password</label>' +
        '<input id="swal-input2" type="password" class="w-full p-2.5 border rounded-xl mt-1 focus:outline-indigo-500 font-bold" placeholder="••••"></div>' +
        '</div>',
      focusConfirm: false,
      confirmButtonText: 'Login to Admin',
      confirmButtonColor: '#4f46e5',
      showCancelButton: true,
      preConfirm: () => {
        return [
          document.getElementById('swal-input1').value,
          document.getElementById('swal-input2').value
        ];
      }
    });

    if (formValues) {
      const [usernameRaw, passwordRaw] = formValues;
      const username = (usernameRaw || '').trim();
      const password = (passwordRaw || '').trim();

      if (!username || !password) {
        Swal.fire({ icon: 'error', title: 'Login Failed!', text: 'Input Username and Password. ❌', confirmButtonColor: '#ef4444' });
        return;
      }

      try {
        // 🆕 system එකේ db.admins table එකේ account එකක්වත් නැද්ද කියලා මුලින්ම check කරනවා
        // (අලුත් POS install එකක දාපුවහාම admin කෙනෙක් නැති නිසා panel එකට යන්න බෑ වෙච්ච bug එක මෙතනින් fix වෙනවා)
        const totalAdminCount = await db.admins.count();

        if (totalAdminCount === 0) {
          // 🟢 System එකේ admin කෙනෙක්වත් නැහැ - default admin / 1234 එකෙන් witharak login වෙන්න ඉඩ දෙනවා
          if (username.toLowerCase() === 'admin' && password === '1234') {
            setCurrentScreen('ADMIN');
            Swal.fire({
              icon: 'success',
              title: 'Welcome Admin! (Default Account)',
              text: 'Please go to Profile Settings and create your own Admin account.',
              confirmButtonColor: '#4f46e5'
            });
          } else {
            Swal.fire({ icon: 'error', title: 'Login Failed!', text: 'System has no admin account. Please use the default username: admin, password: 1234.', confirmButtonColor: '#ef4444' });
          }
          return;
        }

        // ✅ db.admins table එකෙන් user එක සොයනවා (case-insensitive)
        const matchedAdmin = await db.admins
          .where('username')
          .equalsIgnoreCase(username)
          .first();

        if (matchedAdmin && matchedAdmin.password === password) {
          setCurrentScreen('ADMIN');
          Swal.fire({ icon: 'success', title: `Welcome ${matchedAdmin.username}!`, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
        } else {
          Swal.fire({ icon: 'error', title: 'Login Failed!', text: 'Username or Password is incorrect. ❌', confirmButtonColor: '#ef4444' });
        }
      } catch (error) {
        console.error('Admin login error:', error);
        Swal.fire({ icon: 'error', title: 'Database Error', text: 'An error occurred while logging in.', confirmButtonColor: '#ef4444' });
      }
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-100 flex flex-col">
      {/* 🔝 TOP NAVIGATION BAR */}
      <nav className="bg-white border-b px-4 py-2 flex justify-between items-center shadow-sm shrink-0 z-40">
        <div className="flex items-center space-x-2">
          <span className="text-2xl font-black text-indigo-600 tracking-tighter">SapSan POS</span>
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md font-black">v2.0</span>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex space-x-1">
          <button 
            onClick={() => setCurrentScreen('BILLING')}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'BILLING' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            🛒 Billing Screen
          </button>

          <button 
            onClick={() => setCurrentScreen('DASHBOARD')}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'DASHBOARD' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            📈 Dashboard
          </button>
          
          <button 
            onClick={handleAdminTabClick}
            className={`px-4 py-2 text-xs font-black rounded-xl transition ${currentScreen === 'ADMIN' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            ⚙️ Admin Panel
          </button>
        </div>
      </nav>

      {/* 📲 SCREEN RENDERING */}
      <main className="flex-1 overflow-hidden">
        {currentScreen === 'BILLING' && <BillingScreen />}
        
        {/* 🟢 Dashboard Screen එකටත් අවශ්‍ය නම් App navigation එක පාලනය කරන්න callback එකක් දෙන්න පුළුවන් */}
        {currentScreen === 'DASHBOARD' && <DashboardScreen onBackToBilling={() => setCurrentScreen('BILLING')} />} 
        
        {/* 🟢 AdminPanel එකේ Back Button එකෙන් Billing එකට වගේම Dashboard එකටත් යන්න ඕන නම් කරන්න පුළුවන් */}
        {currentScreen === 'ADMIN' && (
          <AdminPanel 
            onBackToBilling={() => setCurrentScreen('BILLING')} 
            onNavigate={(screen) => setCurrentScreen(screen)} 
          />
        )}
      </main>
    </div>
  );
}