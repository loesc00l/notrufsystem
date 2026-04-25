-- =========================================================================
--  Migration 002: Archivierung von Protokollen
--  Im Supabase SQL Editor ausführen.
-- =========================================================================

alter table public.protokolle
  add column if not exists archived_at timestamptz;

create index if not exists protokolle_archived_idx on public.protokolle(archived_at);
