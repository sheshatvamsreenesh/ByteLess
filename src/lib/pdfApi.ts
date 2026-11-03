import { API_BASE_URL } from './api';
import type { PdfSizeMetrics } from './pdfApiTypes';

export type PdfTextResult = {
  title: string; filename: string; text: string; originalBytes: number;
  convertedBytes: number; bytesSaved: number; reductionPercent: number; pages: number;
  measurementScope: string;
  imageMetrics: { imagesDetected:number;imagesPreserved:number;imagesOptimized:number;imagesUnchanged:number;imagesDeferred:number;imagesOmitted:number;optimizationFailures:number };
  scriptMetrics: { scriptsDetected:number;scriptsRemoved:number;trackersDetected:number;trackersRemoved:number };
  warnings: string[];
  processingDetails: string[];
};
export type PdfBlobResult = PdfSizeMetrics & { blob: Blob; pages?: number };

async function getError(response: Response) {
  const data = await response.json().catch(() => ({}));
  return new Error(typeof data.detail === 'string' ? data.detail : 'The PDF could not be processed.');
}

function formFor(file: File) {
  const form = new FormData(); form.append('file', file, file.name); return form;
}

export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const response = await fetch(`${API_BASE_URL}/api/pdf/extract`, { method: 'POST', body: formFor(file) });
  if (!response.ok) throw await getError(response);
  return response.json() as Promise<PdfTextResult>;
}

export async function compressPdf(file: File, quality: number): Promise<PdfBlobResult> {
  const form = formFor(file); form.append('quality', String(quality));
  const response = await fetch(`${API_BASE_URL}/api/pdf/compress`, { method: 'POST', body: form });
  if (!response.ok) throw await getError(response);
  return {
    blob: await response.blob(),
    originalBytes: Number(response.headers.get('X-Original-Bytes')),
    convertedBytes: Number(response.headers.get('X-Converted-Bytes')),
    bytesSaved: Number(response.headers.get('X-Bytes-Saved')),
    reductionPercent: Number(response.headers.get('X-Reduction-Percent')),
  };
}

export async function convertPdfToImages(file: File): Promise<PdfBlobResult> {
  const response = await fetch(`${API_BASE_URL}/api/pdf/images`, { method: 'POST', body: formFor(file) });
  if (!response.ok) throw await getError(response);
  return {
    blob: await response.blob(), pages: Number(response.headers.get('X-Page-Count')),
    originalBytes: Number(response.headers.get('X-Original-Bytes')),
    convertedBytes: Number(response.headers.get('X-Converted-Bytes')),
    bytesSaved: Number(response.headers.get('X-Original-Bytes')) - Number(response.headers.get('X-Converted-Bytes')),
    reductionPercent: 0,
  };
}
