import type { Chapter, Progress } from './types';

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

export function computeProgress(input: ProgressInput): Progress {
  if (input.app_reported_complete) return { pct: 1, basis: 'app', book_position_ms: knownRuntimeMs(input) };

  const runtimeMs = knownRuntimeMs(input);
  const { chapter_idx, chapter_position_ms, chapters } = input;

  if (chapter_idx != null && chapter_position_ms != null) {
    const byIdx = new Map(chapters.map((c) => [c.idx, c.duration_ms] as const));
    let prefix = 0;
    let complete = true;
    for (let i = 0; i < chapter_idx; i++) {
      const d = byIdx.get(i);
      if (d == null) { complete = false; break; }
      prefix += d;
    }
    if (complete) {
      const pos = prefix + chapter_position_ms;
      return { pct: runtimeMs ? Math.min(1, pos / runtimeMs) : null, basis: 'chapters', book_position_ms: pos };
    }
  }

  // No chapter index at all (Libby): the player's position is absolute in the
  // book and DURATION is the whole book, so the ratio is the progress.
  if (chapter_idx == null && chapter_position_ms != null && input.last_duration_ms != null && input.last_duration_ms > 0) {
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
