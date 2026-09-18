-- Audiobook scrobbler schema. Events are the source of truth; books, reads,
-- chapters and sessions are derived and can be rebuilt from events.
create extension if not exists pgcrypto;

-- Single-user for now. Every table carries user_id so Google OAuth later is
-- an auth swap, not a schema change.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
insert into users (id, email) values ('00000000-0000-0000-0000-000000000001', null);

create table settings (
  user_id uuid not null references users(id),
  key text not null,
  value jsonb not null,
  primary key (user_id, key)
);

create table devices (
  id uuid primary key,
  user_id uuid not null references users(id),
  name text,
  last_seen_at timestamptz
);

-- One row per (app, title, author) as seen on the phone. source_key is the
-- normalized identity; hardcover_* is the match.
create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  source_app text not null,
  source_title text not null,
  source_author text,
  source_key text not null,
  title text not null,
  author text,
  hardcover_book_id integer,
  hardcover_edition_id integer,
  isbn13 text,
  runtime_seconds integer,
  cover_url text,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','auto','confirmed','needs_review','no_match')),
  match_candidates jsonb,
  match_score real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_key)
);

-- Chapter map learned from the player's queue and per-chapter durations.
create table chapters (
  book_id uuid not null references books(id) on delete cascade,
  idx integer not null,
  title text,
  duration_ms bigint,
  primary key (book_id, idx)
);

create table reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  book_id uuid not null references books(id) on delete cascade,
  status text not null default 'reading' check (status in ('reading','finished','dnf')),
  started_at timestamptz not null,
  finished_at timestamptz,
  last_activity_at timestamptz not null,
  chapter_idx integer,
  chapter_position_ms bigint,
  book_position_ms bigint,
  book_seconds_listened integer not null default 0,
  wall_seconds_listened integer not null default 0,
  progress_pct real,
  progress_basis text not null default 'none'
    check (progress_basis in ('none','chapters','cumulative','app')),
  finish_source text check (finish_source in ('auto','manual','timeout','app')),
  hardcover_user_book_id integer,
  hardcover_read_id integer,
  hardcover_dirty boolean not null default true,
  hardcover_synced_at timestamptz,
  hardcover_error text
);
create index reads_book_status on reads(book_id, status);

create table events (
  id uuid primary key,                      -- client-generated, dedupes retries
  user_id uuid not null references users(id),
  device_id uuid references devices(id),
  book_id uuid references books(id) on delete set null,
  read_id uuid references reads(id) on delete set null,
  app_package text not null,
  event_type text not null check (event_type in ('play','pause','stop','metadata','position','queue','complete')),
  occurred_at timestamptz not null,
  is_playing boolean not null default false,
  position_ms bigint,
  duration_ms bigint,
  playback_speed real,
  chapter_title text,
  chapter_idx integer,
  chapter_count integer,
  raw jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index events_read_time on events(read_id, occurred_at);
create index events_book_time on events(book_id, occurred_at);
create index events_time on events(user_id, occurred_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  read_id uuid not null references reads(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  wall_seconds integer not null,
  book_seconds integer not null,
  start_chapter_idx integer,
  end_chapter_idx integer,
  start_position_ms bigint,
  end_position_ms bigint,
  event_count integer not null,
  unique (read_id, started_at)
);

-- Things the phone should show a notification for.
create table actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null check (type in ('match_book','confirm_finished')),
  book_id uuid references books(id) on delete cascade,
  read_id uuid references reads(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution jsonb
);
create index actions_pending on actions(user_id, status) where status = 'pending';

create table hardcover_sync_log (
  id bigserial primary key,
  read_id uuid references reads(id) on delete cascade,
  op text not null,
  request jsonb,
  response jsonb,
  ok boolean not null,
  created_at timestamptz not null default now()
);

-- Used by the reprocess admin action.
create or replace function prune_orphan_books(p_user_id uuid) returns integer language plpgsql as $$
declare n integer;
begin
  with gone as (
    delete from books b where b.user_id = p_user_id
      and not exists (select 1 from events e where e.book_id = b.id)
    returning 1
  ) select count(*) into n from gone;
  return n;
end $$;
