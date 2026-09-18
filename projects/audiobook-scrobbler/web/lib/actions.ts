import { db } from './supabase';
import { candidateFields } from './matching';
import { syncRead } from './sync';
import { audiobookEditions, hardcoverEnabled } from './hardcover';
import type { MatchCandidate } from './types';

export type Resolution =
  | { candidate: number } // index into payload.candidates / book.match_candidates
  | { hardcover_book_id: number; hardcover_edition_id?: number | null }
  | { skip: true }
  | { finished: true }
  | { not_yet: true }
  | { dnf: true };

export async function resolveAction(userId: string, actionId: string, resolution: Resolution): Promise<{ ok: boolean; error?: string }> {
  const { data: action } = await db().from('actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle();
  if (!action) return { ok: false, error: 'not found' };
  if (action.status !== 'pending') return { ok: true };

  if (action.type === 'match_book') {
    if ('skip' in resolution) {
      await db().from('books').update({ match_status: 'no_match', updated_at: new Date().toISOString() }).eq('id', action.book_id);
    } else if ('candidate' in resolution) {
      const { data: book } = await db().from('books').select('match_candidates').eq('id', action.book_id).single();
      const cands = ((book?.match_candidates as MatchCandidate[] | null) ?? []);
      const c = cands[resolution.candidate];
      if (!c) return { ok: false, error: 'bad candidate index' };
      await db().from('books').update({ ...candidateFields(c), match_status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', action.book_id);
    } else if ('hardcover_book_id' in resolution) {
      let editionId = resolution.hardcover_edition_id ?? null;
      let runtime: number | null = null;
      let isbn: string | null = null;
      if (hardcoverEnabled()) {
        try {
          const ed = (await audiobookEditions(resolution.hardcover_book_id)).find((e) => !editionId || e.id === editionId) ?? null;
          if (ed) { editionId = ed.id; runtime = ed.audio_seconds; isbn = ed.isbn_13; }
        } catch { /* optional */ }
      }
      await db().from('books').update({
        hardcover_book_id: resolution.hardcover_book_id,
        hardcover_edition_id: editionId,
        runtime_seconds: runtime,
        isbn13: isbn,
        match_status: 'confirmed',
        updated_at: new Date().toISOString(),
      }).eq('id', action.book_id);
    } else {
      return { ok: false, error: 'bad resolution for match_book' };
    }
    // A confirmed match makes every read of that book syncable.
    const { data: reads } = await db().from('reads').select('id').eq('book_id', action.book_id);
    for (const r of reads ?? []) await syncRead(r.id);
  } else if (action.type === 'confirm_finished') {
    if ('finished' in resolution || 'dnf' in resolution) {
      const status = 'finished' in resolution ? 'finished' : 'dnf';
      const { data: read } = await db().from('reads').select('last_activity_at').eq('id', action.read_id).single();
      await db().from('reads').update({ status, finished_at: read?.last_activity_at ?? new Date().toISOString(), finish_source: 'manual', hardcover_dirty: true }).eq('id', action.read_id);
      await syncRead(action.read_id);
    } else if (!('not_yet' in resolution)) {
      return { ok: false, error: 'bad resolution for confirm_finished' };
    }
  }

  await db().from('actions').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution }).eq('id', actionId);
  return { ok: true };
}

/** Manual status change from the PWA (no action row involved). */
export async function setReadStatus(userId: string, readId: string, status: 'reading' | 'finished' | 'dnf'): Promise<boolean> {
  const { data: read } = await db().from('reads').select('id, last_activity_at').eq('id', readId).eq('user_id', userId).maybeSingle();
  if (!read) return false;
  const update: Record<string, unknown> = { status, hardcover_dirty: true };
  if (status === 'reading') Object.assign(update, { finished_at: null, finish_source: null });
  else Object.assign(update, { finished_at: read.last_activity_at, finish_source: 'manual' });
  await db().from('reads').update(update).eq('id', readId);
  await db().from('actions').update({ status: 'dismissed', resolved_at: new Date().toISOString() }).eq('read_id', readId).eq('status', 'pending');
  await syncRead(readId);
  return true;
}
