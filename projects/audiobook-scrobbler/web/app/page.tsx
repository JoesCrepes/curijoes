'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDur, fmtPct, fmtWhen } from '@/lib/client';
import type { MatchCandidate } from '@/lib/types';

interface Book { id: string; title: string; author: string | null; cover_url: string | null; match_status: string; runtime_seconds: number | null; source_app: string }
interface Read { id: string; status: string; progress_pct: number | null; progress_basis: string; book_seconds_listened: number; last_activity_at: string; started_at: string; finished_at: string | null; finish_source: string | null; hardcover_error: string | null; books: Book }
interface Action { id: string; type: string; book_id: string | null; read_id: string | null; payload: { title?: string; author?: string; pct?: number; candidates?: MatchCandidate[] }; created_at: string }
interface Session { id: string; started_at: string; wall_seconds: number; book_seconds: number; reads: { book_id: string; books: { title: string } } }
interface Ev { id: string; app_package: string; event_type: string; occurred_at: string; is_playing: boolean; position_ms: number | null; duration_ms: number | null; chapter_idx: number | null; chapter_title: string | null; book_id: string | null; raw: Record<string, unknown> }
interface Dash { reads: Read[]; actions: Action[]; sessions: Session[]; events: Ev[] }

export default function Home() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const load = useCallback(() => api<Dash>('/api/dashboard').then(setD).catch((e) => setErr(String(e))), []);
  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string, resolution: unknown) => {
    await api(`/api/actions/${id}`, { method: 'POST', json: resolution });
    load();
  };
  const setStatus = async (readId: string, status: string) => {
    await api(`/api/reads/${readId}/status`, { method: 'POST', json: { status } });
    load();
  };

  if (err) return <p style={{ color: 'var(--warn)' }}>{err}</p>;
  if (!d) return <p className="muted">Loading…</p>;

  const reading = d.reads.filter((r) => r.status === 'reading');
  const done = d.reads.filter((r) => r.status !== 'reading');

  return (
    <>
      {d.actions.length > 0 && (
        <>
          <h2>Needs you</h2>
          {d.actions.map((a) => (
            <div className="card" key={a.id}>
              {a.type === 'match_book' ? (
                <>
                  <div>Which book is <b>{a.payload.title}</b>{a.payload.author ? ` by ${a.payload.author}` : ''}?</div>
                  {(a.payload.candidates ?? []).map((c, i) => (
                    <div className="row" key={i} style={{ marginTop: 8 }}>
                      {c.cover_url ? <img className="cover" src={c.cover_url} alt="" /> : <div className="cover" />}
                      <div className="grow">
                        <div>{c.title}</div>
                        <div className="muted">{c.author ?? '—'} · {c.source} · {Math.round(c.score * 100)}% · {c.runtime_seconds ? fmtDur(c.runtime_seconds) : 'no runtime'}</div>
                      </div>
                      <button onClick={() => resolve(a.id, { candidate: i })}>This one</button>
                    </div>
                  ))}
                  <p><button onClick={() => resolve(a.id, { skip: true })}>None of these</button> <a href={`/books/${a.book_id}`}>Search manually →</a></p>
                </>
              ) : (
                <>
                  <div>Finished <b>{a.payload.title}</b>? It has been parked at {fmtPct(a.payload.pct)}.</div>
                  <p>
                    <button className="primary" onClick={() => resolve(a.id, { finished: true })}>Finished</button>
                    <button onClick={() => resolve(a.id, { not_yet: true })}>Not yet</button>
                    <button className="danger" onClick={() => resolve(a.id, { dnf: true })}>Did not finish</button>
                  </p>
                </>
              )}
            </div>
          ))}
        </>
      )}

      <h2>Listening</h2>
      {reading.length === 0 && <p className="muted">Nothing in progress. Play something in Audible, Libro.fm or Libby and it will show up here.</p>}
      {reading.map((r) => <ReadCard key={r.id} r={r} onStatus={setStatus} />)}

      <h2>Recent sessions</h2>
      <div className="card">
        <table>
          <tbody>
            {d.sessions.map((s) => (
              <tr key={s.id}>
                <td>{fmtWhen(s.started_at)}</td>
                <td><a href={`/books/${s.reads?.book_id}`}>{s.reads?.books?.title ?? '?'}</a></td>
                <td>{fmtDur(s.wall_seconds)} wall</td>
                <td>{fmtDur(s.book_seconds)} book</td>
              </tr>
            ))}
            {d.sessions.length === 0 && <tr><td className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {done.length > 0 && (
        <>
          <h2>Finished</h2>
          {done.map((r) => <ReadCard key={r.id} r={r} onStatus={setStatus} />)}
        </>
      )}

      <h2>Raw events <button onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'hide' : 'show'}</button></h2>
      {showRaw && (
        <div className="card">
          <p className="muted">Latest 50 events as the phone sent them. Use this to check which metadata key holds the book title vs. chapter, then fix the field map in Settings and reprocess.</p>
          {d.events.map((e) => (
            <details key={e.id}>
              <summary>{fmtWhen(e.occurred_at)} · {e.app_package.split('.').pop()} · {e.event_type}{e.is_playing ? ' ▶' : ''} · ch {e.chapter_idx ?? '?'} {e.chapter_title ?? ''} · {e.position_ms != null ? fmtDur(e.position_ms / 1000) : ''}/{e.duration_ms != null ? fmtDur(e.duration_ms / 1000) : ''}{e.book_id ? '' : ' · (no book)'}</summary>
              <pre>{JSON.stringify(e.raw, null, 1)}</pre>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function ReadCard({ r, onStatus }: { r: Read; onStatus: (id: string, s: string) => void }) {
  const b = r.books;
  const matchPill = b.match_status === 'auto' || b.match_status === 'confirmed' ? <span className="pill ok">matched</span> : b.match_status === 'needs_review' ? <span className="pill warn">needs match</span> : <span className="pill">{b.match_status}</span>;
  return (
    <div className="card">
      <div className="row">
        {b.cover_url ? <img className="cover" src={b.cover_url} alt="" /> : <div className="cover" />}
        <div className="grow">
          <div><a href={`/books/${b.id}`}>{b.title}</a> {matchPill} {r.status !== 'reading' && <span className="pill accent">{r.status}{r.finish_source ? ` · ${r.finish_source}` : ''}</span>}</div>
          <div className="muted">{b.author ?? '—'} · {fmtDur(r.book_seconds_listened)} listened · {r.progress_basis} · last {fmtWhen(r.last_activity_at)}</div>
          <div className="bar"><div style={{ width: `${Math.round((r.progress_pct ?? 0) * 100)}%` }} /></div>
          {r.hardcover_error && <div className="muted" style={{ color: 'var(--warn)' }}>Hardcover: {r.hardcover_error}</div>}
        </div>
        <div>{fmtPct(r.progress_pct)}</div>
      </div>
      <div style={{ marginTop: 8 }}>
        {r.status === 'reading' ? (
          <>
            <button onClick={() => onStatus(r.id, 'finished')}>Mark finished</button>
            <button onClick={() => onStatus(r.id, 'dnf')}>DNF</button>
          </>
        ) : (
          <button onClick={() => onStatus(r.id, 'reading')}>Reopen</button>
        )}
      </div>
    </div>
  );
}
