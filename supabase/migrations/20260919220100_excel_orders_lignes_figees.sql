-- =====================================================================
-- COMMANDE EXCEL DUCATI — une commande clôturée ou archivée est figée.
-- Les lignes d'un classeur « cloture » / « archive » ne peuvent plus être
-- ajoutées, modifiées ni supprimées (le .xlsx archivé en GED fait foi).
-- Additif : fonction trigger + trigger.
-- =====================================================================

create or replace function public.excel_order_lines_frozen_guard()
returns trigger
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare st text;
begin
  select status into st from public.excel_orders
   where id = coalesce(new.excel_order_id, old.excel_order_id);
  if st in ('cloture', 'archive') then
    raise exception 'Commande Excel clôturée : lignes non modifiables';
  end if;
  return coalesce(new, old);
end $$;

revoke all on function public.excel_order_lines_frozen_guard() from public, anon;

drop trigger if exists trg_excel_order_lines_frozen on public.excel_order_lines;
create trigger trg_excel_order_lines_frozen
  before insert or update or delete on public.excel_order_lines
  for each row execute function public.excel_order_lines_frozen_guard();
