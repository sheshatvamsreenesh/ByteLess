/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { ConvertPage } from './pages/ConvertPage';
import { ReaderPage } from './pages/ReaderPage';
import { SavedPage } from './pages/SavedPage';
import { AccountPage } from './pages/AccountPage';
import { AuthProvider } from './lib/auth';

export default function App() {
  return (
    <AuthProvider>
    <BrowserRouter>
      <div className="relative min-h-screen bg-[#f7f7f5] text-[#111111] overflow-x-hidden selection:bg-[#0d0d0d] selection:text-[#f7f7f5]">
        {/* Shared Top Navigation Bar across all pages */}
        <Navbar />

        {/* Application Page Routing */}
        <main className="w-full min-h-screen">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/convert" element={<ConvertPage />} />
            <Route path="/reader" element={<ReaderPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
    </AuthProvider>
  );
}
