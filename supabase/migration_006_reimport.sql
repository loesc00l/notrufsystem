-- =========================================================================
--  Migration 006:  reimport_geraete_from_katalog
--  Re-Import aller Geräte aus geraete_katalog in ein bestehendes Protokoll.
--  Bestehende Geräte (gleiche Nr) bleiben unangetastet; nur fehlende Nr.
--  werden ergänzt. So kann nach einem versehentlichen Lösch-Klick der
--  Bestand wiederhergestellt werden, ohne ein neues Protokoll anzulegen.
-- =========================================================================

create or replace function public.reimport_geraete_from_katalog(p_protokoll uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  -- Nur erlauben, wenn der aufrufende User Owner des Protokolls ist
  if not exists (select 1 from protokolle p where p.id = p_protokoll and p.owner = auth.uid()) then
    raise exception 'Kein Zugriff auf dieses Protokoll';
  end if;

  with ins as (
    insert into geraete (protokoll_id, nr, zimmer, bett, geraetetyp, sonderfunktion, zbus_adresse, lon_id, sw_version)
    select p_protokoll, k.nr, k.zimmer, k.bett, k.geraetetyp, k.sonderfunktion, k.zbus_adresse, k.lon_id, k.sw_version
    from geraete_katalog k
    where not exists (
      select 1 from geraete g where g.protokoll_id = p_protokoll and g.nr = k.nr
    )
    returning 1
  )
  select count(*) into v_added from ins;

  return v_added;
end;
$$;

grant execute on function public.reimport_geraete_from_katalog(uuid) to authenticated;
