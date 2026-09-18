import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Server-only client. Never import from client components.
 *
 * Uses a Supabase secret key (`sb_secret_...`), which replaced the legacy
 * `service_role` key: it bypasses RLS the same way, but is revocable on its
 * own and is refused outright if it ever leaks into a browser. The legacy
 * variable name is still honored for older deployments.
 */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
