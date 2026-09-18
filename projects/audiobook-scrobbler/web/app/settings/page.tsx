'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { Settings } from '@/lib/types';

export default function SettingsPage() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api<{ settings: Settings }>('/api/settings').then((r) => setText(JSON.stringify(r.settings, null, 2)));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await api('/api/settings', { method: 'PUT', json: JSON.parse(text) });
      setMsg('Saved.');
    } catch (e) { setMsg(String(e)); }
  };
  const run = async (label: string, path: string, init?: RequestInit & { json?: unknown }) => {
    setMsg(`${label}…`);
    try { setMsg(`${label}: ${JSON.stringify(await api(path, init))}`); } catch (e) { setMsg(String(e)); }
  };

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">
        <b>session_gap_seconds</b> ends a session after that much silence. <b>finish_threshold</b> auto-finishes. <b>stall_threshold</b>/<b>stall_hours</b> decide when to ask.
        <b> app_field_maps</b> says which MediaMetadata keys hold the book title, author and chapter per app; after changing it, run Reprocess.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <p><button className="primary" onClick={save}>Save</button> <button onClick={load}>Reload</button></p>
      <h2>Maintenance</h2>
      <p>
        <button onClick={() => run('Recompute', '/api/admin/reprocess', { method: 'POST', json: { mode: 'recompute' } })}>Recompute sessions/progress</button>
        <button className="danger" onClick={() => confirm('Rebuild books/reads/sessions from the raw event log?') && run('Reprocess', '/api/admin/reprocess', { method: 'POST', json: { mode: 'reprocess' } })}>Reprocess from events</button>
      </p>
      <p>
        <button onClick={() => run('Evaluate', '/api/cron/evaluate')}>Run stall check now</button>
        <button onClick={() => run('Hardcover probe', '/api/hardcover/probe')}>Probe Hardcover</button>
      </p>
      {msg && <pre>{msg}</pre>}
    </>
  );
}
