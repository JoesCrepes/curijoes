-- Adds the 'position' progress basis (player-reported absolute position over a
-- book-wide duration, which is how Libby reports). No-op if 0001 was applied
-- after 2026-09-18, when the same value was added to the initial migration.
alter table reads drop constraint if exists reads_progress_basis_check;
alter table reads add constraint reads_progress_basis_check
  check (progress_basis in ('none','chapters','position','cumulative','app'));
