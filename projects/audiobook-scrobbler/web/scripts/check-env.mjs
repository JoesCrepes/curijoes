/**
 * Preflight for the server's configuration. Reads .env.local, then checks that
 * the database is reachable and writable, that RLS actually blocks the public
 * key, and that the Hardcover token works.
 *
 *   npm run check
 *
 * Prints no secrets. Exit code 0 means the server is ready to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const file = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(file)) {
  console.error('no .env.local — copy .env.local.example and fill it in');
  process.exit(1);
}
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

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failed = true;
};
const warn = (m) => console.log(`  warn  ${m}`);

console.log('environment');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) bad('SUPABASE_URL is not set');
else ok(`SUPABASE_URL ${url}`);
if (!key) bad('SUPABASE_SECRET_KEY is not set');
else if (key.startsWith('sb_secret_')) ok(`SUPABASE_SECRET_KEY looks like a modern secret key (${key.length} chars)`);
else if (key.startsWith('eyJ')) warn('SUPABASE_SECRET_KEY is a legacy service_role JWT — works, but legacy keys are being retired');
else if (key.startsWith('sb_publishable_')) bad('that is the PUBLISHABLE key — the server needs the secret key');
else bad('SUPABASE_SECRET_KEY is not a recognized Supabase key');
for (const n of ['API_TOKEN', 'CRON_SECRET']) {
  const v = process.env[n] ?? '';
  if (v.length >= 32) ok(`${n} set (${v.length} chars)`);
  else bad(`${n} missing or too short`);
}
const hc = process.env.HARDCOVER_TOKEN ?? '';
if (hc) ok(`HARDCOVER_TOKEN set, dry run ${(process.env.HARDCOVER_DRY_RUN ?? 'true').toLowerCase() !== 'false' ? 'ON (no writes)' : 'OFF (will write to Hardcover)'}`);
else warn('HARDCOVER_TOKEN not set — the sync is disabled');

if (url && key) {
  console.log('\ndatabase');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: users, error } = await db.from('users').select('id');
  if (error) bad(`read failed: ${error.message}`);
  else if (!users.length) bad('users table is empty — run migration 0001');
  else {
    ok(`read works, ${users.length} user row(s)`);
    const probe = `__probe_${crypto.randomUUID()}`;
    const w = await db.from('settings').insert({ user_id: users[0].id, key: probe, value: { ok: true } });
    if (w.error) bad(`write failed: ${w.error.message}`);
    else {
      await db.from('settings').delete().eq('key', probe);
      ok('write works (RLS bypassed by the secret key, as intended)');
    }
  }
  const expected = ['users', 'settings', 'devices', 'books', 'chapters', 'reads', 'events', 'sessions', 'actions', 'hardcover_sync_log'];
  const missing = [];
  for (const t of expected) {
    const r = await db.from(t).select('*', { count: 'exact', head: true });
    if (r.error) missing.push(t);
  }
  if (missing.length) bad(`tables missing or unreadable: ${missing.join(', ')}`);
  else ok(`all ${expected.length} tables present`);
}

if (process.env.SUPABASE_PUBLISHABLE_KEY && url) {
  console.log('\nrow level security');
  const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const r = await anon.from('events').select('id').limit(1);
  if (r.error || (r.data && r.data.length === 0)) ok('publishable key cannot read events');
  else bad('PUBLISHABLE KEY CAN READ EVENTS — RLS is not protecting the data');
}

if (hc) {
  console.log('\nhardcover');
  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: hc.startsWith('Bearer ') ? hc : `Bearer ${hc}` },
      body: JSON.stringify({ query: '{ me { id username } }' }),
    });
    const j = await res.json();
    if (j.errors) bad(`token rejected: ${j.errors.map((e) => e.message).join('; ')}`);
    else ok(`signed in as ${j.data?.me?.[0]?.username ?? '?'}`);
  } catch (e) {
    bad(`unreachable: ${e.message}`);
  }
}

console.log(failed ? '\nNOT READY' : '\nREADY');
process.exit(failed ? 1 : 0);
