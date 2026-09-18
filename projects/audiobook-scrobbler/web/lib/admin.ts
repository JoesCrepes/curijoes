import { db } from './supabase';
import { loadSettings, recomputeRead } from './ingest';
import type { IncomingEvent } from './types';
import { ingest } from './ingest';

/**
 * Rebuild all derived state from the raw event log. Used after changing an
 * app's field map. Books keep their matches when their identity is unchanged.
 */
export async function reprocess(userId: string): Promise<{ events: number; books_pruned: number }> {
  const { data: events } = await db().from('events').select('*').eq('user_id', userId).order('occurred_at');
  const evs = events ?? [];

  await db().from('events').update({ book_id: null, read_id: null }).eq('user_id', userId);
  await db().from('actions').delete().eq('user_id', userId).eq('status', 'pending').eq('type', 'confirm_finished');
  await db().from('reads').delete().eq('user_id', userId);
  const { data: books } = await db().from('books').select('id').eq('user_id', userId);
  for (const b of books ?? []) await db().from('chapters').delete().eq('book_id', b.id);

  const incoming: IncomingEvent[] = evs.map((e) => {
    const raw = { ...(e.raw as Record<string, unknown>) };
    const queue = raw.queue as IncomingEvent['queue'];
    delete raw.queue;
    return {
      id: e.id,
      app_package: e.app_package,
      event_type: e.event_type,
      occurred_at: e.occurred_at,
      is_playing: e.is_playing,
      position_ms: e.position_ms,
      duration_ms: e.duration_ms,
      playback_speed: e.playback_speed,
      chapter_idx: e.chapter_idx,
      chapter_count: e.chapter_count,
      raw,
      queue,
    };
  });
  // Re-ingest in chunks; the upsert is ignoreDuplicates so rows are re-linked via a delete+insert.
  await db().from('events').delete().eq('user_id', userId);
  for (let i = 0; i < incoming.length; i += 500) await ingest(userId, null, incoming.slice(i, i + 500));

  const { data: orphans } = await db().rpc('prune_orphan_books', { p_user_id: userId });
  return { events: incoming.length, books_pruned: (orphans as number | null) ?? 0 };
}

export async function recomputeAll(userId: string): Promise<number> {
  const s = await loadSettings(userId);
  const { data: reads } = await db().from('reads').select('id').eq('user_id', userId);
  for (const r of reads ?? []) await recomputeRead(r.id, s);
  return reads?.length ?? 0;
}
