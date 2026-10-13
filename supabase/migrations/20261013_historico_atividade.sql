-- Histórico de atividade: regista quem alterou o quê e quando (inserir / alterar / apagar)
-- nas tabelas de negócio. Só os administradores o podem consultar.
create table if not exists public.historico_atividade (
  id           bigint generated always as identity primary key,
  criado_em    timestamptz not null default now(),
  user_id      uuid,
  utilizador   text,
  tabela       text not null,
  operacao     text not null check (operacao in ('INSERT','UPDATE','DELETE')),
  registo_id   text,
  campos       text[],
  antes        jsonb,
  depois       jsonb
);
create index if not exists historico_atividade_criado_idx on public.historico_atividade (criado_em desc);
create index if not exists historico_atividade_tabela_idx on public.historico_atividade (tabela, criado_em desc);
alter table public.historico_atividade enable row level security;
drop policy if exists "ler_admin" on public.historico_atividade;
create policy "ler_admin" on public.historico_atividade for select to authenticated using (public.fn_my_role() = 'admin');
-- sem políticas de escrita: só os triggers (security definer) gravam

create or replace function public.fn_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text; campos text[] := '{}'; ao jsonb := '{}'; an jsonb := '{}';
  rid text; nome text; uid uuid := auth.uid();
  skip text[] := array['password','atualizado_em','updated_at','ultima_atualizacao'];
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  rid := coalesce(n->>'id', o->>'id', n->>'username', o->>'username', n->>'topico_id', o->>'topico_id', n->>'codigo', o->>'codigo');
  -- fotos / textos muito longos não ficam no histórico
  if o is not null then
    for k in select jsonb_object_keys(o) loop
      if k = any(skip) then o := o - k;
      elsif jsonb_typeof(o->k)='string' and length(o->>k) > 400 then o := jsonb_set(o, array[k], '"[conteúdo longo omitido]"'); end if;
    end loop;
  end if;
  if n is not null then
    for k in select jsonb_object_keys(n) loop
      if k = any(skip) then n := n - k;
      elsif jsonb_typeof(n->k)='string' and length(n->>k) > 400 then n := jsonb_set(n, array[k], '"[conteúdo longo omitido]"'); end if;
    end loop;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if (o->k) is distinct from (n->k) then
        campos := campos || k; ao := ao || jsonb_build_object(k, o->k); an := an || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if cardinality(campos) = 0 then return new; end if;
    o := ao; n := an;
  end if;
  select u.nome into nome from public.utilizadores u where u.auth_id = uid limit 1;
  insert into public.historico_atividade(user_id, utilizador, tabela, operacao, registo_id, campos, antes, depois)
  values (uid, coalesce(nome, case when uid is null then 'Sistema' else 'Desconhecido' end), tg_table_name, tg_op, rid, nullif(campos,'{}'), o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'advertencias','colaboradores','colaboradores_moa','empresas_moa','eq_movimentos','equipamentos','eq_manutencoes',
    'faturas','fatura_fornecedores','ferias_previstas','fornecedores','lembretes','obras','pedidos_compra',
    'registos_combustivel','registos_ponto','registos_ponto_moa','utilizadores','mapas_comparativos','mapa_linhas',
    'mapa_fornecedor_valores','calendario_eventos','aprovacoes_ponto','aprovacoes_ponto_moa','obra_diretores_extra',
    'obra_encarregados_extra','co_obra','co_mensal','tavira_topicos','tavira_estado','tavira_fotos'
  ] loop
    execute format('drop trigger if exists trg_historico on public.%I', t);
    execute format('create trigger trg_historico after insert or update or delete on public.%I for each row execute function public.fn_historico()', t);
  end loop;
end $$;
