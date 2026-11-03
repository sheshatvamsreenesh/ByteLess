import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PDF_BYTES, pdfSizeMetrics, validatePdfUpload } from './pdf';

const header = new TextEncoder().encode('%PDF-1.7\n');

test('accepts a PDF signature within the allowed header window', () => {
  validatePdfUpload({ name: 'article.pdf', type: 'application/pdf', size: 1024 }, header);
});

test('rejects wrong extensions, MIME types, empty files, and oversized files', () => {
  assert.throws(() => validatePdfUpload({ name: 'article.html', type: 'application/pdf', size: 20 }, header), /\.pdf/);
  assert.throws(() => validatePdfUpload({ name: 'article.pdf', type: 'text/html', size: 20 }, header), /not marked as a PDF/);
  assert.throws(() => validatePdfUpload({ name: 'article.pdf', type: '', size: 0 }, header), /empty/);
  assert.throws(() => validatePdfUpload({ name: 'article.pdf', type: '', size: MAX_PDF_BYTES + 1 }, header), /20 MB/);
  assert.throws(() => validatePdfUpload({ name: 'article.pdf', type: '', size: 20 }, new TextEncoder().encode('<html>')), /signature/);
});

test('reports measured size increase without claiming savings', () => {
  assert.deepEqual(pdfSizeMetrics(500, 550), { bytesSaved: -50, reductionPercent: -10 });
});
