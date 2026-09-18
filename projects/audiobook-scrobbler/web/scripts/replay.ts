/**
 * Replay captured phone events through the real pipeline, offline, and emit
 * the result in Hardcover's shape.
 *
 * No Supabase, no network: the same pure functions ingest.ts uses (field maps,
 * identity, sessions, progress, finish rules) run over a JSONL capture from
 * android/tools/capture.py, and the reads are mapped to what sync.ts would
 * send to Hardcover (user_books, user_book_reads, and the mutation ops).
 *
 *   npm run replay -- ../android/tools/captures/20260918-154914.jsonl
 *   npm run replay -- capture.jsonl --json out.json --html out.html
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SETTINGS, fieldMapFor } from '../lib/settings';
import { extractIdentity, sourceKey } from '../lib/normalize';
import { computeSessions } from '../lib/sessions';
import { computeProgress } from '../lib/progress';
import { shouldAutoFinish } from '../lib/finish';
import { STATUS, insertUserBookOp, insertReadOp, updateReadOp, updateUserBookOp } from '../lib/hardcover';
import type { Chapter, IncomingEvent, Session, StoredEvent } from '../lib/types';
// @ts-expect-error bundled as text by esbuild (--loader:.html=text)
import template from './replay-template.html';

interface Book {
  id: string;
  source_key: string;
  source_app: string;
  title: string;
  author: string | null;
  external_id: string | null; // ASIN (Audible), titleId (Libby), track id (Libro.fm)
  chapters: Map<number, Chapter>;
  chapter_count: number | null;
}
interface Read {
  id: string;
  book: Book;
  started_at: string;
  last_activity_at: string;
  status: 'reading' | 'finished' | 'dnf';
  finished_at: string | null;
  events: (StoredEvent & { chapter_count: number | null; raw: Record<string, unknown> })[];
}

const MD = 'android.media.metadata.';

function externalId(app: string, raw: Record<string, unknown>): string | null {
  const s = (k: string) => (typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string) : null);
  if (app === 'com.audible.application') return s(MD + 'MEDIA_ID');
  if (app === 'com.overdrive.mobile.android.libby') return s('titleId');
  return null;
}

export function replay(events: IncomingEvent[], settings = DEFAULT_SETTINGS) {
  const allowed = new Set(settings.allowed_apps);
  const books = new Map<string, Book>();
  const reads: Read[] = [];
  const readByBook = new Map<string, Read>();
  const ignored: Record<string, number> = {};
  let noIdentity = 0;
  let n = 0;

  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (allowed.size && !allowed.has(e.app_package)) {
      ignored[e.app_package] = (ignored[e.app_package] ?? 0) + 1;
      continue;
    }
    const raw = (e.raw ?? {}) as Record<string, unknown>;
    const { title, author, chapter } = extractIdentity(raw, fieldMapFor(settings, e.app_package));
    if (!title) {
      noIdentity++;
      continue;
    }
    // Libby and Libro.fm publish the title before the author: an authorless
    // event joins the same-titled book, and an authorless book takes the author
    // when it finally shows up (mirrors getOrCreateBook in lib/ingest.ts).
    const key = sourceKey(e.app_package, title, author);
    const titleOnly = sourceKey(e.app_package, title, null);
    let book = books.get(key);
    if (!book && !author) book = [...books.values()].find((b) => b.source_key.startsWith(titleOnly));
    if (!book && author && books.has(titleOnly)) {
      book = books.get(titleOnly)!;
      books.delete(titleOnly);
      book.source_key = key;
      book.author = author;
      books.set(key, book);
    }
    if (!book) {
      book = { id: `book-${++n}`, source_key: key, source_app: e.app_package, title, author: author ?? null, external_id: null, chapters: new Map(), chapter_count: null };
      books.set(key, book);
    }
    book.external_id ??= externalId(e.app_package, raw);

    // Q16: continue the open read; start a new one if the last is closed and the event is past its window.
    let read = readByBook.get(book.id);
    if (read && read.status !== 'reading') {
      const cutoff = new Date(new Date(read.finished_at ?? read.last_activity_at).getTime() + settings.session_gap_seconds * 1000).toISOString();
      if (e.occurred_at > cutoff) read = undefined;
    }
    if (!read) {
      read = { id: `read-${reads.length + 1}`, book, started_at: e.occurred_at, last_activity_at: e.occurred_at, status: 'reading', finished_at: null, events: [] };
      reads.push(read);
      readByBook.set(book.id, read);
    }
    read.last_activity_at = e.occurred_at;
    const count = e.chapter_count ?? (e.queue ? e.queue.length : null);
    read.events.push({
      id: e.id,
      event_type: e.event_type,
      occurred_at: e.occurred_at,
      is_playing: !!e.is_playing,
      position_ms: e.position_ms ?? null,
      duration_ms: e.duration_ms ?? null,
      playback_speed: e.playback_speed ?? null,
      chapter_idx: e.chapter_idx ?? null,
      chapter_title: chapter,
      chapter_count: count,
      raw,
    });
    if (count != null) book.chapter_count = Math.max(book.chapter_count ?? 0, count);

    if (e.event_type === 'queue' && e.queue) {
      e.queue.forEach((q, idx) => {
        const cur = book!.chapters.get(idx) ?? { idx, title: null, duration_ms: null };
        const qt = q.title && q.title !== title ? q.title : null; // Libro.fm titles every track with the book
        book!.chapters.set(idx, { ...cur, title: qt ?? cur.title });
      });
    }
    if (e.chapter_idx != null && e.duration_ms != null && e.duration_ms > 0) {
      const cur = book.chapters.get(e.chapter_idx) ?? { idx: e.chapter_idx, title: null, duration_ms: null };
      book.chapters.set(e.chapter_idx, { ...cur, duration_ms: e.duration_ms, title: chapter ?? cur.title });
    }
  }

  const out = reads.map((r) => {
    const chapters = [...r.book.chapters.values()].sort((a, b) => a.idx - b.idx);
    const sessions: Session[] = computeSessions(r.events, settings.session_gap_seconds, chapters);
    const lastPos = [...r.events].reverse().find((e) => e.position_ms != null);
    const cumulative = sessions.reduce((a, s) => a + s.book_seconds, 0);
    const wall = sessions.reduce((a, s) => a + s.wall_seconds, 0);
    const progress = computeProgress({
      chapter_idx: lastPos?.chapter_idx ?? null,
      chapter_position_ms: lastPos?.position_ms ?? null,
      last_duration_ms: lastPos?.duration_ms ?? null,
      chapter_count: r.book.chapter_count,
      chapters,
      runtime_seconds: null, // would come from the matched Hardcover audiobook edition
      cumulative_book_seconds: cumulative,
      app_reported_complete: r.events.some((e) => e.event_type === 'complete'),
    });
    const last = r.events[r.events.length - 1];
    if (r.status === 'reading' && shouldAutoFinish({ progress, chapter_idx: lastPos?.chapter_idx ?? null, chapter_count: r.book.chapter_count, finish_threshold: settings.finish_threshold })) {
      r.status = 'finished';
      r.finished_at = last.occurred_at;
    }

    // --- Hardcover shape (what sync.ts sends) ---
    const statusId = r.status === 'finished' ? STATUS.READ : r.status === 'dnf' ? STATUS.DID_NOT_FINISH : STATUS.CURRENTLY_READING;
    const progressSeconds = progress.book_position_ms != null ? Math.round(progress.book_position_ms / 1000) : null;
    const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
    const knownChapters = chapters.filter((c) => c.duration_ms != null).length;
    const runtimeMs = r.book.chapter_count != null && knownChapters >= r.book.chapter_count ? chapters.reduce((a, c) => a + (c.duration_ms ?? 0), 0) : lastPos?.chapter_idx == null ? (lastPos?.duration_ms ?? null) : null;

    const userBook = { book_id: null as number | null, edition_id: null as number | null, status_id: statusId, status: r.status, match: 'pending: Hardcover search by title/author (and ASIN/ISBN when the edition lookup supports it)' };
    const userBookRead = { user_book_id: null as number | null, started_at: day(r.started_at), finished_at: r.status === 'finished' ? day(r.finished_at) : null, edition_id: null as number | null, progress_seconds: progressSeconds, progress: progress.pct != null ? Math.round(progress.pct * 1000) / 10 : null };
    const ops = [
      insertUserBookOp(0, statusId, null),
      insertReadOp(0, { started_at: userBookRead.started_at!, finished_at: userBookRead.finished_at, edition_id: null, progress_seconds: progressSeconds }),
      updateUserBookOp(0, statusId),
      updateReadOp(0, { finished_at: userBookRead.finished_at, progress_seconds: progressSeconds }),
    ].map((op) => ({ ...op, variables: JSON.parse(JSON.stringify(op.variables).replace(/"(book_id|id)":0/g, '"$1":"<from Hardcover>"')) }));

    return {
      read_id: r.id,
      book: {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        source_app: r.book.source_app,
        source_key: r.book.source_key,
        external_id: r.book.external_id,
        field_map: fieldMapFor(settings, r.book.source_app),
        chapter_count: r.book.chapter_count,
        chapters_known: knownChapters,
        chapters: chapters.slice(0, 80),
        runtime_ms: runtimeMs,
      },
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at,
      last_activity_at: r.last_activity_at,
      chapter_idx: lastPos?.chapter_idx ?? null,
      chapter_position_ms: lastPos?.position_ms ?? null,
      progress,
      book_seconds_listened: cumulative,
      wall_seconds_listened: wall,
      speeds: [...new Set(r.events.map((e) => e.playback_speed).filter((s): s is number => s != null))].sort(),
      event_count: r.events.length,
      event_types: r.events.reduce<Record<string, number>>((m, e) => ((m[e.event_type] = (m[e.event_type] ?? 0) + 1), m), {}),
      sessions,
      hardcover: { user_book: userBook, user_book_read: userBookRead, ops },
    };
  });

  return {
    generated_at: new Date().toISOString(),
    settings: { session_gap_seconds: settings.session_gap_seconds, finish_threshold: settings.finish_threshold, allowed_apps: settings.allowed_apps },
    counts: { events: events.length, reads: out.length, no_identity: noIdentity, ignored },
    reads: out,
  };
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) {
    console.error('usage: replay <capture.jsonl> [--json out.json] [--html out.html]');
    process.exit(2);
  }
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const events = fs
    .readFileSync(input, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as IncomingEvent);
  const result = { source: path.basename(input), ...replay(events) };
  const json = JSON.stringify(result, null, 2);
  const jsonOut = opt('--json');
  const htmlOut = opt('--html') ?? input.replace(/\.jsonl?$/, '') + '.hardcover.html';
  if (jsonOut) fs.writeFileSync(jsonOut, json);
  const html = (template as string).replace('__DATA__', JSON.stringify(result).replace(/<\//g, '<\\/'));
  fs.writeFileSync(htmlOut, html);
  console.log(`${result.counts.reads} reads from ${events.length} events (${result.counts.no_identity} without identity, ignored: ${JSON.stringify(result.counts.ignored)})`);
  for (const r of result.reads) {
    console.log(`  ${r.book.title} — ${r.book.author ?? '?'} [${r.book.source_app.split('.').pop()}] ${r.status} ${r.progress.pct != null ? (r.progress.pct * 100).toFixed(1) + '%' : 'n/a'} (${r.progress.basis}) ${r.sessions.length} session(s), ${r.book_seconds_listened}s book / ${r.wall_seconds_listened}s wall`);
  }
  console.log(`wrote ${htmlOut}${jsonOut ? ' and ' + jsonOut : ''}`);
}

if (require.main === module) main();
