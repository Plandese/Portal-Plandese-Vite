-- Existências (secção própria) precisa dos custos de materiais importados do CentralGest e de gravar a contagem,
-- mesmo com o Controlo de Obras ("producao") bloqueado.
do $$
declare p record;
begin
  for p in select policyname, cmd from pg_policies where schemaname='public' and tablename='co_existencia' loop
    if p.cmd = 'SELECT' or p.cmd = 'DELETE' then
      execute format('alter policy %I on public.co_existencia using (fn_cap(''prod''::text) AND NOT fn_sec_all_off(array[''producao'',''existencias'']))', p.policyname);
    elsif p.cmd = 'INSERT' then
      execute format('alter policy %I on public.co_existencia with check (fn_cap(''prod''::text) AND NOT fn_sec_all_off(array[''producao'',''existencias'']))', p.policyname);
    else
      execute format('alter policy %I on public.co_existencia using (fn_cap(''prod''::text) AND NOT fn_sec_all_off(array[''producao'',''existencias''])) with check (fn_cap(''prod''::text) AND NOT fn_sec_all_off(array[''producao'',''existencias'']))', p.policyname);
    end if;
  end loop;
end $$;

alter policy ler     on public.co_obra using (fn_cap('prod'::text) AND NOT fn_sec_all_off(array['producao','existencias']));
alter policy inserir on public.co_obra with check (fn_cap('prod'::text) AND NOT fn_sec_all_off(array['producao','existencias']));
alter policy alterar on public.co_obra using (fn_cap('prod'::text) AND NOT fn_sec_all_off(array['producao','existencias']))
                                       with check (fn_cap('prod'::text) AND NOT fn_sec_all_off(array['producao','existencias']));

-- co_custo_det: com Controlo de Obras bloqueado, Existências só lê os custos de materiais (tipologia 'mat').
alter policy ler on public.co_custo_det using (
  fn_cap('prod'::text) AND (
    NOT fn_sec_off('producao'::text)
    OR (NOT fn_sec_off('existencias'::text) AND tipologia = 'mat')
  )
);
