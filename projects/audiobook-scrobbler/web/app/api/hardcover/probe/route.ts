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
    // `statuses` is refused outright for API tokens ("Not available to API
    // tokens"), so this asked a question it could never get an answer to and
    // quietly recorded the refusal as an error. The user-facing table is
    // user_book_statuses.
    const d = await gql<{ user_book_statuses: { id: number; status: string }[] }>(`query { user_book_statuses { id status } }`);
    report.statuses = Object.fromEntries((d.user_book_statuses ?? []).map((s) => [s.id, s.status]));
  } catch (e) {
    report.statuses_error = String(e);
  }

  try {
    // Phase 4 mirrors ratings and reviews. `rating` exists; `review` does not
    // — the column is review_markdown — so name the fields we actually intend
    // to send rather than assuming.
    const d = await gql<{ __type: { inputFields: { name: string }[] } | null }>(
      `query { __type(name: "UserBookUpdateInput") { inputFields { name } } }`,
    );
    const fields = new Set((d.__type?.inputFields ?? []).map((f) => f.name));
    report.user_book_update_fields = Object.fromEntries(
      ['rating', 'review_markdown', 'review_has_spoilers', 'reviewed_at', 'status_id', 'edition_id'].map((n) => [n, fields.has(n)]),
    );
  } catch (e) {
    report.user_book_update_error = String(e);
  }
  try {
    report.search_sample = await gql(`query { search(query: "project hail mary", query_type: "Book", per_page: 1, page: 1) { results } }`);
  } catch (e) {
    report.search_error = String(e);
  }
  return NextResponse.json(report);
}
