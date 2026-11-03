/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Globe, FileText, Upload, ArrowRight, Download, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { convertHtml, documentFromRemote, setActiveDocument, type DeliveryMode } from '../lib/documents';
import { convertUrl, optimizeUploadedHtml } from '../lib/api';
import { compressPdf, convertPdfToImages, extractPdfText, type PdfTextResult } from '../lib/pdfApi';
import { pdfSizeMetrics, validatePdfUpload } from '../lib/pdf';

type InputMethod = 'url' | 'text' | 'html' | 'pdf';

export const ConvertPage: React.FC = () => {
  const [activeMethod, setActiveMethod] = useState<InputMethod>('url');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [stripTrackers, setStripTrackers] = useState(true);
  const [preserveHeadings, setPreserveHeadings] = useState(true);
  const [compressDOM, setCompressDOM] = useState(true);
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [mode, setMode] = useState<DeliveryMode>('light');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [pdfTextResult, setPdfTextResult] = useState<PdfTextResult | null>(null);
  const [pdfTextUrl, setPdfTextUrl] = useState('');
  const [compressedPdfUrl, setCompressedPdfUrl] = useState('');
  const [compressedPdfSizes, setCompressedPdfSizes] = useState<{ originalBytes: number; convertedBytes: number; bytesSaved: number; reductionPercent: number } | null>(null);
  const [pdfImagesUrl, setPdfImagesUrl] = useState('');
  const [pdfImagePageCount, setPdfImagePageCount] = useState(0);
  const [pdfImageSizes, setPdfImageSizes] = useState<{ originalBytes: number; convertedBytes: number } | null>(null);
  const [compressionQuality, setCompressionQuality] = useState(75);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => () => {
    [pdfPreviewUrl, pdfTextUrl, compressedPdfUrl, pdfImagesUrl].forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, [pdfPreviewUrl, pdfTextUrl, compressedPdfUrl, pdfImagesUrl]);

  const hasInput =
    activeMethod === 'url' ? urlInput.trim().length > 0 :
    activeMethod === 'text' ? textInput.trim().length > 0 : activeMethod === 'html' ? fileContent.length > 0 : !!pdfFile;

  const selectPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      validatePdfUpload(file, new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
      setPdfFile(file);
      setPdfPreviewUrl(URL.createObjectURL(file));
      setPdfTextResult(null); setPdfTextUrl(''); setCompressedPdfUrl(''); setCompressedPdfSizes(null);
      setPdfImagesUrl(''); setPdfImagePageCount(0); setPdfImageSizes(null); setStatus('');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not read that PDF.'); }
    finally { input.value = ''; }
  };

  const downloadBlob = (blob: Blob, setUrl: (url:string)=>void) => {
    setUrl(URL.createObjectURL(blob));
  };

  const runPdfCompression = async () => {
    if (!pdfFile) return;
    setBusy(true); setStatus(`Compressing images at quality ${compressionQuality}…`);
    try {
      const result = await compressPdf(pdfFile, compressionQuality);
      setCompressedPdfSizes(result);
      downloadBlob(result.blob, setCompressedPdfUrl);
      setStatus(result.bytesSaved >= 0 ? 'PDF compression completed.' : 'Compression completed; this file became larger, so the original is unchanged.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'PDF compression failed. The original file is unchanged.'); }
    finally { setBusy(false); }
  };

  const runPdfImages = async () => {
    if (!pdfFile) return;
    setBusy(true); setStatus('Rendering PDF pages as images…');
    try {
      const result = await convertPdfToImages(pdfFile);
      setPdfImagePageCount(result.pages || 0);
      setPdfImageSizes({ originalBytes: result.originalBytes, convertedBytes: result.convertedBytes });
      downloadBlob(result.blob, setPdfImagesUrl);
      setStatus(`${result.pages || 0} page images are ready to download.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'PDF image conversion failed.'); }
    finally { setBusy(false); }
  };

  const openExtractedText = async () => {
    if (!pdfTextResult || !pdfFile) return;
    const escaped = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    const html = `<html><head><title>${escaped(pdfTextResult.title)}</title></head><body><article>${pdfTextResult.text.split(/\n\s*\n/).map(p=>`<p>${escaped(p).replace(/\n/g,'<br>')}</p>`).join('')}</article></body></html>`;
    const doc = convertHtml(html, pdfFile.name, mode, pdfTextResult.text);
    doc.title = pdfTextResult.title; doc.originalBytes = pdfTextResult.originalBytes; doc.convertedBytes = pdfTextResult.convertedBytes;
    doc.warnings = pdfTextResult.warnings;
    doc.measurementScope = pdfTextResult.measurementScope;
    if (doc.metrics) {
      doc.metrics = { ...doc.metrics, ...pdfTextResult.imageMetrics, ...pdfTextResult.scriptMetrics, processingDetails: pdfTextResult.processingDetails, measurementScope: pdfTextResult.measurementScope };
    }
    await setActiveDocument(doc); navigate('/reader');
  };

  const processInput = async () => {
    if (activeMethod === 'pdf') {
      if (!pdfFile) { setStatus('Select a valid PDF file first.'); return; }
      setBusy(true); setStatus('Extracting selectable text from PDF…');
      try {
        const result = await extractPdfText(pdfFile);
        setPdfTextResult(result);
        const textUrl = URL.createObjectURL(new Blob([result.text], { type: 'text/plain;charset=utf-8' }));
        setPdfTextUrl(textUrl);
        setStatus(`Extracted text from ${result.pages} page${result.pages === 1 ? '' : 's'}.`);
      } catch (error) { setStatus(error instanceof Error ? error.message : 'PDF text extraction failed.'); }
      finally { setBusy(false); }
      return;
    }
    if (activeMethod === 'url') {
      let parsed: URL;
      const candidate = /^https?:\/\//i.test(urlInput.trim()) ? urlInput.trim() : `https://${urlInput.trim()}`;
      try { parsed = new URL(candidate); if (!['http:','https:'].includes(parsed.protocol)) throw new Error(); }
      catch { setStatus('Enter a valid http or https webpage URL.'); return; }
      setBusy(true); setStatus('Fetching webpage and extracting article…');
      try {
        const result = await convertUrl(parsed.href, mode);
        const doc = documentFromRemote(result);
        if (!doc.text) throw new Error('No readable article content was extracted.');
        await setActiveDocument(doc); navigate('/reader');
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not convert this webpage.'); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true); setStatus('');
    try {
      const input = activeMethod === 'text' ? textInput : fileContent;
      const escaped = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
      let html = activeMethod === 'text' && !/<[a-z][\s\S]*>/i.test(input)
        ? `<article><h1>${escaped(input.trim().split(/\n+/)[0].slice(0,120))}</h1>${input.trim().split(/\n\s*\n/).map(p=>`<p>${escaped(p)}</p>`).join('')}</article>` : input;
      let imageReport: {imagesOptimized:number;imagesUnchanged:number;optimizationFailures:number;warnings:string[];processingDetails:string[]} | undefined;
      if (activeMethod === 'html' && htmlFile) {
        try {
          const result = await optimizeUploadedHtml(htmlFile, mode, compressionQuality);
          html = result.html;
          imageReport = { imagesOptimized: result.imageMetrics.imagesOptimized, imagesUnchanged: result.imageMetrics.imagesUnchanged, optimizationFailures: result.imageMetrics.optimizationFailures, warnings: result.warnings, processingDetails: [...result.processingDetails, `Image optimization backend measured the uploaded HTML at ${result.originalBytes.toLocaleString()} B before optimization.`] };
        } catch (error) {
          imageReport = { imagesOptimized: 0, imagesUnchanged: 0, optimizationFailures: 1, warnings: [`Image optimization was unavailable; uploaded images were preserved without optimization. ${error instanceof Error ? error.message : ''}`], processingDetails: ['Client-side HTML sanitization continued; no image resources were fetched.'] };
        }
      }
      const doc = convertHtml(html, activeMethod === 'html' ? fileName : 'Pasted text', mode, input, imageReport);
      if (activeMethod === 'html' && htmlFile) doc.originalBytes = htmlFile.size;
      if (!doc.text) throw new Error('No readable content was found in that input.');
      await setActiveDocument(doc); navigate('/reader');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not process this input.'); }
    finally { setBusy(false); }
  };

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
          <button
            onClick={() => { setActiveMethod('pdf'); setStatus(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer ${activeMethod === 'pdf' ? 'bg-[#0d0d0d] text-[#f7f7f5] shadow-xs' : 'text-[#7b7b7b] hover:text-[#111111] hover:bg-neutral-100/70'}`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF Tools</span>
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
                    {fileName || 'AWAITING FILE'}
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
                  <input ref={fileRef} type="file" accept=".html,.htm,.mhtml,text/html" className="hidden" onChange={async e => { const file=e.target.files?.[0]; if(!file) return; if(file.size>10*1024*1024){setStatus('Choose an HTML file smaller than 10 MB.'); return;} setHtmlFile(file); setFileName(file.name); setFileContent(await file.text()); setStatus(''); }} />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mt-4 px-4 py-2 rounded-full border border-neutral-300 text-xs font-medium text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer"
                  >
                    Select File from Device
                  </button>
                  {htmlFile && <div className="mt-4 w-full max-w-md text-left"><label htmlFor="html-image-quality" className="flex items-center justify-between gap-3 text-xs text-neutral-700"><span>Embedded JPEG/WebP quality</span><span className="font-technical">{compressionQuality} / 95</span></label><input id="html-image-quality" type="range" min="1" max="95" value={compressionQuality} onChange={e=>setCompressionQuality(Number(e.target.value))} className="mt-2 w-full accent-neutral-900"/><p className="mt-1 text-[11px] text-[#7b7b7b]">Only embedded PNG, JPEG, and WebP images are considered. Remote image URLs are preserved and never fetched for optimization.</p></div>}
                </div>
              </div>
            )}

            {activeMethod === 'pdf' && (
              <div>
                <div className="flex items-center justify-between pb-3 mb-6 border-b border-neutral-200">
                  <span className="font-technical text-xs uppercase tracking-wider text-[#7b7b7b]">METHOD 04 · PDF PROCESSING</span>
                  <span className="font-technical text-xs text-[#7b7b7b]">{pdfFile ? pdfFile.name : 'AWAITING PDF'}</span>
                </div>
                <div className="border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-2xl p-6 text-center bg-white/50 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 mb-3"><FileText className="w-5 h-5" /></div>
                  <h3 className="font-editorial text-lg text-[#111111] font-medium">Upload a PDF document</h3>
                  <p className="mt-1 text-xs text-[#7b7b7b]">PDF files up to 20 MB. Text extraction supports selectable text; scanned PDFs need OCR, which is not available.</p>
                  <input ref={pdfRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={selectPdf} />
                  <button type="button" onClick={() => pdfRef.current?.click()} className="mt-4 px-4 py-2 rounded-full border border-neutral-300 text-xs font-medium text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer">Select PDF from Device</button>
                  {pdfFile && <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-[#7b7b7b]"><span>Original: {pdfFile.size.toLocaleString()} bytes</span><a href={pdfPreviewUrl} download={pdfFile.name} className="underline">Download original PDF</a></div>}
                </div>

                {pdfFile && pdfPreviewUrl && <div className="mt-4"><span className="font-technical text-[11px] uppercase tracking-wider text-[#7b7b7b] block mb-2">PDF PREVIEW · ORIGINAL FILE</span><iframe title={`Preview of ${pdfFile.name}`} src={pdfPreviewUrl} className="w-full h-72 rounded-xl border border-neutral-300 bg-white" /></div>}

                {pdfFile && <div className="mt-5 pt-4 border-t border-neutral-200 space-y-3">
                  <label htmlFor="pdf-quality" className="flex items-center justify-between gap-3 text-xs text-neutral-700"><span>Image compression quality</span><span className="font-technical">{compressionQuality} / 100</span></label>
                  <input id="pdf-quality" type="range" min="1" max="100" value={compressionQuality} onChange={e => setCompressionQuality(Number(e.target.value))} className="w-full accent-neutral-900" />
                  <p className="text-[11px] text-[#7b7b7b]">Lower quality may reduce embedded image sizes more. Text and vector content are preserved. The original upload remains available.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={runPdfCompression} className="px-4 py-2 rounded-full border border-neutral-300 bg-white text-xs font-medium hover:bg-neutral-100 disabled:opacity-50">Compress PDF</button>
                    <button type="button" disabled={busy} onClick={runPdfImages} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-300 bg-white text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"><ImageIcon className="w-3.5 h-3.5"/>Convert pages to images</button>
                  </div>
                </div>}

                {pdfTextResult && <section className="mt-5 pt-4 border-t border-neutral-200">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-technical text-[11px] uppercase tracking-wider text-[#7b7b7b]">EXTRACTED TEXT PREVIEW · {pdfTextResult.pages} PAGES</span><span className="text-xs text-[#7b7b7b]">PDF {pdfTextResult.originalBytes.toLocaleString()} B → TXT {pdfTextResult.convertedBytes.toLocaleString()} B ({Math.abs(pdfSizeMetrics(pdfTextResult.originalBytes,pdfTextResult.convertedBytes).reductionPercent).toFixed(1)}% {pdfSizeMetrics(pdfTextResult.originalBytes,pdfTextResult.convertedBytes).bytesSaved >= 0 ? 'smaller' : 'larger'})</span></div>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-4 text-xs leading-relaxed text-neutral-800">{pdfTextResult.text}</pre>
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={openExtractedText} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0d0d0d] text-[#f7f7f5] text-xs font-medium">Open in Reader <ArrowRight className="w-3 h-3"/></button>{pdfTextUrl && <a href={pdfTextUrl} download={`${pdfTextResult.title.replace(/[^\w.-]+/g,'-') || 'document'}.txt`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-300 text-xs font-medium"><Download className="w-3.5 h-3.5"/>Download TXT</a>}</div>
                </section>}

                {compressedPdfUrl && compressedPdfSizes && <div className="mt-5 pt-4 border-t border-neutral-200 text-xs text-[#7b7b7b]"><p>Compression result: original {compressedPdfSizes.originalBytes.toLocaleString()} B → output {compressedPdfSizes.convertedBytes.toLocaleString()} B.</p><p>{compressedPdfSizes.bytesSaved >= 0 ? `${compressedPdfSizes.bytesSaved.toLocaleString()} bytes saved (${compressedPdfSizes.reductionPercent.toFixed(1)}%).` : `${Math.abs(compressedPdfSizes.bytesSaved).toLocaleString()} bytes larger (${Math.abs(compressedPdfSizes.reductionPercent).toFixed(1)}%).`}</p><a href={compressedPdfUrl} download={`${pdfFile?.name.replace(/\.pdf$/i,'') || 'document'}-compressed.pdf`} className="mt-2 inline-flex items-center gap-1.5 underline"><Download className="w-3.5 h-3.5"/>Download compressed PDF</a></div>}
                {pdfImagesUrl && <div className="mt-4 text-xs text-[#7b7b7b]"><p>Source PDF {pdfImageSizes?.originalBytes.toLocaleString()} B → PNG archive {pdfImageSizes?.convertedBytes.toLocaleString()} B.</p><a href={pdfImagesUrl} download="pdf-pages.zip" className="mt-2 inline-flex items-center gap-1.5 underline"><Download className="w-3.5 h-3.5"/>Download {pdfImagePageCount} rendered page images (ZIP)</a></div>}
              </div>
            )}

            {/* Action Row */}
            <div className="pt-6 mt-6 border-t border-neutral-200 flex items-center justify-between">
              <span className="text-xs text-[#7b7b7b] font-technical">
                {hasInput ? 'READY FOR PIPELINE' : 'INPUT REQUIRED'}
              </span>
              <button
                type="button"
                disabled={!hasInput || busy}
                onClick={processInput}
                className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium tracking-tight shadow-sm transition-colors ${
                  hasInput
                    ? 'bg-[#0d0d0d] hover:bg-neutral-800 text-[#f7f7f5] cursor-pointer'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                <span>
                  {busy ? 'Processing…' : activeMethod === 'url' && 'Distill Webpage'}
                  {!busy && activeMethod === 'text' && 'Purify Text'}
                  {!busy && activeMethod === 'html' && 'Process Document'}
                  {!busy && activeMethod === 'pdf' && 'Extract PDF Text'}
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
                URL conversions use the configured ByteLess backend. Savings measure the fetched HTML response and converted document.
              </div>
              <div className="pt-4 border-t border-neutral-200 space-y-2">
                <span className="font-technical text-[11px] text-[#7b7b7b] uppercase tracking-wider block">DELIVERY MODE</span>
                {(['light','ultra','terminal'] as DeliveryMode[]).map(item => <label key={item} className="flex items-center gap-2 text-xs text-neutral-700 capitalize cursor-pointer"><input type="radio" name="delivery-mode" checked={mode===item} onChange={()=>setMode(item)} className="accent-neutral-900" />{item} Mode</label>)}
              </div>
              {status && <p role="status" className="text-xs text-amber-800 leading-relaxed">{status}</p>}
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
