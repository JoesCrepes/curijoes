-- Records whether a read's last Hardcover sync actually wrote anything.
-- Without it the UI could only say "no error", which reads as "synced fine"
-- when the truth may be that nothing has ever been sent. Null means no sync
-- has been attempted at all.
alter table reads add column if not exists hardcover_last_mode text
  check (hardcover_last_mode in ('dry_run', 'live'));

-- Everything synced so far ran under HARDCOVER_DRY_RUN=true.
update reads set hardcover_last_mode = 'dry_run' where hardcover_synced_at is not null;
