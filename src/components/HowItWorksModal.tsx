/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, ArrowRight } from 'lucide-react';
import { ByteLessLogo } from './Navbar';

export interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExplore: () => void;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({
  isOpen,
  onClose,
  onExplore,
}) => {
  if (!isOpen) return null;

  const pillars = [
    {
      num: '01',
      title: 'Semantic DOM Purification',
      desc: 'Modern web pages carry an average of 4.2MB of tracking pixels, nested wrappers, and video ads. ByteLess strips the noise down to the essential prose hierarchy.',
    },
    {
      num: '02',
      title: 'Human-First Typography',
      desc: 'Restores typographic elegance with optimal measure, line-height, and high-readability serifs designed for sustained editorial focus without eye strain.',
    },
    {
      num: '03',
      title: 'Sub-100ms Bandwidth Footprint',
      desc: 'Transfers essential web content with up to 94% payload reduction, making knowledge instantly reachable even on 2G or intermittent networks.',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0d0d0d]/40 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#f7f7f5] text-[#111111] rounded-2xl shadow-2xl border border-neutral-300/80 p-6 sm:p-10 relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-[#0d0d0d] text-[#f7f7f5] flex items-center justify-center">
              <ByteLessLogo className="w-3.5 h-3.5 text-[#f7f7f5]" />
            </div>
            <span className="font-technical text-xs uppercase tracking-widest text-[#7b7b7b]">
              Architecture Overview
            </span>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-200/70 hover:bg-neutral-300 text-[#111111] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="py-6">
          <h2 className="font-editorial text-3xl sm:text-4xl text-[#111111] tracking-tight leading-tight">
            How ByteLess Distills the Web
          </h2>
          <p className="mt-3 text-sm sm:text-base text-[#7b7b7b] leading-relaxed">
            ByteLess bridges heavy web publishing with immediate human comprehension.
            By separating meaningful content from bloated presentation runtimes, we create a
            featherlight gateway to written knowledge.
          </p>

          <div className="mt-8 space-y-6">
            {pillars.map((item) => (
              <div
                key={item.num}
                className="flex items-start gap-4 p-4 rounded-xl bg-white/60 border border-neutral-200/80"
              >
                <span className="font-technical text-xs font-semibold text-[#111111] px-2 py-1 bg-neutral-200/70 rounded">
                  {item.num}
                </span>
                <div>
                  <h3 className="font-editorial text-lg text-[#111111] tracking-tight font-medium">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-[#7b7b7b] leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-neutral-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-xs text-[#7b7b7b] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Close Overview
          </button>
          <button
            onClick={() => {
              onClose();
              onExplore();
            }}
            className="inline-flex items-center gap-2 bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] px-5 py-2.5 rounded-full text-xs font-medium tracking-tight transition-colors cursor-pointer"
          >
            <span>Open Workspace</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
