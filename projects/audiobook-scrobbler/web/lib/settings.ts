import type { AppFieldMap, Settings } from './types';

// Package names of the players, all confirmed on a real phone (2026-09-18).
export const APP_AUDIBLE = 'com.audible.application';
export const APP_LIBRO = 'fm.libro.librofm';
export const APP_LIBBY = 'com.overdrive.mobile.android.libby';

// MediaMetadata key names as Android reports them. Which key holds the book
// title vs. the chapter title differs per app and is settled empirically from
// the raw log (android/tools/capture.py); editable per app in Settings.
const GENERIC: AppFieldMap = {
  title: ['android.media.metadata.ALBUM', 'android.media.metadata.DISPLAY_SUBTITLE', 'android.media.metadata.TITLE'],
  author: ['android.media.metadata.ARTIST', 'android.media.metadata.AUTHOR', 'android.media.metadata.ALBUM_ARTIST', 'android.media.metadata.WRITER'],
  chapter: ['android.media.metadata.DISPLAY_TITLE', 'android.media.metadata.TITLE'],
};

// Audible (captured from the real app, see web/tests/fixtures/audible-yesteryear.json):
//   TITLE  = book title ("Yesteryear: A GMA Book Club Pick")
//   AUTHOR = ALBUM = author ("Caro Claire Burke")
//   ARTIST = chapter title ("Part Two: The Present: Chapter 1")
//   MEDIA_ID = ASIN ("B0FKV9JSWV"), DURATION = chapter length, no DISPLAY_TITLE,
//   and a full chapter queue whose items all carry the ASIN as media_id.
const AUDIBLE: AppFieldMap = {
  title: ['android.media.metadata.TITLE'],
  author: ['android.media.metadata.AUTHOR', 'android.media.metadata.ALBUM'],
  chapter: ['android.media.metadata.ARTIST'],
};

// Libby (web/tests/fixtures/libby-the-body.json):
//   ALBUM = TITLE = DISPLAY_TITLE = book, ARTIST = ALBUM_ARTIST = author,
//   DISPLAY_SUBTITLE = chapter ("Chapter 3: Microbial You"), DURATION = the
//   whole book, position is absolute, no queue / chapter index. `titleId` is
//   OverDrive's id; MEDIA_ID is empty.
const LIBBY: AppFieldMap = {
  title: ['android.media.metadata.TITLE', 'android.media.metadata.ALBUM'],
  author: ['android.media.metadata.ARTIST', 'android.media.metadata.ALBUM_ARTIST'],
  chapter: ['android.media.metadata.DISPLAY_SUBTITLE'],
};

// Libro.fm (web/tests/fixtures/librofm-guards-guards.json): TITLE = ALBUM =
// book, ARTIST = author, one queue item per track all titled with the book
// name (so no chapter names), DURATION = track length, MEDIA_ID = track id.
// The generic map fits; chapter resolves to null because it equals the title.

export const DEFAULT_SETTINGS: Settings = {
  session_gap_seconds: 600,
  finish_threshold: 0.98,
  stall_threshold: 0.9,
  stall_hours: 24,
  stall_auto_finish_days: 14,
  auto_match_min_score: 0.85,
  auto_match_min_margin: 0.1,
  allowed_apps: [APP_AUDIBLE, APP_LIBRO, APP_LIBBY],
  app_field_maps: {
    [APP_AUDIBLE]: AUDIBLE,
    [APP_LIBRO]: GENERIC,
    [APP_LIBBY]: LIBBY,
    default: GENERIC,
  },
};

export function mergeSettings(rows: { key: string; value: unknown }[]): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) {
    if (r.key in s) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return s;
}

export function fieldMapFor(settings: Settings, appPackage: string): AppFieldMap {
  return settings.app_field_maps[appPackage] ?? settings.app_field_maps.default ?? DEFAULT_SETTINGS.app_field_maps.default;
}
