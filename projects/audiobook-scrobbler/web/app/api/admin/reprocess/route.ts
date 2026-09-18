import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { reprocess, recomputeAll } from '@/lib/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** POST { mode: 'reprocess' | 'recompute' } */
export async function POST(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const { mode } = (await req.json().catch(() => ({}))) as { mode?: string };
  if (mode === 'recompute') return NextResponse.json({ reads: await recomputeAll(auth.userId) });
  return NextResponse.json(await reprocess(auth.userId));
}
