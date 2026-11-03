/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Bookmark, Type, ArrowRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

export const ReaderPage: React.FC = () => {
  return (
    <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-3xl mx-auto flex flex-col justify-between select-text">
      <div>
        {/* Minimal Reader Toolbar Placeholder (Controls disabled when no document is loaded) */}
        <div className="flex items-center justify-between pb-4 mb-12 sm:mb-16 border-b border-neutral-200 text-xs font-technical text-[#7b7b7b]">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-neutral-400 font-medium">READER VIEW</span>
            <span aria-hidden="true">·</span>
            <span className="text-neutral-400">NO DOCUMENT LOADED</span>
          </div>

          <div className="flex items-center gap-2 opacity-50 cursor-not-allowed select-none">
            <div
              className="px-2.5 py-1 rounded-md border border-neutral-300 bg-white/40 text-neutral-400 text-xs flex items-center gap-1.5"
              title="Typography controls available when reading a document"
            >
              <Type className="w-3 h-3" />
              <span>A±</span>
            </div>

            <div
              className="p-1.5 rounded-md border border-neutral-300 bg-white/40 text-neutral-400"
              title="Bookmark available when reading a document"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* Clean Empty State in the Reading Area */}
        <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 sm:p-20 text-center flex flex-col items-center justify-center my-6 backdrop-blur-xs">
          <div className="w-14 h-14 rounded-full bg-neutral-200/60 flex items-center justify-center text-neutral-600 mb-5">
            <BookOpen className="w-6 h-6 text-[#111111]" />
          </div>

          <h1 className="font-editorial text-3xl sm:text-4xl text-[#111111] font-normal tracking-tight">
            Nothing to read yet
          </h1>

          <p className="mt-3 text-sm sm:text-base text-[#7b7b7b] max-w-md leading-relaxed">
            Convert a webpage or document to see its lightweight version here.
          </p>

          <div className="mt-8">
            <Link
              to="/convert"
              className="inline-flex items-center gap-2 bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium tracking-tight shadow-sm transition-colors"
            >
              <span>Go to Convert</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Reader Footer */}
      <footer className="mt-16 pt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-technical text-[#7b7b7b]">
        <span>READER INTERFACE · DISTRACTION FREE</span>
        <div className="flex items-center gap-2">
          <span>STATUS: STANDBY</span>
        </div>
      </footer>
    </div>
  );
};
