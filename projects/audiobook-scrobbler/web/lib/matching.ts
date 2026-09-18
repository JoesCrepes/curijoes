import { db } from './supabase';
import { normalizeAuthor, normalizeTitle, similarity } from './normalize';
import { audiobookEditions, hardcoverEnabled, searchBooks } from './hardcover';
import { searchOpenLibrary } from './openlibrary';
import type { MatchCandidate, Settings } from './types';

export interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  match_status: string;
}

function score(candTitle: string, candAuthor: string | null, title: string, author: string | null): number {
  const st = similarity(normalizeTitle(candTitle), normalizeTitle(title));
  if (!author || !candAuthor) return st * 0.9;
  const sa = similarity(normalizeAuthor(candAuthor), normalizeAuthor(author));
  return st * 0.7 + sa * 0.3;
}

export async function findCandidates(title: string, author: string | null): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];
  if (hardcoverEnabled()) {
    try {
      const hits = await searchBooks(author ? `${title} ${author}` : title);
      for (const h of hits.slice(0, 5)) {
        let edition = null;
        try {
          edition = (await audiobookEditions(h.book_id))[0] ?? null;
        } catch {
          /* editions are a bonus */
        }
        out.push({
          source: 'hardcover',
          book_id: h.book_id,
          edition_id: edition?.id ?? null,
          title: h.title,
          author: h.author,
          isbn13: edition?.isbn_13 ?? h.isbns.find((i) => i.length === 13) ?? null,
          runtime_seconds: edition?.audio_seconds ?? null,
          cover_url: edition?.cover_url ?? h.cover_url,
          score: score(h.title, h.author, title, author),
        });
      }
    } catch (e) {
      console.error('hardcover search failed', e);
    }
  }
  if (out.length === 0) {
    try {
      for (const h of (await searchOpenLibrary(title, author)).slice(0, 5)) {
        out.push({
          source: 'openlibrary',
          book_id: null,
          edition_id: null,
          title: h.title,
          author: h.author,
          isbn13: h.isbn13,
          runtime_seconds: null,
          cover_url: h.cover_url,
          score: score(h.title, h.author, title, author),
        });
      }
    } catch (e) {
      console.error('openlibrary search failed', e);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function decide(cands: MatchCandidate[], s: Settings): { status: 'auto' | 'needs_review' | 'no_match'; best: MatchCandidate | null } {
  if (cands.length === 0) return { status: 'no_match', best: null };
  const [best, second] = cands;
  const margin = second ? best.score - second.score : 1;
  if (best.score >= s.auto_match_min_score && margin >= s.auto_match_min_margin) return { status: 'auto', best };
  return { status: 'needs_review', best: null };
}

export function candidateFields(c: MatchCandidate) {
  return {
    hardcover_book_id: c.book_id,
    hardcover_edition_id: c.edition_id,
    isbn13: c.isbn13,
    runtime_seconds: c.runtime_seconds,
    cover_url: c.cover_url,
    match_score: c.score,
  };
}

/** Match a freshly created book: writes the result and queues a review action if needed. */
export async function matchBook(book: BookRow, settings: Settings): Promise<void> {
  const cands = await findCandidates(book.title, book.author);
  const { status, best } = decide(cands, settings);
  const update: Record<string, unknown> = { match_status: status, match_candidates: cands, updated_at: new Date().toISOString() };
  if (best) Object.assign(update, candidateFields(best));
  await db().from('books').update(update).eq('id', book.id);
  if (status !== 'auto') {
    await db().from('actions').insert({
      user_id: book.user_id,
      type: 'match_book',
      book_id: book.id,
      payload: { title: book.title, author: book.author, candidates: cands.slice(0, 3) },
    });
  }
}
