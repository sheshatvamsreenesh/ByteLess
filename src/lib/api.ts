import type { ConversionMetrics, DeliveryMode } from './documents';

export const API_BASE_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BYTELESS_API_BASE_URL) ||
  'http://localhost:8000'
).replace(/\/$/, '');

export type CategorizedElements = {
  preserved: {
    headings: number;
    paragraphs: number;
    lists: number;
    tables: number;
    links: number;
    images: number;
  };
  removed: {
    scripts: number;
    trackers: number;
    decorativeAndAds: number;
    otherElements: number;
  };
  deferred: {
    images: number;
  };
  requiresReview: number;
};

export type RemoteConversion = {
  title: string;
  source: string;
  html: string;
  mode: DeliveryMode;
  originalBytes: number;
  convertedBytes: number;
  bytesSaved: number;
  reductionPercent: number;
  warnings: string[];
  measurement: string;
  metrics: ConversionMetrics;
  integrity: {
    elementsRemoved: number;
    trackersDetected: number;
    trackersBlocked: number;
    trackersRemoved: number;
    imagesDeferred: number;
    extractionFailures: number;
    headingsPreserved?: number;
    paragraphsPreserved?: number;
    listsPreserved?: number;
    tablesPreserved?: number;
    linksPreserved?: number;
    categorizedElements?: CategorizedElements;
    potentiallyLostImportantContent: string[];
  };
  ml?: {
    is_model_trained: boolean;
    engine: string;
    recommended_mode: DeliveryMode;
    recommended_actions: {
      defer_images: boolean;
      optimise_images: boolean;
      preserve_diagrams: boolean;
      remove_decorative_elements: boolean;
      remove_safe_scripts: boolean;
      prioritise_text: boolean;
      recommend_ultra_mode: boolean;
    };
    reasons: string[];
    features?: Record<string, number>;
  };
};

export type HtmlImageOptimizationResult = {
  html: string;
  originalBytes: number;
  convertedBytes: number;
  bytesSaved: number;
  percentageSaved: number;
  mode: DeliveryMode;
  warnings: string[];
  processingDetails: string[];
  measurementScope: string;
  imageMetrics: {
    imagesDetected: number;
    imagesPreserved: number;
    imagesOptimized: number;
    imagesUnchanged: number;
    imagesDeferred: number;
    imagesOmitted: number;
    optimizationFailures: number;
  };
  scriptMetrics: {
    scriptsDetected: number;
    scriptsRemoved: number;
    trackersDetected: number;
    trackersRemoved: number;
  };
};

export type SummaryResult = {
  summary: string[];
  provider: string;
  label: string;
  bullets: string[];
  notice?: string;
};

export type TranslationResult = {
  translatedHtml: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
};

export async function convertUrl(url: string, mode: DeliveryMode): Promise<RemoteConversion> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode }),
    });
  } catch {
    throw new Error(`Could not reach the ByteLess backend at ${API_BASE_URL}. Start the backend or set VITE_BYTELESS_API_BASE_URL.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : 'The webpage could not be converted.';
    throw new Error(detail);
  }
  return body as RemoteConversion;
}

export async function convertText(text: string, title?: string, mode: DeliveryMode = 'light'): Promise<RemoteConversion> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/text/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title, mode }),
    });
  } catch {
    throw new Error(`Could not reach the ByteLess backend at ${API_BASE_URL}.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : 'The text could not be converted.';
    throw new Error(detail);
  }
  return body as RemoteConversion;
}

export async function optimizeUploadedHtml(file: File, mode: DeliveryMode, quality: number): Promise<HtmlImageOptimizationResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('mode', mode);
  form.append('quality', String(quality));
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/html/optimize`, { method: 'POST', body: form });
  } catch {
    throw new Error(`Could not reach the ByteLess image optimizer at ${API_BASE_URL}.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : 'The uploaded HTML images could not be processed.');
  }
  return body as HtmlImageOptimizationResult;
}

export async function summarizeText(text: string, title?: string): Promise<SummaryResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
  } catch {
    throw new Error(`Could not reach the ByteLess summarizer at ${API_BASE_URL}.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not generate summary.');
  }
  return body as SummaryResult;
}

export async function translateHtml(html: string, sourceLang = 'en', targetLang = 'hi'): Promise<TranslationResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, source_lang: sourceLang, target_lang: targetLang }),
    });
  } catch {
    throw new Error(`Could not reach the ByteLess translation service at ${API_BASE_URL}.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not translate document.');
  }
  return body as TranslationResult;
}

export async function getMLRecommendations(html?: string, text?: string): Promise<RemoteConversion['ml']> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ml/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, text }),
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export function proxyDeferredImageUrl(remoteUrl: string, quality = 75): string {
  return `${API_BASE_URL}/api/image/proxy?url=${encodeURIComponent(remoteUrl)}&quality=${quality}`;
}
