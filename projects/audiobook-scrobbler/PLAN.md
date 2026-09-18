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
| 4 | Book identity | Every unique (title, author) gets a UUID (`books.id`); matched to a Hardcover book/edition (ISBN, runtime); ambiguous matches go to a review queue surfaced as a phone notification and on the web. |
| 5 | Server | **Next.js API routes on Vercel + Supabase**, same as `spotify-shared-taste` and `commute-estimator`. |
| 6 | Spotify audiobooks | **Out of v1.** Nice-to-have. |
| 7 | Progress | **Both**: raw chapter index + in-chapter position is always stored; percent is derived from the chapter map when the prefix is known, else from cumulative listened seconds ÷ runtime. Recomputable at any time. Runtime comes from the matched Hardcover audiobook edition. Chapter map is learned from the player's queue and observed per-chapter durations. |
| 8 | Sessions | Gap of **10 min** (setting `session_gap_seconds`) ends a session. Both wall-clock seconds and book-seconds tracked; playback speed (user is usually at 2x / 1.7x) is captured and used when position deltas are unavailable. |
| 9 | Finished | **Auto** at ≥ 98% (`finish_threshold`) on chapter-basis progress, on the app reporting completion, or cumulative-basis while on the last chapter. **Stall prompt**: a book at ≥ 90% (`stall_threshold`) with no session for 24 h (`stall_hours`) gets a Finished / Not yet / DNF notification. Ignored prompts auto-finish after 14 days (`stall_auto_finish_days`, 0 disables). |
| 10 | ISBN / metadata lookup | Hardcover search first (gives the ids we write to plus audiobook edition runtime), Open Library fallback. |
| 11 | Client split | **Thin Android app + PWA** now. All server logic is behind JSON APIs with no web-only assumptions, so a fat Android client later is UI work only. |
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

These could not be verified from the sandbox and are the first things to check:

1. **Which MediaMetadata key holds the book title vs. chapter** for Audible,
   Libro.fm and Libby. The server's `app_field_maps` setting defaults to
   album→title, artist→author, display-title→chapter. Look at *Raw events* on
   the home page after the first listen, fix the map in Settings, hit
   *Reprocess from events*.
2. **Libro.fm package name** (`fm.libro.librofm` is a guess). The app's
   Settings screen lists every active media session's package; add the right
   one to `allowed_apps` on the server.
3. **Hardcover GraphQL names** (`insert_user_book`, `insert_user_book_read`,
   status ids 2/3/5, `reading_format_id = 2` for audio). `GET /api/hardcover/probe`
   introspects and reports. Keep `HARDCOVER_DRY_RUN=true` until it's green.
4. Whether the players expose `PlaybackState.position` continuously or only on
   state change (the app samples every 60 s while playing either way).

## Nice-to-have bucket

- Spotify audiobooks (needs music vs. audiobook discrimination on the Spotify session).
- Roll-your-own destination / richer stats (minutes per day, streaks, per-app split): all derivable from `sessions`.
- Fat Android client.
- Google OAuth (swap `authenticate()`; add `users` rows).
- **Automated plan → implement → test loop for the mobile app.** The usual
  mobile answer: instrumented tests on a GitHub Actions emulator
  (`reactivecircus/android-emulator-runner`) plus a tiny *fake player* app
  that publishes a scripted `MediaSession` so the listener can be tested
  end-to-end without Audible; Maestro or Espresso for UI flows; Firebase Test
  Lab if a real device matrix is ever wanted. The server side already has
  pure-function tests for sessions/progress/finish and can grow contract
  tests against a local Supabase.
- Push instead of poll (FCM or a self-hosted UnifiedPush distributor).
