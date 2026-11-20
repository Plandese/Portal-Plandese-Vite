-- ── Helpers ────────────────────────────────────────────────────────────
create or replace function public.fn_my_username()
returns text language sql stable security definer set search_path = public as $$
  select username from public.utilizadores where auth_id = auth.uid();
$$;

-- Tem acesso ao capítulo (rh/cmp/fin/log/prod/def)? Segue a matriz do ecrã Permissões (app_config).
create or replace function public.fn_cap(p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when r.role is null then false
    when r.role = 'admin' then true
    else coalesce((select (c.value -> r.role) ? p_cap from public.app_config c where c.key = 'role_permissions'), false)
  end
  from (select public.fn_my_role() as role) r;
$$;

create or replace function public.fn_is_enc()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_my_role() = 'encarregado', false);
$$;

create or replace function public.fn_is_office()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_my_role() <> 'encarregado', false);
$$;

do $$
declare f text;
begin
  foreach f in array array['fn_my_username()','fn_cap(text)','fn_is_enc()','fn_is_office()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── Limpa a policy genérica "membros" ───────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'membros' loop
    execute format('drop policy membros on public.%I', t);
  end loop;
end $$;

-- Atalho: cria policies separadas para leitura e escrita
create or replace function pg_temp.pol(t text, ler text, escrever text) returns void language plpgsql as $$
begin
  execute format('create policy ler on public.%I for select to authenticated using (%s)', t, ler);
  execute format('create policy inserir on public.%I for insert to authenticated with check (%s)', t, escrever);
  execute format('create policy alterar on public.%I for update to authenticated using (%s) with check (%s)', t, escrever, escrever);
  execute format('create policy apagar on public.%I for delete to authenticated using (%s)', t, escrever);
end $$;

-- Dados partilhados (painel, app do encarregado): todos lêem, só o capítulo dono escreve
select pg_temp.pol('obras',              'public.fn_is_member()', 'public.fn_cap(''def'')');
select pg_temp.pol('colaboradores',      'public.fn_is_member()', 'public.fn_cap(''rh'')');
select pg_temp.pol('ferias_previstas',   'public.fn_is_member()', 'public.fn_cap(''rh'')');
select pg_temp.pol('registos_ponto',     'public.fn_is_member()', 'public.fn_cap(''rh'') or public.fn_is_enc()');
select pg_temp.pol('registos_ponto_moa', 'public.fn_is_member()', 'public.fn_cap(''rh'') or public.fn_is_enc()');
select pg_temp.pol('empresas_moa',       'public.fn_is_member()', 'public.fn_cap(''def'')');
select pg_temp.pol('colaboradores_moa',  'public.fn_is_member()', 'public.fn_cap(''def'') or public.fn_is_enc()');
select pg_temp.pol('app_config',         'public.fn_is_member()', 'public.fn_my_role() = ''admin''');

-- RH
select pg_temp.pol('advertencias', 'public.fn_cap(''rh'')', 'public.fn_cap(''rh'')');

-- Compras (mapas também criados a partir de Preços Unitários, capítulo Produção)
select pg_temp.pol('mapas_comparativos',      'public.fn_cap(''cmp'') or public.fn_cap(''prod'')', 'public.fn_cap(''cmp'') or public.fn_cap(''prod'')');
select pg_temp.pol('mapa_linhas',             'public.fn_cap(''cmp'') or public.fn_cap(''prod'')', 'public.fn_cap(''cmp'') or public.fn_cap(''prod'')');
select pg_temp.pol('mapa_fornecedor_valores', 'public.fn_cap(''cmp'') or public.fn_cap(''prod'')', 'public.fn_cap(''cmp'') or public.fn_cap(''prod'')');
select pg_temp.pol('fornecedores', 'public.fn_cap(''cmp'') or public.fn_cap(''fin'') or public.fn_cap(''def'') or public.fn_cap(''prod'')', 'public.fn_cap(''def'')');

-- Pedidos de compra: capítulo Compras; encarregado cria pelo chat e vê os que criou
create policy ler on public.pedidos_compra for select to authenticated
  using (public.fn_cap('cmp') or (public.fn_is_enc() and criado_por = public.fn_my_username()));
create policy inserir on public.pedidos_compra for insert to authenticated
  with check (public.fn_cap('cmp') or (public.fn_is_enc() and criado_por = public.fn_my_username()));
create policy alterar on public.pedidos_compra for update to authenticated
  using (public.fn_cap('cmp')) with check (public.fn_cap('cmp'));
create policy apagar on public.pedidos_compra for delete to authenticated using (public.fn_cap('cmp'));

-- Financeiro
select pg_temp.pol('faturas',             'public.fn_cap(''fin'')', 'public.fn_cap(''fin'')');
select pg_temp.pol('fatura_fornecedores', 'public.fn_cap(''fin'')', 'public.fn_cap(''fin'')');

-- Logística e Equipamentos (encarregado lê equipamentos, regista movimentos/combustível, actualiza localização)
create policy ler on public.equipamentos for select to authenticated using (public.fn_is_member());
create policy inserir on public.equipamentos for insert to authenticated with check (public.fn_cap('log'));
create policy alterar on public.equipamentos for update to authenticated
  using (public.fn_cap('log') or public.fn_is_enc()) with check (public.fn_cap('log') or public.fn_is_enc());
create policy apagar on public.equipamentos for delete to authenticated using (public.fn_cap('log'));

select pg_temp.pol('eq_manutencoes', 'public.fn_cap(''log'')', 'public.fn_cap(''log'')');

create policy ler on public.eq_movimentos for select to authenticated using (public.fn_cap('log') or public.fn_is_enc());
create policy inserir on public.eq_movimentos for insert to authenticated with check (public.fn_cap('log') or public.fn_is_enc());
create policy alterar on public.eq_movimentos for update to authenticated using (public.fn_cap('log')) with check (public.fn_cap('log'));
create policy apagar on public.eq_movimentos for delete to authenticated using (public.fn_cap('log'));

create policy ler on public.registos_combustivel for select to authenticated using (public.fn_cap('log') or public.fn_is_enc());
create policy inserir on public.registos_combustivel for insert to authenticated with check (public.fn_cap('log') or public.fn_is_enc());
create policy alterar on public.registos_combustivel for update to authenticated using (public.fn_cap('log')) with check (public.fn_cap('log'));
create policy apagar on public.registos_combustivel for delete to authenticated using (public.fn_cap('log'));

-- Produção
select pg_temp.pol('tavira_estado',  'public.fn_cap(''prod'')', 'public.fn_cap(''prod'')');
select pg_temp.pol('tavira_fotos',   'public.fn_cap(''prod'')', 'public.fn_cap(''prod'')');
select pg_temp.pol('tavira_topicos', 'public.fn_cap(''prod'')', 'public.fn_cap(''prod'')');

-- Quadro de lembretes do painel: pessoal de escritório
select pg_temp.pol('lembretes', 'public.fn_is_office()', 'public.fn_is_office()');

-- Notificações: cada um vê/marca as suas; qualquer membro pode notificar outros
create policy ler on public.notificacoes for select to authenticated using (destinatario = public.fn_my_username());
create policy inserir on public.notificacoes for insert to authenticated with check (public.fn_is_member());
create policy alterar on public.notificacoes for update to authenticated
  using (destinatario = public.fn_my_username()) with check (destinatario = public.fn_my_username());
create policy apagar on public.notificacoes for delete to authenticated using (destinatario = public.fn_my_username());

-- Quem recebe o quê: todos lêem (para calcular destinatários), admin gere, cada um gere as suas
select pg_temp.pol('notif_subscriptions', 'public.fn_is_member()',
  'public.fn_my_role() = ''admin'' or destinatario = public.fn_my_username()');

-- Subscrições push do dispositivo: só as próprias (a edge function usa a service role)
select pg_temp.pol('push_subscriptions', 'destinatario = public.fn_my_username()', 'destinatario = public.fn_my_username()');