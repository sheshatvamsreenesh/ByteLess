/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Library, ArrowRight, Trash2, Search, Download } from 'lucide-react';
import { deleteDocument, downloadDocumentExport, getSavedDocuments, searchDocuments, setActiveDocument, type ConvertedDocument } from '../lib/documents';

export const SavedPage: React.FC = () => {
  const [docs,setDocs]=useState<ConvertedDocument[]>([]);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [online,setOnline]=useState(navigator.onLine);
  const navigate=useNavigate();
  const refresh=useCallback(async()=>{setLoading(true);try{setDocs(await getSavedDocuments());setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load saved content.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();const onStatus=()=>setOnline(navigator.onLine);window.addEventListener('online',onStatus);window.addEventListener('offline',onStatus);window.addEventListener('focus',refresh);return()=>{window.removeEventListener('online',onStatus);window.removeEventListener('offline',onStatus);window.removeEventListener('focus',refresh);};},[refresh]);
  const open=async(doc:ConvertedDocument)=>{try{await setActiveDocument(doc);navigate('/reader');}catch(e){setError(e instanceof Error?e.message:'Could not open this document.');}};
  const remove=async(doc:ConvertedDocument)=>{if(!window.confirm(`Delete "${doc.title}" from saved content?`))return;try{await deleteDocument(doc.id);await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not delete this document.');}};
  const visible=useMemo(()=>searchDocuments(docs,query),[docs,query]);
  return <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-4xl mx-auto flex flex-col justify-between select-text"><div>
    <div className="mb-10 sm:mb-14"><div className="mb-3"><span className="font-technical text-[11px] uppercase tracking-[0.22em] text-[#7b7b7b]">PERSONAL ARCHIVE</span></div><div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"><div><h1 className="font-editorial text-4xl sm:text-5xl text-[#111111] tracking-tight">Saved Content</h1><p className="mt-2 text-sm sm:text-base text-[#7b7b7b]">Your personal library of distilled web documents, cached for quick access, even offline.</p></div><div className="px-3.5 py-1.5 rounded-full border border-neutral-300/80 bg-white/70 text-xs font-technical text-[#7b7b7b]">{docs.length} DOCUMENTS</div></div></div>
    <p className="mb-4 text-[11px] font-technical text-[#7b7b7b]">{online?'SAVED TEXT AVAILABLE OFFLINE · LINKED MEDIA MAY NEED INTERNET · NEW WEB CONVERSIONS REQUIRE INTERNET':'OFFLINE · SAVED TEXT AVAILABLE ON THIS DEVICE · LINKED MEDIA MAY NEED INTERNET'}</p>
    {error&&<p role="alert" className="mb-4 text-xs text-amber-800">{error}</p>}
    {docs.length>0 && <label className="mb-5 flex items-center gap-2 px-4 py-3 bg-white/70 rounded-xl border border-neutral-300 text-xs"><Search className="w-4 h-4 text-neutral-500"/><input aria-label="Search saved content" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search saved content" className="w-full bg-transparent outline-none"/></label>}
    {loading ? <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 text-center my-6 text-xs text-[#7b7b7b]">Loading your saved library…</div> : visible.length===0 ? <div className="rounded-2xl border-2 border-dashed border-neutral-300/80 bg-white/40 p-12 sm:p-20 text-center flex flex-col items-center justify-center my-6"><div className="w-14 h-14 rounded-full bg-neutral-200/60 flex items-center justify-center mb-5"><Library className="w-6 h-6 text-[#111111]"/></div><h2 className="font-editorial text-3xl sm:text-4xl text-[#111111]">{docs.length?'No matching documents':'Your library is empty'}</h2><p className="mt-3 text-sm text-[#7b7b7b]">{docs.length?'Try another search.':'Converted content you save will appear here for quick access, even offline.'}</p>{!docs.length&&<Link to="/convert" className="mt-8 inline-flex items-center gap-2 bg-[#0d0d0d] text-[#f7f7f5] px-6 py-2.5 rounded-full text-xs">Convert your first page <ArrowRight className="w-3.5 h-3.5"/></Link>}</div> : <div className="space-y-3">{visible.map(doc=><div key={doc.id} className="flex items-center justify-between gap-4 rounded-2xl bg-white/70 border border-neutral-300/80 p-5"><div className="min-w-0 flex-1"><button onClick={()=>void open(doc)} className="min-w-0 text-left"><h2 className="font-editorial text-xl truncate">{doc.title}</h2><p className="mt-1 text-xs text-neutral-500 truncate">{doc.source} · Saved {new Date(doc.savedAt||doc.createdAt).toLocaleDateString()} · {doc.mode} · {doc.contentType||'document'}</p><p className="mt-2 text-xs text-neutral-600 line-clamp-2">{doc.text.slice(0,240)}</p></button><div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-neutral-500"><button onClick={()=>downloadDocumentExport(doc,'txt')} className="inline-flex items-center gap-1 underline"><Download className="w-3 h-3"/>TXT</button><button onClick={()=>downloadDocumentExport(doc,'md')} className="inline-flex items-center gap-1 underline"><Download className="w-3.5 h-3.5"/>Markdown</button></div></div><button aria-label={`Delete ${doc.title}`} onClick={()=>void remove(doc)} className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-600"><Trash2 className="w-4 h-4"/></button></div>)}</div>}
  </div><footer className="mt-16 pt-6 border-t border-neutral-200 flex justify-between text-xs font-technical text-[#7b7b7b]"><span>LOCAL CACHE LIBRARY · INDEXEDDB OFFLINE STORAGE</span><span>{docs.length} DOCUMENTS STORED</span></footer></div>;
};
