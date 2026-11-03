import { createClient } from '@supabase/supabase-js';

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const projectUrl = environment.VITE_SUPABASE_URL?.trim();
const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const validProjectUrl = (() => {
  if (!projectUrl) return false;
  try {
    const parsed = new URL(projectUrl);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
  } catch { return false; }
})();

export const supabaseConfigured = Boolean(validProjectUrl && publishableKey);
export const supabase = supabaseConfigured
  ? createClient(projectUrl!, publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

