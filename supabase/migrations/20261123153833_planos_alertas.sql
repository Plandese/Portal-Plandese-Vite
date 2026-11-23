-- Alertas dos planos de trabalho (encomendar material, adjudicar subempreitadas, outras datas importantes).
-- Os alertas vivem em planos_trabalho.opcoes->'alertas'; o portal grava em cada um a data calculada ("data",
-- "inicio", "tarefaNome"). Nos dias úteis às 08:15 UTC avisa no sininho do portal até 7 dias antes e no dia
-- (ou logo que a data passe, se ainda não estiver feito). planos_alertas_enviados evita repetir o mesmo aviso;
-- se a data do alerta mudar (o plano mexeu), volta a avisar.
create table if not exists public.planos_alertas_enviados (
  plano_id   uuid not null,
  alerta_id  text not null,
  fase       text not null,          -- 'aviso' (até 7 dias antes) | 'dia' (no dia ou já em atraso)
  data       date not null,          -- data do alerta quando se avisou
  enviado_em timestamptz not null default now(),
  primary key (plano_id, alerta_id, fase, data)
);
alter table public.planos_alertas_enviados enable row level security;
revoke all on public.planos_alertas_enviados from anon, authenticated;

create or replace function public.fn_alertas_planos()
returns integer language plpgsql security definer set search_path = public as $$
declare
  hoje date := current_date;
  dests jsonb; r record; d text; n integer := 0; fase text; quando text; msg text;
begin
  if extract(isodow from hoje) > 5 or exists (select 1 from feriados_pt where data = hoje) then return 0; end if;
  select value into dests from app_config where key = 'planos_alertas_destinatarios';
  if dests is null or jsonb_typeof(dests) <> 'array' then dests := '["admin", "david.mosca"]'::jsonb; end if;
  for r in
    select p.id as plano_id, p.nome as plano, p.criado_por, o.nome as obra, a.value as al, (a.value->>'data')::date as dia
      from planos_trabalho p
      left join obras o on o.id::text = p.obra_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.opcoes->'alertas') = 'array' then p.opcoes->'alertas' else '[]'::jsonb end) a
     where coalesce(a.value->>'feito', '') = ''
       and coalesce(a.value->>'id', '') <> ''
       and coalesce(a.value->>'data', '') ~ '^\d{4}-\d{2}-\d{2}$'
       and (a.value->>'data')::date <= hoje + 7
  loop
    fase := case when r.dia <= hoje then 'dia' else 'aviso' end;
    insert into planos_alertas_enviados(plano_id, alerta_id, fase, data) values (r.plano_id, r.al->>'id', fase, r.dia)
      on conflict do nothing;
    if not found then continue; end if;
    quando := case when r.dia < hoje then 'em atraso desde ' || to_char(r.dia, 'DD/MM/YYYY')
                   when r.dia = hoje then 'até hoje'
                   else 'até ' || to_char(r.dia, 'DD/MM/YYYY') || ' (faltam ' || (r.dia - hoje) || ' dias)' end;
    msg := case r.al->>'tipo' when 'material' then 'Encomenda: ' when 'sub' then 'Adjudicação: ' else 'Alerta: ' end
        || coalesce(r.al->>'titulo', '') || ' — ' || quando || '.'
        || case when coalesce(r.al->>'tarefaNome', '') <> ''
                then ' Para «' || (r.al->>'tarefaNome') || '»'
                     || case when coalesce(r.al->>'inicio', '') ~ '^\d{4}-\d{2}-\d{2}$'
                             then ', que começa a ' || to_char((r.al->>'inicio')::date, 'DD/MM/YYYY') else '' end || '.'
                else '' end
        || ' ' || coalesce(r.obra, r.plano);
    for d in select distinct x from (select jsonb_array_elements_text(dests) as x union select r.criado_por) s where x is not null and x <> '' loop
      insert into notificacoes(actor, actor_nome, acao, seccao, destinatario) values (null, 'Planos de trabalho', msg, 'planos-trabalho', d);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.fn_alertas_planos() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'alertas-planos';
select cron.schedule('alertas-planos', '15 8 * * 1-5', $$select public.fn_alertas_planos()$$);
