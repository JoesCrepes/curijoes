import { describe, it, expect } from 'vitest';
import { computeSessions } from '@/lib/sessions';
import type { StoredEvent } from '@/lib/types';

let n = 0;
const T0 = Date.parse('2026-09-18T10:00:00Z');
function ev(offsetSec: number, p: Partial<StoredEvent>): StoredEvent {
  return {
    id: `e${n++}`,
    event_type: 'position',
    occurred_at: new Date(T0 + offsetSec * 1000).toISOString(),
    is_playing: true,
    position_ms: null,
    duration_ms: null,
    playback_speed: 2,
    chapter_idx: null,
    chapter_title: null,
    ...p,
  };
}

describe('computeSessions', () => {
  it('splits on gaps longer than the threshold', () => {
    const events = [
      ev(0, { event_type: 'play', position_ms: 0, chapter_idx: 0 }),
      ev(60, { position_ms: 120_000, chapter_idx: 0 }),
      ev(120, { event_type: 'pause', is_playing: false, position_ms: 240_000, chapter_idx: 0 }),
      // 20 min later
      ev(1320, { event_type: 'play', position_ms: 240_000, chapter_idx: 0 }),
      ev(1380, { event_type: 'pause', is_playing: false, position_ms: 360_000, chapter_idx: 0 }),
    ];
    const s = computeSessions(events, 600);
    expect(s).toHaveLength(2);
    expect(s[0].wall_seconds).toBe(120);
    expect(s[0].book_seconds).toBe(240); // 2x speed, tracked via position deltas
    expect(s[1].book_seconds).toBe(120);
  });

  it('uses wall*speed on seek-forward and 0 on rewind', () => {
    const events = [
      ev(0, { event_type: 'play', position_ms: 0 }),
      ev(60, { position_ms: 900_000 }), // jumped 15 min in 1 min: a seek
      ev(120, { position_ms: 800_000 }), // rewound
      ev(180, { event_type: 'pause', is_playing: false, position_ms: 920_000 }),
    ];
    const [s] = computeSessions(events, 600);
    expect(s.book_seconds).toBe(120 + 0 + 120);
  });

  it('crosses chapter boundaries using the previous chapter duration', () => {
    const events = [
      ev(0, { event_type: 'play', position_ms: 580_000, duration_ms: 600_000, chapter_idx: 4 }),
      ev(60, { position_ms: 100_000, duration_ms: 900_000, chapter_idx: 5 }),
      ev(120, { event_type: 'pause', is_playing: false, position_ms: 220_000, chapter_idx: 5 }),
    ];
    const [s] = computeSessions(events, 600);
    expect(s.book_seconds).toBe(20 + 100 + 120);
    expect(s.start_chapter_idx).toBe(4);
    expect(s.end_chapter_idx).toBe(5);
  });

  it('does not count paused time and ignores idle metadata chatter', () => {
    const events = [
      ev(0, { event_type: 'metadata', is_playing: false }),
      ev(5, { event_type: 'pause', is_playing: false }),
      ev(10, { event_type: 'play', position_ms: 0 }),
      ev(70, { event_type: 'pause', is_playing: false, position_ms: 120_000 }),
      ev(370, { event_type: 'play', position_ms: 120_000 }),
      ev(430, { event_type: 'pause', is_playing: false, position_ms: 240_000 }),
    ];
    const s = computeSessions(events, 600);
    expect(s).toHaveLength(1);
    expect(s[0].event_count).toBe(4);
    expect(s[0].wall_seconds).toBe(420);
    expect(s[0].book_seconds).toBe(240);
  });

  it('returns nothing for a lone event', () => {
    expect(computeSessions([ev(0, { event_type: 'metadata', is_playing: false })], 600)).toEqual([]);
  });
});
