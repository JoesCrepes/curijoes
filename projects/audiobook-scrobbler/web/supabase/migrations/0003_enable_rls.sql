-- Every table lives in the `public` schema, which Supabase exposes over
-- PostgREST to anyone holding the anon key (a public value by design).
-- The app only ever talks to the database server-side with the service role
-- key, which bypasses RLS. So: enable RLS everywhere and define no policies.
-- Result: anon and authenticated get nothing, the server keeps full access.
--
-- The "RLS Enabled No Policy" advisory this produces is expected and is the
-- desired state until there is a real per-user auth story (decision 14).
alter table users enable row level security;
alter table settings enable row level security;
alter table devices enable row level security;
alter table books enable row level security;
alter table chapters enable row level security;
alter table reads enable row level security;
alter table events enable row level security;
alter table sessions enable row level security;
alter table actions enable row level security;
alter table hardcover_sync_log enable row level security;

-- prune_orphan_books is called with the service role key only; pin its
-- search_path so it cannot be influenced by a caller-supplied one.
alter function prune_orphan_books(uuid) set search_path = public, pg_temp;
