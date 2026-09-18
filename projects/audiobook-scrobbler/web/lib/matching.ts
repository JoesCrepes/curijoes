import { db } from './supabase';
import { normalizeAuthor, normalizeTitle, similarity } from './normalize';
import { audiobookEditions, editionByIdentifier, hardcoverEnabled, searchBooks } from './hardcover';
import { searchOpenLibrary } from './openlibrary';
import type { ExternalId, MatchCandidate, Settings } from './types';

export interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  match_status: string;
  external_id?: string | null;
  external_id_kind?: string | null;
  /** Total runtime the player itself reported, when it reports one (Libby). */
  observed_runtime_seconds?: number | null;
}

/** Runtimes agree within 10%: the same book, allowing for credits and intros. */
const RUNTIME_TOLERANCE = 0.1;

export function runtimeAgreement(observed: number | null | undefined, candidate: number | null | undefined): number | null {
  if (!observed || !candidate) return null;
  const off = Math.abs(candidate - observed) / observed;
  if (off <= RUNTIME_TOLERANCE) return 1;
  if (off >= 0.35) return 0;
  return 1 - (off - RUNTIME_TOLERANCE) / (0.35 - RUNTIME_TOLERANCE);
}

export interface ScoreInput {
  candTitle: string;
  candAuthor: string | null;
  candRuntime?: number | null;
  title: string;
  author: string | null;
  observedRuntime?: number | null;
}

/**
 * Title similarity is the backbone; the author either corroborates it or, when
 * either side is missing, holds the score below auto-accept on purpose.
 *
 * The old version returned `titleSimilarity * 0.9` whenever an author was
 * missing, which let a title-only match clear the 0.85 auto threshold — that is
 * how "The Body" (Libby, Bill Bryson) auto-matched to Stephen King's novel.
 * A missing author is now evidence we lack, not evidence in favour.
 */
export function score(i: ScoreInput): number {
  const st = similarity(normalizeTitle(i.candTitle), normalizeTitle(i.title));
  const runtime = runtimeAgreement(i.observedRuntime, i.candRuntime);

  if (!i.author || !i.candAuthor) {
    // No author to compare. Cap below any sane auto-accept threshold, and let
    // runtime agreement lift it only part of the way.
    const base = st * 0.6;
    return runtime == null ? base : base + runtime * 0.15;
  }

  const sa = similarity(normalizeAuthor(i.candAuthor), normalizeAuthor(i.author));
  if (runtime == null) return st * 0.65 + sa * 0.35;
  return st * 0.55 + sa * 0.3 + runtime * 0.15;
}

/** True when the scorer had an author on both sides — required for auto-accept. */
export function hasAuthorEvidence(candAuthor: string | null, author: string | null): boolean {
  if (!author || !candAuthor) return false;
  return similarity(normalizeAuthor(candAuthor), normalizeAuthor(author)) >= 0.5;
}

export async function findCandidates(
  title: string,
  author: string | null,
  opts: { external?: ExternalId | null; observedRuntime?: number | null; userId?: string } = {},
): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];

  // 1. Something we already confirmed for this identifier: no lookup, no scoring.
  if (opts.external && opts.userId) {
    const { data } = await db()
      .from('identifier_matches')
      .select('*')
      .eq('user_id', opts.userId)
      .eq('kind', opts.external.kind)
      .eq('value', opts.external.value)
      .maybeSingle();
    if (data) {
      return [{
        source: 'hardcover',
        book_id: data.hardcover_book_id,
        edition_id: data.hardcover_edition_id,
        title,
        author,
        isbn13: data.isbn13,
        runtime_seconds: data.runtime_seconds,
        cover_url: data.cover_url,
        score: 1,
      }];
    }
  }

  // 2. Exact edition lookup by the player's own id.
  if (opts.external && opts.external.kind !== 'overdrive' && hardcoverEnabled()) {
    try {
      const hit = await editionByIdentifier(opts.external.kind, opts.external.value);
      if (hit) {
        return [{
          source: 'hardcover',
          book_id: hit.book_id,
          edition_id: hit.edition_id,
          title: hit.title,
          author: hit.author,
          isbn13: hit.isbn13,
          runtime_seconds: hit.runtime_seconds,
          cover_url: hit.cover_url,
          score: 1,
        }];
      }
    } catch (e) {
      console.error('identifier lookup failed', e);
    }
  }

  // 3. Fall back to search, scored.
  if (hardcoverEnabled()) {
    try {
      const hits = await searchBooks(author ? `${title} ${author}` : title);
      for (const h of hits.slice(0, 5)) {
        // The search index already carries the default audiobook runtime, so a
        // per-candidate edition query is only needed for the leaders.
        let edition = null;
        if (h.has_audiobook) {
          try {
            edition = (await audiobookEditions(h.book_id))[0] ?? null;
          } catch {
            /* editions are a bonus */
          }
        }
        const runtime = edition?.audio_seconds ?? h.audio_seconds;
        out.push({
          source: 'hardcover',
          book_id: h.book_id,
          edition_id: edition?.id ?? null,
          title: h.title,
          author: h.author,
          isbn13: edition?.isbn_13 ?? h.isbns.find((i) => i.length === 13) ?? null,
          runtime_seconds: runtime,
          cover_url: edition?.cover_url ?? h.cover_url,
          score: score({ candTitle: h.title, candAuthor: h.author, candRuntime: runtime, title, author, observedRuntime: opts.observedRuntime }),
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
          score: score({ candTitle: h.title, candAuthor: h.author, title, author }),
        });
      }
    } catch (e) {
      console.error('openlibrary search failed', e);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function decide(cands: MatchCandidate[], s: Settings, ctx: { author?: string | null } = {}): { status: 'auto' | 'needs_review' | 'no_match'; best: MatchCandidate | null } {
  if (cands.length === 0) return { status: 'no_match', best: null };
  const [best, second] = cands;
  const margin = second ? best.score - second.score : 1;
  // An identifier lookup is exact; nothing else may auto-accept without an
  // author on both sides, so a title-only coincidence cannot slip through.
  const exact = best.score >= 1;
  const corroborated = exact || hasAuthorEvidence(best.author, ctx.author ?? null);
  if (corroborated && best.score >= s.auto_match_min_score && margin >= s.auto_match_min_margin) {
    return { status: 'auto', best };
  }
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

/** Remember what an identifier resolved to, so it matches instantly next time. */
export async function rememberIdentifier(userId: string, external: ExternalId, c: MatchCandidate): Promise<void> {
  if (!c.book_id) return;
  await db().from('identifier_matches').upsert({
    user_id: userId,
    kind: external.kind,
    value: external.value,
    hardcover_book_id: c.book_id,
    hardcover_edition_id: c.edition_id,
    runtime_seconds: c.runtime_seconds,
    isbn13: c.isbn13,
    cover_url: c.cover_url,
  });
}

/** Match a book: writes the result and queues a review action if needed. */
export async function matchBook(book: BookRow, settings: Settings): Promise<void> {
  const external: ExternalId | null =
    book.external_id && book.external_id_kind ? { kind: book.external_id_kind as ExternalId['kind'], value: book.external_id } : null;
  const cands = await findCandidates(book.title, book.author, {
    external,
    observedRuntime: book.observed_runtime_seconds ?? null,
    userId: book.user_id,
  });
  const { status, best } = decide(cands, settings, { author: book.author });
  const update: Record<string, unknown> = { match_status: status, match_candidates: cands, updated_at: new Date().toISOString() };
  if (best) Object.assign(update, candidateFields(best));
  await db().from('books').update(update).eq('id', book.id);
  if (status === 'auto' && best && external) await rememberIdentifier(book.user_id, external, best);
  if (status !== 'auto') {
    // Replace any stale prompt rather than stacking a second one for this book.
    await db().from('actions').update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('book_id', book.id).eq('type', 'match_book').eq('status', 'pending');
    await db().from('actions').insert({
      user_id: book.user_id,
      type: 'match_book',
      book_id: book.id,
      payload: { title: book.title, author: book.author, candidates: cands.slice(0, 3) },
    });
  }
}
