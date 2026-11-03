import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Type, ArrowRight, BookOpen, Sun, Moon, Copy, Download, FileText, Play, Pause, Square, Volume2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadDocumentExport, getActiveDocument, saveDocument, type ConvertedDocument } from '../lib/documents';
import { availableSpeechLanguages, splitSpeechText } from '../lib/speech';
import { documentByteDelta } from '../lib/performance';

export const ReaderPage: React.FC = () => {
  const [doc, setDoc] = useState<ConvertedDocument | null>(null);
  const [size, setSize] = useState(18);
  const [dark, setDark] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechLanguage, setSpeechLanguage] = useState('');
  const [speechVoiceURI, setSpeechVoiceURI] = useState('');
  const [speechState, setSpeechState] = useState<'idle'|'speaking'|'paused'|'error'>('idle');
  const [speechMessage, setSpeechMessage] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const speechQueue = useRef<string[]>([]);
  const speechIndex = useRef(0);
  const speechRun = useRef(0);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  useEffect(() => { let alive=true; getActiveDocument().then(value=>{if(alive)setDoc(value);}).catch(error=>{if(alive)setMessage(error instanceof Error?error.message:'Could not load the document.');}).finally(()=>{if(alive)setLoading(false);}); return()=>{alive=false;}; },[]);
  useEffect(() => { const update=()=>{const max=document.documentElement.scrollHeight-innerHeight;setProgress(max>0?Math.round(scrollY/max*100):100);}; window.addEventListener('scroll',update); update(); return()=>window.removeEventListener('scroll',update); },[]);
  useEffect(() => {
    const available = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    setSpeechSupported(available);
    if (!available) { setSpeechMessage('Text-to-speech is unavailable in this browser.'); return; }
    const synthesis = window.speechSynthesis;
    speechSynthesisRef.current = synthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh();
    synthesis.addEventListener('voiceschanged', refresh);
    const retry = window.setTimeout(refresh, 300);
    return () => { window.clearTimeout(retry); synthesis.removeEventListener('voiceschanged', refresh); };
  },[]);
  useEffect(() => {
    if (!voices.length || speechLanguage) return;
    const preferred = voices.find(voice=>voice.default) || voices[0];
    setSpeechLanguage(preferred.lang);
    setSpeechVoiceURI(preferred.voiceURI);
  },[voices,speechLanguage]);
  useEffect(() => () => {
    speechRun.current += 1;
    speechSynthesisRef.current?.cancel();
  },[doc?.id]);
  const copy = async () => { if(!doc)return; try { await navigator.clipboard.writeText(doc.text); setMessage('Copied to clipboard'); } catch { setMessage('Clipboard access was denied'); } };
  const saveOffline = async () => { if(!doc)return; try { await saveDocument(doc); setDoc({...doc,savedAt:doc.savedAt||Date.now()}); setMessage('Saved offline on this device'); } catch(error) { setMessage(error instanceof Error?error.message:'Could not save this document.'); } };
  const exportFile = () => { if(!doc)return; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([doc.html],{type:'text/html'})); a.download=`${doc.title.replace(/[^\w-]+/g,'-')||'byteless-document'}.html`; a.click(); URL.revokeObjectURL(a.href); };
  const filteredVoices = voices.filter(voice=>!speechLanguage || voice.lang===speechLanguage);
  const languageOptions = availableSpeechLanguages(voices);
  const byteDelta = doc ? documentByteDelta(doc.originalBytes,doc.convertedBytes) : {bytesSaved:0,percentageSaved:0,outputLarger:false};
  const speakNext = (run:number) => {
    if (run !== speechRun.current) return;
    const chunk = speechQueue.current[speechIndex.current];
    if (!chunk) { setSpeechState('idle'); setSpeechMessage('Finished reading.'); return; }
    const utterance = new SpeechSynthesisUtterance(chunk);
    const voice = filteredVoices.find(item=>item.voiceURI===speechVoiceURI) || filteredVoices[0];
    if (voice) { utterance.voice=voice; utterance.lang=voice.lang; }
    else if (speechLanguage) utterance.lang=speechLanguage;
    utterance.onstart=()=>{if(run===speechRun.current)setSpeechState('speaking');};
    utterance.onend=()=>{if(run===speechRun.current){speechIndex.current+=1;speakNext(run);}};
    utterance.onerror=event=>{if(run===speechRun.current){setSpeechState('error');setSpeechMessage(`Speech playback failed: ${event.error}.`);}};
    speechSynthesisRef.current?.speak(utterance);
  };
  const playSpeech = () => {
    if (!doc?.text.trim()) { setSpeechMessage('This document has no readable text to speak.'); return; }
    if (!speechSupported || !speechSynthesisRef.current) { setSpeechMessage('Text-to-speech is unavailable in this browser.'); return; }
    speechRun.current+=1;
    const run=speechRun.current;
    speechSynthesisRef.current.cancel();
    speechQueue.current=splitSpeechText(doc.text);
    speechIndex.current=0;
    setSpeechMessage(voices.length?'Playing document text.':'Using the system default voice.');
    speakNext(run);
  };
  const pauseSpeech = () => { speechSynthesisRef.current?.pause(); setSpeechState('paused'); setSpeechMessage('Speech paused.'); };
  const resumeSpeech = () => { speechSynthesisRef.current?.resume(); setSpeechState('speaking'); setSpeechMessage('Speech resumed.'); };
  const stopSpeech = () => { speechRun.current+=1; speechQueue.current=[]; speechIndex.current=0; speechSynthesisRef.current?.cancel(); setSpeechState('idle'); setSpeechMessage('Speech stopped.'); };
  const changeLanguage = (language:string) => { setSpeechLanguage(language); const first=voices.find(voice=>voice.lang===language); setSpeechVoiceURI(first?.voiceURI||''); };
  return <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-3xl mx-auto select-text">
    <div className="flex items-center justify-between pb-4 mb-8 border-b border-neutral-200 text-xs font-technical text-[#7b7b7b]">
      <div className="flex items-center gap-2"><span>READER VIEW</span><span>·</span><span>{doc ? `${progress}% READ` : 'NO DOCUMENT LOADED'}</span></div>
      {doc && <div className="flex flex-wrap items-center justify-end gap-2">
        <button aria-label="Decrease font size" onClick={()=>setSize(Math.max(14,size-1))} className="px-2 py-1 rounded border border-neutral-300 bg-white/60">A−</button><Type className="w-3 h-3"/><button aria-label="Increase font size" onClick={()=>setSize(Math.min(28,size+1))} className="px-2 py-1 rounded border border-neutral-300 bg-white/60">A+</button>
        <button aria-label="Toggle reader theme" onClick={()=>setDark(!dark)} className="p-1.5 rounded border border-neutral-300 bg-white/60">{dark?<Sun className="w-3.5 h-3.5"/>:<Moon className="w-3.5 h-3.5"/>}</button>
        <button aria-label="Save document to Saved Content" title={doc.savedAt?'Saved in your library':'Save to Saved Content for offline access'} onClick={()=>void saveOffline()} className="p-1.5 rounded border border-neutral-300 bg-white/60"><Bookmark className="w-3.5 h-3.5"/></button>
        <button aria-label="Copy content" onClick={copy} className="p-1.5 rounded border border-neutral-300 bg-white/60"><Copy className="w-3.5 h-3.5"/></button>
        <button aria-label="Export document" onClick={exportFile} className="p-1.5 rounded border border-neutral-300 bg-white/60"><Download className="w-3.5 h-3.5"/></button>
        <button aria-label="Export TXT" title="Download TXT" onClick={()=>downloadDocumentExport(doc,'txt')} className="px-1.5 py-1 rounded border border-neutral-300 bg-white/60 text-[10px]">TXT</button>
        <button aria-label="Export Markdown" title="Download Markdown" onClick={()=>downloadDocumentExport(doc,'md')} className="px-1.5 py-1 rounded border border-neutral-300 bg-white/60 text-[10px]"><FileText className="w-3 h-3 inline mr-1"/>MD</button>
      </div>}
    </div>
    {doc && <section aria-label="Text to speech controls" className="mb-6 rounded-xl border border-neutral-200 bg-white/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-technical text-[11px] uppercase tracking-wider text-[#7b7b7b]"><Volume2 className="w-3.5 h-3.5"/>LISTEN</span>
        {speechSupported && <>
          <label className="sr-only" htmlFor="speech-language">Speech language</label>
          <select id="speech-language" aria-label="Speech language" value={speechLanguage} onChange={event=>changeLanguage(event.target.value)} className="max-w-32 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs" disabled={!languageOptions.length}>
            {!languageOptions.length&&<option value="">Loading voices</option>}
            {languageOptions.map(language=><option key={language} value={language}>{language}</option>)}
          </select>
          <label className="sr-only" htmlFor="speech-voice">Speech voice</label>
          <select id="speech-voice" aria-label="Speech voice" value={speechVoiceURI} onChange={event=>setSpeechVoiceURI(event.target.value)} className="max-w-44 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs" disabled={!filteredVoices.length}>
            {!filteredVoices.length&&<option value="">System default voice</option>}
            {filteredVoices.map(voice=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
          </select>
          <button type="button" aria-label="Play document speech" title="Play" disabled={!doc.text.trim()} onClick={playSpeech} className="p-1.5 rounded border border-neutral-300 bg-white/70 disabled:opacity-40"><Play className="w-3.5 h-3.5"/></button>
          <button type="button" aria-label="Pause speech" title="Pause" disabled={speechState!=='speaking'} onClick={pauseSpeech} className="p-1.5 rounded border border-neutral-300 bg-white/70 disabled:opacity-40"><Pause className="w-3.5 h-3.5"/></button>
          <button type="button" aria-label="Resume speech" title="Resume" disabled={speechState!=='paused'} onClick={resumeSpeech} className="p-1.5 rounded border border-neutral-300 bg-white/70 disabled:opacity-40"><Play className="w-3.5 h-3.5"/></button>
          <button type="button" aria-label="Stop speech" title="Stop" disabled={speechState==='idle'} onClick={stopSpeech} className="p-1.5 rounded border border-neutral-300 bg-white/70 disabled:opacity-40"><Square className="w-3.5 h-3.5"/></button>
        </>}
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-[11px] text-[#7b7b7b]">{speechMessage || (speechSupported ? (!doc.text.trim()?'This document has no readable text to speak.':voices.length?'Ready to read aloud.':'No browser voices detected yet; the system default may still be available.') : 'Text-to-speech is unavailable in this browser.')}</p>
    </section>}
    {doc && <section aria-label="Translation and summary availability" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-neutral-200 pb-3 text-[11px] text-[#7b7b7b]">
      <span>Translation unavailable · no provider configured; document text stays on this device.</span><span>AI summary unavailable · no provider configured.</span>
    </section>}
    {!doc ? <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 sm:p-20 text-center flex flex-col items-center justify-center my-6 backdrop-blur-xs">{loading?<p className="text-sm text-[#7b7b7b]">Loading document…</p>:<><div className="w-14 h-14 rounded-full bg-neutral-200/60 flex items-center justify-center text-neutral-600 mb-5"><BookOpen className="w-6 h-6 text-[#111111]"/></div><h1 className="font-editorial text-3xl sm:text-4xl text-[#111111]">Nothing to read yet</h1><p className="mt-3 text-sm text-[#7b7b7b]">Convert a webpage or document to see its lightweight version here.</p><Link to="/convert" className="mt-8 inline-flex items-center gap-2 bg-[#0d0d0d] text-[#f7f7f5] px-6 py-2.5 rounded-full text-xs">Go to Convert <ArrowRight className="w-3.5 h-3.5"/></Link></>}</div> : <article className={`rounded-2xl border border-neutral-200 p-6 sm:p-10 ${dark?'bg-[#171717] text-[#f2f0e9]':'bg-white/70 text-[#111111]'}`}>
      <h1 className="font-editorial text-3xl sm:text-4xl mb-2">{doc.title}</h1><p className="mb-8 text-xs text-neutral-500">{doc.source}</p>
      <div style={{fontSize:size,lineHeight:1.75}} className="reader-content font-editorial [&_p]:my-4 [&_h2]:text-2xl [&_h2]:mt-8 [&_h3]:text-xl [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic" dangerouslySetInnerHTML={{__html:doc.html}}/>
      <section aria-label="Performance scorecard" className="mt-8 pt-4 border-t border-neutral-200 text-xs text-neutral-500 font-technical space-y-1">
        <p>PERFORMANCE SCORECARD · {doc.mode.toUpperCase()} MODE</p>
        <p>DOCUMENT BYTES {doc.originalBytes.toLocaleString()} B → {doc.convertedBytes.toLocaleString()} B · {byteDelta.outputLarger ? `${Math.abs(byteDelta.bytesSaved).toLocaleString()} B larger (${Math.abs(byteDelta.percentageSaved).toFixed(1)}%)` : `${byteDelta.bytesSaved.toLocaleString()} B saved (${byteDelta.percentageSaved.toFixed(1)}%)`}</p>
        {doc.metrics ? <>
          <p>IMAGES · {doc.metrics.imagesPreserved} preserved · {doc.metrics.imagesOptimized} optimized · {doc.metrics.imagesDeferred} deferred · {doc.metrics.imagesOmitted} omitted · {doc.metrics.optimizationFailures} optimization failures</p>
          <p>SCRIPTS · {doc.metrics.scriptsDetected} detected · {doc.metrics.scriptsRemoved} removed from output</p>
          <p>TRACKER-LIKE REFERENCES · {doc.metrics.trackersDetected} detected · {doc.metrics.trackersRemoved} removed from output; this does not measure or block network requests</p>
          {doc.metrics.processingDetails.map((detail,index)=><p key={`detail-${index}`}>DETAIL: {detail}</p>)}
          <p>MEASUREMENT SCOPE: {doc.measurementScope || doc.metrics.measurementScope}</p>
        </> : <p>Image, script, and tracker counts were not recorded for this legacy saved document.</p>}
        <p>Whole-page network traffic and subresource transfers are not measured.</p>
        <p>ELEMENTS REMOVED {doc.removed} · EXTRACTION FAILURES {doc.integrity?.extractionFailures ?? 0}</p>
        {doc.warnings?.map((warning,index)=><p key={`warning-${index}`}>WARNING: {warning}</p>)}{doc.integrity?.potentiallyLostImportantContent.map((entry,index)=><p key={`loss-${index}`}>POTENTIAL CONTENT LOSS: {entry}</p>)}
      </section>
    </article>}
    {message && <p role="status" className="mt-3 text-xs text-[#7b7b7b]">{message}</p>}
    <footer className="mt-16 pt-6 border-t border-neutral-200 flex justify-between text-xs font-technical text-[#7b7b7b]"><span>READER INTERFACE · DISTRACTION FREE</span><span>STATUS: {doc?(doc.savedAt?'LIBRARY · TEXT OFFLINE READY':'LOCAL · NOT IN SAVED CONTENT'):'STANDBY'}</span></footer>
  </div>;
};
