import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Everything the PWA home screen needs in one call. */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const url = new URL(req.url);
  const bookId = url.searchParams.get('book');
  const d = db();

  if (bookId) {
    const [book, reads, chapters, events] = await Promise.all([
      d.from('books').select('*').eq('id', bookId).eq('user_id', auth.userId).single(),
      d.from('reads').select('*, sessions(*)').eq('book_id', bookId).order('started_at', { ascending: false }),
      d.from('chapters').select('*').eq('book_id', bookId).order('idx'),
      d.from('events').select('id, event_type, occurred_at, is_playing, position_ms, duration_ms, playback_speed, chapter_idx, chapter_title, raw').eq('book_id', bookId).order('occurred_at', { ascending: false }).limit(200),
    ]);
    return NextResponse.json({ book: book.data, reads: reads.data ?? [], chapters: chapters.data ?? [], events: events.data ?? [] });
  }

  const [reads, actions, recentSessions, recentEvents, books] = await Promise.all([
    // Sessions and the match fields ride along so the phone app can draw a
    // book's whole detail screen without a second round trip.
    d.from('reads')
      .select('*, sessions(*), books(id, title, author, cover_url, match_status, runtime_seconds, source_app, external_id, external_id_kind, hardcover_book_id, hardcover_edition_id, isbn13)')
      .eq('user_id', auth.userId)
      .order('last_activity_at', { ascending: false })
      .limit(50),
    d.from('actions').select('*').eq('user_id', auth.userId).eq('status', 'pending').order('created_at'),
    d.from('sessions').select('*, reads(book_id, books(title))').order('started_at', { ascending: false }).limit(30),
    d.from('events').select('id, app_package, event_type, occurred_at, is_playing, position_ms, duration_ms, playback_speed, chapter_idx, chapter_title, book_id, raw').eq('user_id', auth.userId).order('occurred_at', { ascending: false }).limit(50),
    d.from('books').select('id, title, author, match_status, hardcover_book_id, match_candidates, source_app').eq('user_id', auth.userId).order('created_at', { ascending: false }),
  ]);
  return NextResponse.json({ reads: reads.data ?? [], actions: actions.data ?? [], sessions: recentSessions.data ?? [], events: recentEvents.data ?? [], books: books.data ?? [] });
}
