/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Library, ArrowRight } from 'lucide-react';

export const SavedPage: React.FC = () => {
  return (
    <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-4xl mx-auto flex flex-col justify-between select-text">
      <div>
        {/* Header Section */}
        <div className="mb-10 sm:mb-14">
          <div className="mb-3">
            <span className="font-technical text-[11px] uppercase tracking-[0.22em] text-[#7b7b7b]">
              PERSONAL ARCHIVE
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="font-editorial text-4xl sm:text-5xl text-[#111111] tracking-tight font-normal">
                Saved Content
              </h1>
              <p className="mt-2 text-sm sm:text-base text-[#7b7b7b] max-w-xl leading-relaxed">
                Your personal library of distilled web documents, cached for quick access, even offline.
              </p>
            </div>

            {/* Real 0 Saved Documents Indicator */}
            <div className="self-start sm:self-auto shrink-0 px-3.5 py-1.5 rounded-full border border-neutral-300/80 bg-white/70 text-xs font-technical text-[#7b7b7b]">
              <span>0 DOCUMENTS</span>
            </div>
          </div>
        </div>

        {/* Proper Clean Empty State */}
        <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 sm:p-20 text-center flex flex-col items-center justify-center my-6 backdrop-blur-xs">
          <div className="w-14 h-14 rounded-full bg-neutral-200/60 flex items-center justify-center text-neutral-600 mb-5">
            <Library className="w-6 h-6 text-[#111111]" />
          </div>

          <h2 className="font-editorial text-3xl sm:text-4xl text-[#111111] font-normal tracking-tight">
            Your library is empty
          </h2>

          <p className="mt-3 text-sm sm:text-base text-[#7b7b7b] max-w-md leading-relaxed">
            Converted content you save will appear here for quick access, even offline.
          </p>

          <div className="mt-8">
            <Link
              to="/convert"
              className="inline-flex items-center gap-2 bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium tracking-tight shadow-sm transition-colors"
            >
              <span>Convert your first page</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 pt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-technical text-[#7b7b7b]">
        <span>LOCAL CACHE LIBRARY · OFFLINE STORAGE</span>
        <div className="flex items-center gap-2">
          <span>0 DOCUMENTS STORED</span>
        </div>
      </footer>
    </div>
  );
};
