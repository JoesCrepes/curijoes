import { NextResponse } from 'next/server';
import { SINGLE_USER_ID, authenticate } from '@/lib/auth';
import { evaluate } from '@/lib/evaluate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily via Vercel Cron (CRON_SECRET) or on demand with the API token.
 * Daily because Hobby accounts refuse anything more frequent, and because the
 * work suits it: a stall needs 24 h of silence and a prompt times out after 14
 * days. Only the retry of a failed Hardcover sync waits longer than it would
 * have. Safe to call by hand, and safe to call repeatedly.
 */
export async function GET(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const cronOk = !!process.env.CRON_SECRET && header === `Bearer ${process.env.CRON_SECRET}`;
  const user = authenticate(req);
  if (!cronOk && !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await evaluate(user?.userId ?? SINGLE_USER_ID);
  return NextResponse.json(result);
}
