-- The player's own catalog id for a book: Audible's ASIN (MEDIA_ID), Libro.fm's
-- ISBN-13 (from the cover URL), Libby's OverDrive titleId. Two jobs:
--   1. identity that survives title drift, so a confirmed match keeps cascading
--      even if the player later reports a slightly different title string;
--   2. an exact Hardcover lookup (editions.asin / editions.isbn_13) that skips
--      fuzzy scoring entirely.
alter table books add column external_id text;
alter table books add column external_id_kind text
  check (external_id_kind in ('asin', 'isbn13', 'overdrive'));

-- One book per identifier per user. Partial so the many null rows don't collide.
create unique index books_external_id on books (user_id, external_id_kind, external_id)
  where external_id is not null;

-- Remembers what a confirmed match resolved an identifier to, so the same
-- identifier matches instantly next time even when Hardcover's catalog does
-- not carry it (Audible regional ASINs are routinely missing).
create table identifier_matches (
  user_id uuid not null references users(id),
  kind text not null check (kind in ('asin', 'isbn13', 'overdrive')),
  value text not null,
  hardcover_book_id integer not null,
  hardcover_edition_id integer,
  runtime_seconds integer,
  isbn13 text,
  cover_url text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, value)
);
alter table identifier_matches enable row level security;
