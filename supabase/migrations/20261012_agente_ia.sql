-- ═══════════════════════════════════════════════════════════════
--  AGENTE IA — registo de uso, ações propostas e funções de apoio
--  · agente_logs  : auditoria + limite diário por utilizador + feedback
--  · agente_acoes : ações propostas pelo agente que o utilizador confirma
--  · ag_balanco() : mesmo cálculo do Controlo de Obras (balanço por obra)
--  · ag_alertas() : alertas proativos (regras), calculados com a RLS do utilizador
--  Tudo SECURITY INVOKER: o agente nunca vê mais do que o utilizador vê.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.agente_logs (
  id           bigint generated always as identity primary key,
  utilizador   text not null,
  role         text,
  pergunta     text,
  resposta     text,
  ferramentas  jsonb not null default '[]'::jsonb,
  tokens_in    integer,
  tokens_out   integer,
  ms           integer,
  erro         text,
  feedback     smallint,           -- 1 = útil, -1 = não útil
  criado_em    timestamptz not null default now()
);
create index if not exists agente_logs_user_dia on public.agente_logs (utilizador, criado_em desc);

alter table public.agente_logs enable row level security;

drop policy if exists ler on public.agente_logs;
create policy ler on public.agente_logs for select to authenticated
  using (utilizador = fn_my_username() or fn_my_role() = 'admin');

drop policy if exists inserir on public.agente_logs;
create policy inserir on public.agente_logs for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null and fn_my_role() <> 'encarregado');

drop policy if exists feedback on public.agente_logs;
create policy feedback on public.agente_logs for update to authenticated
  using (utilizador = fn_my_username()) with check (utilizador = fn_my_username());

revoke all on public.agente_logs from anon, authenticated;
grant select, insert on public.agente_logs to authenticated;
grant update (feedback) on public.agente_logs to authenticated;

-- ── Ações propostas ────────────────────────────────────────────
create table if not exists public.agente_acoes (
  id          uuid primary key default gen_random_uuid(),
  utilizador  text not null,
  tipo        text not null,
  params      jsonb not null default '{}'::jsonb,
  resumo      text not null,
  estado      text not null default 'pendente'
              check (estado in ('pendente','confirmada','cancelada','erro','expirada')),
  resultado   jsonb,
  criado_em   timestamptz not null default now(),
  decidido_em timestamptz
);
create index if not exists agente_acoes_user on public.agente_acoes (utilizador, criado_em desc);

alter table public.agente_acoes enable row level security;

drop policy if exists ler on public.agente_acoes;
create policy ler on public.agente_acoes for select to authenticated
  using (utilizador = fn_my_username() or fn_my_role() = 'admin');

drop policy if exists inserir on public.agente_acoes;
create policy inserir on public.agente_acoes for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null and fn_my_role() <> 'encarregado');

drop policy if exists atualizar on public.agente_acoes;
create policy atualizar on public.agente_acoes for update to authenticated
  using (utilizador = fn_my_username()) with check (utilizador = fn_my_username());

revoke all on public.agente_acoes from anon, authenticated;
grant select, insert, update on public.agente_acoes to authenticated;

-- ── Balanço por obra (replica coBalancoCalc do portal) ─────────
create or replace function public.ag_balanco(p_obra text default null, p_de text default null, p_ate text default null)
returns table (
  obra_id text, obra_nome text, ativa boolean, meses int,
  proveitos numeric, mo numeric, eq numeric, mat numeric, geral numeric, sub numeric, outros numeric,
  sede numeric, transferido numeric, existencias numeric,
  custos numeric, saldo numeric, margem numeric
)
language sql stable security invoker set search_path = public as $$
  with m as (
    select r.obra_id,
           count(*)::int as meses,
           sum(coalesce(r.proveitos,0)) as prov,
           sum(coalesce(r.mo,0)) as mo, sum(coalesce(r.eq,0)) as eq, sum(coalesce(r.mat,0)) as mat,
           sum(coalesce(r.geral,0)) as geral, sum(coalesce(r.sub,0)) as sub, sum(coalesce(r.outros,0)) as outros
    from co_mensal r
    where (p_obra is null or r.obra_id = p_obra)
      and (p_de  is null or r.mes >= p_de)
      and (p_ate is null or r.mes <= p_ate)
    group by r.obra_id
  ),
  u as (select obra_id, max(mes) as ultimo from co_mensal group by obra_id),
  x as (
    select o.id as obra_id, o.nome as obra_nome, o.ativa, m.meses,
           m.prov, m.mo, m.eq, m.mat, m.geral, m.sub, m.outros,
           round(m.prov * coalesce(c.sede_pct,0) / 100, 2) as sede,
           case when (p_de is null or u.ultimo >= p_de) and (p_ate is null or u.ultimo <= p_ate)
                then coalesce(c.transferido,0) else 0 end as transf,
           abs(coalesce(c.existencias,0)) as exist
    from m
    join obras o on o.id = m.obra_id
    left join co_obra c on c.obra_id = m.obra_id
    left join u on u.obra_id = m.obra_id
  )
  select x.obra_id, x.obra_nome, x.ativa, x.meses,
         round(x.prov,2), round(x.mo,2), round(x.eq,2), round(x.mat,2), round(x.geral,2), round(x.sub,2), round(x.outros,2),
         x.sede, x.transf, x.exist,
         round(x.mo+x.eq+x.mat+x.geral+x.sub+x.outros+x.sede+x.transf-x.exist, 2) as custos,
         round(x.prov-(x.mo+x.eq+x.mat+x.geral+x.sub+x.outros+x.sede+x.transf-x.exist), 2) as saldo,
         case when x.prov > 0
              then round((x.prov-(x.mo+x.eq+x.mat+x.geral+x.sub+x.outros+x.sede+x.transf-x.exist)) / x.prov, 4)
         end as margem
  from x
  order by x.obra_nome;
$$;
grant execute on function public.ag_balanco(text,text,text) to authenticated;

-- ── Alertas proativos ──────────────────────────────────────────
create or replace function public.ag_alertas()
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  r jsonb := '[]'::jsonb;
  n int;
  x record;
begin
  -- 1. Obras ativas com margem negativa (Controlo de Obras)
  for x in select obra_nome, saldo, margem from ag_balanco() where ativa and proveitos > 0 and margem < 0 order by saldo loop
    r := r || jsonb_build_object('tipo','margem','nivel','alta','seccao','producao',
      'titulo', 'Margem negativa: ' || x.obra_nome,
      'detalhe', 'Saldo de ' || replace(to_char(x.saldo,'FM999G999G990'),',','.') || ' € (' || replace(to_char(x.margem*100,'FM990D0'),'.',',') || '% sobre proveitos).');
  end loop;

  -- 2. Faturas à espera de aprovação do diretor há mais de 5 dias
  select count(*) into n from faturas where status = 'aguarda_diretor' and criado_em < now() - interval '5 days';
  if n > 0 then
    r := r || jsonb_build_object('tipo','faturas','nivel','media','seccao','faturas-aprovar',
      'titulo', n || ' fatura(s) à espera de aprovação há mais de 5 dias',
      'detalhe', 'Estado "aguarda diretor" sem decisão.');
  end if;

  -- 3. Seguros e IPO a vencer em 30 dias (ou já vencidos)
  for x in select nome, matricula, seguro_validade, ipo_validade from equipamentos
           where coalesce(estado,'') <> 'inativo'
             and (seguro_validade < current_date + 30 or ipo_validade < current_date + 30)
           order by least(coalesce(seguro_validade,'2999-01-01'), coalesce(ipo_validade,'2999-01-01')) limit 15 loop
    r := r || jsonb_build_object('tipo','equipamento','nivel',
      case when least(coalesce(x.seguro_validade,'2999-01-01'::date), coalesce(x.ipo_validade,'2999-01-01'::date)) < current_date then 'alta' else 'media' end,
      'seccao','equipamentos',
      'titulo', 'Documentos de ' || x.nome || coalesce(' (' || x.matricula || ')',''),
      'detalhe', concat_ws(' · ',
        case when x.seguro_validade < current_date + 30 then 'Seguro: ' || to_char(x.seguro_validade,'DD/MM/YYYY') end,
        case when x.ipo_validade   < current_date + 30 then 'IPO: '    || to_char(x.ipo_validade,'DD/MM/YYYY') end));
  end loop;

  -- 4. Prazos de obra a terminar em 30 dias ou ultrapassados
  for x in select nome, prazo from obras where ativa and prazo is not null and prazo < current_date + 30 order by prazo limit 10 loop
    r := r || jsonb_build_object('tipo','prazo','nivel', case when x.prazo < current_date then 'alta' else 'media' end,'seccao','obras',
      'titulo', 'Prazo de ' || x.nome,
      'detalhe', case when x.prazo < current_date then 'Ultrapassado em ' || to_char(x.prazo,'DD/MM/YYYY')
                      else 'Termina em ' || to_char(x.prazo,'DD/MM/YYYY') end);
  end loop;

  -- 5. Pedidos de compra pendentes com data limite a menos de 3 dias
  select count(*) into n from pedidos_compra where estado = 'pendente' and data_limite is not null and data_limite < current_date + 3;
  if n > 0 then
    r := r || jsonb_build_object('tipo','compras','nivel','media','seccao','compras',
      'titulo', n || ' pedido(s) de compra pendentes com data limite próxima',
      'detalhe', 'Data limite nos próximos 3 dias ou já passada.');
  end if;

  -- 6. Ponto por aprovar (últimos 14 dias, dias úteis passados)
  select count(*) into n from (
    select distinct p.obra_id, p.data from registos_ponto p
    where p.data >= current_date - 14 and p.data < current_date and extract(isodow from p.data) < 6
      and not exists (select 1 from aprovacoes_ponto a where a.obra_id = p.obra_id and a.data = p.data)
  ) t;
  if n > 0 then
    r := r || jsonb_build_object('tipo','ponto','nivel','info','seccao','historico',
      'titulo', n || ' dia(s)/obra com ponto por aprovar nos últimos 14 dias',
      'detalhe', 'Registos de encarregados ainda sem aprovação do diretor.');
  end if;

  -- 7. Manutenções pendentes há mais de 30 dias
  select count(*) into n from eq_manutencoes where estado = 'pendente' and data < current_date - 30;
  if n > 0 then
    r := r || jsonb_build_object('tipo','manutencao','nivel','info','seccao','equipamentos',
      'titulo', n || ' manutenção(ões) pendentes há mais de 30 dias',
      'detalhe', 'Pedidos de manutenção de equipamentos por resolver.');
  end if;

  return r;
end;
$$;
grant execute on function public.ag_alertas() to authenticated;
