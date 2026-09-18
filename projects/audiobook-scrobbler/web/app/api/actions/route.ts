import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Pending actions for the phone to surface as notifications. */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  const { data, error } = await db().from('actions').select('id, type, book_id, read_id, payload, created_at').eq('user_id', auth.userId).eq('status', 'pending').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actions: data });
}
