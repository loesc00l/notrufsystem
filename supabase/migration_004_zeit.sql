-- =========================================================================
--  Migration 004:  geprueft_am  date  ->  timestamptz
--  Damit beim Klick auf OK/NOK/NA Datum + Uhrzeit gespeichert werden.
--  Bestehende Datums-Werte werden zu Mitternacht des jeweiligen Tages.
-- =========================================================================

begin;

alter table public.geraete
  alter column geprueft_am type timestamptz
  using (geprueft_am::timestamptz);

commit;
