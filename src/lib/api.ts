import type { ConversionMetrics, DeliveryMode } from './documents';

export const API_BASE_URL = (import.meta.env.VITE_BYTELESS_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export type RemoteConversion = {
  title: string; source: string; html: string; mode: DeliveryMode;
  originalBytes: number; convertedBytes: number; bytesSaved: number; reductionPercent: number;
  warnings: string[];
  measurement: string;
  metrics: ConversionMetrics;
  integrity: { elementsRemoved: number; trackersDetected: number; trackersBlocked: number; trackersRemoved: number; imagesDeferred: number; extractionFailures: number; potentiallyLostImportantContent: string[] };
};

export type HtmlImageOptimizationResult = {
  html: string; originalBytes: number; convertedBytes: number; bytesSaved: number;
  percentageSaved: number; mode: DeliveryMode; warnings: string[];
  processingDetails: string[]; measurementScope: string;
  imageMetrics: { imagesDetected: number; imagesPreserved: number; imagesOptimized: number; imagesUnchanged: number; imagesDeferred: number; imagesOmitted: number; optimizationFailures: number };
  scriptMetrics: { scriptsDetected: number; scriptsRemoved: number; trackersDetected: number; trackersRemoved: number };
};

export async function convertUrl(url: string, mode: DeliveryMode): Promise<RemoteConversion> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/convert`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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

export async function optimizeUploadedHtml(file: File, mode: DeliveryMode, quality: number): Promise<HtmlImageOptimizationResult> {
  const form = new FormData();
  form.append('file', file, file.name); form.append('mode', mode); form.append('quality', String(quality));
  let response: Response;
  try { response = await fetch(`${API_BASE_URL}/api/html/optimize`, { method: 'POST', body: form }); }
  catch { throw new Error(`Could not reach the ByteLess image optimizer at ${API_BASE_URL}.`); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'The uploaded HTML images could not be processed.');
  return body as HtmlImageOptimizationResult;
}
