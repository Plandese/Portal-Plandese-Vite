-- Existências em obra: contagem de material por empreitada e por mês (histórico).
-- Para o controlo de custos conta sempre a última existência gravada (co_obra.existencias é atualizado pela app).
create table public.co_existencia (
  obra_id      text not null references public.obras(id) on delete cascade,
  mes          text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  linhas       jsonb not null default '[]'::jsonb,   -- [{f:fornecedor, a:artigo, p:preço unitário, q:quantidade}]
  total        numeric not null default 0,
  nota         text not null default '',
  guardado_por text not null default '',
  atualizado   timestamptz not null default now(),
  primary key (obra_id, mes)
);
alter table public.co_existencia enable row level security;
create policy ler     on public.co_existencia for select to authenticated using (fn_cap('prod'));
create policy inserir on public.co_existencia for insert to authenticated with check (fn_cap('prod'));
create policy alterar on public.co_existencia for update to authenticated using (fn_cap('prod')) with check (fn_cap('prod'));
create policy apagar  on public.co_existencia for delete to authenticated using (fn_cap('prod'));
grant select, insert, update, delete on public.co_existencia to authenticated;
