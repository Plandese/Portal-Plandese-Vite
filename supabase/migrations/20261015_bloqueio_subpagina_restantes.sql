-- Aplica no servidor o bloqueio por sub-página ("off" em app_config/access_overrides) às restantes tabelas.
-- Regra: a tabela fica inacessível quando TODAS as sub-páginas que a usam estão bloqueadas para o utilizador.
-- Ver também 20261015_bloqueio_subpagina_servidor.sql (fn_sec_off + Controlo de Obras).
-- Nota: dados que vivem em app_config (ex.: preços unitários) continuam legíveis por qualquer membro.
create or replace function public.fn_sec_all_off(p_secs text[])
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select not exists (select 1 from unnest(p_secs) s where not public.fn_sec_off(s));
$f$;
grant execute on function public.fn_sec_all_off(text[]) to authenticated;

do $$
declare
  cfg jsonb := jsonb_build_object(
    'faturas',                 array['faturas','faturas-aprovar','tesouraria'],
    'fatura_fornecedores',     array['faturas','faturas-aprovar','tesouraria'],
    'pedidos_compra',          array['compras','mapas-comparativos'],
    'mapas_comparativos',      array['mapas-comparativos','compras','precos-unitarios','producao'],
    'mapa_linhas',             array['mapas-comparativos','compras','precos-unitarios','producao'],
    'mapa_fornecedor_valores', array['mapas-comparativos','compras','precos-unitarios','producao'],
    'fornecedores',            array['fornecedores','compras','mapas-comparativos','faturas','faturas-aprovar','tesouraria','producao'],
    'equipamentos',            array['equipamentos','combustivel'],
    'eq_manutencoes',          array['equipamentos'],
    'eq_movimentos',           array['equipamentos'],
    'registos_combustivel',    array['combustivel'],
    'colaboradores',           array['colaboradores','historico','fecho-mes','mapa-ferias'],
    'advertencias',            array['colaboradores','historico','fecho-mes'],
    'registos_ponto',          array['historico','fecho-mes','colaboradores','mapa-ferias'],
    'registos_ponto_moa',      array['historico','fecho-mes','colaboradores','empresas-moa'],
    'aprovacoes_ponto',        array['historico','fecho-mes'],
    'aprovacoes_ponto_moa',    array['historico','fecho-mes'],
    'ferias_previstas',        array['mapa-ferias','historico','fecho-mes','colaboradores'],
    'empresas_moa',            array['empresas-moa','historico','fecho-mes'],
    'colaboradores_moa',       array['empresas-moa','historico','fecho-mes'],
    'tavira_estado',           array['pendentes-tavira'],
    'tavira_topicos',          array['pendentes-tavira'],
    'tavira_fotos',            array['pendentes-tavira'],
    'obras',                   array['obras'],
    'obra_diretores_extra',    array['obras'],
    'obra_encarregados_extra', array['obras']
  );
  t text; secs text; p record; q text; w text; g text;
begin
  for t in select jsonb_object_keys(cfg) loop
    select 'array[' || string_agg(quote_literal(x), ',') || ']::text[]' into secs from jsonb_array_elements_text(cfg->t) x;
    g := 'NOT fn_sec_all_off(' || secs || ')';
    for p in select policyname, qual, with_check from pg_policies where schemaname='public' and tablename=t loop
      if coalesce(p.qual,'') || coalesce(p.with_check,'') like '%fn_sec_%' then continue; end if;
      q := p.qual; w := p.with_check;
      if q is not null then
        if q like '%fn_cap(%' then q := regexp_replace(q, 'fn_cap\(''(\w+)''::text\)', '(fn_cap(''\1''::text) AND ' || g || ')', 'g');
        elsif q like '%fn_is_member()%' then q := '(' || q || ') AND ' || g; end if;
      end if;
      if w is not null then
        if w like '%fn_cap(%' then w := regexp_replace(w, 'fn_cap\(''(\w+)''::text\)', '(fn_cap(''\1''::text) AND ' || g || ')', 'g');
        elsif w like '%fn_is_member()%' then w := '(' || w || ') AND ' || g; end if;
      end if;
      if q is not distinct from p.qual and w is not distinct from p.with_check then continue; end if;
      if q is not null and w is not null then
        execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, t, q, w);
      elsif q is not null then
        execute format('alter policy %I on public.%I using (%s)', p.policyname, t, q);
      else
        execute format('alter policy %I on public.%I with check (%s)', p.policyname, t, w);
      end if;
    end loop;
  end loop;
end $$;
