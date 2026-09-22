-- Adds the 'chapters_estimated' progress basis: a chapter-map prefix where the
-- chapters we have never seen played are filled from the runtime the known
-- chapters do not account for. A book started before this app was watching has
-- holes in its map, and the cumulative fallback could only ever describe what
-- we recorded -- Guards! Guards! reported 23% while genuinely at track 95 of 121.
alter table reads drop constraint if exists reads_progress_basis_check;
alter table reads add constraint reads_progress_basis_check
  check (progress_basis in ('none','chapters','chapters_estimated','position','cumulative','app'));
