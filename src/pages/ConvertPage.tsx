/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Globe, FileText, Upload, ArrowRight } from 'lucide-react';

type InputMethod = 'url' | 'text' | 'html';

export const ConvertPage: React.FC = () => {
  const [activeMethod, setActiveMethod] = useState<InputMethod>('url');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [stripTrackers, setStripTrackers] = useState(true);
  const [preserveHeadings, setPreserveHeadings] = useState(true);
  const [compressDOM, setCompressDOM] = useState(true);

  const hasInput =
    activeMethod === 'url' ? urlInput.trim().length > 0 :
    activeMethod === 'text' ? textInput.trim().length > 0 : false;

  return (
    <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-20 px-4 sm:px-8 max-w-5xl mx-auto flex flex-col justify-between">
      <div>
        {/* Header section */}
        <div className="mb-8 sm:mb-12">
          <div className="mb-3">
            <span className="font-technical text-[11px] uppercase tracking-[0.22em] text-[#7b7b7b]">
              CONVERSION WORKSPACE
            </span>
          </div>
          <h1 className="font-editorial text-4xl sm:text-5xl text-[#111111] tracking-tight font-normal">
            Distill Web Content
          </h1>
          <p className="mt-2.5 text-sm sm:text-base text-[#7b7b7b] max-w-2xl leading-relaxed">
            Choose an input method below to strip execution scripts, advertising beacons,
            and nested div wrappers, leaving pure semantic prose.
          </p>
        </div>

        {/* Input Method Switcher (3 Clearly Presented Methods) */}
        <div className="flex items-center gap-2 p-1.5 bg-white/80 backdrop-blur-md rounded-2xl border border-neutral-300/80 shadow-xs max-w-xl mb-8">
          <button
            onClick={() => setActiveMethod('url')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer ${
              activeMethod === 'url'
                ? 'bg-[#0d0d0d] text-[#f7f7f5] shadow-xs'
                : 'text-[#7b7b7b] hover:text-[#111111] hover:bg-neutral-100/70'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Website URL</span>
          </button>

          <button
            onClick={() => setActiveMethod('text')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer ${
              activeMethod === 'text'
                ? 'bg-[#0d0d0d] text-[#f7f7f5] shadow-xs'
                : 'text-[#7b7b7b] hover:text-[#111111] hover:bg-neutral-100/70'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Paste Text</span>
          </button>

          <button
            onClick={() => setActiveMethod('html')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer ${
              activeMethod === 'html'
                ? 'bg-[#0d0d0d] text-[#f7f7f5] shadow-xs'
                : 'text-[#7b7b7b] hover:text-[#111111] hover:bg-neutral-100/70'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload HTML</span>
          </button>
        </div>

        {/* Workspace Body Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Input Card (Spans 2 Columns) */}
          <div className="lg:col-span-2 rounded-2xl bg-white/70 border border-neutral-300/80 p-6 sm:p-8 backdrop-blur-sm shadow-xs flex flex-col justify-between min-h-[380px]">
            {/* METHOD 1: WEBSITE URL (Empty by default) */}
            {activeMethod === 'url' && (
              <div>
                <div className="flex items-center justify-between pb-3 mb-6 border-b border-neutral-200">
                  <span className="font-technical text-xs uppercase tracking-wider text-[#7b7b7b]">
                    METHOD 01 · REMOTE URL EXTRACTION
                  </span>
                  <span className="font-technical text-xs text-[#7b7b7b]">
                    AWAITING URL
                  </span>
                </div>

                <div className="space-y-4">
                  <label htmlFor="url-input" className="block text-xs font-medium text-[#111111]">
                    Enter Target Article or Publication URL
                  </label>
                  <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-neutral-300 focus-within:border-neutral-800 transition-colors">
                    <span className="font-mono text-xs text-neutral-400 select-none">https://</span>
                    <input
                      id="url-input"
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="Enter webpage URL (e.g. publication.org/essay)..."
                      className="w-full bg-transparent border-none text-xs sm:text-sm text-[#111111] placeholder:text-neutral-400 focus:outline-none font-mono"
                    />
                  </div>

                  {/* Extraction Options */}
                  <div className="pt-4 space-y-2.5">
                    <span className="font-technical text-[11px] text-[#7b7b7b] uppercase tracking-wider block">
                      PURIFICATION RULES
                    </span>
                    <label className="flex items-center gap-2.5 text-xs text-neutral-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stripTrackers}
                        onChange={(e) => setStripTrackers(e.target.checked)}
                        className="rounded border-neutral-300 accent-neutral-900"
                      />
                      <span>Strip telemetry scripts, marketing beacons, and cookie modals</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-xs text-neutral-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preserveHeadings}
                        onChange={(e) => setPreserveHeadings(e.target.checked)}
                        className="rounded border-neutral-300 accent-neutral-900"
                      />
                      <span>Preserve hierarchical H1–H4 structure and blockquotes</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-xs text-neutral-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={compressDOM}
                        onChange={(e) => setCompressDOM(e.target.checked)}
                        className="rounded border-neutral-300 accent-neutral-900"
                      />
                      <span>Collapse redundant CSS wrapper trees into lean semantic tags</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* METHOD 2: PASTE TEXT (Empty by default) */}
            {activeMethod === 'text' && (
              <div>
                <div className="flex items-center justify-between pb-3 mb-6 border-b border-neutral-200">
                  <span className="font-technical text-xs uppercase tracking-wider text-[#7b7b7b]">
                    METHOD 02 · RAW MARKDOWN & TEXT NORMALIZATION
                  </span>
                  <span className="font-technical text-xs text-[#7b7b7b]">
                    {textInput.trim() ? `${textInput.split(/\s+/).filter(Boolean).length} WORDS` : 'AWAITING TEXT'}
                  </span>
                </div>

                <div className="space-y-4">
                  <label htmlFor="text-input" className="block text-xs font-medium text-[#111111]">
                    Paste Unformatted Content
                  </label>
                  <textarea
                    id="text-input"
                    rows={8}
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Paste unformatted web copy, HTML markup, or article text here..."
                    className="w-full p-4 bg-white rounded-xl border border-neutral-300 text-xs sm:text-sm text-[#111111] placeholder:text-neutral-400 focus:outline-none focus:border-neutral-800 font-sans leading-relaxed resize-none"
                  />
                </div>
              </div>
            )}

            {/* METHOD 3: UPLOAD HTML (Empty by default) */}
            {activeMethod === 'html' && (
              <div>
                <div className="flex items-center justify-between pb-3 mb-6 border-b border-neutral-200">
                  <span className="font-technical text-xs uppercase tracking-wider text-[#7b7b7b]">
                    METHOD 03 · LOCAL FILE UPLOAD
                  </span>
                  <span className="font-technical text-xs text-[#7b7b7b]">
                    AWAITING FILE
                  </span>
                </div>

                <div className="border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-2xl p-8 sm:p-12 text-center bg-white/50 transition-colors flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 mb-3">
                    <Upload className="w-5 h-5" />
                  </div>
                  <h3 className="font-editorial text-lg text-[#111111] font-medium">
                    Upload Web Archive or HTML
                  </h3>
                  <p className="mt-1 text-xs text-[#7b7b7b] max-w-sm">
                    Drag and drop your saved .html, .htm, or .mhtml archive files here to extract clean reading text.
                  </p>
                  <button
                    type="button"
                    className="mt-4 px-4 py-2 rounded-full border border-neutral-300 text-xs font-medium text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer"
                  >
                    Select File from Device
                  </button>
                </div>
              </div>
            )}

            {/* Action Row */}
            <div className="pt-6 mt-6 border-t border-neutral-200 flex items-center justify-between">
              <span className="text-xs text-[#7b7b7b] font-technical">
                {hasInput ? 'READY FOR PIPELINE' : 'INPUT REQUIRED'}
              </span>
              <button
                type="button"
                disabled={!hasInput && activeMethod !== 'html'}
                className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium tracking-tight shadow-sm transition-colors ${
                  hasInput || activeMethod === 'html'
                    ? 'bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] cursor-pointer'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                <span>
                  {activeMethod === 'url' && 'Distill Webpage'}
                  {activeMethod === 'text' && 'Purify Text'}
                  {activeMethod === 'html' && 'Process Document'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right Sidebar: Target Specification with Neutral Placeholders */}
          <div className="rounded-2xl bg-white/70 border border-neutral-300/80 p-6 backdrop-blur-sm shadow-xs flex flex-col justify-between">
            <div className="space-y-6">
              <div>
                <span className="font-technical text-[11px] text-[#7b7b7b] uppercase tracking-wider block mb-2">
                  COMPRESSION ESTIMATE
                </span>
                <div className="text-2xl sm:text-3xl font-editorial font-normal text-[#111111]">
                  Awaiting input
                </div>
                <p className="mt-1.5 text-xs text-[#7b7b7b] leading-relaxed">
                  Payload reduction and byte metrics will be calculated upon document distillation.
                </p>
              </div>

              <div className="pt-4 border-t border-neutral-200 space-y-3">
                <span className="font-technical text-[11px] text-[#7b7b7b] uppercase tracking-wider block">
                  OUTPUT STANDARDS
                </span>
                <div className="flex items-center justify-between text-xs font-technical">
                  <span className="text-[#7b7b7b]">FORMAT</span>
                  <span className="text-[#111111] font-medium">Clean Semantic HTML</span>
                </div>
                <div className="flex items-center justify-between text-xs font-technical">
                  <span className="text-[#7b7b7b]">TYPOGRAPHY</span>
                  <span className="text-[#111111] font-medium">Newsreader (Editorial)</span>
                </div>
                <div className="flex items-center justify-between text-xs font-technical">
                  <span className="text-[#7b7b7b]">STATUS</span>
                  <span className="text-neutral-500 font-medium">Awaiting input</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-100/70 border border-neutral-200/80 text-[11px] text-[#7b7b7b] leading-relaxed">
                Connectors initialized in preview mode. Provide source content to begin conversion.
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-200 text-center">
              <span className="font-technical text-[10px] text-[#7b7b7b] uppercase tracking-widest">
                BYTELESS COMPRESSION PROTOCOL
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-16 pt-6 border-t border-neutral-200 text-center text-xs text-[#7b7b7b] font-technical">
        <span>CONVERT WORKSPACE · BYTELESS v0.9</span>
      </div>
    </div>
  );
};
