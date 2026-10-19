-- Linhas das faturas associadas ao catálogo de materiais (lista de materiais / CentralGest).
-- faturas.linhas: [{ desc, ref_forn, qtd, un, pu, total, art_ref, art_nome, estado }]
--   estado: 'auto' (associado pelo portal) | 'manual' (escolhido pelo utilizador) | 'pendente' | 'ignorado'
alter table public.faturas add column if not exists linhas jsonb not null default '[]'::jsonb;

-- Memória de associações: a mesma descrição do mesmo fornecedor é associada sozinha nas faturas seguintes.
create table if not exists public.fatura_artigo_alias (
  nif        text not null,
  chave      text not null,              -- descrição (ou ref. do fornecedor) normalizada
  art_ref    text not null,
  art_nome   text not null default '',
  un         text not null default '',
  usos       integer not null default 1,
  atualizado timestamptz not null default now(),
  primary key (nif, chave)
);
alter table public.fatura_artigo_alias enable row level security;
create policy ler     on public.fatura_artigo_alias for select to authenticated using (fn_cap('fin'));
create policy inserir on public.fatura_artigo_alias for insert to authenticated with check (fn_cap('fin'));
create policy alterar on public.fatura_artigo_alias for update to authenticated using (fn_cap('fin')) with check (fn_cap('fin'));
create policy apagar  on public.fatura_artigo_alias for delete to authenticated using (fn_cap('fin'));
grant select, insert, update, delete on public.fatura_artigo_alias to authenticated;
