# Audiobook Scrobbler — plan

Outcome of the grilling session (2026-09-18). Every decision below was put to
the user and settled; anything marked *assumption* was stated and accepted
without a further question.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Destination tracker | **Hardcover** as the mirror; our own event log in Supabase is the source of truth. Roll-your-own destination later reuses Hardcover's data model. |
| 2 | Capture mechanism | **Our own Android app**: `NotificationListenerService` + `MediaSessionManager`, logging every MediaSession metadata/state change from allow-listed players. Off-the-shelf scrobblers (Pano) ruled out: book/chapter parsing and the manual-match flow need an app anyway. |
| 3 | Granularity | **Level 3**: currently-reading, progress, sessions, finished detection with a manual exception flow. |
| 4 | Book identity | A UUID (`books.id`) per book, resolved from the player's own id first (`external_id`: Audible ASIN, Libro.fm ISBN, Libby titleId) and then normalized (title, author) — so a confirmed match survives the player changing its title string. Matched to a Hardcover book/edition (ISBN, runtime); ambiguous matches go to a review queue surfaced as a phone notification and on the web. |
| 5 | Server | **Next.js API routes on Vercel + Supabase**, same as `spotify-shared-taste` and `commute-estimator`. |
| 6 | Spotify audiobooks | **Out of v1.** Nice-to-have. |
| 7 | Progress | **Both**: raw chapter index + in-chapter position is always stored; percent is derived from the chapter map when the prefix is known, else from cumulative listened seconds ÷ runtime. Recomputable at any time. Runtime comes from the matched Hardcover audiobook edition. Chapter map is learned from the player's queue and observed per-chapter durations. |
| 8 | Sessions | Gap of **10 min** (setting `session_gap_seconds`) ends a session. Both wall-clock seconds and book-seconds tracked; playback speed (user is usually at 2x / 1.7x) is captured and used when position deltas are unavailable. |
| 9 | Finished | **Auto** at ≥ 98% (`finish_threshold`) on chapter-basis progress, on the app reporting completion, or cumulative-basis while on the last chapter. **Stall prompt**: a book at ≥ 90% (`stall_threshold`) with no session for 24 h (`stall_hours`) gets a Finished / Not yet / DNF notification. Ignored prompts auto-finish after 14 days (`stall_auto_finish_days`, 0 disables). |
| 10 | ISBN / metadata lookup | Hardcover search first (gives the ids we write to plus audiobook edition runtime), Open Library fallback. |
| 11 | Client split | Thin Android app + PWA first; the fat client landed 2026-09-18 and was indeed UI work only, since every route was already JSON with no web-only assumptions. The PWA remains for anything roomier than a phone. |
| 12 | Hardcover sync | One-way, batched per ingest: start → Currently Reading + a read; each ingest → progress on that read; finished/DNF → status. Never read back. |
| 13 | Offline | Phone queues events in SQLite (client UUIDs), WorkManager flushes with retry; server upserts on id so retries are harmless. |
| 14 | Auth | Single static bearer token. `lib/auth.ts#authenticate` is the one seam; every table has `user_id`, so Google OAuth later is a swap of that function. |
| 15 | APK build | GitHub Actions builds the debug APK (this sandbox cannot reach dl.google.com for the SDK). Phone runs Android 17 → `minSdk 34`, `compileSdk 36`. |
| 16 | Re-reads | A new read starts if the latest read is finished/DNF and the event falls outside its window; parallel books are independent reads. |
| 17 | Layout | `projects/audiobook-scrobbler/{web,android}`. |

*Assumptions*: no Firebase; the app polls `/api/actions` every 15 min and raises
local notifications. Chapter data is not expected from Hardcover; the player
queue is the source.

## Things that need a real device or network to settle

Items 1, 2 and 4 were settled on 2026-09-18 with `android/tools/capture.py`
against a Pixel 10 Pro Fold (Android 17); the recordings are in
`android/tools/captures/` and trimmed fixtures in `web/tests/fixtures/`.

1. **Which MediaMetadata key holds the book title vs. chapter** — settled, and
   every app is different (defaults in `web/lib/settings.ts`):
   - *Audible*: TITLE = book, AUTHOR = ALBUM = author, ARTIST = chapter name,
     MEDIA_ID = ASIN, DURATION = chapter length, a 62-item chapter queue with
     real names ("Part Two: The Present: Chapter 1"), position chapter-relative.
   - *Libby*: TITLE = ALBUM = DISPLAY_TITLE = book, ARTIST = author,
     DISPLAY_SUBTITLE = chapter name, DURATION = whole book, position absolute,
     no queue or chapter index; `titleId` is OverDrive's id.
   - *Libro.fm*: TITLE = ALBUM = book, ARTIST = author, one queue item per
     track all titled with the book (no chapter names), DURATION = track
     length, MEDIA_ID = track id, position track-relative.
2. **Libro.fm package name** — `fm.libro.librofm` was right.
3. **Hardcover GraphQL names** — settled against the live API on 2026-09-18.
   Every assumption held: `insert_user_book`, `update_user_book`,
   `insert_user_book_read` and `update_user_book_read` all exist with the
   argument names the sync uses, `DatesReadInput` really does take
   `progress_seconds` / `started_at` / `finished_at` / `edition_id`, and the
   status ids are 2 reading, 3 read, 5 did-not-finish. (`upsert_user_book_read`
   is documented but absent; we do not use it.) `HARDCOVER_DRY_RUN` stays true
   until the user is ready to let it write, not because anything is unverified.
4. **Position updates** — Libby and Libro.fm re-publish PlaybackState every
   2–3 s while playing; Spotify several times a second; Audible on state
   changes and skips (PAUSED→BUFFERING→PAUSED around each skip). The listener
   now treats BUFFERING as transparent and logs a same-state re-publish only
   when the position jumps by more than 3 s from where extrapolation predicts
   (a seek) or the speed changes. The 60 s sample while playing stays.

Both follow-ups from the capture are now done: the player's own id is stored
on the book and used as identity ahead of title+author, and the allow-list is
a list of switches in the app.

## Nice-to-have bucket

- Spotify audiobooks (needs music vs. audiobook discrimination on the Spotify session).
- Roll-your-own destination / richer stats (minutes per day, streaks, per-app split): all derivable from `sessions`.
- Google OAuth (swap `authenticate()`; add `users` rows).
- Push instead of poll (FCM or a self-hosted UnifiedPush distributor).
- Maestro/Espresso for the settings UI; Firebase Test Lab if a real device
  matrix is ever wanted; server contract tests against a local Supabase.

## Done since (2026-09-18, local session)

- **Automated build → test loop for the Android app** (was a nice-to-have):
  `android/fakeplayer/` publishes a scripted `MediaSession`, `tools/e2e.py`
  boots an emulator, installs both apps, runs scripted listens against a mock
  ingest server and asserts on the events; `EventBuilderTest` covers the
  event builder and outbox on-device. Same loop runs in CI (`android-emulator`
  job). See README → *Automated Android test loop*.
- Listener now re-syncs when the allow-list changes, so adding a package in
  Settings takes effect on already-open sessions. Buffering is transparent and
  a same-state re-publish only logs on a real seek or speed change, which
  stopped Spotify flooding the log several times a second.
- **Matching reworked after a real wrong match.** Replaying the phone capture
  through the live server auto-matched Libby's "The Body" (Bill Bryson) to
  Stephen King's novel: the book row is created before the author arrives, and
  a title-only score of 0.9 cleared the 0.85 auto threshold. Now a missing
  author is absence of evidence, nothing auto-accepts without agreement on
  both title and author unless an identifier matched exactly, ISBN and ASIN
  resolve an edition outright, and runtime agreement within 10% is a scoring
  signal. `identifier_matches` remembers what a confirmed match resolved an
  identifier to, which is what makes Audible work at all — Hardcover holds
  four regional ASINs for Yesteryear and none of them is the one Audible
  reports on this phone.
- **Deployed.** Supabase `hoftfafrwgxypyqhfjqe`, Vercel at
  `audiobook-scrobbler.vercel.app`, RLS on every table with no policies.
- **Fat Android client** (was a nice-to-have): four Compose screens in the web
  app's palette; prompts open in the app rather than the PWA.
