/**
 * Hardcover GraphQL client. The endpoint and the Hasura-style mutation names
 * below match Hardcover's public API docs as of writing, but this sandbox
 * could not reach api.hardcover.app to verify them. Run GET /api/hardcover/probe
 * after deploying: it introspects the schema and reports which of these
 * names exist so any drift is a one-line fix here.
 */
const ENDPOINT = 'https://api.hardcover.app/v1/graphql';

// Hardcover status ids. Confirm with the probe (it queries `statuses`).
export const STATUS = { WANT_TO_READ: 1, CURRENTLY_READING: 2, READ: 3, PAUSED: 4, DID_NOT_FINISH: 5 } as const;
const AUDIOBOOK_FORMAT_ID = 2;

export function hardcoverEnabled(): boolean {
  return !!process.env.HARDCOVER_TOKEN;
}
export function hardcoverDryRun(): boolean {
  return (process.env.HARDCOVER_DRY_RUN ?? 'true').toLowerCase() !== 'false';
}

export async function gql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.HARDCOVER_TOKEN;
  if (!token) throw new Error('HARDCOVER_TOKEN not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) throw new Error(`hardcover: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data as T;
}

export interface HardcoverHit {
  book_id: number;
  title: string;
  author: string | null;
  isbns: string[];
  cover_url: string | null;
}

export async function searchBooks(q: string): Promise<HardcoverHit[]> {
  const data = await gql<{ search: { results: unknown } }>(
    `query Search($q: String!) { search(query: $q, query_type: "Book", per_page: 10, page: 1) { results } }`,
    { q },
  );
  // results is Typesense JSON: { hits: [{ document: {...} }] }
  const results = data.search?.results as { hits?: { document: Record<string, unknown> }[] } | undefined;
  return (results?.hits ?? []).map((h) => {
    const d = h.document;
    const authors = (d.author_names as string[] | undefined) ?? [];
    const image = d.image as { url?: string } | undefined;
    return {
      book_id: Number(d.id),
      title: String(d.title ?? ''),
      author: authors[0] ?? null,
      isbns: (d.isbns as string[] | undefined) ?? [],
      cover_url: image?.url ?? null,
    };
  });
}

export interface HardcoverEdition {
  id: number;
  isbn_13: string | null;
  audio_seconds: number | null;
  title: string | null;
  cover_url: string | null;
}

export async function audiobookEditions(bookId: number): Promise<HardcoverEdition[]> {
  const data = await gql<{ editions: { id: number; isbn_13: string | null; audio_seconds: number | null; title: string | null; image: { url: string } | null }[] }>(
    `query Editions($bookId: Int!) {
      editions(where: { book_id: { _eq: $bookId }, reading_format_id: { _eq: ${AUDIOBOOK_FORMAT_ID} } }, order_by: { users_count: desc }, limit: 5) {
        id isbn_13 audio_seconds title image { url }
      }
    }`,
    { bookId },
  );
  return (data.editions ?? []).map((e) => ({ id: e.id, isbn_13: e.isbn_13, audio_seconds: e.audio_seconds, title: e.title, cover_url: e.image?.url ?? null }));
}

export interface SyncOp {
  op: string;
  query: string;
  variables: Record<string, unknown>;
}

/** Idempotent-ish helpers; each returns the op it ran (for the sync log). */
export async function findUserBook(bookId: number): Promise<number | null> {
  const data = await gql<{ me: { id: number }[] }>(`query { me { id } }`);
  const userId = data.me?.[0]?.id;
  const ub = await gql<{ user_books: { id: number }[] }>(
    `query UB($userId: Int!, $bookId: Int!) { user_books(where: { user_id: { _eq: $userId }, book_id: { _eq: $bookId } }, limit: 1) { id } }`,
    { userId, bookId },
  );
  return ub.user_books?.[0]?.id ?? null;
}

export function insertUserBookOp(bookId: number, statusId: number, editionId: number | null): SyncOp {
  return {
    op: 'insert_user_book',
    query: `mutation ($object: UserBookCreateInput!) { insert_user_book(object: $object) { id } }`,
    variables: { object: { book_id: bookId, status_id: statusId, ...(editionId ? { edition_id: editionId } : {}) } },
  };
}
export function updateUserBookOp(userBookId: number, statusId: number): SyncOp {
  return {
    op: 'update_user_book',
    query: `mutation ($id: Int!, $object: UserBookUpdateInput!) { update_user_book(id: $id, object: $object) { id } }`,
    variables: { id: userBookId, object: { status_id: statusId } },
  };
}
export function insertReadOp(userBookId: number, read: { started_at: string; finished_at?: string | null; edition_id?: number | null; progress_seconds?: number | null }): SyncOp {
  return {
    op: 'insert_user_book_read',
    query: `mutation ($id: Int!, $read: DatesReadInput!) { insert_user_book_read(user_book_id: $id, user_book_read: $read) { id } }`,
    variables: { id: userBookId, read: compact(read) },
  };
}
export function updateReadOp(readId: number, read: { finished_at?: string | null; progress_seconds?: number | null }): SyncOp {
  return {
    op: 'update_user_book_read',
    query: `mutation ($id: Int!, $object: DatesReadInput!) { update_user_book_read(id: $id, object: $object) { id } }`,
    variables: { id: readId, object: compact(read) },
  };
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Run an op, honoring dry-run. Returns the new/affected id when present. */
export async function runOp(op: SyncOp): Promise<{ ok: boolean; id: number | null; response: unknown }> {
  if (hardcoverDryRun()) return { ok: true, id: null, response: { dry_run: true } };
  const data = await gql<Record<string, { id?: number }>>(op.query, op.variables);
  const first = Object.values(data)[0];
  return { ok: true, id: first?.id ?? null, response: data };
}
