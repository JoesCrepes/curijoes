import { NextResponse } from 'next/server';
import { requireAuth, isResponse } from '@/lib/auth';
import { gql, hardcoverEnabled, hardcoverDryRun } from '@/lib/hardcover';

export const dynamic = 'force-dynamic';

/**
 * Verifies the Hardcover assumptions baked into lib/hardcover.ts: token works,
 * the mutation names exist, and the status ids are what we think.
 */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (isResponse(auth)) return auth;
  if (!hardcoverEnabled()) return NextResponse.json({ enabled: false });
  const report: Record<string, unknown> = { enabled: true, dry_run: hardcoverDryRun() };
  try {
    report.me = await gql(`query { me { id username } }`);
  } catch (e) {
    report.me_error = String(e);
  }
  try {
    const t = await gql<{ __type: { fields: { name: string }[] } }>(`query { __type(name: "mutation_root") { fields { name } } }`);
    const names = new Set(t.__type.fields.map((f) => f.name));
    report.mutations = Object.fromEntries(['insert_user_book', 'update_user_book', 'insert_user_book_read', 'update_user_book_read'].map((n) => [n, names.has(n)]));
  } catch (e) {
    report.mutations_error = String(e);
  }
  try {
    report.statuses = await gql(`query { statuses { id name } }`);
  } catch (e) {
    report.statuses_error = String(e);
  }
  try {
    report.search_sample = await gql(`query { search(query: "project hail mary", query_type: "Book", per_page: 1, page: 1) { results } }`);
  } catch (e) {
    report.search_error = String(e);
  }
  return NextResponse.json(report);
}
