import { db } from './supabase';
import { mergeSettings, fieldMapFor } from './settings';
import { extractIdentity, sourceKey } from './normalize';
import { computeSessions } from './sessions';
import { computeProgress } from './progress';
import { shouldAutoFinish } from './finish';
import { matchBook } from './matching';
import { syncRead } from './sync';
import type { IncomingEvent, Settings, StoredEvent } from './types';

export async function loadSettings(userId: string): Promise<Settings> {
  const { data } = await db().from('settings').select('key, value').eq('user_id', userId);
  return mergeSettings(data ?? []);
}

interface ReadRow {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  last_activity_at: string;
}

async function getOrCreateBook(userId: string, app: string, title: string, author: string | null, settings: Settings, cache: Map<string, string>) {
  const key = sourceKey(app, title, author);
  const cached = cache.get(key);
  if (cached) return { id: cached, created: false };
  const existing = await db().from('books').select('id').eq('user_id', userId).eq('source_key', key).maybeSingle();
  if (existing.data) {
    cache.set(key, existing.data.id);
    return { id: existing.data.id, created: false };
  }
  // Libby and Libro.fm publish the title before the author. An authorless
  // event joins the same-titled book; an authorless book takes the author
  // (and the full key) when it finally shows up.
  const titleOnly = sourceKey(app, title, null);
  if (!author) {
    const byTitle = await db().from('books').select('id').eq('user_id', userId).like('source_key', `${titleOnly}%`).limit(1).maybeSingle();
    if (byTitle.data) {
      cache.set(key, byTitle.data.id);
      return { id: byTitle.data.id, created: false };
    }
  } else {
    const authorless = await db().from('books').select('id, match_status').eq('user_id', userId).eq('source_key', titleOnly).maybeSingle();
    if (authorless.data) {
      await db().from('books').update({ source_key: key, source_author: author, author }).eq('id', authorless.data.id);
      cache.set(key, authorless.data.id);
      cache.delete(titleOnly);
      if (authorless.data.match_status === 'unmatched' || authorless.data.match_status === 'no_match') {
        try {
          await matchBook({ id: authorless.data.id, user_id: userId, title, author, match_status: authorless.data.match_status }, settings);
        } catch (e) {
          console.error('match failed', e);
        }
      }
      return { id: authorless.data.id, created: false };
    }
  }
  const { data, error } = await db()
    .from('books')
    .insert({ user_id: userId, source_app: app, source_title: title, source_author: author, source_key: key, title, author })
    .select('id, user_id, title, author, match_status')
    .single();
  if (error || !data) throw new Error(`book insert failed: ${error?.message}`);
  cache.set(key, data.id);
  try {
    await matchBook(data, settings);
  } catch (e) {
    console.error('match failed', e);
  }
  return { id: data.id, created: true };
}

/** Q16: continue the open read; late events fall into the read they belong to; otherwise start a new read. */
async function getOrCreateRead(userId: string, bookId: string, occurredAt: string, settings: Settings, cache: Map<string, ReadRow>) {
  const c = cache.get(bookId);
  if (c && (c.status === 'reading' || occurredAt <= (c.finished_at ?? c.last_activity_at))) return c;
  const { data: latest } = await db()
    .from('reads')
    .select('id, status, started_at, finished_at, last_activity_at')
    .eq('book_id', bookId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    const cutoff = new Date(new Date(latest.finished_at ?? latest.last_activity_at).getTime() + settings.session_gap_seconds * 1000).toISOString();
    if (latest.status === 'reading' || occurredAt <= cutoff) {
      cache.set(bookId, latest);
      return latest as ReadRow;
    }
  }
  const { data, error } = await db()
    .from('reads')
    .insert({ user_id: userId, book_id: bookId, started_at: occurredAt, last_activity_at: occurredAt })
    .select('id, status, started_at, finished_at, last_activity_at')
    .single();
  if (error || !data) throw new Error(`read insert failed: ${error?.message}`);
  cache.set(bookId, data);
  return data as ReadRow;
}

export interface IngestResult {
  accepted: number;
  ignored_app: number;
  no_identity: number;
  books_created: number;
  reads_touched: number;
}

export async function ingest(userId: string, device: { id: string; name?: string } | null, events: IncomingEvent[]): Promise<IngestResult> {
  const settings = await loadSettings(userId);
  const result: IngestResult = { accepted: 0, ignored_app: 0, no_identity: 0, books_created: 0, reads_touched: 0 };
  if (device?.id) {
    await db().from('devices').upsert({ id: device.id, user_id: userId, name: device.name ?? null, last_seen_at: new Date().toISOString() });
  }

  const allowed = new Set(settings.allowed_apps);
  const bookCache = new Map<string, string>();
  const readCache = new Map<string, ReadRow>();
  const touchedReads = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const chapterUpserts = new Map<string, { book_id: string; idx: number; title?: string | null; duration_ms?: number | null }>();

  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const e of sorted) {
    if (allowed.size && !allowed.has(e.app_package)) {
      result.ignored_app++;
      continue;
    }
    const { title, author, chapter } = extractIdentity(e.raw, fieldMapFor(settings, e.app_package));
    let bookId: string | null = null;
    let readId: string | null = null;
    if (title) {
      const b = await getOrCreateBook(userId, e.app_package, title, author ?? null, settings, bookCache);
      if (b.created) result.books_created++;
      bookId = b.id;
      const r = await getOrCreateRead(userId, b.id, e.occurred_at, settings, readCache);
      readId = r.id;
      touchedReads.add(readId);
    } else {
      result.no_identity++;
    }

    rows.push({
      id: e.id,
      user_id: userId,
      device_id: device?.id ?? null,
      book_id: bookId,
      read_id: readId,
      app_package: e.app_package,
      event_type: e.event_type,
      occurred_at: e.occurred_at,
      is_playing: !!e.is_playing,
      position_ms: e.position_ms ?? null,
      duration_ms: e.duration_ms ?? null,
      playback_speed: e.playback_speed ?? null,
      chapter_title: chapter,
      chapter_idx: e.chapter_idx ?? null,
      chapter_count: e.chapter_count ?? (e.queue ? e.queue.length : null),
      raw: { ...(e.raw ?? {}), ...(e.queue ? { queue: e.queue } : {}) },
    });

    if (bookId && e.event_type === 'queue' && e.queue) {
      e.queue.forEach((q, idx) => {
        const k = `${bookId}:${idx}`;
        // Libro.fm titles every track with the book name: that is not a chapter name.
        const qt = q.title && q.title !== title ? q.title : null;
        chapterUpserts.set(k, { ...(chapterUpserts.get(k) ?? { book_id: bookId!, idx }), title: qt });
      });
    }
    if (bookId && e.chapter_idx != null && e.duration_ms != null && e.duration_ms > 0) {
      const k = `${bookId}:${e.chapter_idx}`;
      chapterUpserts.set(k, { ...(chapterUpserts.get(k) ?? { book_id: bookId, idx: e.chapter_idx }), duration_ms: e.duration_ms, ...(chapter ? { title: chapter } : {}) });
    }
  }

  if (rows.length) {
    const { error } = await db().from('events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`event insert failed: ${error.message}`);
    result.accepted = rows.length;
  }
  for (const c of chapterUpserts.values()) {
    // Merge with existing so a queue (titles) and a duration observation don't clobber each other.
    const { data: existing } = await db().from('chapters').select('title, duration_ms').eq('book_id', c.book_id).eq('idx', c.idx).maybeSingle();
    await db().from('chapters').upsert({
      book_id: c.book_id,
      idx: c.idx,
      title: c.title ?? existing?.title ?? null,
      duration_ms: c.duration_ms ?? existing?.duration_ms ?? null,
    });
  }

  for (const readId of touchedReads) await recomputeRead(readId, settings);
  result.reads_touched = touchedReads.size;
  for (const readId of touchedReads) await syncRead(readId);
  return result;
}

/** Rebuild sessions and progress for a read from its events. Safe to call anytime. */
export async function recomputeRead(readId: string, settings: Settings): Promise<void> {
  const { data: read } = await db().from('reads').select('*, books(runtime_seconds)').eq('id', readId).single();
  if (!read) return;
  const { data: events } = await db()
    .from('events')
    .select('id, event_type, occurred_at, is_playing, position_ms, duration_ms, playback_speed, chapter_idx, chapter_title, chapter_count')
    .eq('read_id', readId)
    .order('occurred_at', { ascending: true });
  const evs = (events ?? []) as (StoredEvent & { chapter_count: number | null })[];
  if (evs.length === 0) return;
  const { data: chapters } = await db().from('chapters').select('idx, title, duration_ms').eq('book_id', read.book_id).order('idx');

  const sessions = computeSessions(evs, settings.session_gap_seconds, chapters ?? []);
  await db().from('sessions').delete().eq('read_id', readId);
  if (sessions.length) {
    await db().from('sessions').insert(sessions.map((s) => ({ ...s, read_id: readId })));
  }

  const lastPos = [...evs].reverse().find((e) => e.position_ms != null);
  const chapterCount = evs.reduce<number | null>((m, e) => (e.chapter_count != null && (m == null || e.chapter_count > m) ? e.chapter_count : m), null);
  const cumulative = sessions.reduce((a, s) => a + s.book_seconds, 0);
  const wall = sessions.reduce((a, s) => a + s.wall_seconds, 0);
  const progress = computeProgress({
    chapter_idx: lastPos?.chapter_idx ?? null,
    chapter_position_ms: lastPos?.position_ms ?? null,
    last_duration_ms: lastPos?.duration_ms ?? null,
    chapter_count: chapterCount,
    chapters: chapters ?? [],
    runtime_seconds: (read.books as { runtime_seconds: number | null } | null)?.runtime_seconds ?? null,
    cumulative_book_seconds: cumulative,
    app_reported_complete: evs.some((e) => e.event_type === 'complete'),
  });
  const last = evs[evs.length - 1];

  const update: Record<string, unknown> = {
    last_activity_at: last.occurred_at,
    chapter_idx: lastPos?.chapter_idx ?? null,
    chapter_position_ms: lastPos?.position_ms ?? null,
    book_position_ms: progress.book_position_ms,
    book_seconds_listened: cumulative,
    wall_seconds_listened: wall,
    progress_pct: progress.pct,
    progress_basis: progress.basis,
    hardcover_dirty: true,
  };
  if (read.status === 'reading' && shouldAutoFinish({ progress, chapter_idx: lastPos?.chapter_idx ?? null, chapter_count: chapterCount, finish_threshold: settings.finish_threshold })) {
    update.status = 'finished';
    update.finished_at = last.occurred_at;
    update.finish_source = progress.basis === 'app' ? 'app' : 'auto';
  }
  await db().from('reads').update(update).eq('id', readId);
}
