-- =========================================================================
--  Migration 003:  anzeige -> (zimmer, bett) sauber splitten
--  - neue Spalte "zimmer"
--  - Daten aus "anzeige" zerlegen, "bett" bereinigen (':A' -> 'A')
--  - alte Spalte "anzeige" wird entfernt
--  - die Hilfsfunktion create_protokoll_with_devices wird neu erstellt
--
--  Im Supabase SQL Editor in einem Rutsch ausführen.
-- =========================================================================

begin;

-- ---------- 1. neue Spalten anlegen --------------------------------------
alter table public.geraete         add column if not exists zimmer text;
alter table public.geraete_katalog add column if not exists zimmer text;
alter table public.maengel         add column if not exists zimmer text;

-- ---------- 2. Daten migrieren -------------------------------------------
-- Hilfslogik:
--   anzeige enthält ':'  -> zimmer = vor ':', bett = nach ':'
--   anzeige ohne ':'     -> zimmer = anzeige, bett bleibt
-- bett-Bereinigung: führender ':' raus, '–' (em-dash) auf NULL

update public.geraete set
  zimmer = case
             when anzeige is null then null
             when position(':' in anzeige) > 0 then split_part(anzeige, ':', 1)
             else anzeige
           end,
  bett = case
           when bett is null then null
           when bett = '–' then null
           when bett like ':%' then substring(bett from 2)
           when anzeige like '%:%' and (bett is null or bett = '') then split_part(anzeige, ':', 2)
           else bett
         end;

update public.geraete_katalog set
  zimmer = case
             when anzeige is null then null
             when position(':' in anzeige) > 0 then split_part(anzeige, ':', 1)
             else anzeige
           end,
  bett = case
           when bett is null then null
           when bett = '–' then null
           when bett like ':%' then substring(bett from 2)
           when anzeige like '%:%' and (bett is null or bett = '') then split_part(anzeige, ':', 2)
           else bett
         end;

update public.maengel set
  zimmer = case
             when anzeige is null then null
             when position(':' in anzeige) > 0 then split_part(anzeige, ':', 1)
             else anzeige
           end,
  bett = case
           when bett is null then null
           when bett = '–' then null
           when bett like ':%' then substring(bett from 2)
           when anzeige like '%:%' and (bett is null or bett = '') then split_part(anzeige, ':', 2)
           else bett
         end;

-- ---------- 3. alte anzeige-Spalte entfernen -----------------------------
alter table public.geraete         drop column if exists anzeige;
alter table public.geraete_katalog drop column if exists anzeige;
alter table public.maengel         drop column if exists anzeige;

-- ---------- 4. Hilfsfunktion neu definieren ------------------------------
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

  insert into geraete (protokoll_id, nr, zimmer, bett, geraetetyp, sonderfunktion, zbus_adresse, lon_id, sw_version)
  select new_id, nr, zimmer, bett, geraetetyp, sonderfunktion, zbus_adresse, lon_id, sw_version
  from geraete_katalog
  order by nr;

  return new_id;
end;
$$;

grant execute on function public.create_protokoll_with_devices(text,text,text) to authenticated;

commit;

-- ---------- 5. Stichprobe (optional: zum Prüfen einkommentieren) ---------
-- select nr, zimmer, bett, geraetetyp from public.geraete_katalog order by nr limit 20;
