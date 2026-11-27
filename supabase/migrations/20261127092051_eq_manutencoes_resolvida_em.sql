-- Data em que um pedido de manutenção passou a «resolvida».
-- O quadro de Manutenção só mostra as resolvidas dos últimos 7 dias.
-- Preenchida por trigger para cobrir todos os caminhos (portal, app, agente).

alter table public.eq_manutencoes
  add column if not exists resolvida_em timestamptz;

-- As que já estão resolvidas não têm data conhecida: ficam visíveis mais 7 dias a partir de hoje.
update public.eq_manutencoes
   set resolvida_em = now()
 where estado = 'resolvida' and resolvida_em is null;

create or replace function public.fn_eq_manut_resolvida_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'resolvida' then
    if tg_op = 'INSERT' then
      new.resolvida_em := coalesce(new.resolvida_em, now());
    elsif old.estado is distinct from 'resolvida' then
      new.resolvida_em := now();                                   -- acabou de ser resolvida
    else
      new.resolvida_em := coalesce(new.resolvida_em, old.resolvida_em, now());
    end if;
  else
    new.resolvida_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eq_manut_resolvida_em on public.eq_manutencoes;
create trigger trg_eq_manut_resolvida_em
  before insert or update of estado on public.eq_manutencoes
  for each row execute function public.fn_eq_manut_resolvida_em();
