/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { NavLink } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';

export const ByteLessLogo: React.FC<{ className?: string }> = ({ className = 'w-5.5 h-5.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7 8.5H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 12H13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 15.5H10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const NAV_ITEMS = [
  { label: 'Home', path: '/' },
  { label: 'Convert', path: '/convert' },
  { label: 'Reader', path: '/reader' },
  { label: 'Saved', path: '/saved' },
];

export const Navbar: React.FC = () => {
  const { user } = useAuth();
  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-5 sm:px-10 lg:px-16 py-5 sm:py-6 md:py-7 flex items-center justify-between pointer-events-auto bg-[#f7f7f5]/90 backdrop-blur-md border-b border-neutral-200/70 transition-all duration-200">
      {/* Left: ByteLess Brand & Logo (Larger, more substantial visual presence) */}
      <NavLink
        to="/"
        className="group flex items-center gap-3 text-[#111111] hover:opacity-85 transition-opacity focus:outline-none"
        aria-label="ByteLess Home"
      >
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#0d0d0d] text-[#f7f7f5] flex items-center justify-center transition-transform group-hover:scale-105 shadow-xs">
          <ByteLessLogo className="w-5 h-5 sm:w-5.5 sm:h-5.5 text-[#f7f7f5]" />
        </div>
        <span className="text-xl sm:text-2xl font-semibold tracking-[-0.035em] text-[#111111]">
          ByteLess
        </span>
      </NavLink>

      {/* Right: Larger, More Spacious Navigation Pill */}
      <nav
        aria-label="Main Navigation"
        className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 bg-white/80 backdrop-blur-md rounded-full border border-neutral-300/90 shadow-sm"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `px-3.5 sm:px-5 lg:px-6 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm md:text-[15px] font-medium tracking-tight transition-all duration-200 ${
                isActive
                  ? 'bg-[#0d0d0d] text-[#f7f7f5] shadow-xs'
                  : 'text-[#7b7b7b] hover:text-[#111111] hover:bg-neutral-100/90'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <NavLink to="/account" aria-label={user ? `Account: ${user.email || 'signed in'}` : 'Account and sign in'} title={user?.email || 'Account'} className={({ isActive }) => `ml-1 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ${isActive ? 'bg-[#0d0d0d] text-[#f7f7f5]' : 'text-[#7b7b7b] hover:bg-neutral-100/90 hover:text-[#111111]'}`}>
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </NavLink>
      </nav>
    </header>
  );
};
