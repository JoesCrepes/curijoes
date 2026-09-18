'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api, fmtDur, fmtPct, fmtWhen } from '@/lib/client';
import type { MatchCandidate } from '@/lib/types';

interface Detail {
  book: { id: string; title: string; author: string | null; source_title: string; source_author: string | null; source_app: string; cover_url: string | null; match_status: string; hardcover_book_id: number | null; hardcover_edition_id: number | null; isbn13: string | null; runtime_seconds: number | null; match_candidates: MatchCandidate[] | null };
  reads: { id: string; status: string; started_at: string; finished_at: string | null; progress_pct: number | null; progress_basis: string; book_seconds_listened: number; wall_seconds_listened: number; hardcover_user_book_id: number | null; hardcover_read_id: number | null; hardcover_error: string | null; sessions: { id: string; started_at: string; ended_at: string; wall_seconds: number; book_seconds: number; start_chapter_idx: number | null; end_chapter_idx: number | null }[] }[];
  chapters: { idx: number; title: string | null; duration_ms: number | null }[];
  events: { id: string; event_type: string; occurred_at: string; is_playing: boolean; position_ms: number | null; duration_ms: number | null; playback_speed: number | null; chapter_idx: number | null; chapter_title: string | null; raw: Record<string, unknown> }[];
}

export default function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [cands, setCands] = useState<MatchCandidate[]>([]);
  const load = useCallback(() => api<Detail>(`/api/dashboard?book=${id}`).then((x) => { setD(x); setQ(x.book.title); setAuthor(x.book.author ?? ''); setCands(x.book.match_candidates ?? []); }), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="muted">Loading…</p>;
  const b = d.book;

  const choose = async (c: MatchCandidate) => { await api(`/api/books/${id}/match`, { method: 'POST', json: { candidate: c } }); load(); };
  const search = async () => { const r = await api<{ candidates: MatchCandidate[] }>(`/api/books/${id}/search?q=${encodeURIComponent(q)}&author=${encodeURIComponent(author)}`); setCands(r.candidates); };

  return (
    <>
      <h1>{b.title}</h1>
      <div className="card">
        <div className="row">
          {b.cover_url ? <img className="cover" src={b.cover_url} alt="" /> : <div className="cover" />}
          <div className="grow">
            <div>{b.author ?? '—'} <span className="pill">{b.match_status}</span></div>
            <div className="muted">Source: “{b.source_title}” / “{b.source_author ?? ''}” via {b.source_app}</div>
            <div className="muted">Hardcover book {b.hardcover_book_id ?? '—'} · edition {b.hardcover_edition_id ?? '—'} · ISBN {b.isbn13 ?? '—'} · runtime {b.runtime_seconds ? fmtDur(b.runtime_seconds) : '—'}</div>
          </div>
        </div>
      </div>

      <h2>Match</h2>
      <div className="card">
        <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="title" /><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="author" /><button onClick={search}>Search</button></div>
        {cands.map((c, i) => (
          <div className="row" key={i} style={{ marginTop: 8 }}>
            {c.cover_url ? <img className="cover" src={c.cover_url} alt="" /> : <div className="cover" />}
            <div className="grow"><div>{c.title}</div><div className="muted">{c.author ?? '—'} · {c.source} · {Math.round(c.score * 100)}% · {c.runtime_seconds ? fmtDur(c.runtime_seconds) : 'no runtime'}{c.isbn13 ? ` · ${c.isbn13}` : ''}</div></div>
            <button onClick={() => choose(c)}>Use</button>
          </div>
        ))}
      </div>

      <h2>Reads</h2>
      {d.reads.map((r) => (
        <div className="card" key={r.id}>
          <div><span className="pill accent">{r.status}</span> {fmtWhen(r.started_at)} → {fmtWhen(r.finished_at)} · {fmtPct(r.progress_pct)} ({r.progress_basis}) · {fmtDur(r.book_seconds_listened)} book / {fmtDur(r.wall_seconds_listened)} wall</div>
          <div className="muted">Hardcover user_book {r.hardcover_user_book_id ?? '—'} · read {r.hardcover_read_id ?? '—'}{r.hardcover_error ? ` · error: ${r.hardcover_error}` : ''}</div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              {[...r.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)).map((s) => (
                <tr key={s.id}><td>{fmtWhen(s.started_at)}</td><td>{fmtDur(s.wall_seconds)} wall</td><td>{fmtDur(s.book_seconds)} book</td><td>ch {s.start_chapter_idx ?? '?'}→{s.end_chapter_idx ?? '?'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h2>Chapters ({d.chapters.length})</h2>
      <div className="card">
        <table><tbody>{d.chapters.map((c) => <tr key={c.idx}><td>{c.idx}</td><td>{c.title ?? '—'}</td><td>{c.duration_ms != null ? fmtDur(c.duration_ms / 1000) : '—'}</td></tr>)}</tbody></table>
      </div>

      <h2>Events</h2>
      <div className="card">
        {d.events.map((e) => (
          <details key={e.id}>
            <summary>{fmtWhen(e.occurred_at)} · {e.event_type}{e.is_playing ? ' ▶' : ''} · ch {e.chapter_idx ?? '?'} {e.chapter_title ?? ''} · {e.position_ms != null ? fmtDur(e.position_ms / 1000) : ''}/{e.duration_ms != null ? fmtDur(e.duration_ms / 1000) : ''} · {e.playback_speed ?? ''}x</summary>
            <pre>{JSON.stringify(e.raw, null, 1)}</pre>
          </details>
        ))}
      </div>
    </>
  );
}
