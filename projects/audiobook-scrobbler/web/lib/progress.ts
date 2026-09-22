import type { Chapter, Progress, StoredEvent } from './types';

export interface ProgressInput {
  chapter_idx: number | null;
  chapter_position_ms: number | null;
  /** DURATION reported with the last position: a chapter for Audible/Libro.fm, the whole book for Libby. */
  last_duration_ms?: number | null;
  chapter_count: number | null; // from the player's queue, if seen
  chapters: Chapter[];
  runtime_seconds: number | null; // from the matched edition
  cumulative_book_seconds: number;
  app_reported_complete: boolean;
}

/** Total runtime: prefer the full chapter map when complete, else the edition. */
export function knownRuntimeMs(input: ProgressInput): number | null {
  const { chapters, chapter_count, runtime_seconds } = input;
  if (chapter_count != null && chapters.length >= chapter_count && chapters.every((c) => c.duration_ms != null)) {
    return chapters.reduce((a, c) => a + (c.duration_ms ?? 0), 0);
  }
  return runtime_seconds != null ? runtime_seconds * 1000 : null;
}

/**
 * A player re-attaching its MediaSession — you opened the app but played
 * nothing — republishes metadata at position 0. Taken at face value that reads
 * as "back to the start of the book" and wipes the read's progress, which is
 * exactly what happened to Yesteryear on 2026-09-21. A zeroed, not-playing
 * metadata/queue event is therefore not evidence of position once the read has
 * ever been somewhere else; a real rewind arrives as a play, pause or seek.
 */
export function isIdleReattach(e: Pick<StoredEvent, 'event_type' | 'is_playing' | 'position_ms'>): boolean {
  return e.position_ms === 0 && !e.is_playing && (e.event_type === 'metadata' || e.event_type === 'queue');
}

/**
 * The most recent event that credibly says where the listener is.
 *
 * Besides the zeroed re-attach, a player that has lost its queue binding
 * republishes a real position with no chapter index. On a book with chapters
 * that position is chapter-relative, so reading it without an index invites it
 * to be taken as absolute — Audible restored Yesteryear at 45s into chapter 3
 * and it was scored as 3% of the book. Once a read has ever carried a chapter
 * index, a sample without one tells us nothing we can place.
 */
export function lastPositionEvent(evs: StoredEvent[]): StoredEvent | null {
  const everMoved = evs.some((e) => (e.position_ms ?? 0) > 0);
  const hasChapters = evs.some((e) => e.chapter_idx != null);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.position_ms == null) continue;
    if (everMoved && isIdleReattach(e)) continue;
    if (hasChapters && e.chapter_idx == null) continue;
    return e;
  }
  return null;
}

export function computeProgress(input: ProgressInput): Progress {
  if (input.app_reported_complete) return { pct: 1, basis: 'app', book_position_ms: knownRuntimeMs(input) };

  const runtimeMs = knownRuntimeMs(input);
  const { chapter_idx, chapter_position_ms, chapters } = input;

  if (chapter_idx != null && chapter_position_ms != null) {
    const byIdx = new Map(chapters.map((c) => [c.idx, c.duration_ms] as const));
    let knownPrefix = 0;
    let unknownBelow = 0;
    for (let i = 0; i < chapter_idx; i++) {
      const d = byIdx.get(i);
      if (d == null) unknownBelow++;
      else knownPrefix += d;
    }

    if (unknownBelow === 0) {
      const pos = knownPrefix + chapter_position_ms;
      return { pct: runtimeMs ? Math.min(1, pos / runtimeMs) : null, basis: 'chapters', book_position_ms: pos };
    }

    // The map is only learned from chapters actually played, so a book started
    // before this app existed has holes below the current chapter. Spread the
    // runtime the known chapters don't account for evenly over the ones we have
    // never seen. It is an estimate, and labelled as one, but it beats the
    // cumulative fallback by a mile: cumulative can only ever describe what we
    // watched, so Guards! Guards! read 23% while genuinely at track 95 of 121.
    // The estimate converges on the truth as the map fills in.
    const estimated = estimatePrefix({ knownPrefix, unknownBelow, chapters, chapter_count: input.chapter_count, runtimeMs });
    if (estimated != null) {
      // Round: book_position_ms is a bigint column and a fractional estimate is
      // rejected outright.
      const pos = Math.round(Math.min(estimated + chapter_position_ms, runtimeMs!));
      return { pct: Math.min(1, pos / runtimeMs!), basis: 'chapters_estimated', book_position_ms: pos };
    }
  }

  // No chapter index at all (Libby): the player's position is absolute in the
  // book and DURATION is the whole book, so the ratio is the progress. This
  // only holds for a player with no queue; on a book that has chapters, a
  // position without an index is chapter-relative and reading it as absolute
  // silently invents a number.
  const noQueue = input.chapter_count == null || input.chapter_count <= 1;
  if (noQueue && chapter_idx == null && chapter_position_ms != null && input.last_duration_ms != null && input.last_duration_ms > 0) {
    return { pct: Math.min(1, chapter_position_ms / input.last_duration_ms), basis: 'position', book_position_ms: chapter_position_ms };
  }

  if (runtimeMs && input.cumulative_book_seconds > 0) {
    return {
      pct: Math.min(1, (input.cumulative_book_seconds * 1000) / runtimeMs),
      basis: 'cumulative',
      book_position_ms: null,
    };
  }
  return { pct: null, basis: 'none', book_position_ms: null };
}

/** Prefix of a partly-known chapter map, or null when there is nothing to base it on. */
function estimatePrefix(i: {
  knownPrefix: number;
  unknownBelow: number;
  chapters: Chapter[];
  chapter_count: number | null;
  runtimeMs: number | null;
}): number | null {
  if (!i.runtimeMs) return null;
  const total = i.chapter_count ?? i.chapters.length;
  const knownCount = i.chapters.filter((c) => c.duration_ms != null).length;
  const unknownCount = total - knownCount;
  if (unknownCount <= 0 || i.unknownBelow > unknownCount) return null;

  const knownTotal = i.chapters.reduce((a, c) => a + (c.duration_ms ?? 0), 0);
  const meanUnknown = (i.runtimeMs - knownTotal) / unknownCount;
  // The known chapters already account for the whole runtime: the map and the
  // edition disagree, so an estimate would be guesswork on top of guesswork.
  if (!(meanUnknown > 0)) return null;

  return i.knownPrefix + i.unknownBelow * meanUnknown;
}
