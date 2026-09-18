import type { AppFieldMap, Settings } from './types';

// Package names of the players. Audible and Libby are well known; Libro.fm's
// is the best current guess and is easy to correct from the Settings page
// once the raw event log shows the real one.
export const APP_AUDIBLE = 'com.audible.application';
export const APP_LIBRO = 'fm.libro.librofm';
export const APP_LIBBY = 'com.overdrive.mobile.android.libby';

// MediaMetadata key names as Android reports them. Which key holds the book
// title vs. the chapter title differs per app and is settled empirically from
// the raw log; these defaults are the reasonable first guess and are editable.
const GENERIC: AppFieldMap = {
  title: ['android.media.metadata.ALBUM', 'android.media.metadata.DISPLAY_SUBTITLE', 'android.media.metadata.TITLE'],
  author: ['android.media.metadata.ARTIST', 'android.media.metadata.AUTHOR', 'android.media.metadata.ALBUM_ARTIST', 'android.media.metadata.WRITER'],
  chapter: ['android.media.metadata.DISPLAY_TITLE', 'android.media.metadata.TITLE'],
};

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
    [APP_AUDIBLE]: GENERIC,
    [APP_LIBRO]: GENERIC,
    [APP_LIBBY]: GENERIC,
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
