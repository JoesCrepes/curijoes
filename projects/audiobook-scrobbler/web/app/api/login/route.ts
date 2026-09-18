import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** PWA login: exchanges the shared token for a cookie so pages can call the API. */
export async function POST(req: Request) {
  const { token } = (await req.json()) as { token: string };
  const probe = new Request(req.url, { headers: { authorization: `Bearer ${token}` } });
  if (!authenticate(probe)) return NextResponse.json({ error: 'bad token' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('api_token', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  return res;
}
