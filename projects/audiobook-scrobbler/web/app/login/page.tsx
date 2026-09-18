'use client';
import { useState } from 'react';

export default function Login() {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="card">
      <h1>Sign in</h1>
      <p className="muted">Paste the API token from the server environment. This is the same token the phone uses.</p>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token" />
      <p>
        <button
          className="primary"
          onClick={async () => {
            const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
            if (res.ok) window.location.href = '/';
            else setErr('That token was rejected.');
          }}
        >
          Sign in
        </button>
      </p>
      {err && <p style={{ color: 'var(--warn)' }}>{err}</p>}
    </div>
  );
}
