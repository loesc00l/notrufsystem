-- =========================================================================
--  Migration 005:  geraete_history
--  Speichert eine Kopie aller bereits geprüften Geräte, bevor die
--  Testdaten in geraete zurückgesetzt werden ("Neue Prüfung starten").
--  Mehrere Geräte einer Prüfungsrunde teilen sich eine batch_id (uuid).
-- =========================================================================

begin;

create table if not exists public.geraete_history (
  id bigserial primary key,
  protokoll_id uuid not null references public.protokolle(id) on delete cascade,
  geraet_id bigint,                              -- nicht FK: Gerät könnte später gelöscht werden
  batch_id  uuid not null,                       -- gruppiert alle Geräte einer Prüfungsrunde
  archived_at timestamptz not null default now(),
  archived_by uuid default auth.uid(),

  nr integer,
  raumname text,
  zimmer text,
  bett text,
  geraetetyp text,

  sichtpruefung text,
  befestigung text,
  rufausloesung text,
  akust_signal text,
  opt_anzeige text,
  weiterleitung text,
  quittierung text,
  notstrom text,

  gesamt_ergebnis text,
  bemerkung text,
  geprueft_von text,
  geprueft_am timestamptz
);

create index if not exists geraete_history_protokoll_idx on public.geraete_history(protokoll_id);
create index if not exists geraete_history_batch_idx     on public.geraete_history(batch_id);
create index if not exists geraete_history_geraet_idx    on public.geraete_history(geraet_id);

alter table public.geraete_history enable row level security;

drop policy if exists "geraete_history_by_owner" on public.geraete_history;
create policy "geraete_history_by_owner" on public.geraete_history
  for all
  using (exists (select 1 from public.protokolle p where p.id = geraete_history.protokoll_id and p.owner = auth.uid()))
  with check (exists (select 1 from public.protokolle p where p.id = geraete_history.protokoll_id and p.owner = auth.uid()));

commit;
