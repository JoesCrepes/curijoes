import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { candidateFields } from '@/lib/matching';
import { syncRead } from '@/lib/sync';
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
  await db().from('actions').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution: { via: 'web' } }).eq('book_id', id).eq('type', 'match_book').eq('status', 'pending');
  const { data: reads } = await db().from('reads').select('id').eq('book_id', id);
  for (const r of reads ?? []) await syncRead(r.id);
  return NextResponse.json({ ok: true });
}
