import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { resolveAction, type Resolution } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const resolution = (await req.json()) as Resolution;
  const r = await resolveAction(auth.userId, id, resolution);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
