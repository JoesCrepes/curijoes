import { db } from './supabase';
import { isStalled } from './finish';
import { loadSettings } from './ingest';
import { syncRead } from './sync';

/** Daily cron: stall prompts, prompt timeouts, and Hardcover retry. */
export async function evaluate(userId: string, now = new Date()): Promise<{ stall_prompts: number; timed_out: number; resynced: number }> {
  const s = await loadSettings(userId);
  const out = { stall_prompts: 0, timed_out: 0, resynced: 0 };

  const { data: reads } = await db().from('reads').select('id, progress_pct, last_activity_at, books(title)').eq('user_id', userId).eq('status', 'reading');
  for (const r of reads ?? []) {
    if (!isStalled({ pct: r.progress_pct, last_activity_at: r.last_activity_at, now: now.toISOString(), stall_threshold: s.stall_threshold, stall_hours: s.stall_hours })) continue;
    const { data: pending } = await db().from('actions').select('id').eq('read_id', r.id).eq('type', 'confirm_finished').eq('status', 'pending').maybeSingle();
    if (pending) continue;
    await db().from('actions').insert({
      user_id: userId,
      type: 'confirm_finished',
      read_id: r.id,
      payload: { title: (r.books as unknown as { title: string } | null)?.title ?? '', pct: r.progress_pct },
    });
    out.stall_prompts++;
  }

  if (s.stall_auto_finish_days > 0) {
    const cutoff = new Date(now.getTime() - s.stall_auto_finish_days * 86400 * 1000).toISOString();
    const { data: stale } = await db().from('actions').select('id, read_id').eq('user_id', userId).eq('type', 'confirm_finished').eq('status', 'pending').lt('created_at', cutoff);
    for (const a of stale ?? []) {
      const { data: read } = await db().from('reads').select('last_activity_at, status').eq('id', a.read_id).single();
      if (read?.status === 'reading') {
        await db().from('reads').update({ status: 'finished', finished_at: read.last_activity_at, finish_source: 'timeout', hardcover_dirty: true }).eq('id', a.read_id);
        await syncRead(a.read_id);
      }
      await db().from('actions').update({ status: 'resolved', resolved_at: now.toISOString(), resolution: { timeout: true } }).eq('id', a.id);
      out.timed_out++;
    }
  }

  const { data: dirty } = await db().from('reads').select('id').eq('user_id', userId).eq('hardcover_dirty', true).limit(50);
  for (const r of dirty ?? []) {
    await syncRead(r.id);
    out.resynced++;
  }
  return out;
}
