# Book tracking — MVP proposal

Sequel to `PLAN.md`. That document got a scrobbler built. This one asks what
else has to exist before the Goodreads account can be deleted, and says no to
most of it.

Outcome of the grilling session (2026-09-22). Questions put to the user and
settled are in *Decisions*; everything in *Cut* was considered and dropped on
purpose.

## The bar

**MVP = the Goodreads account can be deleted without losing anything.**

Not "has feature parity with Goodreads". Parity includes a social network, a
recommendation engine and a quote database, none of which are being built.
The bar is only: every piece of data currently living in Goodreads lives here
instead, and every routine thing done there can be done here.

That bar is met by seven things, and no others:

1. The Goodreads back catalogue is imported — ratings, reviews, shelves, dates.
2. The library is browsable, with want-to-read / reading / read / DNF.
3. A book can be added that no player has ever reported.
4. Books can be rated and reviewed.
5. A physical book can be started, progressed and finished by hand.
6. Audiobooks continue to track themselves.
7. "What did I read this year" answers correctly, against a yearly goal.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 18 | Source of truth for library data | **Ours.** Supabase owns status, rating, review, shelves and dates. Hardcover stays the catalogue (search, covers, runtimes, ids) and a write-only mirror. Put to the user against Hardcover-as-backend; they chose ownership and no lock-in, consistent with decision 1. |
| 19 | Sync direction | **Still one-way.** Decision 12 survives intact — owning the data is what saves us from reading Hardcover back and inventing a conflict-resolution story. Nothing in this proposal reads user state from Hardcover. |
| 20 | Social | **Out, permanently.** Not selected as something to preserve. This is the decision that makes 18 affordable: the one thing a personal database genuinely cannot replace is other people, and the user does not want them. |
| 21 | Formats | Audio is first class; print and ebook are real but manual. Split is roughly 85 / 10 / 5. |
| 22 | Manual parity | **A principle, not a feature:** anything the scrobbler does automatically must be doable by hand. Drives the schema more than any single feature does. |
| 23 | Ebook scraping | **Backlog**, explicitly. Interesting, not MVP. Manual entry covers the 5%. |
| 24 | Goodreads import | **We build it**, reusing the existing matcher, rather than running Hardcover's importer. Follows from 18: the data has to land in our tables. |
| 25 | Where the library UI lives | **Both, at parity. The native Android app is the primary surface.** Not a PWA — a full Android app is wanted for reasons beyond this project, and that is a decision to live with. The web UI is not a fallback or an admin console; it is the same product on a bigger screen. |
| 26 | How parity is afforded | **Both clients stay thin.** No business logic in either; every screen is backed by a JSON endpoint returning render-ready data. Already proven here — decision 11 records that the fat Android client "was indeed UI work only, since every route was already JSON with no web-only assumptions". That property is now load-bearing and must not be eroded. |
| 27 | How parity is kept | **Definition of done, not a phase.** A phase is finished when both clients ship it. A "web catches up later" phase would never be scheduled, and the web UI would drift into the debug console it is today. |
| 28 | Offline library writes | **Reuse the outbox.** Ratings, status changes and progress marks queue in the existing SQLite outbox and drain through `UploadWorker`, exactly as events do. Single user on a single device means no conflict story is needed — last write wins, and that is correct. |

### What decision 18 costs, stated once

Choosing to own the data buys no lock-in and full control, and it costs:

- **Every catalogue problem is ours forever.** Matching, covers, runtimes,
  editions, series, an author whose name is spelled three ways. The matcher
  already carries this weight for audiobooks; import points it at the whole
  back catalogue at once.
- **Ratings and reviews are written twice** — once here, once mirrored — and
  the mirror can fail silently. Acceptable because it is one-way.
- **No social, ever**, without building it. Accepted under decision 20.

This was the user's call after the alternative was argued. It is not revisited
below.

### What decision 25 costs, stated once

Two clients at parity is the single largest cost in this proposal — larger
than the import, larger than the schema split. Every library feature is built
twice, in Compose and in React, by one person.

What makes it survivable is that **this codebase has already done it once**.
The fat Android client landed as pure UI work because every route was already
returning JSON with no web-only assumptions, and `GET /api/dashboard` already
ships a book's whole detail screen in one round trip specifically so the phone
does not need a second. Decision 26 is not a new discipline; it is a promise
not to break an existing one.

Two consequences worth naming:

- **The API is designed first, every phase.** Not the Android screen with an
  endpoint retrofitted to it. If a screen needs logic the endpoint does not
  provide, the endpoint is wrong.
- **One carve-out from parity: the Goodreads import is web-only.** It is a
  one-time migration tool, not a feature of the tracker — a CSV file picked
  from a filesystem and a keyboard-driven review table. Building that twice
  would be spending the parity budget on the one screen guaranteed never to be
  opened again. Parity means the *product* is at parity, not every route.

## The shape

```
player events ─┐
manual entry  ─┼→ Supabase (source of truth) ──one-way──→ Hardcover (mirror)
Goodreads CSV ─┘         ↑
                         └── Hardcover GraphQL (catalogue: search, ids, runtimes)
```

Hardcover appears twice and the two roles must not be confused. As a
**catalogue** it is read constantly and is nothing but a metadata provider —
replaceable by Open Library, as the fallback already proves. As a **mirror**
it is written and never read. There is no third role.

## Schema

Three moves. The first is the only one that is architecture; the rest is
columns.

### 1. `books` is two tables pretending to be one

Today `books` is keyed `unique (user_id, source_key)` and carries
`source_app`, `source_title`, `source_author`. That is **a row per player, not
a row per book**. It has been fine because every row arrived from a player.
It breaks the moment it does not:

- The same book heard on Libby and later on Audible is two rows, two reads,
  two entries in the library, and a re-read that does not know it is one.
- An imported Goodreads book has no `source_app` and no honest `source_key`.
- A physical book has no player at all.

Split it, keeping `books.id` stable so nothing downstream moves:

```sql
-- new: the player-scoped identity that books currently holds
create table book_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  book_id uuid not null references books(id) on delete cascade,
  source_app text not null,
  source_title text not null,
  source_author text,
  source_key text not null,
  external_id text,
  external_id_kind text check (external_id_kind in ('asin','isbn13','overdrive')),
  first_seen_at timestamptz not null default now(),
  unique (user_id, source_key)
);
-- then: copy those five columns across, and drop them from books
```

`books` keeps `id`, `title`, `author`, the `hardcover_*` and `isbn13` fields,
`runtime_seconds`, `cover_url` and the match columns, and becomes the library
entity — the thing that gets shelved, rated and reviewed. Because `books.id`
does not change, `reads`, `events`, `chapters` and `actions` keep their
foreign keys and no data moves.

Ingest changes from "find or create a book by `source_key`" to "find or create
a **source** by `source_key`, then attach it to a book". Matching moves up to
the book. `identifier_matches` is unaffected — it is already keyed by
identifier, not by row.

This is the migration to do first and to do while the dataset is still small
enough to throw away.

### 2. Library columns

```sql
alter table books
  add column status text not null default 'none'
    check (status in ('none','want_to_read','reading','read','dnf','paused')),
  add column rating numeric(2,1) check (rating >= 0.5 and rating <= 5),
  add column review text,
  add column reviewed_at timestamptz,
  add column want_to_read_at timestamptz,
  add column page_count integer,
  add column origin text not null default 'player'
    check (origin in ('player','manual','import'));

create table shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null, slug text not null, sort integer not null default 0,
  unique (user_id, slug)
);
create table shelf_books (
  shelf_id uuid references shelves(id) on delete cascade,
  book_id uuid references books(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (shelf_id, book_id)
);

create table goals (
  user_id uuid not null references users(id),
  year integer not null, target_books integer not null,
  primary key (user_id, year)
);
```

`books.status` is maintained, not manual-only: a book with an open read is
`reading`, otherwise it takes its latest read's outcome, and `want_to_read` is
the one value only a human sets. Ratings are `0.5`–`5` in half steps to match
Hardcover's scale, so the mirror needs no conversion.

### 3. Progress marks — the manual-parity primitive

Rather than bolt a `page_position` column onto `reads` that recompute would
immediately fight over, make manual progress a first-class observation:

```sql
create table progress_marks (
  id uuid primary key default gen_random_uuid(),
  read_id uuid not null references reads(id) on delete cascade,
  at timestamptz not null,
  unit text not null check (unit in ('seconds','pages','percent')),
  value numeric not null,
  origin text not null default 'manual' check (origin in ('manual','import')),
  note text
);
```

One table buys all of:

- "I'm on page 142" for a print book.
- "I got to chapter 9" for an audiobook listened to with the phone off — a
  manual mark newer than the last event simply wins.
- Percent for an ebook, which is the only thing an ebook reader reports.
- A future Kindle scraper writes marks with `origin = 'kindle'` and needs no
  new progress code at all.

`computeProgress` grows one branch: a mark newer than `lastPositionEvent`
takes precedence, with `basis` of `pages` / `percent` / `manual`. Books with
no events at all go down this path exclusively, which is how a physical book
gets a progress bar.

`reads` also gains `format text check (format in ('audio','print','ebook'))`
and `origin text check (origin in ('events','manual','import'))`.

## The recompute boundary

Right now the invariant is "everything except `events` is derived, and
*Reprocess from events* rebuilds it". That invariant is about to become false,
and three places in the code will destroy hand-entered data on the next
reprocess. These are not hypothetical — they are the current behaviour of
[lib/admin.ts](projects/audiobook-scrobbler/web/lib/admin.ts) and
[lib/ingest.ts](projects/audiobook-scrobbler/web/lib/ingest.ts):

| Where | What it does today | What it destroys |
|---|---|---|
| [admin.ts:23](projects/audiobook-scrobbler/web/lib/admin.ts#L23) | `delete from reads where user_id = …` | Every imported Goodreads read and every manual print read. |
| [ingest.ts](projects/audiobook-scrobbler/web/lib/ingest.ts) `recomputeRead` | `delete from sessions where read_id = …`, then re-inserts from events | Every hand-logged session. |
| `prune_orphan_books` | deletes books with no events | **Every imported book**, since none of them will ever have an event. |

The new invariant, and it needs writing down somewhere the other session will
see it:

> Derived state is rebuilt from events. **User-authored state is never touched
> by a rebuild.** User-authored means: status, rating, review, shelves,
> progress marks, manual and imported reads and sessions, and confirmed
> matches.

Mechanically that is: reprocess deletes only `reads` with `origin = 'events'`;
`recomputeRead` deletes only `sessions` with `origin = 'derived'`;
`prune_orphan_books` prunes only `books` with `origin = 'player'`. Three
`where` clauses, and getting them wrong means silently eating the import.

One more: `recomputeRead` returns early when a read has no events, so a manual
read would never get its progress computed. That early return has to become a
check for "no events *and* no marks".

## Phases

Ordered so that each one is independently useful, and each ends with both
clients shipping it (decision 27).

An earlier draft opened with "flip `HARDCOVER_DRY_RUN` before anything else".
That was over-cautious: phases 1 to 3 write only to our own database and do
not touch the mirror at all. The flip is a gate on phase 4 and nothing
earlier, which leaves the parallel bug work room to finish first.

### Phase 1 — the schema split

`books` → `books` + `book_sources`, ingest rewritten to match, recompute
boundary enforced with the three `where` clauses. No user-visible change
whatsoever, which is exactly why it is tempting to skip and exactly why it
must come first — every later phase writes rows that this migration would
otherwise have to move.

### Phase 2 — the library

Status, rating, review, shelves. Add-a-book by Hardcover search (the search
endpoint exists; it needs a create-a-book sibling to
[/api/books/[id]/search](projects/audiobook-scrobbler/web/app/api/books/[id]/search/route.ts)).
Manual reads with formats, manual progress marks, editable start and finish
dates. A library view that is not the current debug console.

Shipped on both clients, with library writes queued through the outbox per
decision 28. This is the phase where the parity cost is actually paid, and it
is roughly half the total MVP effort.

At the end of this phase the thing is a book tracker. Everything after is
migration and reporting.

### Phase 3 — Goodreads import

CSV upload → one `books` row per line with `origin = 'import'`, status from
*Exclusive Shelf*, rating, review, custom shelves from *Bookshelves*, and a
synthetic finished read carrying *Date Read*.

Matching runs in three tiers: ISBN13 exact (most of the library, essentially
free), then the existing scorer at the auto threshold, then everything else to
review.

At a couple of hundred books this is a small phase. ISBN13 will resolve most
of the library outright, the scorer takes another slice, and what reaches
review is plausibly a few dozen rows — a form, not a product. The earlier
draft budgeted heavily for a bulk-review tool on the assumption of a
four-figure library; that budget is released.

Still worth a dedicated screen rather than the existing action queue, which
is built for the occasional ambiguous audiobook arriving alone: a table of
unmatched imports with the top candidate pre-selected and confirmable from
the keyboard. Web-only, per the carve-out above. One sitting's work.

Known lossy spots, all acceptable: *Read Count* > 1 becomes one read, because
Goodreads only keeps the last date; many read books have no *Date Read* at
all, so `finished_at` stays null on a finished read.

### Phase 4 — stats, then the mirror

"Books read in ${year}" against `goals`, finished-by-year, hours listened by
month. One screen, both clients.

Then, and only once `HARDCOVER_DRY_RUN` is `false` and one real read has been
watched landing: extend the mirror to push rating, review and want-to-read
status alongside the reads it already writes. Building the ratings mirror
against a write path that has never written would mean debugging two unproven
things at once.

## Cut

Considered, deliberately not in the MVP:

- **Ebook / Kindle scraping.** Decision 23. A project the size of the
  audiobook work; `progress_marks` is designed so it slots in later for free.
- **Anything social.** Decision 20.
- **Recommendations.** Follows from cutting social; there is nothing to
  recommend from.
- **Series tracking, owned copies, lending, re-read histories beyond a flat
  list, tags separate from shelves, quotes, highlights, notes.**
- **Rich stats** — streaks, heatmaps, per-app splits, pace projections, "books
  per week". All derivable from `sessions` whenever they are wanted, which is
  the argument for not building them now.
- **Shelf mirroring to Hardcover lists.** The `lists` / `list_books` mutations
  are unverified and shelves are the least valuable thing to duplicate.
- **Multi-user and OAuth.** Decision 14 stands untouched.
- **Reading a library back from Hardcover.** Decision 19.

## Needs verifying

- ~~**`UserBookUpdateInput` accepting `rating` and `review`.**~~ **Settled
  2026-09-22, and half of it was wrong.** `rating` exists and is `numeric`, so
  the 0.5–5 half-step scale needs no conversion. **There is no `review`
  field.** The review is `review_markdown` (String), alongside `review_slate`
  (jsonb), `review_has_spoilers` (Boolean) and `reviewed_at` (date). Phase 4
  would have failed on the field name. `UserBookCreateInput` takes the same
  set, so a rating can be sent on the first write rather than needing a
  follow-up update.
- ~~**Status id 1 for want-to-read.**~~ **Settled 2026-09-22: yes.** All six
  ids confirmed against the live API — 1 Want to Read, 2 Currently Reading,
  3 Read, 4 Paused, 5 Did Not Finish, 6 Ignored. `STATUS` in
  [lib/hardcover.ts](projects/audiobook-scrobbler/web/lib/hardcover.ts) is
  correct as declared.
  The reason this went unconfirmed is worth keeping: the probe route asked
  `statuses`, which Hardcover refuses for API tokens outright
  (`Not available to API tokens: statuses`), and the route recorded that
  refusal as an error rather than a wrong question. The readable table is
  `user_book_statuses`, which `scripts/hardcover-probe.mjs` was already using.
  The route now agrees with the script.
- **Goodreads export still being available**, and its column set. It has been
  removed and restored before now.
- **Back catalogue size: a couple of hundred books.** Settled, and it is what
  shrinks phase 3.
- **Whether the outbox generalises cleanly.** It currently carries append-only
  events; library writes are updates to a row. If a generic queued-mutation
  shape turns out to be invasive, the fallback is online-only writes with a
  retry toast, and decision 28 downgrades to backlog.

## Coordination

Another session is mid-flight in this tree, with uncommitted work in
`lib/finish.ts`, `lib/ingest.ts`, `lib/progress.ts`, `lib/types.ts`,
`tests/progress.test.ts` and migration `0006`. Phase 1 rewrites `ingest.ts`
and phase 2 touches `progress.ts`. That work should land and be committed
before phase 1 starts; taking the schema split into a branch alongside it
would mean resolving the same conflict twice.

That same work is why `HARDCOVER_DRY_RUN` stays `true` for now, which is fine
— nothing before phase 4 depends on it.
