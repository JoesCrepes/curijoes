import { describe, it, expect } from 'vitest';
import { computeProgress } from '@/lib/progress';
import { shouldAutoFinish, isStalled } from '@/lib/finish';

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

  it('falls back to cumulative when a chapter duration is missing', () => {
    const p = computeProgress({
      ...base,
      chapter_idx: 2,
      chapter_position_ms: 30_000,
      chapters: [{ idx: 1, title: null, duration_ms: 100_000 }],
      runtime_seconds: 1000,
      cumulative_book_seconds: 500,
    });
    expect(p.basis).toBe('cumulative');
    expect(p.pct).toBe(0.5);
  });

  it('reports none with no runtime', () => {
    expect(computeProgress({ ...base, cumulative_book_seconds: 500 }).basis).toBe('none');
  });

  it('app completion wins', () => {
    expect(computeProgress({ ...base, app_reported_complete: true })).toMatchObject({ pct: 1, basis: 'app' });
  });
});

describe('finish rules', () => {
  it('auto-finishes on chapter-basis progress above threshold', () => {
    expect(shouldAutoFinish({ progress: { pct: 0.985, basis: 'chapters', book_position_ms: 1 }, chapter_idx: 10, chapter_count: 12, finish_threshold: 0.98 })).toBe(true);
    expect(shouldAutoFinish({ progress: { pct: 0.97, basis: 'chapters', book_position_ms: 1 }, chapter_idx: 11, chapter_count: 12, finish_threshold: 0.98 })).toBe(false);
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
