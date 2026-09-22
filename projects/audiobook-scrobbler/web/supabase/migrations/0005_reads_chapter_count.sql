-- The highest chapter count the player has reported for this read, so a client
-- can say "Chapter 3 of 62" without counting the chapters table itself.
-- Already computed during every recompute; this just keeps it.
alter table reads add column chapter_count integer;
