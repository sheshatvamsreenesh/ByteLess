/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Type,
  ArrowRight,
  BookOpen,
  Copy,
  Download,
  FileText,
  Play,
  Pause,
  Square,
  Volume2,
  Languages,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCcw,
  Check,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadDocumentExport, getActiveDocument, saveDocument, type ConvertedDocument } from '../lib/documents';
import { availableSpeechLanguages, splitSpeechText } from '../lib/speech';
import { documentByteDelta } from '../lib/performance';
import { summarizeText, translateHtml, proxyDeferredImageUrl, type SummaryResult } from '../lib/api';

export const ReaderPage: React.FC = () => {
  const [doc, setDoc] = useState<ConvertedDocument | null>(null);
  const [originalHtml, setOriginalHtml] = useState<string>('');
  const [currentHtml, setCurrentHtml] = useState<string>('');
  const [size, setSize] = useState(18);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // Translation state
  const [translating, setTranslating] = useState(false);
  const [translationLang, setTranslationLang] = useState<'hi' | 'en'>('hi');
  const [isTranslated, setIsTranslated] = useState(false);
  const [translationProvider, setTranslationProvider] = useState('');

  // AI Summary state
  const [summarizing, setSummarizing] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryResult | null>(null);
  const [showSummaryView, setShowSummaryView] = useState(false);

  // Integrity Report collapsible
  const [showIntegrityReport, setShowIntegrityReport] = useState(false);

  // Web Speech state
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechLanguage, setSpeechLanguage] = useState('');
  const [speechVoiceURI, setSpeechVoiceURI] = useState('');
  const [speechState, setSpeechState] = useState<'idle' | 'speaking' | 'paused' | 'error'>('idle');
  const [speechMessage, setSpeechMessage] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const speechQueue = useRef<string[]>([]);
  const speechIndex = useRef(0);
  const speechRun = useRef(0);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  // Load active document on mount
  useEffect(() => {
    let alive = true;
    getActiveDocument()
      .then((value) => {
        if (alive && value) {
          setDoc(value);
          setOriginalHtml(value.html);
          setCurrentHtml(value.html);
        }
      })
      .catch((error) => {
        if (alive) setMessage(error instanceof Error ? error.message : 'Could not load document.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Track scroll progress
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 0 ? Math.round((scrollY / max) * 100) : 100);
    };
    window.addEventListener('scroll', update);
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);

  // Estimated reading time calculation (approx 200 words per minute)
  const readingTimeMin = useMemo(() => {
    if (!doc?.text) return 1;
    const words = doc.text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }, [doc?.text]);

  // Web Speech API initialization
  useEffect(() => {
    const available =
      typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    setSpeechSupported(available);
    if (!available) {
      setSpeechMessage('Text-to-speech is unavailable in this browser.');
      return;
    }
    const synthesis = window.speechSynthesis;
    speechSynthesisRef.current = synthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh();
    synthesis.addEventListener('voiceschanged', refresh);
    const retry = window.setTimeout(refresh, 300);
    return () => {
      window.clearTimeout(retry);
      synthesis.removeEventListener('voiceschanged', refresh);
    };
  }, []);

  useEffect(() => {
    if (!voices.length || speechLanguage) return;
    const preferred = voices.find((voice) => voice.default) || voices[0];
    setSpeechLanguage(preferred.lang);
    setSpeechVoiceURI(preferred.voiceURI);
  }, [voices, speechLanguage]);

  useEffect(
    () => () => {
      speechRun.current += 1;
      speechSynthesisRef.current?.cancel();
    },
    [doc?.id]
  );

  // Handle on-demand deferred image loading in Ultra Mode via event delegation
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.load-deferred-image-btn') as HTMLButtonElement | null;
      if (!target) return;

      const remoteUrl = target.getAttribute('data-url');
      if (!remoteUrl) return;

      const placeholder = target.closest('.deferred-image-placeholder');
      if (!placeholder) return;

      target.disabled = true;
      target.textContent = 'Loading image…';

      const proxiedUrl = proxyDeferredImageUrl(remoteUrl, 75);
      const img = new Image();
      img.onload = () => {
        img.className = 'rounded-xl border border-neutral-200 my-4 max-w-full h-auto shadow-xs';
        img.alt = placeholder.getAttribute('data-alt') || 'Loaded image';
        placeholder.replaceWith(img);
        setMessage('Deferred image loaded on demand.');
      };
      img.onerror = () => {
        target.disabled = false;
        target.textContent = 'Retry Loading';
        setMessage('Failed to load image from remote host.');
      };
      img.src = proxiedUrl;
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [currentHtml]);

  const copy = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.text);
      setMessage('Copied article text to clipboard.');
    } catch {
      setMessage('Clipboard access was denied.');
    }
  };

  const saveOffline = async () => {
    if (!doc) return;
    try {
      await saveDocument(doc);
      setDoc({ ...doc, savedAt: doc.savedAt || Date.now() });
      setMessage('Saved to your personal offline library.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save document.');
    }
  };

  const exportFile = () => {
    if (!doc) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc.html], { type: 'text/html' }));
    a.download = `${doc.title.replace(/[^\w-]+/g, '-') || 'byteless-document'}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Translation Handler (English <-> Hindi)
  const handleTranslate = async () => {
    if (!doc) return;
    setTranslating(true);
    setMessage('');
    try {
      const sourceLang = translationLang === 'hi' ? 'en' : 'hi';
      const targetLang = translationLang;
      const result = await translateHtml(doc.html, sourceLang, targetLang);
      setCurrentHtml(result.translatedHtml);
      setIsTranslated(true);
      setTranslationProvider(result.provider || 'Translation Engine');
      setMessage(`Document translated to ${targetLang === 'hi' ? 'Hindi' : 'English'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Translation failed.');
    } finally {
      setTranslating(false);
    }
  };

  const handleRevertTranslation = () => {
    setCurrentHtml(originalHtml);
    setIsTranslated(false);
    setMessage('Reverted to original document content.');
  };

  // AI Summary Handler
  const handleGenerateSummary = async () => {
    if (!doc) return;
    setSummarizing(true);
    setMessage('');
    try {
      const res = await summarizeText(doc.text, doc.title);
      setSummaryData(res);
      setShowSummaryView(true);
      setMessage('Summary generated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not generate summary.');
    } finally {
      setSummarizing(false);
    }
  };

  // Web Speech Actions
  const filteredVoices = voices.filter((voice) => !speechLanguage || voice.lang === speechLanguage);
  const languageOptions = availableSpeechLanguages(voices);
  const byteDelta = doc
    ? documentByteDelta(doc.originalBytes, doc.convertedBytes)
    : { bytesSaved: 0, percentageSaved: 0, outputLarger: false };

  const speakNext = (run: number) => {
    if (run !== speechRun.current) return;
    const chunk = speechQueue.current[speechIndex.current];
    if (!chunk) {
      setSpeechState('idle');
      setSpeechMessage('Finished reading aloud.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk);
    const voice = filteredVoices.find((item) => item.voiceURI === speechVoiceURI) || filteredVoices[0];
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (speechLanguage) {
      utterance.lang = speechLanguage;
    }
    utterance.onstart = () => {
      if (run === speechRun.current) setSpeechState('speaking');
    };
    utterance.onend = () => {
      if (run === speechRun.current) {
        speechIndex.current += 1;
        speakNext(run);
      }
    };
    utterance.onerror = (event) => {
      if (run === speechRun.current) {
        setSpeechState('error');
        setSpeechMessage(`Speech playback failed: ${event.error}.`);
      }
    };
    speechSynthesisRef.current?.speak(utterance);
  };

  const playSpeech = () => {
    if (!doc?.text.trim()) {
      setSpeechMessage('This document has no readable text to speak.');
      return;
    }
    if (!speechSupported || !speechSynthesisRef.current) {
      setSpeechMessage('Text-to-speech is unavailable in this browser.');
      return;
    }
    speechRun.current += 1;
    const run = speechRun.current;
    speechSynthesisRef.current.cancel();
    speechQueue.current = splitSpeechText(doc.text);
    speechIndex.current = 0;
    setSpeechMessage(voices.length ? 'Reading document aloud…' : 'Using system voice.');
    speakNext(run);
  };

  const pauseSpeech = () => {
    speechSynthesisRef.current?.pause();
    setSpeechState('paused');
    setSpeechMessage('Speech paused.');
  };

  const resumeSpeech = () => {
    speechSynthesisRef.current?.resume();
    setSpeechState('speaking');
    setSpeechMessage('Speech resumed.');
  };

  const stopSpeech = () => {
    speechRun.current += 1;
    speechQueue.current = [];
    speechIndex.current = 0;
    speechSynthesisRef.current?.cancel();
    setSpeechState('idle');
    setSpeechMessage('Speech stopped.');
  };

  const changeLanguage = (language: string) => {
    setSpeechLanguage(language);
    const first = voices.find((voice) => voice.lang === language);
    setSpeechVoiceURI(first?.voiceURI || '');
  };

  return (
    <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-3xl mx-auto select-text">
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between pb-4 mb-8 border-b border-neutral-200 text-xs font-technical text-[#7b7b7b]">
        <div className="flex items-center gap-2">
          <span>READER VIEW</span>
          <span>·</span>
          <span>{doc ? `${progress}% READ · ~${readingTimeMin} MIN` : 'NO DOCUMENT LOADED'}</span>
        </div>
        {doc && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              aria-label="Decrease font size"
              onClick={() => setSize(Math.max(14, size - 1))}
              className="px-2 py-1 rounded border border-neutral-300 bg-white/70 hover:bg-neutral-100 transition-colors"
            >
              A−
            </button>
            <Type className="w-3 h-3 text-neutral-400" />
            <button
              aria-label="Increase font size"
              onClick={() => setSize(Math.min(28, size + 1))}
              className="px-2 py-1 rounded border border-neutral-300 bg-white/70 hover:bg-neutral-100 transition-colors"
            >
              A+
            </button>
            <button
              aria-label="Save document offline"
              title={doc.savedAt ? 'Saved in library' : 'Save for offline access'}
              onClick={() => void saveOffline()}
              className={`p-1.5 rounded border border-neutral-300 transition-colors ${
                doc.savedAt ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white/70 hover:bg-neutral-100'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label="Copy article content"
              onClick={copy}
              className="p-1.5 rounded border border-neutral-300 bg-white/70 hover:bg-neutral-100 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label="Export document HTML"
              onClick={exportFile}
              className="p-1.5 rounded border border-neutral-300 bg-white/70 hover:bg-neutral-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label="Export TXT"
              title="Download plain text (.txt)"
              onClick={() => downloadDocumentExport(doc, 'txt')}
              className="px-1.5 py-1 rounded border border-neutral-300 bg-white/70 text-[10px] hover:bg-neutral-100 transition-colors"
            >
              TXT
            </button>
            <button
              aria-label="Export Markdown"
              title="Download Markdown (.md)"
              onClick={() => downloadDocumentExport(doc, 'md')}
              className="px-1.5 py-1 rounded border border-neutral-300 bg-white/70 text-[10px] hover:bg-neutral-100 transition-colors flex items-center gap-1"
            >
              <FileText className="w-3 h-3" />
              MD
            </button>
          </div>
        )}
      </div>

      {/* Voice Reading (Web Speech API) */}
      {doc && (
        <section aria-label="Text to speech controls" className="mb-6 rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-technical text-[11px] uppercase tracking-wider text-[#7b7b7b]">
              <Volume2 className="w-3.5 h-3.5" />
              LISTEN
            </span>
            {speechSupported && (
              <>
                <label className="sr-only" htmlFor="speech-language">
                  Speech language
                </label>
                <select
                  id="speech-language"
                  aria-label="Speech language"
                  value={speechLanguage}
                  onChange={(event) => changeLanguage(event.target.value)}
                  className="max-w-32 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                  disabled={!languageOptions.length}
                >
                  {!languageOptions.length && <option value="">Loading voices</option>}
                  {languageOptions.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="speech-voice">
                  Speech voice
                </label>
                <select
                  id="speech-voice"
                  aria-label="Speech voice"
                  value={speechVoiceURI}
                  onChange={(event) => setSpeechVoiceURI(event.target.value)}
                  className="max-w-44 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                  disabled={!filteredVoices.length}
                >
                  {!filteredVoices.length && <option value="">System default voice</option>}
                  {filteredVoices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Play document speech"
                    title="Play"
                    disabled={!doc.text.trim()}
                    onClick={playSpeech}
                    className="p-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Pause speech"
                    title="Pause"
                    disabled={speechState !== 'speaking'}
                    onClick={pauseSpeech}
                    className="p-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Resume speech"
                    title="Resume"
                    disabled={speechState !== 'paused'}
                    onClick={resumeSpeech}
                    className="p-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Stop speech"
                    title="Stop"
                    disabled={speechState === 'idle'}
                    onClick={stopSpeech}
                    className="p-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
          <p role="status" aria-live="polite" className="mt-2 text-[11px] text-[#7b7b7b]">
            {speechMessage ||
              (speechSupported
                ? !doc.text.trim()
                  ? 'This document has no readable text to speak.'
                  : voices.length
                  ? 'Ready to read aloud.'
                  : 'System voice ready.'
                : 'Text-to-speech is unavailable in this browser.')}
          </p>
        </section>
      )}

      {/* AI Assistant & Translation Bar */}
      {doc && (
        <section aria-label="Reader intelligence tools" className="mb-6 rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* AI Summary Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={summarizing}
                onClick={handleGenerateSummary}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0d0d0d] text-[#f7f7f5] text-xs font-medium hover:bg-neutral-800 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>{summarizing ? 'Generating…' : 'Generate AI Summary'}</span>
              </button>
              {summaryData && (
                <button
                  type="button"
                  onClick={() => setShowSummaryView(!showSummaryView)}
                  className="px-3 py-1.5 rounded-full border border-neutral-300 bg-white text-xs font-medium hover:bg-neutral-100 cursor-pointer"
                >
                  {showSummaryView ? 'View Full Article' : 'View Summary'}
                </button>
              )}
            </div>

            {/* Translation Controls (English <-> Hindi) */}
            <div className="flex items-center gap-2">
              <Languages className="w-3.5 h-3.5 text-neutral-500" />
              <select
                value={translationLang}
                onChange={(e) => setTranslationLang(e.target.value as 'hi' | 'en')}
                disabled={translating}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
              >
                <option value="hi">Translate to Hindi (हिन्दी)</option>
                <option value="en">Translate to English</option>
              </select>
              {!isTranslated ? (
                <button
                  type="button"
                  disabled={translating}
                  onClick={handleTranslate}
                  className="px-3 py-1.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {translating ? 'Translating…' : 'Translate'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRevertTranslation}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Original</span>
                </button>
              )}
            </div>
          </div>

          {/* AI Summary Banner */}
          {showSummaryView && summaryData && (
            <div className="mt-3 p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-xs space-y-2">
              <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
                <span className="font-technical text-[11px] uppercase tracking-wider text-amber-900 font-medium">
                  {summaryData.label} · {summaryData.provider}
                </span>
                <span className="text-[10px] text-amber-800">3–5 KEY POINTS</span>
              </div>
              <ul className="space-y-1.5 text-neutral-800 leading-relaxed list-disc pl-4 pt-1">
                {summaryData.summary.map((point, i) => (
                  <li key={`summary-${i}`}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {isTranslated && (
            <p className="text-[11px] text-[#7b7b7b]">
              Showing translated text ({translationLang.toUpperCase()}) powered by {translationProvider}. Original document
              structure and headings are preserved.
            </p>
          )}
        </section>
      )}

      {/* Main Content Area */}
      {!doc ? (
        <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 sm:p-20 text-center flex flex-col items-center justify-center my-6 backdrop-blur-xs">
          {loading ? (
            <p className="text-sm text-[#7b7b7b]">Loading document…</p>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-neutral-200/60 flex items-center justify-center text-neutral-600 mb-5">
                <BookOpen className="w-6 h-6 text-[#111111]" />
              </div>
              <h1 className="font-editorial text-3xl sm:text-4xl text-[#111111]">Nothing to read yet</h1>
              <p className="mt-3 text-sm text-[#7b7b7b]">Convert a webpage or document to see its lightweight version here.</p>
              <Link
                to="/convert"
                className="mt-8 inline-flex items-center gap-2 bg-[#0d0d0d] text-[#f7f7f5] px-6 py-2.5 rounded-full text-xs"
              >
                Go to Convert <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>
      ) : (
        <article className="rounded-2xl border border-neutral-200 p-6 sm:p-10 bg-white/70 text-[#111111] shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full border border-neutral-300/80 text-[10px] font-technical uppercase text-[#7b7b7b]">
              {doc.mode} Mode
            </span>
            <span className="text-xs text-neutral-400 font-technical">
              <Clock className="w-3 h-3 inline mr-1" />
              ~{readingTimeMin} min read
            </span>
          </div>
          <h1 className="font-editorial text-3xl sm:text-4xl mb-2">{doc.title}</h1>
          <p className="mb-8 text-xs text-neutral-500 truncate">{doc.source}</p>

          {/* Rendered Semantic Prose */}
          <div
            ref={contentRef}
            style={{ fontSize: size, lineHeight: 1.75 }}
            className="reader-content font-editorial [&_p]:my-4 [&_h2]:text-2xl [&_h2]:mt-8 [&_h3]:text-xl [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-neutral-300 [&_th]:p-2 [&_th]:bg-neutral-100/50 [&_td]:border [&_td]:border-neutral-300 [&_td]:p-2"
            dangerouslySetInnerHTML={{ __html: currentHtml }}
          />

          {/* Comprehensive Content Integrity & Removal Report */}
          <div className="mt-10 pt-6 border-t border-neutral-200">
            <button
              type="button"
              onClick={() => setShowIntegrityReport(!showIntegrityReport)}
              className="w-full flex items-center justify-between text-left py-2 font-technical text-xs text-[#7b7b7b] hover:text-[#111111] transition-colors"
            >
              <span className="flex items-center gap-2 uppercase tracking-wider font-medium text-[#111111]">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                Content Integrity & Removal Report
              </span>
              <span className="flex items-center gap-1 text-[11px]">
                {showIntegrityReport ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </button>

            {showIntegrityReport && (
              <div className="mt-3 p-4 rounded-xl bg-neutral-100/70 border border-neutral-200 text-xs font-technical space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                    <span className="text-[10px] text-emerald-800 uppercase block font-medium">PRESERVED</span>
                    <span className="text-lg font-editorial text-neutral-900 block mt-0.5">
                      {(doc.integrity?.headingsPreserved || 0) +
                        (doc.integrity?.paragraphsPreserved || 0) +
                        (doc.integrity?.listsPreserved || 0) +
                        (doc.integrity?.tablesPreserved || 0) +
                        (doc.metrics?.imagesPreserved || 0)}
                    </span>
                    <span className="text-[10px] text-neutral-500">Elements</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                    <span className="text-[10px] text-amber-800 uppercase block font-medium">DEFERRED</span>
                    <span className="text-lg font-editorial text-neutral-900 block mt-0.5">
                      {doc.integrity?.imagesDeferred || doc.metrics?.imagesDeferred || 0}
                    </span>
                    <span className="text-[10px] text-neutral-500">Images</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                    <span className="text-[10px] text-neutral-600 uppercase block font-medium">REMOVED</span>
                    <span className="text-lg font-editorial text-neutral-900 block mt-0.5">
                      {doc.integrity?.elementsRemoved || doc.removed || 0}
                    </span>
                    <span className="text-[10px] text-neutral-500">Non-essential</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                    <span className="text-[10px] text-blue-800 uppercase block font-medium">TRACKERS STRIPPED</span>
                    <span className="text-lg font-editorial text-neutral-900 block mt-0.5">
                      {doc.integrity?.trackersRemoved || doc.metrics?.trackersRemoved || 0}
                    </span>
                    <span className="text-[10px] text-neutral-500">References</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-neutral-600 pt-2 text-[11px] leading-relaxed">
                  <p className="flex items-center justify-between">
                    <span>Headings Preserved:</span>
                    <strong className="text-neutral-900">{doc.integrity?.headingsPreserved ?? 'Analyzed'}</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    <span>Paragraphs Preserved:</span>
                    <strong className="text-neutral-900">{doc.integrity?.paragraphsPreserved ?? 'Analyzed'}</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    <span>Lists &amp; Tables Preserved:</span>
                    <strong className="text-neutral-900">
                      {(doc.integrity?.listsPreserved || 0) + (doc.integrity?.tablesPreserved || 0)}
                    </strong>
                  </p>
                  <p className="flex items-center justify-between">
                    <span>Hyperlinks Preserved:</span>
                    <strong className="text-neutral-900">{doc.integrity?.linksPreserved ?? 'Analyzed'}</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    <span>Scripts Detected &amp; Removed:</span>
                    <strong className="text-neutral-900">{doc.metrics?.scriptsRemoved || 0}</strong>
                  </p>
                </div>

                <div className="pt-2 border-t border-neutral-200 text-[10px] text-neutral-500 space-y-1">
                  <p>
                    <strong>Integrity Note:</strong> Tracker detection identifies recognizable analytics references in HTML.
                    Removing them from converted output does not claim to intercept or block browser network requests.
                  </p>
                  <p>
                    <strong>Safety Guarantee:</strong> Essential diagrams, data tables, and semantic references are protected by
                    ByteLess deterministic preservation rules.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Performance Scorecard */}
          <section aria-label="Performance scorecard" className="mt-8 pt-4 border-t border-neutral-200 text-xs text-neutral-500 font-technical space-y-1">
            <p className="text-[#111111] font-medium">PERFORMANCE SCORECARD · {doc.mode.toUpperCase()} MODE</p>
            <p>
              DOCUMENT BYTES {doc.originalBytes.toLocaleString()} B → {doc.convertedBytes.toLocaleString()} B ·{' '}
              {byteDelta.outputLarger
                ? `${Math.abs(byteDelta.bytesSaved).toLocaleString()} B larger`
                : `${byteDelta.bytesSaved.toLocaleString()} B saved (${byteDelta.percentageSaved.toFixed(1)}%)`}
            </p>
            {doc.metrics ? (
              <>
                <p>
                  IMAGES · {doc.metrics.imagesPreserved} preserved · {doc.metrics.imagesOptimized} optimized ·{' '}
                  {doc.metrics.imagesDeferred} deferred · {doc.metrics.imagesOmitted} omitted
                </p>
                <p>
                  SCRIPTS · {doc.metrics.scriptsDetected} detected · {doc.metrics.scriptsRemoved} removed
                </p>
                <p>
                  TRACKERS · {doc.metrics.trackersDetected} detected · {doc.metrics.trackersRemoved} references removed
                </p>
                <p className="text-[10px]">
                  ESTIMATED LOADING TIME (2G @ 250 Kbps): ~
                  {Math.max(0.1, (doc.convertedBytes * 8) / (250 * 1024)).toFixed(2)}s (vs ~
                  {Math.max(0.1, (doc.originalBytes * 8) / (250 * 1024)).toFixed(2)}s source document)
                </p>
              </>
            ) : (
              <p>Image, script, and tracker counts were not recorded for this legacy document.</p>
            )}
            <p className="text-[10px]">
              SCOPE: Measured against HTML document payload bytes; excludes third-party subresources and network compression.
            </p>
            {doc.warnings?.map((warning, index) => (
              <p key={`warning-${index}`} className="text-amber-800">
                WARNING: {warning}
              </p>
            ))}
          </section>
        </article>
      )}

      {message && <p role="status" className="mt-3 text-xs text-[#7b7b7b] font-technical">{message}</p>}

      <footer className="mt-16 pt-6 border-t border-neutral-200 flex justify-between text-xs font-technical text-[#7b7b7b]">
        <span>READER INTERFACE · WARM LIGHT THEME</span>
        <span>
          STATUS: {doc ? (doc.savedAt ? 'LIBRARY · OFFLINE READY' : 'LOCAL CACHE · UNARCHIVED') : 'STANDBY'}
        </span>
      </footer>
    </div>
  );
};
