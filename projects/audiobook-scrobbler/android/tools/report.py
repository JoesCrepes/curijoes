#!/usr/bin/env python3
"""
Turn a capture (tools/captures/<ts>.jsonl, from capture.py or any list of
ingest events) into one self-contained HTML page: per app, the field map we
learned, a timeline of events, the event table, the raw metadata keys with
sample values, and the chapter queue.

    python tools/report.py tools/captures/20260918-154914.jsonl
    python tools/report.py capture.jsonl -o report.html
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

TEMPLATE = r"""<title>__TITLE__</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --bg: #f7f7f5; --surface: #fcfcfb; --line: #e2e1dc; --line-strong: #c9c8c2;
  --ink: #17181a; --ink-2: #55575c; --ink-3: #8a8c92; --accent: #2f5d8a; --accent-soft: #e6eef7;
  --s-metadata: #2a78d6; --s-queue: #eb6834; --s-play: #1baf7a; --s-pause: #eda100; --s-position: #e87ba4; --s-stop: #4a3aa7;
  --sans: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; --mono: "IBM Plex Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #161718; --surface: #1e1f21; --line: #2f3033; --line-strong: #45464a;
  --ink: #f1f1ee; --ink-2: #b9bab4; --ink-3: #85868a; --accent: #7fb0e6; --accent-soft: #1f2d3d;
  --s-metadata: #3987e5; --s-queue: #d95926; --s-play: #199e70; --s-pause: #c98500; --s-position: #d55181; --s-stop: #9085e9;
} }
:root[data-theme="dark"] {
  --bg: #161718; --surface: #1e1f21; --line: #2f3033; --line-strong: #45464a;
  --ink: #f1f1ee; --ink-2: #b9bab4; --ink-3: #85868a; --accent: #7fb0e6; --accent-soft: #1f2d3d;
  --s-metadata: #3987e5; --s-queue: #d95926; --s-play: #199e70; --s-pause: #c98500; --s-position: #d55181; --s-stop: #9085e9;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--sans); }
.wrap { max-width: 1100px; margin: 0 auto; padding-block: 24px 48px; padding-inline: 16px; }
h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; text-wrap: balance; }
h2 { font-size: 15px; font-weight: 600; margin: 0; }
.sub { color: var(--ink-2); margin: 0 0 20px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
.tab { border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; font-weight: 500; }
.tab[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tab small { color: inherit; opacity: .75; margin-left: 6px; font-weight: 400; }
.panel { display: grid; gap: 18px; }
.block { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
.block > h2 { margin-bottom: 10px; }
.map { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; align-items: baseline; }
.map .k { color: var(--ink-2); font-weight: 500; text-transform: uppercase; letter-spacing: .04em; font-size: 11.5px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 8px; font-size: 12.5px; color: var(--ink-2); }
.legend span::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--c); vertical-align: 0; }
.timeline { width: 100%; overflow-x: auto; }
.timeline svg { display: block; width: 100%; height: 120px; }
.tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--bg); padding: 6px 9px; border-radius: 6px; font: 12px/1.4 var(--mono); max-width: 360px; z-index: 5; }
.tip[hidden] { display: none; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; white-space: nowrap; }
th { color: var(--ink-2); font-weight: 500; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; }
td.wrap-cell { white-space: normal; max-width: 420px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--c); }
.muted { color: var(--ink-3); }
details summary { cursor: pointer; font-weight: 500; }
.stats { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-bottom: 18px; color: var(--ink-2); }
.stats b { color: var(--ink); font-weight: 600; }
.kv-val { white-space: normal; word-break: break-all; }
@media (prefers-reduced-motion: no-preference) { .tab { transition: background .15s; } }
</style>
<div class="wrap">
  <h1 id="title"></h1>
  <p class="sub" id="subtitle"></p>
  <div class="stats" id="stats"></div>
  <div class="tabs" role="tablist" id="tabs"></div>
  <div class="panel" id="panel"></div>
</div>
<div class="tip" id="tip" hidden></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const TYPES = ['metadata', 'queue', 'play', 'pause', 'position', 'stop'];
const MD = 'android.media.metadata.';
const KNOWN = {
  'com.audible.application': { name: 'Audible', title: 'TITLE', author: 'AUTHOR (= ALBUM)', chapter: 'ARTIST', id: 'MEDIA_ID (ASIN)', pos: 'chapter-relative; DURATION = chapter; queue = chapters' },
  'com.overdrive.mobile.android.libby': { name: 'Libby', title: 'TITLE (= ALBUM = DISPLAY_TITLE)', author: 'ARTIST (= ALBUM_ARTIST)', chapter: 'DISPLAY_SUBTITLE', id: 'titleId (OverDrive)', pos: 'absolute in the book; DURATION = whole book; no queue' },
  'fm.libro.librofm': { name: 'Libro.fm', title: 'TITLE (= ALBUM)', author: 'ARTIST', chapter: 'none (queue items are all the book title)', id: 'MEDIA_ID (track id)', pos: 'track-relative; DURATION = track; queue = tracks' },
  'com.spotify.music': { name: 'Spotify', title: 'ALBUM', author: 'ARTIST', chapter: 'TITLE (track)', id: 'MEDIA_ID (spotify:track:…)', pos: 'track-relative; not an audiobook app' },
  'com.curijoes.fakeplayer': { name: 'Fake player', title: 'per layout', author: 'per layout', chapter: 'per layout', id: 'per layout', pos: 'scripted' },
};
const apps = {};
for (const e of DATA.events) (apps[e.app_package] ??= []).push(e);
for (const k in apps) apps[k].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
const appKeys = Object.keys(apps).sort((a, b) => (KNOWN[a] ? 0 : 1) - (KNOWN[b] ? 0 : 1) || apps[b].length - apps[a].length);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtMs = (ms) => ms == null ? '—' : (ms >= 3600000 ? `${Math.floor(ms / 3600000)}h ${Math.floor(ms % 3600000 / 60000)}m ${Math.floor(ms % 60000 / 1000)}s` : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.floor(ms % 60000 / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const fmtT = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false });
const short = (pkg) => KNOWN[pkg]?.name ?? pkg.split('.').pop();

document.getElementById('title').textContent = DATA.title;
document.getElementById('subtitle').textContent = DATA.subtitle;
const first = DATA.events.length ? DATA.events.reduce((m, e) => e.occurred_at < m ? e.occurred_at : m, DATA.events[0].occurred_at) : null;
const last = DATA.events.length ? DATA.events.reduce((m, e) => e.occurred_at > m ? e.occurred_at : m, DATA.events[0].occurred_at) : null;
document.getElementById('stats').innerHTML = `<span><b>${DATA.events.length}</b> events</span><span><b>${appKeys.length}</b> apps</span>` + (first ? `<span>${new Date(first).toLocaleDateString()} <b>${fmtT(first)}</b> – <b>${fmtT(last)}</b></span>` : '');

const tabs = document.getElementById('tabs');
let current = null;
try { current = localStorage.getItem('capture-tab'); } catch {}
if (!appKeys.includes(current)) current = appKeys[0];
for (const k of appKeys) {
  const b = document.createElement('button');
  b.className = 'tab'; b.role = 'tab'; b.id = 'tab-' + k.replace(/\W/g, '-');
  b.innerHTML = `${esc(short(k))}<small>${apps[k].length}</small>`;
  b.addEventListener('click', () => { current = k; try { localStorage.setItem('capture-tab', k); } catch {} render(); });
  tabs.appendChild(b);
}

function timeline(evs) {
  const t0 = new Date(evs[0].occurred_at).getTime(), t1 = new Date(evs[evs.length - 1].occurred_at).getTime();
  const span = Math.max(t1 - t0, 1000);
  const W = 1000, H = 120, L = 8, R = 8, top = 18, rowH = 14;
  const x = (t) => L + (new Date(t).getTime() - t0) / span * (W - L - R);
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="events over time">`;
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const xx = L + i / ticks * (W - L - R);
    s += `<line x1="${xx}" x2="${xx}" y1="${top - 6}" y2="${H - 16}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<text x="${xx}" y="${H - 3}" font-size="11" fill="var(--ink-3)" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}" font-family="var(--mono)">${fmtT(new Date(t0 + i / ticks * span).toISOString())}</text>`;
  }
  TYPES.forEach((ty, row) => {
    const y = top + row * rowH;
    s += `<text x="${L}" y="${y - 5}" font-size="9" fill="var(--ink-3)" font-family="var(--sans)" opacity="0">${ty}</text>`;
  });
  evs.forEach((e, i) => {
    const row = TYPES.indexOf(e.event_type); if (row < 0) return;
    const y = top + row * rowH;
    s += `<circle data-i="${i}" cx="${x(e.occurred_at)}" cy="${y}" r="5" fill="var(--s-${e.event_type})" stroke="var(--surface)" stroke-width="1.5"/>`;
  });
  return s + '</svg>';
}

function keyTable(evs) {
  const seen = {};
  for (const e of evs) for (const [k, v] of Object.entries(e.raw ?? {})) {
    if (k === 'queue') continue;
    const set = (seen[k] ??= new Map());
    const sv = String(v);
    if (!set.has(sv) && set.size < 4) set.set(sv, true);
  }
  const rows = Object.keys(seen).sort().map((k) => `<tr><td class="mono">${esc(k.replace(MD, ''))}${k.startsWith(MD) ? '' : ' <span class="muted">(app key)</span>'}</td><td class="mono kv-val">${[...seen[k].keys()].map((v) => esc(v.length > 120 ? v.slice(0, 120) + '…' : v)).join('<br>')}</td></tr>`);
  return `<div class="scroll"><table><thead><tr><th>key</th><th>values seen</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function eventTable(evs) {
  const rows = evs.map((e, i) => {
    const r = e.raw ?? {};
    return `<tr data-i="${i}"><td class="mono muted">${fmtT(e.occurred_at)}</td><td><span class="dot" style="--c:var(--s-${e.event_type})"></span>${e.event_type}</td>` +
      `<td class="mono">${e.chapter_idx ?? '—'}${e.chapter_count != null ? ' / ' + e.chapter_count : ''}</td><td class="mono">${fmtMs(e.position_ms)}</td><td class="mono">${fmtMs(e.duration_ms)}</td><td class="mono">${e.playback_speed != null ? e.playback_speed.toFixed(2).replace(/\.?0+$/, '') + '×' : '—'}</td>` +
      `<td class="wrap-cell">${esc(r[MD + 'TITLE'] ?? '')}</td><td class="wrap-cell">${esc(r[MD + 'ALBUM'] ?? '')}</td><td class="wrap-cell">${esc(r[MD + 'ARTIST'] ?? '')}</td><td class="wrap-cell">${esc(r[MD + 'DISPLAY_SUBTITLE'] ?? r[MD + 'DISPLAY_TITLE'] ?? '')}</td>` +
      `<td class="mono">${e.queue ? e.queue.length + ' items' : ''}</td></tr>`;
  });
  return `<div class="scroll"><table><thead><tr><th>time</th><th>event</th><th>chapter</th><th>position</th><th>duration</th><th>speed</th><th>TITLE</th><th>ALBUM</th><th>ARTIST</th><th>DISPLAY_SUBTITLE / _TITLE</th><th>queue</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function queueBlock(evs) {
  const q = [...evs].reverse().find((e) => e.event_type === 'queue' && e.queue?.length);
  if (!q) return `<div class="block"><h2>Queue</h2><p class="muted" style="margin:0">This app published no queue.</p></div>`;
  const items = q.queue.map((it, i) => `<tr><td class="mono muted">${i}</td><td class="wrap-cell">${esc(it.title ?? '')}</td><td class="wrap-cell muted">${esc(it.subtitle ?? '')}</td><td class="mono">${esc(it.media_id ?? '')}</td></tr>`);
  return `<div class="block"><details><summary>Queue · ${q.queue.length} items (as published at ${fmtT(q.occurred_at)})</summary><div class="scroll" style="margin-top:10px"><table><thead><tr><th>#</th><th>title</th><th>subtitle</th><th>media_id</th></tr></thead><tbody>${items.join('')}</tbody></table></div></details></div>`;
}

function render() {
  for (const b of tabs.children) b.setAttribute('aria-selected', b.id === 'tab-' + current.replace(/\W/g, '-'));
  const evs = apps[current];
  const known = KNOWN[current];
  const counts = TYPES.map((t) => [t, evs.filter((e) => e.event_type === t).length]).filter(([, n]) => n);
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div class="block"><h2>${esc(known?.name ?? current)} <span class="mono muted" style="font-weight:400">${esc(current)}</span></h2>
      ${known ? `<div class="map">
        <span class="k">book title</span><span class="mono">${esc(known.title)}</span>
        <span class="k">author</span><span class="mono">${esc(known.author)}</span>
        <span class="k">chapter</span><span class="mono">${esc(known.chapter)}</span>
        <span class="k">identity</span><span class="mono">${esc(known.id)}</span>
        <span class="k">position</span><span>${esc(known.pos)}</span></div>` : '<p class="muted" style="margin:0">No field map yet for this app; read the keys below.</p>'}
    </div>
    <div class="block"><h2>Timeline</h2>
      <div class="legend">${counts.map(([t, n]) => `<span style="--c:var(--s-${t})">${t} ${n}</span>`).join('')}</div>
      <div class="timeline">${timeline(evs)}</div></div>
    <div class="block"><h2>Events</h2>${eventTable(evs)}</div>
    <div class="block"><h2>Raw metadata keys</h2><p class="muted" style="margin:0 0 8px">Every key the player put on its MediaMetadata, with up to four distinct values seen.</p>${keyTable(evs)}</div>
    ${queueBlock(evs)}`;
  const tip = document.getElementById('tip');
  panel.querySelectorAll('circle').forEach((c) => {
    c.addEventListener('mousemove', (ev) => {
      const e = evs[+c.dataset.i]; const r = e.raw ?? {};
      tip.innerHTML = `${fmtT(e.occurred_at)} <b>${e.event_type}</b> ch ${e.chapter_idx ?? '—'} · ${fmtMs(e.position_ms)}<br>${esc(r[MD + 'TITLE'] ?? '')}<br>${esc(r[MD + 'ARTIST'] ?? '')}`;
      tip.hidden = false; tip.style.left = Math.min(ev.clientX + 12, innerWidth - 380) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}
render();
</script>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capture", help="JSONL from capture.py (one ingest event per line)")
    ap.add_argument("-o", "--out", help="output HTML (default: next to the capture)")
    ap.add_argument("--title", default="Player capture")
    args = ap.parse_args()

    src = pathlib.Path(args.capture)
    events = [json.loads(line) for line in src.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not events:
        sys.exit("no events in capture")
    apps = sorted({e["app_package"] for e in events})
    data = {
        "title": args.title,
        "subtitle": f"{src.name}: what each player's MediaSession actually publishes, as captured by the scrobbler ({len(events)} events, {len(apps)} apps).",
        "events": events,
    }
    html = TEMPLATE.replace("__TITLE__", args.title).replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    out = pathlib.Path(args.out) if args.out else src.with_suffix(".html")
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
