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
  /** Runtime of the default audiobook edition, straight from the search index. */
  audio_seconds: number | null;
  has_audiobook: boolean;
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
    const audio = Number(d.audio_seconds);
    return {
      book_id: Number(d.id),
      title: String(d.title ?? ''),
      author: authors[0] ?? null,
      isbns: (d.isbns as string[] | undefined) ?? [],
      cover_url: image?.url ?? null,
      audio_seconds: Number.isFinite(audio) && audio > 0 ? audio : null,
      has_audiobook: d.has_audiobook === true,
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

const EDITION_FIELDS = `id book_id asin isbn_13 audio_seconds reading_format_id title image { url }
  book { id title contributions { author { name } } }`;

export interface EditionHit {
  book_id: number;
  edition_id: number;
  title: string;
  author: string | null;
  isbn13: string | null;
  runtime_seconds: number | null;
  cover_url: string | null;
}

interface EditionRow {
  id: number;
  book_id: number;
  asin: string | null;
  isbn_13: string | null;
  audio_seconds: number | null;
  reading_format_id: number | null;
  title: string | null;
  image: { url: string } | null;
  book: { title: string; contributions: { author: { name: string } | null }[] } | null;
}

function toHit(e: EditionRow): EditionHit {
  return {
    book_id: e.book_id,
    edition_id: e.id,
    title: e.book?.title ?? e.title ?? '',
    author: e.book?.contributions?.map((c) => c.author?.name).find(Boolean) ?? null,
    isbn13: e.isbn_13,
    runtime_seconds: e.audio_seconds,
    cover_url: e.image?.url ?? null,
  };
}

/**
 * Exact edition lookup by the player's own id. Verified live: Libro.fm's ISBN-13
 * lands the right audiobook edition first try. Audible's ASIN often misses,
 * because Hardcover carries other regional ASINs for the same title.
 */
export async function editionByIdentifier(kind: 'asin' | 'isbn13', value: string): Promise<EditionHit | null> {
  const column = kind === 'asin' ? 'asin' : 'isbn_13';
  const data = await gql<{ editions: EditionRow[] }>(
    `query ById($v: String!) { editions(where: { ${column}: { _eq: $v } }, limit: 5) { ${EDITION_FIELDS} } }`,
    { v: value },
  );
  const rows = data.editions ?? [];
  // An audiobook edition is what we want; fall back to any edition of that book.
  const best = rows.find((e) => e.reading_format_id === AUDIOBOOK_FORMAT_ID) ?? rows[0];
  return best ? toHit(best) : null;
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

/**
 * Stand-in id handed back by a dry run so the caller keeps going and builds the
 * mutations that depend on one. A dry run that returned null stopped at
 * insert_user_book, which meant the read mutations — the half that carries
 * progress — were never constructed, let alone inspected.
 */
export const DRY_RUN_ID = -1;

/** Run an op, honoring dry-run. Returns the new/affected id when present. */
export async function runOp(op: SyncOp): Promise<{ ok: boolean; id: number | null; response: unknown }> {
  if (hardcoverDryRun()) return { ok: true, id: DRY_RUN_ID, response: { dry_run: true } };
  const data = await gql<Record<string, { id?: number }>>(op.query, op.variables);
  const first = Object.values(data)[0];
  return { ok: true, id: first?.id ?? null, response: data };
}
