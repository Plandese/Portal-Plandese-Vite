-- Permite atribuir MAIS de um diretor de obra e MAIS de um encarregado por obra.
-- obras.diretor_id / obras.encarregado_id continuam a ser o diretor/encarregado
-- "principal" (usado em relatórios/resumos); estas tabelas guardam os adicionais.
create table if not exists public.obra_diretores_extra (
  obra_id    text not null references public.obras(id) on delete cascade,
  diretor_id text not null,
  criado_em  timestamptz not null default now(),
  primary key (obra_id, diretor_id)
);

create table if not exists public.obra_encarregados_extra (
  obra_id        text not null references public.obras(id) on delete cascade,
  encarregado_id text not null,
  criado_em      timestamptz not null default now(),
  primary key (obra_id, encarregado_id)
);

alter table public.obra_diretores_extra enable row level security;
alter table public.obra_encarregados_extra enable row level security;

-- Mesmo padrão de RLS da tabela obras: qualquer membro lê; só quem tem a
-- capacidade 'def' (editar obras) pode adicionar/remover.
create policy "ler" on public.obra_diretores_extra for select to authenticated
  using (public.fn_is_member());
create policy "inserir" on public.obra_diretores_extra for insert to authenticated
  with check (public.fn_cap('def'));
create policy "apagar" on public.obra_diretores_extra for delete to authenticated
  using (public.fn_cap('def'));

create policy "ler" on public.obra_encarregados_extra for select to authenticated
  using (public.fn_is_member());
create policy "inserir" on public.obra_encarregados_extra for insert to authenticated
  with check (public.fn_cap('def'));
create policy "apagar" on public.obra_encarregados_extra for delete to authenticated
  using (public.fn_cap('def'));

grant select, insert, delete on public.obra_diretores_extra to authenticated;
grant select, insert, delete on public.obra_encarregados_extra to authenticated;

-- Aprovação de ponto/MOA: passa a aceitar também os diretores adicionais da obra.
create or replace function public.fn_pode_aprovar_ponto(p_obra_id text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_my_role() = 'admin'
      or exists (select 1 from public.obras o
                  where o.id = p_obra_id and o.diretor_id = public.fn_my_username())
      or exists (select 1 from public.obra_diretores_extra od
                  where od.obra_id = p_obra_id and od.diretor_id = public.fn_my_username());
$$;
