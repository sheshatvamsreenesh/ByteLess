/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ArrowRight, CornerDownLeft } from 'lucide-react';

export interface HeroSectionProps {
  onExplore: () => void;
  onSeeHowItWorks: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onExplore,
  onSeeHowItWorks,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <section className="relative z-10 min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 pt-24 pb-20 text-center select-text">
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        {/* Exact Eyebrow from Distill Reference */}
        <div className="mb-4 sm:mb-6">
          <span className="font-technical text-[11px] sm:text-xs font-medium tracking-[0.22em] uppercase text-[#7b7b7b]">
            AI READABILITY
          </span>
        </div>

        {/* Exact Headline from Distill Reference */}
        <h1 className="flex flex-col items-center justify-center tracking-tight text-[#111111] leading-[1.04]">
          <span className="font-editorial font-normal text-4xl sm:text-6xl md:text-7xl lg:text-[76px] xl:text-[84px] text-balance">
            Built for people.
          </span>
          <span className="font-editorial italic font-normal text-4xl sm:text-6xl md:text-7xl lg:text-[76px] xl:text-[84px] text-balance mt-0.5 sm:mt-1">
            Read by machines.
          </span>
        </h1>

        {/* Conversational Assistant Entrance — Restrained Visual Cue (Spacing adjusted with description removed) */}
        <div className="mt-10 sm:mt-12 md:mt-14 w-full max-w-md sm:max-w-lg mx-auto">
          <div
            className={`group relative flex items-center gap-3 bg-white/75 backdrop-blur-md rounded-full px-4 py-2.5 sm:py-3 border transition-all duration-300 shadow-[0_2px_16px_rgba(0,0,0,0.03)] ${
              inputFocused
                ? 'border-neutral-800 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] ring-1 ring-neutral-800'
                : 'border-neutral-300/80 hover:border-neutral-400'
            }`}
          >
            <div className="text-neutral-400 pl-1 select-none font-technical text-sm">
              ›
            </div>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Ask ByteLess or paste URL to distill into pure text..."
              className="w-full bg-transparent border-none text-xs sm:text-sm text-[#111111] placeholder:text-neutral-400 focus:outline-none font-sans"
              aria-label="Ask ByteLess or paste URL placeholder"
            />

            <button
              onClick={onExplore}
              className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#0d0d0d] text-[#f7f7f5] flex items-center justify-center hover:bg-neutral-800 transition-colors cursor-pointer"
              aria-label="Distill query or URL placeholder"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Subtle Technical Label */}
          <div className="mt-2.5 flex items-center justify-center gap-2 text-[10px] sm:text-[11px] font-technical text-[#7b7b7b] tracking-wider uppercase">
            <span>SEMANTIC ENGINE</span>
            <span aria-hidden="true">·</span>
            <span>DOM COMPRESSION</span>
            <span aria-hidden="true">·</span>
            <span>ZERO AD-WEIGHT</span>
          </div>
        </div>

        {/* Minimal CTA Row inspired by Alwayzz */}
        <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {/* Prominent black pill-shaped CTA */}
          <button
            onClick={onExplore}
            className="group inline-flex items-center gap-2 bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] px-6 sm:px-7 py-3 rounded-full text-xs sm:text-sm font-medium tracking-tight shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer active:scale-98"
          >
            <span>Explore ByteLess</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* Secondary understated outlined CTA */}
          <button
            onClick={onSeeHowItWorks}
            className="inline-flex items-center gap-2 border border-neutral-300 hover:border-neutral-400 bg-white/40 hover:bg-white/80 text-[#111111] px-5 sm:px-6 py-3 rounded-full text-xs sm:text-sm font-medium tracking-tight backdrop-blur-xs transition-all duration-200 cursor-pointer"
          >
            <span>See how it works</span>
          </button>
        </div>
      </div>
    </section>
  );
};
