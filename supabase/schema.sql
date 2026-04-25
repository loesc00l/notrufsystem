-- =========================================================================
--  Notrufsystem - Prüfprotokoll nach DIN VDE 0834
--  Supabase Postgres Schema
-- =========================================================================
--  Führen Sie diese Datei einmal in Supabase SQL Editor aus.
-- =========================================================================

-- ---------- PROTOKOLLE (Deckblatt / Stammdaten) -------------------------
create table if not exists public.protokolle (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,

  krankenhaus text,
  station text,
  anlage text,
  verantwortlicher text,
  pruefdatum_von date,
  pruefdatum_bis date,
  pruefer text,
  qualifikation text,
  auftrag_nr text,
  naechste_pruefung date,
  bemerkung text,
  archived_at timestamptz
);

-- ---------- GERÄTE (Anlagenbestand / Prüfliste) -------------------------
create table if not exists public.geraete (
  id bigserial primary key,
  protokoll_id uuid not null references public.protokolle(id) on delete cascade,
  nr integer not null,
  raumname text,
  anzeige text,
  bett text,
  geraetetyp text,
  sonderfunktion text,
  zbus_adresse text,
  lon_id text,
  sw_version text,

  -- Prüfkriterien: 'OK' | 'NOK' | 'NA' | null
  sichtpruefung text,
  befestigung text,
  rufausloesung text,
  akust_signal text,
  opt_anzeige text,
  weiterleitung text,
  quittierung text,
  notstrom text,

  gesamt_ergebnis text,           -- OK / NOK / NA
  bemerkung text,
  geprueft_von text,
  geprueft_am date,

  unique(protokoll_id, nr)
);

create index if not exists geraete_protokoll_idx on public.geraete(protokoll_id);

-- ---------- MÄNGELLISTE -------------------------------------------------
create table if not exists public.maengel (
  id bigserial primary key,
  protokoll_id uuid not null references public.protokolle(id) on delete cascade,
  geraet_id bigint references public.geraete(id) on delete set null,
  nr integer,
  raumname text,
  anzeige text,
  bett text,
  geraetetyp text,
  pruefdatum date,
  mangelbeschreibung text,
  sofortmassnahme text,
  prioritaet text,        -- H / M / N
  verantwortlich text,
  erledigt_am date,
  created_at timestamptz not null default now()
);

create index if not exists maengel_protokoll_idx on public.maengel(protokoll_id);

-- ---------- KATALOG: Stamm-Ger\u00e4teliste (für Import neuer Protokolle) ----
create table if not exists public.geraete_katalog (
  nr integer primary key,
  anzeige text,
  bett text,
  geraetetyp text,
  sonderfunktion text,
  zbus_adresse text,
  lon_id text,
  sw_version text
);

-- =========================================================================
--  ROW-LEVEL SECURITY
-- =========================================================================
alter table public.protokolle    enable row level security;
alter table public.geraete       enable row level security;
alter table public.maengel       enable row level security;
alter table public.geraete_katalog enable row level security;

-- Katalog: jeder angemeldete Nutzer darf lesen, niemand schreiben (nur via SQL/Service Role)
drop policy if exists "katalog_read_authenticated" on public.geraete_katalog;
create policy "katalog_read_authenticated" on public.geraete_katalog
  for select using (auth.role() = 'authenticated');

-- Protokolle: Besitzer darf alles, andere nichts
drop policy if exists "prot_owner_all" on public.protokolle;
create policy "prot_owner_all" on public.protokolle
  for all
  using  (owner = auth.uid())
  with check (owner = auth.uid());

-- Geräte: Zugriff wenn Protokoll dem User gehört
drop policy if exists "geraete_by_owner" on public.geraete;
create policy "geraete_by_owner" on public.geraete
  for all
  using (exists (select 1 from public.protokolle p where p.id = geraete.protokoll_id and p.owner = auth.uid()))
  with check (exists (select 1 from public.protokolle p where p.id = geraete.protokoll_id and p.owner = auth.uid()));

-- Mängel: analog
drop policy if exists "maengel_by_owner" on public.maengel;
create policy "maengel_by_owner" on public.maengel
  for all
  using (exists (select 1 from public.protokolle p where p.id = maengel.protokoll_id and p.owner = auth.uid()))
  with check (exists (select 1 from public.protokolle p where p.id = maengel.protokoll_id and p.owner = auth.uid()));

-- =========================================================================
--  HILFSFUNKTION: Neues Protokoll mit Geräte-Import aus Katalog anlegen
-- =========================================================================
create or replace function public.create_protokoll_with_devices(
  p_krankenhaus text,
  p_station     text,
  p_anlage      text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into protokolle (krankenhaus, station, anlage, owner)
  values (p_krankenhaus, p_station, p_anlage, auth.uid())
  returning id into new_id;

  insert into geraete (protokoll_id, nr, anzeige, bett, geraetetyp, sonderfunktion, zbus_adresse, lon_id, sw_version)
  select new_id, nr, anzeige, bett, geraetetyp, sonderfunktion, zbus_adresse, lon_id, sw_version
  from geraete_katalog
  order by nr;

  return new_id;
end;
$$;

grant execute on function public.create_protokoll_with_devices(text,text,text) to authenticated;
