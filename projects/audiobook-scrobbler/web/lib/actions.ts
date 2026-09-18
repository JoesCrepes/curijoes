import { db } from './supabase';
import { candidateFields, rememberIdentifier } from './matching';
import { syncRead } from './sync';
import { audiobookEditions, hardcoverEnabled } from './hardcover';
import { loadSettings, recomputeRead } from './ingest';
import type { MatchCandidate } from './types';

/**
 * A match decides the book's runtime, and runtime decides progress. So after a
 * match changes, every read of that book is recomputed before it is synced —
 * otherwise a book stays at "progress unknown" until the next event arrives.
 */
async function refreshReads(userId: string, bookId: string): Promise<void> {
  const settings = await loadSettings(userId);
  const { data: reads } = await db().from('reads').select('id').eq('book_id', bookId);
  for (const r of reads ?? []) {
    await recomputeRead(r.id, settings);
    await syncRead(r.id);
  }
}

export type Resolution =
  | { candidate: number } // index into payload.candidates / book.match_candidates
  | { hardcover_book_id: number; hardcover_edition_id?: number | null }
  | { skip: true }
  | { finished: true }
  | { not_yet: true }
  | { dnf: true };

/**
 * A confirmation is the strongest signal we ever get. Pin the player's own id
 * to it so the same identifier resolves instantly next time, even for books
 * Hardcover cannot be searched into (Audible's regional ASINs), and even if the
 * player later reports a different title string.
 */
async function recordIdentifier(
  userId: string,
  book: { external_id?: string | null; external_id_kind?: string | null } | null | undefined,
  c: MatchCandidate,
): Promise<void> {
  if (!book?.external_id || !book.external_id_kind) return;
  try {
    await rememberIdentifier(userId, { kind: book.external_id_kind as 'asin' | 'isbn13' | 'overdrive', value: book.external_id }, c);
  } catch (e) {
    console.error('could not remember identifier', e);
  }
}

export async function resolveAction(userId: string, actionId: string, resolution: Resolution): Promise<{ ok: boolean; error?: string }> {
  const { data: action } = await db().from('actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle();
  if (!action) return { ok: false, error: 'not found' };
  if (action.status !== 'pending') return { ok: true };

  if (action.type === 'match_book') {
    if ('skip' in resolution) {
      await db().from('books').update({ match_status: 'no_match', updated_at: new Date().toISOString() }).eq('id', action.book_id);
    } else if ('candidate' in resolution) {
      const { data: book } = await db().from('books').select('match_candidates, external_id, external_id_kind').eq('id', action.book_id).single();
      const cands = ((book?.match_candidates as MatchCandidate[] | null) ?? []);
      const c = cands[resolution.candidate];
      if (!c) return { ok: false, error: 'bad candidate index' };
      await db().from('books').update({ ...candidateFields(c), match_status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', action.book_id);
      await recordIdentifier(userId, book, c);
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
      const { data: bk } = await db().from('books').select('external_id, external_id_kind, cover_url').eq('id', action.book_id).single();
      await recordIdentifier(userId, bk, {
        source: 'hardcover', book_id: resolution.hardcover_book_id, edition_id: editionId,
        title: '', author: null, isbn13: isbn, runtime_seconds: runtime, cover_url: bk?.cover_url ?? null, score: 1,
      });
    } else {
      return { ok: false, error: 'bad resolution for match_book' };
    }
    // A confirmed match makes every read of that book syncable, and gives them
    // a runtime to compute progress against.
    await refreshReads(userId, action.book_id);
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
