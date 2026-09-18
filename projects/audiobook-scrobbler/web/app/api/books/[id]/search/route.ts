import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { findCandidates } from '@/lib/matching';

export const dynamic = 'force-dynamic';

/** Re-run candidate search with a user-supplied query: ?q=title&author=name */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
  const candidates = await findCandidates(q, url.searchParams.get('author'));
  return NextResponse.json({ candidates });
}
