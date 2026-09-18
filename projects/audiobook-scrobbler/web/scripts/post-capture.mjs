/** POST a capture JSONL at a running server's /api/ingest, in batches. */
import fs from 'node:fs'; import path from 'node:path';
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
}
const [file, base = 'http://127.0.0.1:3000'] = process.argv.slice(2);
const events = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(`posting ${events.length} events to ${base}/api/ingest`);
for (let i = 0; i < events.length; i += 50) {
  const batch = events.slice(i, i + 50);
  const res = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.API_TOKEN}` },
    body: JSON.stringify({ device: { id: '11111111-1111-1111-1111-111111111111', name: 'capture-replay' }, events: batch }),
  });
  const text = await res.text();
  console.log(`  batch ${i / 50 + 1}: HTTP ${res.status} ${text.slice(0, 300)}`);
  if (!res.ok) process.exit(1);
}
