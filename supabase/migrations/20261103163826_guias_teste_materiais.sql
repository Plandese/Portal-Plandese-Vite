-- Página de teste das guias: artigos das faturas sincronizadas ↔ base de dados de materiais (lista de custos da empreitada)
alter table gt_faturas add column if not exists artigos_assoc_em timestamptz;   -- quando os artigos foram associados automaticamente
create table if not exists gt_artigo_alias (like fatura_artigo_alias including all);   -- memória por fornecedor, só do teste
alter table gt_artigo_alias enable row level security;
drop policy if exists gt_artigo_alias_admin on gt_artigo_alias;
create policy gt_artigo_alias_admin on gt_artigo_alias for all to authenticated using (fn_my_role() = 'admin') with check (fn_my_role() = 'admin');

-- compara linhas sem os campos de associação (a importação não deve apagar associações já feitas)
create or replace function gt_limpa_linhas(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(l - 'art_ref' - 'art_nome' - 'estado' - '_cands' - '_via' - '_aberta' - '_tocada' order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) with ordinality t(l, o)
$$;

create or replace function gt_importar_faturas() returns jsonb language plpgsql security definer set search_path = public as $$
declare n_novas int; n_atual int;
begin
  if fn_my_role() is distinct from 'admin' then raise exception 'Sem permissão'; end if;
  insert into gt_faturas (origem_id, fornecedor, nif, numero, data, data_pag, base, iva, total, status, centro_custo, linhas, guias_ref, ficheiro, notas, teste, criado_em, criado_por)
    select f.id, f.fornecedor, f.nif, f.numero, f.data, f.data_pag, f.base, f.iva, f.total, f.status, f.centro_custo, coalesce(f.linhas, '[]'::jsonb), coalesce(f.guias_ref, '[]'::jsonb), f.ficheiro, f.notas, false, f.criado_em, f.criado_por
    from faturas f
    where f.fornecedor ilike '%secil%' and f.centro_custo like 'O065%' and not f.teste and (f.data is null or f.data < '2026-01-01' or f.data > '2026-05-31')
      and not exists (select 1 from gt_faturas g where g.origem_id = f.id);
  get diagnostics n_novas = row_count;
  update gt_faturas g set fornecedor = f.fornecedor, nif = f.nif, numero = f.numero, data = f.data, data_pag = f.data_pag, base = f.base, iva = f.iva, total = f.total,
         status = f.status, centro_custo = f.centro_custo, guias_ref = coalesce(f.guias_ref, '[]'::jsonb),
         linhas = case when gt_limpa_linhas(g.linhas) is distinct from gt_limpa_linhas(f.linhas) then coalesce(f.linhas, '[]'::jsonb) else g.linhas end,
         artigos_assoc_em = case when gt_limpa_linhas(g.linhas) is distinct from gt_limpa_linhas(f.linhas) then null else g.artigos_assoc_em end
    from faturas f
    where g.origem_id = f.id and not g.teste
      and (gt_limpa_linhas(g.linhas), g.guias_ref, g.base, g.data, g.centro_custo, g.status, g.nif, g.total) is distinct from (gt_limpa_linhas(f.linhas), coalesce(f.guias_ref, '[]'::jsonb), f.base, f.data, f.centro_custo, f.status, f.nif, f.total);
  get diagnostics n_atual = row_count;
  return jsonb_build_object('novas', n_novas, 'atualizadas', n_atual);
end $$;
