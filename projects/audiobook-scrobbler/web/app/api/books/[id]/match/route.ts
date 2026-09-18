import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { candidateFields, rememberIdentifier } from '@/lib/matching';
import { syncRead } from '@/lib/sync';
import { loadSettings, recomputeRead } from '@/lib/ingest';
import type { MatchCandidate } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Confirm a match directly from the PWA: { candidate: MatchCandidate } or { skip: true }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json()) as { candidate?: MatchCandidate; skip?: boolean };
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.skip) update.match_status = 'no_match';
  else if (body.candidate) Object.assign(update, candidateFields(body.candidate), { match_status: 'confirmed' });
  else return NextResponse.json({ error: 'candidate or skip required' }, { status: 400 });
  const { error } = await db().from('books').update(update).eq('id', id).eq('user_id', auth.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Pin the player's own id to the confirmed match so it cascades to future books.
  if (body.candidate) {
    const { data: bk } = await db().from('books').select('external_id, external_id_kind').eq('id', id).maybeSingle();
    if (bk?.external_id && bk.external_id_kind) {
      try {
        await rememberIdentifier(auth.userId, { kind: bk.external_id_kind as 'asin' | 'isbn13' | 'overdrive', value: bk.external_id }, body.candidate);
      } catch (e) {
        console.error('could not remember identifier', e);
      }
    }
  }
  await db().from('actions').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution: { via: 'web' } }).eq('book_id', id).eq('type', 'match_book').eq('status', 'pending');
  // The match sets the runtime, so progress has to be recomputed before syncing.
  const settings = await loadSettings(auth.userId);
  const { data: reads } = await db().from('reads').select('id').eq('book_id', id);
  for (const r of reads ?? []) {
    await recomputeRead(r.id, settings);
    await syncRead(r.id);
  }
  return NextResponse.json({ ok: true });
}
