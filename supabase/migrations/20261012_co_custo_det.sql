-- Controlo de Obras: detalhe dos custos por fornecedor/artigo (alimentado por "Atualizar das pastas")
create table public.co_custo_det (
  obra_id    text not null references public.obras(id) on delete cascade,
  mes        text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  tipologia  text not null,
  fornecedor text not null default '',
  artigo     text not null default '',
  qtd        numeric not null default 0,
  valor      numeric not null default 0,
  primary key (obra_id, mes, tipologia, fornecedor, artigo)
);
alter table public.co_custo_det enable row level security;
create policy ler     on public.co_custo_det for select to authenticated using (fn_cap('prod'));
create policy inserir on public.co_custo_det for insert to authenticated with check (fn_cap('prod'));
create policy alterar on public.co_custo_det for update to authenticated using (fn_cap('prod')) with check (fn_cap('prod'));
create policy apagar  on public.co_custo_det for delete to authenticated using (fn_cap('prod'));
create index co_custo_det_obra on public.co_custo_det (obra_id, tipologia);
