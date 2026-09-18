import type { Session, StoredEvent } from './types';

const MS = 1000;

function ts(e: StoredEvent): number {
  return new Date(e.occurred_at).getTime();
}

/**
 * Book-seconds consumed between two consecutive events while playing.
 * Position deltas are the truth; wall time × speed is the fallback when the
 * delta is implausible (seek) or crosses a chapter boundary of unknown length.
 */
function bookSecondsBetween(a: StoredEvent, b: StoredEvent, chapterDurations: Map<number, number>): number {
  const wall = (ts(b) - ts(a)) / MS;
  if (wall <= 0) return 0;
  const speed = a.playback_speed && a.playback_speed > 0 ? a.playback_speed : 1;
  const expected = wall * speed;
  const cap = expected * 1.25 + 5;

  if (a.position_ms == null || b.position_ms == null) return expected;

  const sameChapter = a.chapter_idx == null || b.chapter_idx == null || a.chapter_idx === b.chapter_idx;
  if (sameChapter) {
    const d = (b.position_ms - a.position_ms) / MS;
    if (d < 0) return 0; // rewound: we can't tell how much was re-listened; be conservative
    if (d <= cap) return d;
    return expected; // seek forward: count only the wall time actually spent
  }

  const durA = a.duration_ms ?? (a.chapter_idx != null ? chapterDurations.get(a.chapter_idx) : undefined);
  if (durA != null) {
    const d = (durA - a.position_ms + b.position_ms) / MS;
    if (d >= 0 && d <= cap) return d;
  }
  return expected;
}

/**
 * Cluster a read's events (ascending by time) into sessions separated by
 * gaps longer than gapSeconds, and compute listened time per session.
 */
export function computeSessions(events: StoredEvent[], gapSeconds: number, chapters: { idx: number; duration_ms: number | null }[] = []): Session[] {
  const sorted = [...events].sort((x, y) => ts(x) - ts(y));
  const durations = new Map<number, number>();
  for (const c of chapters) if (c.duration_ms != null) durations.set(c.idx, c.duration_ms);

  const out: Session[] = [];
  let cur: StoredEvent[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    let book = 0;
    for (let i = 1; i < cur.length; i++) {
      if (cur[i - 1].is_playing) book += bookSecondsBetween(cur[i - 1], cur[i], durations);
    }
    const first = cur[0];
    const last = cur[cur.length - 1];
    out.push({
      started_at: first.occurred_at,
      ended_at: last.occurred_at,
      wall_seconds: Math.round((ts(last) - ts(first)) / MS),
      book_seconds: Math.round(book),
      start_chapter_idx: first.chapter_idx,
      end_chapter_idx: last.chapter_idx,
      start_position_ms: first.position_ms,
      end_position_ms: last.position_ms,
      event_count: cur.length,
    });
    cur = [];
  };

  for (const e of sorted) {
    if (cur.length > 0 && ts(e) - ts(cur[cur.length - 1]) > gapSeconds * MS) flush();
    // A session should begin on something playing; leading pauses/metadata
    // from an idle player don't open one.
    if (cur.length === 0 && !e.is_playing && e.event_type !== 'play') continue;
    cur.push(e);
  }
  flush();
  return out.filter((s) => s.event_count > 1 || s.book_seconds > 0);
}
