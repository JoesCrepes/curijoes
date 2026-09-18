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
2. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `API_TOKEN`
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

## Android app notes

- `MediaListenerService` is a `NotificationListenerService` only because that
  is the permission Android requires for `MediaSessionManager.getActiveSessions`.
  It never reads notifications.
- Events: `metadata` (book/chapter changed), `queue` (chapter list), `play`,
  `pause`, `stop`, and a `position` sample every 60 s while playing. Every
  event carries the whole `MediaMetadata` bag in `raw`.
- Outbox is SQLite (`events.db`); `UploadWorker` drains it whenever there's
  network, `ActionsWorker` polls for prompts every 15 min and after uploads.
- *Capture every media app* is a discovery mode: use it once to learn a
  player's package name from the status panel, then put that name in the
  allow-list here and in the server's `allowed_apps` setting.
- Build: `./gradlew assembleDebug` with the Android SDK installed, or take the
  APK artifact from the GitHub Actions run.

## Automated Android test loop

No Audible needed. `android/fakeplayer/` is a second app that publishes a
real `MediaSession` and is driven entirely by adb intents: LOAD, PLAY,
PAUSE, STOP, SEEK, CHAPTER, SPEED, RELEASE. It advances position in real
time and rolls into the next chapter by itself. LOAD takes
`--es layout audible|libby|librofm|generic`; the three real layouts reproduce
what those apps actually publish, as recorded from a phone (see *Capturing
real player data* below and `PLAN.md`), so the loop tests the scrobbler
against the true key names, position semantics and queue shapes.

```bash
cd android
python tools/e2e.py               # emulator up, build, install, scripted listen, assertions
python tools/e2e.py --connected   # + instrumented unit tests (EventBuilder, EventStore)
python tools/e2e.py --sample      # + wait for the 60 s periodic position sample
python tools/e2e.py --window      # watch the emulator while it runs
python tools/e2e.py --no-build    # reuse the APKs already built
```

What it does: boots (or reuses) the `scrobbler-api36` AVD, installs both
APKs, grants notification access with `cmd notification allow_listener`,
starts a mock `/api/ingest` on the host reached through `adb reverse`,
configures the app through the debug-only `DebugConfigReceiver`, plays three
scenarios in the fake player and asserts on the uploaded events (types,
chapter indexes, positions, queue, token, dedupe). On failure it dumps the
relevant logcat and `dumpsys media_session`.

Needs: JDK 17 (`JAVA_HOME`), the Android SDK (`ANDROID_HOME` or the default
location) with platform-tools, emulator, cmdline-tools and
`system-images;android-36;google_apis;x86_64`, and Python 3. The same loop
runs in CI on a GitHub Actions emulator (`android-emulator` job).

Debug builds also allow cleartext HTTP and expose the config receiver; release
builds have neither.

### Capturing real player data (phone over USB)

The fake player is a stand-in; the shape of a real Audible/Libby/Libro.fm
session comes from the phone. Enable *USB debugging*, plug the phone in,
accept the prompt, then:

```bash
cd android
python tools/capture.py            # build, install, grant, record until Ctrl+C
python tools/capture.py --no-build --duration 600
```

It points the app at a mock server on the PC (through `adb reverse`, so no
deployed server is needed), turns on *capture every app*, and writes every
uploaded event to `tools/captures/<timestamp>.jsonl` plus a
`.summary.json` with each app's raw metadata keys and sample values. The
first event from each app prints its full raw key set. Play, pause, seek,
skip chapters and switch books while it runs. On exit the app's server URL
is cleared (or set with `--restore-url`) and the allow-list is set to the
packages seen. Keep the phone on Wi-Fi: the uploader waits for a network.

To see what a capture turns into without a server, replay it through the
real pipeline offline and get a page in Hardcover's shape (`user_books`,
`user_book_reads`, the mutations the sync would run, plus sessions and the
chapter map):

```bash
cd web
npm run replay -- ../android/tools/captures/20260918-154914.jsonl   # writes <capture>.hardcover.html
```

`python ../android/tools/report.py <capture.jsonl>` renders the raw side
instead: every event, every metadata key and the queue, per app.
