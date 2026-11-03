/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const PARTNERS = [
  'AETHER RESEARCH',
  'VERVE MEDIA',
  'MONOLITH',
  'SYNAPSE LABS',
  'CHRONICLE',
];

export const PartnerStrip: React.FC = () => {
  return (
    <div className="relative z-10 w-full px-6 py-6 pb-8 sm:pb-10 flex flex-col items-center justify-center text-center">
      {/* Small introductory label */}
      <span className="font-technical text-[10px] uppercase tracking-[0.2em] text-[#7b7b7b] mb-3">
        EDITORIAL & RESEARCH PARTNERS
      </span>

      {/* Horizontal row of fictional text-based partner names */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 sm:gap-x-10 gap-y-2 max-w-4xl">
        {PARTNERS.map((partner, idx) => (
          <React.Fragment key={partner}>
            <span className="font-technical text-xs tracking-wider text-neutral-500 hover:text-neutral-900 transition-colors cursor-default">
              {partner}
            </span>
            {idx < PARTNERS.length - 1 && (
              <span className="text-neutral-300 hidden sm:inline select-none" aria-hidden="true">
                /
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
