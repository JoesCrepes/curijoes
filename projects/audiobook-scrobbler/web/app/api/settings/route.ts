import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { loadSettings } from '@/lib/ingest';
import { DEFAULT_SETTINGS } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  return NextResponse.json({ settings: await loadSettings(auth.userId), defaults: DEFAULT_SETTINGS });
}

/** Body: partial Settings. Each key is stored as its own row. */
export async function PUT(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as Record<string, unknown>;
  const rows = Object.entries(body)
    .filter(([k]) => k in DEFAULT_SETTINGS)
    .map(([key, value]) => ({ user_id: auth.userId, key, value }));
  if (rows.length === 0) return NextResponse.json({ error: 'no known keys' }, { status: 400 });
  const { error } = await db().from('settings').upsert(rows, { onConflict: 'user_id,key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: await loadSettings(auth.userId) });
}
