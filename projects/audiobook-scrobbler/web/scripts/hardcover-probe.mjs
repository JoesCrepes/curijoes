/**
 * Read-only reconnaissance against the live Hardcover API, using HARDCOVER_TOKEN
 * from .env.local. Runs no mutations.
 *
 *   node scripts/hardcover-probe.mjs                      # identity + schema check
 *   node scripts/hardcover-probe.mjs --asin B0FKV9JSWV    # edition lookup by ASIN
 *   node scripts/hardcover-probe.mjs --isbn 9781473588165 # edition lookup by ISBN-13
 *   node scripts/hardcover-probe.mjs --search "Yesteryear Caro Claire Burke"
 *
 * Verifies the assumptions in lib/hardcover.ts: mutation names, status ids, and
 * whether editions can be reached by the identifiers the phone already gives us
 * (Audible's ASIN, Libro.fm's ISBN from the cover URL).
 */
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';

function loadEnv() {
  const file = path.join(process.cwd(), '.env.local');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

async function gql(query, variables = {}) {
  const token = process.env.HARDCOVER_TOKEN;
  if (!token) throw new Error('HARDCOVER_TOKEN not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (json.errors?.length) throw new Error(`${res.status}: ${json.errors.map((e) => e.message).join('; ')}`);
  return json.data;
}

const EDITION_FIELDS = `id book_id asin isbn_10 isbn_13 audio_seconds pages edition_format reading_format_id release_date
  title publisher { name } image { url } book { id title slug contributions { author { name } } }`;

async function identity() {
  const d = await gql(`query { me { id username } }`);
  const me = d.me?.[0];
  console.log(`token OK — signed in as ${me?.username ?? '?'} (user id ${me?.id ?? '?'})`);
  return me?.id ?? null;
}

async function schema() {
  const d = await gql(`query {
    __schema {
      mutationType { fields { name } }
      queryType { fields { name } }
    }
  }`);
  const muts = new Set((d.__schema.mutationType?.fields ?? []).map((f) => f.name));
  const queries = new Set((d.__schema.queryType?.fields ?? []).map((f) => f.name));
  console.log('\nmutations lib/hardcover.ts assumes:');
  for (const n of ['insert_user_book', 'update_user_book', 'insert_user_book_read', 'update_user_book_read', 'upsert_user_book_read']) {
    console.log(`  ${muts.has(n) ? 'OK     ' : 'MISSING'} ${n}`);
  }
  console.log('queries:');
  for (const n of ['me', 'search', 'editions', 'books', 'user_books', 'user_book_reads']) {
    console.log(`  ${queries.has(n) ? 'OK     ' : 'MISSING'} ${n}`);
  }

  // Argument shape of the read mutations: the thing most likely to have drifted.
  const args = await gql(`query {
    __type(name: "mutation_root") { fields { name args { name type { name kind ofType { name kind } } } } }
  }`);
  const byName = Object.fromEntries((args.__type?.fields ?? []).map((f) => [f.name, f.args]));
  for (const n of ['insert_user_book', 'insert_user_book_read', 'update_user_book_read', 'update_user_book']) {
    const a = byName[n];
    if (!a) continue;
    const t = (x) => x.type?.name ?? x.type?.ofType?.name ?? x.type?.kind;
    console.log(`  ${n}(${a.map((x) => `${x.name}: ${t(x)}`).join(', ')})`);
  }
  for (const t of ['DatesReadInput', 'UserBookCreateInput', 'UserBookUpdateInput']) {
    const d2 = await gql(`query($n: String!) { __type(name: $n) { name inputFields { name type { name kind ofType { name } } } } }`, { n: t });
    const f = d2.__type?.inputFields;
    console.log(`  ${t}: ${f ? f.map((x) => `${x.name}: ${x.type?.name ?? x.type?.ofType?.name ?? x.type?.kind}`).join(', ') : 'NOT FOUND'}`);
  }
}

async function statuses() {
  try {
    const d = await gql(`query { user_book_statuses { id status } }`);
    console.log('\nstatus ids:', (d.user_book_statuses ?? []).map((s) => `${s.id}=${s.status}`).join(', '));
  } catch (e) {
    console.log('\nstatus ids: could not read —', e.message.slice(0, 120));
  }
}

async function byAsin(asin) {
  const d = await gql(`query($v: String!) { editions(where: { asin: { _eq: $v } }, limit: 5) { ${EDITION_FIELDS} } }`, { v: asin });
  report(`ASIN ${asin}`, d.editions);
}

async function byIsbn(isbn) {
  const d = await gql(`query($v: String!) { editions(where: { isbn_13: { _eq: $v } }, limit: 5) { ${EDITION_FIELDS} } }`, { v: isbn });
  report(`ISBN-13 ${isbn}`, d.editions);
}

function report(label, editions) {
  console.log(`\n${label}: ${editions?.length ?? 0} edition(s)`);
  for (const e of editions ?? []) {
    const authors = (e.book?.contributions ?? []).map((c) => c.author?.name).filter(Boolean).join(', ');
    console.log(`  edition ${e.id} · book ${e.book_id} "${e.book?.title}" — ${authors || '?'}`);
    console.log(`    format ${e.edition_format ?? '?'} (reading_format_id ${e.reading_format_id}) · audio_seconds ${e.audio_seconds ?? '—'}${e.audio_seconds ? ` (${(e.audio_seconds / 3600).toFixed(2)} h)` : ''}`);
    console.log(`    asin ${e.asin ?? '—'} · isbn_13 ${e.isbn_13 ?? '—'} · publisher ${e.publisher?.name ?? '—'} · released ${e.release_date ?? '—'}`);
  }
}

async function search(q) {
  const d = await gql(`query($q: String!) { search(query: $q, query_type: "Book", per_page: 5, page: 1) { results } }`, { q });
  const hits = d.search?.results?.hits ?? [];
  console.log(`\nsearch "${q}": ${hits.length} hit(s)`);
  for (const h of hits) {
    const doc = h.document;
    console.log(`  book ${doc.id} "${doc.title}" — ${(doc.author_names ?? []).join(', ')} · audio_seconds ${doc.audio_seconds ?? '—'} · has_audiobook ${doc.has_audiobook} · isbns ${(doc.isbns ?? []).length}`);
  }
  // Audiobook editions of the top hit: the runtime path when there is no identifier (Libby).
  if (hits[0]) {
    const id = Number(hits[0].document.id);
    const e = await gql(`query($id: Int!) { editions(where: { book_id: { _eq: $id }, reading_format_id: { _eq: 2 } }, order_by: { users_count: desc }, limit: 5) { ${EDITION_FIELDS} } }`, { id });
    report(`audiobook editions of book ${id}`, e.editions);
  }
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : null;
  };
  try {
    await identity();
  } catch (e) {
    console.error('token check FAILED:', e.message);
    process.exit(1);
  }
  if (args.length === 0) {
    await schema();
    await statuses();
    return;
  }
  if (opt('--asin')) await byAsin(opt('--asin'));
  if (opt('--isbn')) await byIsbn(opt('--isbn'));
  if (opt('--search')) await search(opt('--search'));
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
