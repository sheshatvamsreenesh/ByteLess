/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X } from 'lucide-react';
import { ByteLessLogo } from './Navbar';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0d0d0d]/40 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#f7f7f5] text-[#111111] rounded-2xl shadow-2xl border border-neutral-300/80 p-6 sm:p-10 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-6 border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-[#0d0d0d] text-[#f7f7f5] flex items-center justify-center">
              <ByteLessLogo className="w-3.5 h-3.5 text-[#f7f7f5]" />
            </div>
            <span className="font-technical text-xs uppercase tracking-widest text-[#7b7b7b]">
              About ByteLess
            </span>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-200/70 hover:bg-neutral-300 text-[#111111] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close about dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-6 space-y-4 text-left">
          <h2 className="font-editorial text-2xl sm:text-3xl text-[#111111] tracking-tight">
            Readability Without the Weight
          </h2>
          <p className="text-sm text-[#7b7b7b] leading-relaxed">
            ByteLess helps people access essential web content in a lightweight, readable format,
            even on slow or limited internet connections.
          </p>
          <p className="text-sm text-[#7b7b7b] leading-relaxed">
            As web experiences grow heavier and more fragmented, ByteLess utilizes intelligent
            distillation to strip away non-content assets, reconstructing the written word with
            clarity, elegance, and intentional typographic rhythm.
          </p>
          <div className="p-3.5 rounded-xl bg-white/70 border border-neutral-200/80 text-xs font-technical text-[#111111] space-y-1">
            <div className="flex justify-between">
              <span className="text-[#7b7b7b]">FOUNDATION</span>
              <span>EDITORIAL AI SKELETON</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#7b7b7b]">LATENCY DESIGN</span>
              <span>OFFLINE-FIRST / LOW BANDWIDTH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#7b7b7b]">PHILOSOPHY</span>
              <span>BUILT FOR PEOPLE. READ BY MACHINES.</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-neutral-200 text-right">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-[#0d0d0d] text-[#f7f7f5] text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
