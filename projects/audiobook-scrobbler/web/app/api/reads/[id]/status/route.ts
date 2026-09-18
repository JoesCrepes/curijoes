import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { setReadStatus } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const { status } = (await req.json()) as { status: 'reading' | 'finished' | 'dnf' };
  if (!['reading', 'finished', 'dnf'].includes(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
  const ok = await setReadStatus(auth.userId, id, status);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
