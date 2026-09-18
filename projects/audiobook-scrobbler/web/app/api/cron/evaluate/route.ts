import { NextResponse } from 'next/server';
import { SINGLE_USER_ID, authenticate } from '@/lib/auth';
import { evaluate } from '@/lib/evaluate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Hourly via Vercel Cron (CRON_SECRET) or manually with the API token. */
export async function GET(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const cronOk = !!process.env.CRON_SECRET && header === `Bearer ${process.env.CRON_SECRET}`;
  const user = authenticate(req);
  if (!cronOk && !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await evaluate(user?.userId ?? SINGLE_USER_ID);
  return NextResponse.json(result);
}
