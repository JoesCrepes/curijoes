import type { AppFieldMap, ExternalId } from './types';

const NOISE = [
  /\((unabridged|abridged)\)/gi,
  /\[(unabridged|abridged|audiobook)\]/gi,
  /\bunabridged\b/gi,
  /:\s*a novel$/i,
  /\s*[-–:]\s*[^-–:]*?,\s*book\s+\d+.*$/i, // trailing "- The X Archive, Book 2"
  /\s*[-–:]\s*(the|a)?\s*[\w' ]+\s+(series|trilogy|saga|cycle|chronicles)\b.*$/i,
  /,?\s*book\s+\d+\s*$/i,
];

export function normalizeTitle(raw: string): string {
  let t = raw.normalize('NFKC');
  for (const re of NOISE) t = t.replace(re, ' ');
  return t
    .toLowerCase()
    .replace(/[’'"“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeAuthor(raw: string | null | undefined): string {
  if (!raw) return '';
  let a = raw.normalize('NFKC').replace(/narrated by.*$/i, '').replace(/\(.*?\)/g, '');
  // Multi-author strings: keep the first name for identity purposes.
  a = a.split(/,|&|\band\b|;/i)[0] ?? a;
  return a
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function sourceKey(appPackage: string, title: string, author: string | null | undefined): string {
  // Identity is title+author, NOT app: the same book listened to in Libby and
  // later Audible should be one book. The app is kept on the row for display.
  void appPackage;
  return `${normalizeTitle(title)}|${normalizeAuthor(author)}`;
}

function firstString(raw: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!raw) return null;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Pull (book title, author, chapter title) out of a raw metadata bag. */
export function extractIdentity(raw: Record<string, unknown> | undefined, map: AppFieldMap) {
  const title = firstString(raw, map.title);
  const author = firstString(raw, map.author);
  let chapter = firstString(raw, map.chapter);
  if (chapter && title && chapter === title) chapter = null;
  return { title, author, chapter };
}

const MD = 'android.media.metadata.';
const ASIN = /^B[0-9A-Z]{9}$/;
// Libro.fm serves covers as covers.libro.fm/<isbn13>_<size>.jpg, which is the
// only place it exposes the audiobook's ISBN.
const LIBROFM_COVER = /covers\.libro\.fm\/(\d{13})/;

/**
 * The player's own id for the book, verified against real captures:
 *   Audible   MEDIA_ID is the ASIN (also the media_id on every queue item)
 *   Libro.fm  no id field, but the cover URL carries the audiobook ISBN-13
 *   Libby     MEDIA_ID is empty; `titleId` is OverDrive's own id
 * Audible's ASIN is marketplace-specific, so Hardcover often will not have it;
 * it is still worth keeping as a local identity (see identifier_matches).
 */
export function extractIdentifier(appPackage: string, raw: Record<string, unknown> | undefined): ExternalId | null {
  if (!raw) return null;
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');

  const mediaId = str(`${MD}MEDIA_ID`);
  if (ASIN.test(mediaId)) return { kind: 'asin', value: mediaId };

  for (const k of [`${MD}ART_URI`, `${MD}ALBUM_ART_URI`, `${MD}DISPLAY_ICON_URI`]) {
    const m = LIBROFM_COVER.exec(str(k));
    if (m) return { kind: 'isbn13', value: m[1] };
  }

  const titleId = str('titleId');
  if (titleId && /^\d+$/.test(titleId)) return { kind: 'overdrive', value: titleId };

  void appPackage; // keyed on the metadata shape, not the package name
  return null;
}

/** Token-set Dice coefficient for fuzzy title/author comparison. */
export function similarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}
