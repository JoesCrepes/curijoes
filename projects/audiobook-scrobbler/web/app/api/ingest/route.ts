import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { ingest } from '@/lib/ingest';
import type { IncomingEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TYPES = new Set(['play', 'pause', 'stop', 'metadata', 'position', 'queue', 'complete']);

export async function POST(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  let body: { device?: { id: string; name?: string }; events?: IncomingEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const events = (body.events ?? []).filter((e) => e && typeof e.id === 'string' && typeof e.app_package === 'string' && TYPES.has(e.event_type) && !Number.isNaN(Date.parse(e.occurred_at)));
  if (events.length !== (body.events ?? []).length) return NextResponse.json({ error: 'malformed events' }, { status: 400 });
  try {
    const result = await ingest(auth.userId, body.device ?? null, events);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'ingest failed' }, { status: 500 });
  }
}
