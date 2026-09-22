import { db } from './supabase';
import * as hc from './hardcover';

/** Push one read's state to Hardcover (one-way). Errors are recorded, never thrown. */
export async function syncRead(readId: string): Promise<void> {
  if (!hc.hardcoverEnabled()) return;
  const { data: read } = await db().from('reads').select('*, books(*)').eq('id', readId).single();
  if (!read) return;
  const book = read.books as { hardcover_book_id: number | null; hardcover_edition_id: number | null; match_status: string };
  if (!book.hardcover_book_id || !['auto', 'confirmed'].includes(book.match_status)) return;

  const statusId = read.status === 'finished' ? hc.STATUS.READ : read.status === 'dnf' ? hc.STATUS.DID_NOT_FINISH : hc.STATUS.CURRENTLY_READING;
  const progressSeconds = read.book_position_ms != null ? Math.round(read.book_position_ms / 1000) : null;
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

  const log = async (op: hc.SyncOp, result: { ok: boolean; response: unknown }) => {
    await db().from('hardcover_sync_log').insert({ read_id: readId, op: op.op, request: op.variables, response: result.response as object, ok: result.ok });
  };

  try {
    let userBookId: number | null = read.hardcover_user_book_id;
    if (!userBookId) {
      userBookId = hc.hardcoverDryRun() ? null : await hc.findUserBook(book.hardcover_book_id);
      if (!userBookId) {
        const op = hc.insertUserBookOp(book.hardcover_book_id, statusId, book.hardcover_edition_id);
        const r = await hc.runOp(op);
        await log(op, r);
        userBookId = r.id;
      } else {
        const op = hc.updateUserBookOp(userBookId, statusId);
        await log(op, await hc.runOp(op));
      }
    } else {
      const op = hc.updateUserBookOp(userBookId, statusId);
      await log(op, await hc.runOp(op));
    }

    let hcReadId: number | null = read.hardcover_read_id;
    if (userBookId && !hcReadId) {
      const op = hc.insertReadOp(userBookId, {
        started_at: day(read.started_at)!,
        finished_at: read.status === 'finished' ? day(read.finished_at) : null,
        edition_id: book.hardcover_edition_id,
        progress_seconds: progressSeconds,
      });
      const r = await hc.runOp(op);
      await log(op, r);
      hcReadId = r.id;
    } else if (hcReadId) {
      const op = hc.updateReadOp(hcReadId, { finished_at: read.status === 'finished' ? day(read.finished_at) : null, progress_seconds: progressSeconds });
      await log(op, await hc.runOp(op));
    }

    // A dry run's ids are stand-ins, so they must not be kept: persisting one
    // would make the next real run update a user_book that does not exist.
    // Keeping them null also means a dry run always exercises the insert path,
    // which is the payload worth reading before letting this write for real.
    const dry = hc.hardcoverDryRun();
    await db()
      .from('reads')
      .update({
        hardcover_user_book_id: dry ? null : userBookId,
        hardcover_read_id: dry ? null : hcReadId,
        hardcover_dirty: dry, // dry runs stay dirty so a real run picks them up
        hardcover_synced_at: new Date().toISOString(),
        hardcover_last_mode: dry ? 'dry_run' : 'live',
        hardcover_error: null,
      })
      .eq('id', readId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('hardcover sync failed', readId, msg);
    await db().from('reads').update({ hardcover_error: msg }).eq('id', readId);
  }
}
