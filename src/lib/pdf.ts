export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type PdfUploadMetadata = { name: string; type: string; size: number };

export function validatePdfUpload(file: PdfUploadMetadata, signature: Uint8Array): void {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a file with a .pdf extension.');
  if (file.type && !['application/pdf', 'application/octet-stream'].includes(file.type.toLowerCase())) {
    throw new Error('The selected file is not marked as a PDF.');
  }
  if (file.size <= 0) throw new Error('The selected PDF is empty.');
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF files must be 20 MB or smaller.');
  const header = new TextDecoder().decode(signature.slice(0, 1024));
  if (!header.includes('%PDF-')) throw new Error('The file does not have a valid PDF signature.');
}

export function pdfSizeMetrics(originalBytes: number, convertedBytes: number) {
  const bytesSaved = originalBytes - convertedBytes;
  return { bytesSaved, reductionPercent: originalBytes > 0 ? (bytesSaved / originalBytes) * 100 : 0 };
}
