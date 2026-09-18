# Audiobook Scrobbler

Scrobbles audiobook listening from Audible, Libro.fm and Libby on one Android
phone into a personal listening log, derives sessions / progress / finished
books, and mirrors reads to [Hardcover](https://hardcover.app).

See `PLAN.md` for the design decisions and what still needs verifying on a
real device.

```
android/   Kotlin app: NotificationListener → MediaSession events → SQLite queue → POST /api/ingest
web/       Next.js (Vercel) + Supabase: ingest, sessions, progress, matching, Hardcover sync, PWA
```

## How it works

1. The phone app watches active media sessions for allow-listed packages. On
   every metadata or playback-state change, and every 60 s while playing, it
   records an event: full raw metadata bag, position, duration, speed, chapter
   index (from the session queue), timestamp, client UUID.
2. `POST /api/ingest` resolves each event to a **book** (normalized
   title+author) and a **read** (the open read for that book, or a new one),
   stores the event, learns the chapter map, recomputes that read's
   **sessions** (10-minute gap rule) and **progress**, applies the auto-finish
   rule, and syncs the read to Hardcover.
3. Ambiguous book matches and stalled near-finished reads become **actions**;
   the phone polls `GET /api/actions` and shows notifications with buttons.
   The same queue is on the PWA home page.
4. Everything except `events` is derived. *Settings → Reprocess from events*
   rebuilds it, which is how you fix a wrong field map after the fact.

## Server setup

```bash
cd web
npm install
cp .env.local.example .env.local   # fill in
npm run dev
```

1. Create a Supabase project and run `web/supabase/migrations/0001_init.sql`
   in the SQL editor.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_TOKEN`
   (`openssl rand -hex 32`), `CRON_SECRET`, and optionally `HARDCOVER_TOKEN`.
3. Deploy to Vercel with the project root set to
   `projects/audiobook-scrobbler/web`. `vercel.json` schedules the hourly
   stall/timeout/resync cron.
4. Open the site, sign in with `API_TOKEN`, then Settings → *Probe Hardcover*.
   Once the probe reports the mutations exist, set `HARDCOVER_DRY_RUN=false`.

Tests: `npm test` (pure logic: normalization, sessions, progress, finish rules).

## Phone setup

1. Download the debug APK from the *audiobook-scrobbler* GitHub Actions run
   (or build with Android Studio from `android/`) and sideload it.
2. Open the app, enter the server URL and `API_TOKEN`, tap *Grant notification
   access* and allow it, and allow notifications.
3. Play something. The app's status panel shows the sessions it can see and
   the upload queue; the PWA's *Raw events* panel shows what arrived.

## API

All routes take `Authorization: Bearer <API_TOKEN>` (the PWA uses a cookie set by `/api/login`).

| Route | Purpose |
|---|---|
| `POST /api/ingest` | `{ device: {id,name}, events: [...] }` → counts |
| `GET /api/actions` / `POST /api/actions/:id` | pending prompts; resolve with `{candidate:i}`, `{skip:true}`, `{finished:true}`, `{not_yet:true}`, `{dnf:true}` |
| `POST /api/reads/:id/status` | `{status: reading|finished|dnf}` |
| `GET /api/books/:id/search?q=&author=` / `POST /api/books/:id/match` | manual matching |
| `GET|PUT /api/settings` | thresholds, allow-list, per-app field maps |
| `GET /api/dashboard[?book=id]` | data for the PWA |
| `GET /api/cron/evaluate` | stall prompts, timeouts, Hardcover retry (hourly) |
| `GET /api/hardcover/probe` | verifies Hardcover schema assumptions |
| `POST /api/admin/reprocess` | `{mode: reprocess|recompute}` |
