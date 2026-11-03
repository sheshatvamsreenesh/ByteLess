export type DeliveryMode = 'light' | 'ultra' | 'terminal';
export type ConversionMetrics = {
  imagesDetected: number; imagesPreserved: number; imagesOptimized: number; imagesUnchanged: number;
  imagesDeferred: number; imagesOmitted: number; optimizationFailures: number;
  scriptsDetected: number; scriptsRemoved: number; trackersDetected: number; trackersRemoved: number;
  processingDetails: string[]; measurementScope: string;
};
export type ImageOptimizationReport = {
  imagesOptimized: number; imagesUnchanged: number; optimizationFailures: number;
  warnings?: string[]; processingDetails?: string[];
};
export type ConvertedDocument = {
  id: string; title: string; source: string; html: string; text: string;
  originalBytes: number; convertedBytes: number; removed: number; trackers: number;
  createdAt: number; mode: DeliveryMode; imagesDeferred: number;
  warnings?: string[];
  integrity?: { trackersBlocked: number; extractionFailures: number; potentiallyLostImportantContent: string[] };
  contentType?: 'webpage' | 'html' | 'text' | 'pdf-text';
  savedAt?: number;
  metrics?: ConversionMetrics;
  measurementScope?: string;
};

const ACTIVE_KEY = 'byteless.active.v2';
const LEGACY_ACTIVE_KEY = 'byteless.active.v1';
const LEGACY_SAVED_KEY = 'byteless.saved.v1';
const DB_NAME = 'byteless-documents';
const DB_VERSION = 1;
let databasePromise: Promise<IDBDatabase> | undefined;
const safeTags = new Set(['ARTICLE','MAIN','SECTION','H1','H2','H3','H4','H5','H6','P','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','A','IMG','STRONG','B','EM','I','BR','HR','FIGURE','FIGCAPTION']);
const trackerPattern = /analytics|track|pixel|beacon|doubleclick|googletagmanager|facebook\.net/i;

export function convertHtml(input: string, source: string, mode: DeliveryMode = 'light', originalPayload = input, optimization?: ImageOptimizationReport): ConvertedDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/html');
  const title = doc.title.trim() || source || 'Untitled document';
  const imagesDetected = doc.querySelectorAll('img').length;
  const scriptsDetected = doc.querySelectorAll('script').length;
  const trackerCandidates = Array.from(doc.querySelectorAll('script[src],script:not([src]),iframe[src],img[src],link[href]')).filter(el => {
    const resource = el.getAttribute('src') || el.getAttribute('href') || '';
    if (resource.toLowerCase().startsWith('data:')) return false;
    return trackerPattern.test(resource) || (el.tagName === 'SCRIPT' && trackerPattern.test(el.textContent || ''));
  });
  const trackerSet = new Set(trackerCandidates);
  let removed = 0, trackersRemoved = 0, imagesDeferred = 0, imagesOmitted = 0, scriptsRemoved = 0;
  const imageWarnings: string[] = [];
  doc.querySelectorAll('script,style,noscript,iframe,form,button,nav,footer,header,aside,svg,canvas,object,embed,link,meta').forEach(el => {
    if (trackerSet.has(el)) trackersRemoved++;
    if (el.tagName === 'SCRIPT') scriptsRemoved++;
    removed++; el.remove();
  });
  doc.querySelectorAll('*').forEach(el => {
    if (!safeTags.has(el.tagName)) { el.replaceWith(...Array.from(el.childNodes)); removed++; return; }
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on') || attr.name === 'style' || attr.name === 'srcset' || !['href','src','alt','title','width','height','colspan','rowspan'].includes(attr.name)) el.removeAttribute(attr.name);
      if ((attr.name === 'width' || attr.name === 'height') && !/^\d{1,5}$/.test(attr.value)) el.removeAttribute(attr.name);
    });
    if (el instanceof HTMLAnchorElement) {
      try { if (!['http:','https:','mailto:'].includes(new URL(el.href, source || location.href).protocol)) el.removeAttribute('href'); } catch { el.removeAttribute('href'); }
    }
    if (el instanceof HTMLImageElement) {
      if (trackerSet.has(el)) { el.remove(); removed++; imagesOmitted++; trackersRemoved++; }
      else if (mode !== 'light') { const p = doc.createElement('p'); p.textContent = `[Image: ${el.alt.trim() || 'Image without alternative text'}]`; el.replaceWith(p); imagesDeferred++; }
      else {
        if (el.hasAttribute('srcset')) imageWarnings.push('Responsive image variants were reduced to one safe source for the Reader.');
        const sourceCandidate = el.getAttribute('src') || el.getAttribute('srcset')?.match(/^\s*(https?:\/\/\S+|\/\S+|\.\.?\/\S+)/i)?.[1] || '';
        if (!sourceCandidate) { imagesOmitted++; imageWarnings.push('An image without a usable source was retained as context but cannot be displayed.'); }
        else {
          try { el.setAttribute('src', new URL(sourceCandidate, source || location.href).href); }
          catch { el.removeAttribute('src'); imagesOmitted++; imageWarnings.push('A relative image from the uploaded HTML could not be resolved from the single HTML file and was not displayed.'); }
        }
        el.removeAttribute('srcset');
      }
    }
  });
  const root = doc.body;
  const html = mode === 'terminal' ? `<pre>${escapeHtml(root.textContent || '')}</pre>` : root.innerHTML;
  const text = root.innerText || root.textContent || '';
  const convertedBytes = new TextEncoder().encode(html).length;
  const imagesPreserved = Array.from(root.querySelectorAll('img')).filter(image => image.hasAttribute('src')).length;
  const imagesOptimized = mode === 'light' ? Math.min(optimization?.imagesOptimized || 0, imagesPreserved) : 0;
  const originalBytes = new TextEncoder().encode(originalPayload).length;
  const processingDetails = [`Delivery mode: ${mode}.`, ...(optimization?.processingDetails || []), 'Remote image URLs are not fetched or modified by the browser conversion pipeline.'];
  const measurementScope = 'Source bytes compared with sanitized Reader HTML bytes; excludes linked resources and whole-page network traffic.';
  const metrics: ConversionMetrics = { imagesDetected, imagesPreserved, imagesOptimized, imagesUnchanged: Math.max(0,imagesPreserved-imagesOptimized), imagesDeferred, imagesOmitted, optimizationFailures: optimization?.optimizationFailures || 0, scriptsDetected, scriptsRemoved, trackersDetected: trackerCandidates.length, trackersRemoved, processingDetails, measurementScope };
  return { id: crypto.randomUUID(), title, source, html, text: text.trim(), originalBytes, convertedBytes, removed, trackers: trackerCandidates.length, createdAt: Date.now(), mode, imagesDeferred, contentType: inferContentType(source), warnings: [...(optimization?.warnings || []), ...new Set(imageWarnings)], metrics, measurementScope };
}
export function documentFromRemote(result: {title:string;source:string;html:string;mode:DeliveryMode;originalBytes:number;convertedBytes:number;warnings:string[];measurement:string;metrics:ConversionMetrics;integrity:{elementsRemoved:number;trackersDetected:number;trackersBlocked:number;trackersRemoved:number;imagesDeferred:number;extractionFailures:number;potentiallyLostImportantContent:string[]}}): ConvertedDocument {
  const parsed = new DOMParser().parseFromString(result.html, 'text/html');
  return { id: crypto.randomUUID(), title: result.title, source: result.source, html: result.html,
    text: (parsed.body.innerText || parsed.body.textContent || '').trim(), originalBytes: result.originalBytes,
    convertedBytes: result.convertedBytes, removed: result.integrity.elementsRemoved,
    trackers: result.integrity.trackersDetected, createdAt: Date.now(), mode: result.mode,
    imagesDeferred: result.integrity.imagesDeferred, warnings: result.warnings, contentType: 'webpage',
    integrity: { trackersBlocked: result.integrity.trackersBlocked, extractionFailures: result.integrity.extractionFailures, potentiallyLostImportantContent: result.integrity.potentiallyLostImportantContent }, metrics: result.metrics, measurementScope: result.measurement };
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
function inferContentType(source: string): ConvertedDocument['contentType'] {
  if (/^https?:\/\//i.test(source)) return 'webpage';
  if (/\.pdf$/i.test(source)) return 'pdf-text';
  if (/\.(html?|mhtml)$/i.test(source)) return 'html';
  return 'text';
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('Offline document storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error('Document storage is busy in another tab. Close other ByteLess tabs and retry.'));
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise!;
}

function storageError(error: DOMException | null): Error {
  if (error?.name === 'QuotaExceededError') return new Error('Browser storage is full. Delete saved documents or free device storage, then retry.');
  return new Error(error?.message || 'Could not access offline document storage.');
}

async function getDocument(id: string): Promise<ConvertedDocument | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').get(id);
    request.onsuccess = () => resolve((request.result as ConvertedDocument | undefined) || null);
    request.onerror = () => reject(storageError(request.error));
  });
}

async function writeDocument(doc: ConvertedDocument, save = false): Promise<ConvertedDocument> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    const store = transaction.objectStore('documents');
    const read = store.get(doc.id);
    let stored = doc;
    read.onsuccess = () => {
      const previous = read.result as ConvertedDocument | undefined;
      stored = { ...doc, contentType: doc.contentType || inferContentType(doc.source), savedAt: save ? previous?.savedAt || Date.now() : previous?.savedAt };
      store.put(stored);
    };
    transaction.oncomplete = () => resolve(stored);
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

export async function setActiveDocument(doc: ConvertedDocument): Promise<void> {
  const activeId = sessionStorage.getItem(ACTIVE_KEY);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    const store = transaction.objectStore('documents');
    if (activeId && activeId !== doc.id) {
      const previous = store.get(activeId);
      previous.onsuccess = () => { if (previous.result && !(previous.result as ConvertedDocument).savedAt) store.delete(activeId); };
    }
    const existing = store.get(doc.id);
    existing.onsuccess = () => store.put({ ...doc, contentType: doc.contentType || inferContentType(doc.source), savedAt: (existing.result as ConvertedDocument | undefined)?.savedAt });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
  try { sessionStorage.setItem(ACTIVE_KEY, doc.id); localStorage.removeItem(LEGACY_ACTIVE_KEY); }
  catch { throw new Error('Could not remember the active document in this browser session.'); }
}

export async function getActiveDocument(): Promise<ConvertedDocument | null> {
  try {
    const id = sessionStorage.getItem(ACTIVE_KEY);
    if (id) return await getDocument(id);
    const legacy = localStorage.getItem(LEGACY_ACTIVE_KEY);
    if (!legacy) return null;
    const doc = JSON.parse(legacy) as ConvertedDocument;
    await setActiveDocument(doc);
    return getDocument(doc.id);
  } catch (error) { if (error instanceof Error) throw error; throw storageError(null); }
}

async function migrateLegacyDocuments(): Promise<void> {
  const legacy = localStorage.getItem(LEGACY_SAVED_KEY);
  if (!legacy) return;
  let documents: ConvertedDocument[];
  try { documents = JSON.parse(legacy) as ConvertedDocument[]; }
  catch { localStorage.removeItem(LEGACY_SAVED_KEY); return; }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    const store = transaction.objectStore('documents');
    documents.forEach(doc => {
      const request = store.get(doc.id);
      request.onsuccess = () => store.put({ ...doc, contentType: doc.contentType || inferContentType(doc.source), savedAt: doc.savedAt || doc.createdAt || Date.now() });
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
  localStorage.removeItem(LEGACY_SAVED_KEY);
}

export async function getSavedDocuments(): Promise<ConvertedDocument[]> {
  await migrateLegacyDocuments();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').getAll();
    request.onsuccess = () => resolve((request.result as ConvertedDocument[]).filter(doc => !!doc.savedAt).sort((a,b) => (b.savedAt || 0) - (a.savedAt || 0)));
    request.onerror = () => reject(storageError(request.error));
  });
}

export function searchDocuments(documents: ConvertedDocument[], query: string): ConvertedDocument[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return documents;
  return documents.filter(doc => `${doc.title} ${doc.source} ${doc.text} ${doc.mode} ${doc.contentType || ''}`.toLocaleLowerCase().includes(needle));
}

export async function saveDocument(doc: ConvertedDocument): Promise<void> {
  const saved = await writeDocument(doc, true);
  try { sessionStorage.setItem(ACTIVE_KEY, saved.id); }
  catch { throw new Error('The document was saved, but this browser could not set the active Reader document.'); }
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    transaction.objectStore('documents').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

export function exportDocument(doc: ConvertedDocument, format: 'txt' | 'md'): { blob: Blob; filename: string } {
  const base = doc.title.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'byteless-document';
  if (format === 'txt') return { blob: new Blob([doc.text], { type: 'text/plain;charset=utf-8' }), filename: `${base}.txt` };
  const markdown = htmlToMarkdown(doc.html) || doc.text;
  return { blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename: `${base}.md` };
}

function htmlToMarkdown(html: string): string {
  const converted = html
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level:string, body:string) => `\n${'#'.repeat(Number(level))} ${body}\n`)
    .replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img\b([^>]*)>/gi, (_m, attrs:string) => {
      const alt = attrs.match(/\balt=["']([^"']*)["']/i)?.[1] || '';
      const src = attrs.match(/\bsrc=["']([^"']*)["']/i)?.[1];
      return src ? `![${alt}](${src})` : `![${alt}]`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body:string) => `\n\`\`\`\n${body.replace(/<[^>]+>/g, '')}\n\`\`\`\n`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, body:string) => {
      let index = 0;
      return body.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_item, content:string) => `\n${++index}. ${content}`);
    })
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, body:string) => {
      const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => {
        const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => cell[1].replace(/<[^>]+>/g, '').trim());
        return `| ${cells.join(' | ')} |`;
      });
      if (rows.length && /<th\b/i.test(body)) rows.splice(1, 0, `| ${rows[0].slice(2,-2).split(' | ').map(()=>'---').join(' | ')} |`);
      return `\n${rows.join('\n')}\n`;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, body:string) => `\n${body.replace(/<[^>]+>/g, '').split(/\n+/).map(line => `> ${line.trim()}`).join('\n')}\n`)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|article|section|ul|ol|pre|figure|figcaption|tr|table|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
  return decodeHtmlEntities(converted);
}

function decodeHtmlEntities(value:string):string {
  if (typeof document !== 'undefined') { const textarea=document.createElement('textarea'); textarea.innerHTML=value; return textarea.value; }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|copy|reg|trade|rsquo|lsquo|rdquo|ldquo);/gi, (entity, key:string) => {
    const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',mdash:'—',ndash:'–',hellip:'…',copy:'©',reg:'®',trade:'™',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
    if (key[0] !== '#') return named[key.toLowerCase()] || entity;
    const code = key[1].toLowerCase()==='x' ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

export function downloadDocumentExport(doc: ConvertedDocument, format: 'txt' | 'md'): void {
  const exported = exportDocument(doc, format);
  const url = URL.createObjectURL(exported.blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = exported.filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
