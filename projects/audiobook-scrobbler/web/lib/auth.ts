import { NextResponse } from 'next/server';

export const SINGLE_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface AuthContext {
  userId: string;
}

/**
 * The one place that turns a request into a user. Today: a shared bearer
 * token maps to the single seeded user. Google OAuth later replaces the body
 * of this function (verify a session cookie / id token, look up users.id).
 */
export function authenticate(req: Request): AuthContext | null {
  const expected = process.env.API_TOKEN;
  if (!expected) return null;
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookie = req.headers.get('cookie') ?? '';
  const cookieToken = /(?:^|;\s*)api_token=([^;]+)/.exec(cookie)?.[1];
  const token = bearer ?? (cookieToken ? decodeURIComponent(cookieToken) : null);
  if (token && timingSafeEqual(token, expected)) return { userId: SINGLE_USER_ID };
  return null;
}

export function requireAuth(req: Request): AuthContext | NextResponse {
  return authenticate(req) ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
