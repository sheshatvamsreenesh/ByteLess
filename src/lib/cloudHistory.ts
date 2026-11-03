import type { ConvertedDocument, ConversionMetrics, DeliveryMode } from './documents';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const SYNC_PREFERENCE_KEY = 'byteless.supabase.history-sync.v1';
const MAX_HISTORY_CONTENT_BYTES = 5 * 1024 * 1024;

export type CloudHistoryRow = {
  id: string;
  user_id: string;
  title: string;
  source: string;
  content_type: ConvertedDocument['contentType'];
  mode: DeliveryMode;
  original_bytes: number;
  converted_bytes: number;
  converted_html: string;
  converted_text: string;
  metrics: ConversionMetrics | null;
  warnings: string[] | null;
  removed_elements: number;
  trackers_detected: number;
  images_deferred: number;
  measurement_scope: string | null;
  created_at: string;
};

function syncPreferenceKey(userId: string): string { return `${SYNC_PREFERENCE_KEY}:${userId}`; }

export function isHistorySyncEnabled(userId: string): boolean {
  if (!userId) return false;
  try { return localStorage.getItem(syncPreferenceKey(userId)) === 'true'; }
  catch { return false; }
}

export function setHistorySyncEnabled(enabled: boolean, userId: string): void {
  if (!userId) throw new Error('Sign in before changing the history sync preference.');
  try { localStorage.setItem(syncPreferenceKey(userId), String(enabled)); }
  catch { throw new Error('This browser could not save the history sync preference.'); }
}

export function historyRowToDocument(row: CloudHistoryRow): ConvertedDocument {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    html: row.converted_html,
    text: row.converted_text,
    originalBytes: Number(row.original_bytes),
    convertedBytes: Number(row.converted_bytes),
    removed: row.removed_elements,
    trackers: row.trackers_detected,
    createdAt: Date.parse(row.created_at),
    mode: row.mode,
    imagesDeferred: row.images_deferred,
    warnings: row.warnings || [],
    contentType: row.content_type || 'text',
    metrics: row.metrics || undefined,
    measurementScope: row.measurement_scope || undefined,
    savedAt: Date.parse(row.created_at),
  };
}

export function optimizationStatistics(doc: ConvertedDocument) {
  const bytesSaved = doc.originalBytes - doc.convertedBytes;
  return {
    original_bytes: doc.originalBytes,
    converted_bytes: doc.convertedBytes,
    bytes_saved: bytesSaved,
    percentage_saved: doc.originalBytes > 0 ? Number(((bytesSaved / doc.originalBytes) * 100).toFixed(2)) : 0,
    mode: doc.mode,
    images_detected: doc.metrics?.imagesDetected || 0,
    images_preserved: doc.metrics?.imagesPreserved || 0,
    images_optimized: doc.metrics?.imagesOptimized || 0,
    images_deferred: doc.metrics?.imagesDeferred ?? doc.imagesDeferred,
    images_omitted: doc.metrics?.imagesOmitted || 0,
    scripts_detected: doc.metrics?.scriptsDetected || 0,
    scripts_removed: doc.metrics?.scriptsRemoved || 0,
    trackers_detected: doc.metrics?.trackersDetected ?? doc.trackers,
    trackers_removed: doc.metrics?.trackersRemoved || 0,
  };
}

function fileMetadata(doc: ConvertedDocument, userId: string) {
  if (doc.contentType !== 'html' && doc.contentType !== 'pdf-text') return null;
  const filename = doc.source.split(/[\\/]/).pop()?.slice(0, 255) || 'document';
  const isPdf = doc.contentType === 'pdf-text';
  return {
    id: doc.id,
    user_id: userId,
    history_id: doc.id,
    filename,
    mime_type: isPdf ? 'application/pdf' : 'text/html',
    original_bytes: doc.originalBytes,
    converted_bytes: doc.convertedBytes,
  };
}

export async function recordOptimization(doc: ConvertedDocument): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured for this deployment.');
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Sign in before syncing conversion history.');
  await persistOptimizationRows(supabase, user.id, doc);
}

export async function persistOptimizationRows(client: SupabaseClient, userId: string, doc: ConvertedDocument): Promise<void> {
  if (!userId) throw new Error('A signed-in user is required to write conversion history.');
  const contentBytes = new TextEncoder().encode(doc.html).byteLength + new TextEncoder().encode(doc.text).byteLength;
  if (contentBytes > MAX_HISTORY_CONTENT_BYTES) throw new Error('Cloud history sync supports converted content up to 5 MB. The local document remains available.');

  const history = {
    id: doc.id,
    user_id: userId,
    title: doc.title.slice(0, 500),
    source: doc.source.slice(0, 2048),
    content_type: doc.contentType || 'text',
    mode: doc.mode,
    original_bytes: doc.originalBytes,
    converted_bytes: doc.convertedBytes,
    converted_html: doc.html,
    converted_text: doc.text,
    metrics: doc.metrics || {},
    warnings: doc.warnings || [],
    removed_elements: doc.removed,
    trackers_detected: doc.metrics?.trackersDetected ?? doc.trackers,
    images_deferred: doc.metrics?.imagesDeferred ?? doc.imagesDeferred,
    measurement_scope: doc.measurementScope || doc.metrics?.measurementScope || '',
    created_at: new Date(doc.createdAt).toISOString(),
  };
  const { error: historyError } = await client.from('optimization_history').upsert(history, { onConflict: 'id' });
  if (historyError) throw historyError;

  const { error: statisticsError } = await client.from('optimization_statistics').upsert({
    history_id: doc.id,
    user_id: userId,
    ...optimizationStatistics(doc),
  }, { onConflict: 'history_id' });
  if (statisticsError) throw statisticsError;

  const metadata = fileMetadata(doc, userId);
  if (metadata) {
    const { error: fileError } = await client.from('file_metadata').upsert(metadata, { onConflict: 'id' });
    if (fileError) throw fileError;
  }
}

export async function syncConvertedDocument(doc: ConvertedDocument): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user) return null;
    if (!isHistorySyncEnabled(user.id)) return null;
    await recordOptimization(doc);
    return null;
  } catch (error) {
    return `Cloud history could not be synced. Your local document is available. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export async function getOptimizationHistory(): Promise<ConvertedDocument[]> {
  if (!supabase) return [];
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return [];
  const { data, error } = await supabase.from('optimization_history')
    .select('id,user_id,title,source,content_type,mode,original_bytes,converted_bytes,converted_html,converted_text,metrics,warnings,removed_elements,trackers_detected,images_deferred,measurement_scope,created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).map(row => historyRowToDocument(row as CloudHistoryRow));
}

export async function deleteOptimizationHistory(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured for this deployment.');
  const { error } = await supabase.from('optimization_history').delete().eq('id', id);
  if (error) throw error;
}

export async function updateDisplayName(displayName: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured for this deployment.');
  const value = displayName.trim();
  if (value.length < 1 || value.length > 100) throw new Error('Display name must be between 1 and 100 characters.');
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Sign in to update your profile.');
  const { error } = await supabase.from('profiles').update({ display_name: value }).eq('id', user.id);
  if (error) throw error;
}

export async function getDisplayName(): Promise<string> {
  if (!supabase) return '';
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return '';
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data?.display_name || '';
}

