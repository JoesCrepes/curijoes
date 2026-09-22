import { describe, it, expect } from 'vitest';
import { computeProgress, lastPositionEvent, isIdleReattach } from '@/lib/progress';
import { shouldAutoFinish, isStalled } from '@/lib/finish';
import type { StoredEvent } from '@/lib/types';
import libby from './fixtures/libby-the-body.json';

const base = {
  chapter_idx: null as number | null,
  chapter_position_ms: null as number | null,
  chapter_count: null as number | null,
  chapters: [] as { idx: number; title: string | null; duration_ms: number | null }[],
  runtime_seconds: null as number | null,
  cumulative_book_seconds: 0,
  app_reported_complete: false,
};

describe('computeProgress', () => {
  it('uses the chapter map when the prefix is fully known', () => {
    const p = computeProgress({
      ...base,
      chapter_idx: 2,
      chapter_position_ms: 30_000,
      chapter_count: 3,
      chapters: [
        { idx: 0, title: null, duration_ms: 100_000 },
        { idx: 1, title: null, duration_ms: 100_000 },
        { idx: 2, title: null, duration_ms: 100_000 },
      ],
    });
    expect(p.basis).toBe('chapters');
    expect(p.book_position_ms).toBe(230_000);
    expect(p.pct).toBeCloseTo(230 / 300);
  });

  it('falls back to cumulative when a chapter duration is missing and nothing can be estimated', () => {
    const p = computeProgress({
      ...base,
      chapter_idx: 2,
      chapter_position_ms: 30_000,
      // One chapter known, and it already accounts for the whole runtime, so
      // there is no leftover to spread over the unseen ones.
      chapters: [{ idx: 1, title: null, duration_ms: 1_000_000 }],
      chapter_count: 3,
      runtime_seconds: 1000,
      cumulative_book_seconds: 500,
    });
    expect(p.basis).toBe('cumulative');
    expect(p.pct).toBe(0.5);
  });

  it('estimates the prefix when the chapter map has holes below the current chapter', () => {
    // Guards! Guards! as it actually stood on 2026-09-22: 121 tracks, only the
    // 30 played under our watch have durations, listener on track 95. The
    // cumulative fallback said 23%; track 95 of 121 is really about 78.5%.
    const chapters = Array.from({ length: 121 }, (_, idx) => ({
      idx,
      title: null,
      duration_ms: idx >= 65 && idx < 95 ? 376_925 : null, // the 30 we observed
    }));
    const p = computeProgress({
      ...base,
      chapter_idx: 95,
      chapter_position_ms: 31_177,
      chapter_count: 121,
      chapters,
      runtime_seconds: 48_293,
      cumulative_book_seconds: 11_143,
    });
    expect(p.basis).toBe('chapters_estimated');
    expect(p.pct).toBeGreaterThan(0.75);
    expect(p.pct).toBeLessThan(0.82);
    expect(p.book_position_ms).not.toBeNull();
  });

  it('prefers the exact prefix over an estimate once the map below the chapter is complete', () => {
    const chapters = [
      { idx: 0, title: null, duration_ms: 100_000 },
      { idx: 1, title: null, duration_ms: 100_000 },
      { idx: 2, title: null, duration_ms: null }, // later chapter still unknown
      { idx: 3, title: null, duration_ms: null },
    ];
    const p = computeProgress({ ...base, chapter_idx: 2, chapter_position_ms: 30_000, chapter_count: 4, chapters, runtime_seconds: 400 });
    expect(p.basis).toBe('chapters');
    expect(p.book_position_ms).toBe(230_000);
  });

  it('returns a whole number of milliseconds, because the column is a bigint', () => {
    const chapters = Array.from({ length: 121 }, (_, idx) => ({
      idx, title: null, duration_ms: idx >= 65 && idx < 95 ? 376_925 : null,
    }));
    const p = computeProgress({
      ...base, chapter_idx: 95, chapter_position_ms: 31_177, chapter_count: 121, chapters, runtime_seconds: 48_293,
    });
    expect(p.book_position_ms).toBe(Math.round(p.book_position_ms!));
  });

  it('does not read a chapter-relative position as absolute on a book with a queue', () => {
    // Audible re-attached and restored Yesteryear at 45s into chapter 3, but
    // without a chapter index. Over the chapter's own DURATION that scored 3%
    // of a 14-hour book.
    const p = computeProgress({
      ...base,
      chapter_idx: null,
      chapter_position_ms: 45_538,
      last_duration_ms: 1_388_827, // the chapter, not the book
      chapter_count: 62,
      runtime_seconds: 49_620,
      cumulative_book_seconds: 121,
    });
    expect(p.basis).not.toBe('position');
  });

  it('never estimates past the end of the book', () => {
    const chapters = Array.from({ length: 10 }, (_, idx) => ({ idx, title: null, duration_ms: null }));
    const p = computeProgress({ ...base, chapter_idx: 9, chapter_position_ms: 10_000_000, chapter_count: 10, chapters, runtime_seconds: 1000 });
    expect(p.pct).toBe(1);
    expect(p.book_position_ms).toBe(1_000_000);
  });

  it('uses absolute position over a book-wide duration when there is no chapter index (Libby)', () => {
    const p = computeProgress({ ...base, chapter_position_ms: libby.event.position_ms, last_duration_ms: libby.event.duration_ms });
    expect(p.basis).toBe('position');
    expect(p.book_position_ms).toBe(libby.event.position_ms);
    expect(p.pct).toBeCloseTo(4961357 / 50679215, 5);
    // A chapter-relative position (Audible/Libro.fm) must not be read as absolute.
    expect(computeProgress({ ...base, chapter_idx: 66, chapter_position_ms: 300_000, last_duration_ms: 924_609 }).basis).not.toBe('position');
  });

  it('reports none with no runtime', () => {
    expect(computeProgress({ ...base, cumulative_book_seconds: 500 }).basis).toBe('none');
  });

  it('app completion wins', () => {
    expect(computeProgress({ ...base, app_reported_complete: true })).toMatchObject({ pct: 1, basis: 'app' });
  });
});

describe('lastPositionEvent', () => {
  const ev = (o: Partial<StoredEvent>): StoredEvent => ({
    id: Math.random().toString(36).slice(2),
    event_type: 'position',
    occurred_at: '2026-09-18T00:00:00Z',
    is_playing: false,
    position_ms: null,
    duration_ms: null,
    playback_speed: null,
    chapter_idx: null,
    chapter_title: null,
    ...o,
  });

  it('ignores an idle re-attach that would rewind the read to zero', () => {
    // Audible on 2026-09-21: the app was opened, nothing was played, and it
    // republished metadata at position 0 with no chapter. Read literally that
    // wiped Yesteryear back to 0%.
    const evs = [
      ev({ event_type: 'play', is_playing: true, position_ms: 13_499, chapter_idx: 2 }),
      ev({ event_type: 'queue', is_playing: false, position_ms: 45_525, chapter_idx: 2 }),
      ev({ event_type: 'metadata', is_playing: false, position_ms: 0, chapter_idx: null }),
      ev({ event_type: 'queue', is_playing: false, position_ms: 0, chapter_idx: null }),
    ];
    const last = lastPositionEvent(evs);
    expect(last?.position_ms).toBe(45_525);
    expect(last?.chapter_idx).toBe(2);
  });

  it('ignores a restored position that has lost its chapter index', () => {
    const evs = [
      ev({ event_type: 'play', is_playing: true, position_ms: 13_499, chapter_idx: 2 }),
      ev({ event_type: 'queue', is_playing: false, position_ms: 45_525, chapter_idx: 2 }),
      // Audible re-attached: real position, no queue binding.
      ev({ event_type: 'metadata', is_playing: false, position_ms: 45_538, chapter_idx: null }),
      ev({ event_type: 'queue', is_playing: false, position_ms: 45_538, chapter_idx: null }),
    ];
    expect(lastPositionEvent(evs)?.chapter_idx).toBe(2);
    expect(lastPositionEvent(evs)?.position_ms).toBe(45_525);
  });

  it('keeps indexless positions on a player that never reports chapters (Libby)', () => {
    const evs = [
      ev({ event_type: 'play', is_playing: true, position_ms: 4_961_362, chapter_idx: null }),
      ev({ event_type: 'pause', is_playing: false, position_ms: 11_086_819, chapter_idx: null }),
    ];
    expect(lastPositionEvent(evs)?.position_ms).toBe(11_086_819);
  });

  it('accepts position zero at the very start of a book', () => {
    const evs = [ev({ event_type: 'metadata', is_playing: false, position_ms: 0, chapter_idx: 0 })];
    expect(lastPositionEvent(evs)?.position_ms).toBe(0);
  });

  it('accepts a deliberate rewind, which arrives as playback rather than metadata', () => {
    const evs = [
      ev({ event_type: 'position', is_playing: true, position_ms: 500_000, chapter_idx: 3 }),
      ev({ event_type: 'play', is_playing: true, position_ms: 0, chapter_idx: 0 }),
    ];
    expect(lastPositionEvent(evs)?.position_ms).toBe(0);
  });

  it('only treats a zeroed, paused metadata event as a re-attach', () => {
    expect(isIdleReattach({ event_type: 'metadata', is_playing: false, position_ms: 0 })).toBe(true);
    expect(isIdleReattach({ event_type: 'metadata', is_playing: true, position_ms: 0 })).toBe(false);
    expect(isIdleReattach({ event_type: 'pause', is_playing: false, position_ms: 0 })).toBe(false);
    expect(isIdleReattach({ event_type: 'metadata', is_playing: false, position_ms: 12 })).toBe(false);
  });
});

describe('finish rules', () => {
  it('auto-finishes on chapter-basis progress above threshold', () => {
    expect(shouldAutoFinish({ progress: { pct: 0.985, basis: 'chapters', book_position_ms: 1 }, chapter_idx: 10, chapter_count: 12, finish_threshold: 0.98 })).toBe(true);
    expect(shouldAutoFinish({ progress: { pct: 0.97, basis: 'chapters', book_position_ms: 1 }, chapter_idx: 11, chapter_count: 12, finish_threshold: 0.98 })).toBe(false);
  });
  it('position basis auto-finishes like chapters', () => {
    expect(shouldAutoFinish({ progress: { pct: 0.99, basis: 'position', book_position_ms: 1 }, chapter_idx: null, chapter_count: null, finish_threshold: 0.98 })).toBe(true);
  });
  it('an estimated prefix needs the last chapter, like cumulative', () => {
    expect(shouldAutoFinish({ progress: { pct: 0.99, basis: 'chapters_estimated', book_position_ms: 1 }, chapter_idx: 5, chapter_count: 12, finish_threshold: 0.98 })).toBe(false);
    expect(shouldAutoFinish({ progress: { pct: 0.99, basis: 'chapters_estimated', book_position_ms: 1 }, chapter_idx: 11, chapter_count: 12, finish_threshold: 0.98 })).toBe(true);
  });
  it('cumulative basis needs the last chapter', () => {
    expect(shouldAutoFinish({ progress: { pct: 0.99, basis: 'cumulative', book_position_ms: null }, chapter_idx: 5, chapter_count: 12, finish_threshold: 0.98 })).toBe(false);
    expect(shouldAutoFinish({ progress: { pct: 0.99, basis: 'cumulative', book_position_ms: null }, chapter_idx: 11, chapter_count: 12, finish_threshold: 0.98 })).toBe(true);
  });
  it('stall requires both threshold and idle time', () => {
    const now = '2026-09-18T12:00:00Z';
    expect(isStalled({ pct: 0.95, last_activity_at: '2026-09-16T12:00:00Z', now, stall_threshold: 0.9, stall_hours: 24 })).toBe(true);
    expect(isStalled({ pct: 0.95, last_activity_at: '2026-09-18T01:00:00Z', now, stall_threshold: 0.9, stall_hours: 24 })).toBe(false);
    expect(isStalled({ pct: 0.5, last_activity_at: '2026-09-01T12:00:00Z', now, stall_threshold: 0.9, stall_hours: 24 })).toBe(false);
  });
});
