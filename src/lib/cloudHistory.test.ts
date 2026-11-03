import assert from 'node:assert/strict';
import test from 'node:test';
import { historyRowToDocument, isHistorySyncEnabled, optimizationStatistics, persistOptimizationRows, setHistorySyncEnabled } from './cloudHistory';
import type { ConvertedDocument } from './documents';
import type { SupabaseClient } from '@supabase/supabase-js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });

function sample(): ConvertedDocument {
  return {
    id: 'a0fe03d1-09db-47ef-a60c-f7fe4d80cb42', title: 'Cloud record', source: 'article.html',
    html: '<p>Converted</p>', text: 'Converted', originalBytes: 100, convertedBytes: 120,
    removed: 2, trackers: 1, createdAt: Date.parse('2026-11-03T12:00:00Z'), mode: 'light',
    imagesDeferred: 0, contentType: 'html',
    metrics: { imagesDetected: 1, imagesPreserved: 1, imagesOptimized: 0, imagesUnchanged: 1, imagesDeferred: 0, imagesOmitted: 0, optimizationFailures: 0, scriptsDetected: 2, scriptsRemoved: 2, trackersDetected: 1, trackersRemoved: 1, processingDetails: [], measurementScope: 'Document bytes.' },
  };
}

test('cloud statistics retain measured increase instead of claiming savings', () => {
  const statistics = optimizationStatistics(sample());
  assert.equal(statistics.bytes_saved, -20);
  assert.equal(statistics.percentage_saved, -20);
  assert.equal(statistics.scripts_detected, 2);
  assert.equal(statistics.scripts_removed, 2);
});

test('database writes attach the signed-in owner and persist history, statistics, and file metadata', async () => {
  const writes: Array<{ table: string; values: Record<string, unknown>; conflict: string | undefined }> = [];
  const fakeClient = {
    from(table: string) {
      return { upsert: async (values: Record<string, unknown>, options?: { onConflict?: string }) => {
        writes.push({ table, values, conflict: options?.onConflict });
        return { error: null };
      } };
    },
  } as unknown as SupabaseClient;
  const doc = sample();
  await persistOptimizationRows(fakeClient, 'user-a', doc);
  assert.deepEqual(writes.map(write => write.table), ['optimization_history', 'optimization_statistics', 'file_metadata']);
  assert.ok(writes.every(write => write.values.user_id === 'user-a'));
  assert.equal(writes[0].values.converted_html, doc.html);
  assert.equal(writes[1].values.bytes_saved, -20);
  assert.equal(writes[2].values.filename, 'article.html');
});

test('database writes stop and surface a history insert error', async () => {
  let count = 0;
  const fakeClient = {
    from() { return { upsert: async () => { count++; return { error: new Error('RLS denied') }; } }; },
  } as unknown as SupabaseClient;
  await assert.rejects(persistOptimizationRows(fakeClient, 'user-a', sample()), /RLS denied/);
  assert.equal(count, 1);
});

test('cloud history records map to Reader-compatible documents', () => {
  const doc = sample();
  const mapped = historyRowToDocument({
    id: doc.id, user_id: '6a2945f1-26eb-46a5-a62a-5ab7b2ae875e', title: doc.title, source: doc.source,
    content_type: 'html', mode: 'light', original_bytes: 100, converted_bytes: 120,
    converted_html: doc.html, converted_text: doc.text, metrics: doc.metrics!, warnings: [],
    removed_elements: 2, trackers_detected: 1, images_deferred: 0,
    measurement_scope: 'Document bytes.', created_at: '2026-11-03T12:00:00Z',
  });
  assert.equal(mapped.html, doc.html);
  assert.equal(mapped.text, doc.text);
  assert.equal(mapped.convertedBytes, 120);
  assert.equal(mapped.createdAt, doc.createdAt);
});

test('history sync preference is explicit and can be turned off', () => {
  const firstUser = 'user-a';
  const secondUser = 'user-b';
  setHistorySyncEnabled(true, firstUser);
  assert.equal(isHistorySyncEnabled(firstUser), true);
  assert.equal(isHistorySyncEnabled(secondUser), false);
  setHistorySyncEnabled(false, firstUser);
  assert.equal(isHistorySyncEnabled(firstUser), false);
});
