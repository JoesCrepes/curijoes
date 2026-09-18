export type EventType = 'play' | 'pause' | 'stop' | 'metadata' | 'position' | 'queue' | 'complete';

/** Event as posted by the phone. */
export interface IncomingEvent {
  id: string;
  app_package: string;
  event_type: EventType;
  occurred_at: string; // ISO 8601
  is_playing?: boolean;
  position_ms?: number | null;
  duration_ms?: number | null;
  playback_speed?: number | null;
  chapter_idx?: number | null;
  chapter_count?: number | null;
  /** All MediaMetadata keys the player exposed, verbatim. */
  raw?: Record<string, unknown>;
  /** For queue events: the player's queue, in order. */
  queue?: { title?: string | null; subtitle?: string | null; media_id?: string | null }[];
}

/** Event as stored, minimally typed for the pure computation modules. */
export interface StoredEvent {
  id: string;
  event_type: EventType;
  occurred_at: string;
  is_playing: boolean;
  position_ms: number | null;
  duration_ms: number | null;
  playback_speed: number | null;
  chapter_idx: number | null;
  chapter_title: string | null;
}

export interface Chapter {
  idx: number;
  title: string | null;
  duration_ms: number | null;
}

export interface Session {
  started_at: string;
  ended_at: string;
  wall_seconds: number;
  book_seconds: number;
  start_chapter_idx: number | null;
  end_chapter_idx: number | null;
  start_position_ms: number | null;
  end_position_ms: number | null;
  event_count: number;
}

export type ProgressBasis = 'none' | 'chapters' | 'cumulative' | 'app';

export interface Progress {
  pct: number | null; // 0..1
  basis: ProgressBasis;
  book_position_ms: number | null;
}

/** How to read book/chapter identity out of a given player's metadata. */
export interface AppFieldMap {
  /** Ordered list of raw keys to try for the book title. */
  title: string[];
  author: string[];
  chapter: string[];
}

export interface Settings {
  session_gap_seconds: number;
  finish_threshold: number; // 0..1, auto-finish
  stall_threshold: number; // 0..1, notify when parked above this
  stall_hours: number; // hours without a session before notifying
  stall_auto_finish_days: number; // 0 disables; resolves ignored stall prompts as finished
  auto_match_min_score: number;
  auto_match_min_margin: number;
  allowed_apps: string[];
  app_field_maps: Record<string, AppFieldMap>;
}

export interface MatchCandidate {
  source: 'hardcover' | 'openlibrary';
  book_id: number | null;
  edition_id: number | null;
  title: string;
  author: string | null;
  isbn13: string | null;
  runtime_seconds: number | null;
  cover_url: string | null;
  score: number;
}
