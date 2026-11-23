-- Planos de trabalho: versões guardadas de cada plano (Proposta, Aprovado, Revisão…).
-- Cada versão é uma cópia completa do plano em «dados» (tarefas, equipas, subempreiteiros, opções) e um
-- «resumo» pequeno para a lista (nº de tarefas, início, fim, dias úteis, valor). Mesmo acesso que os planos.
create table if not exists public.planos_trabalho_versoes (
  id          uuid primary key default gen_random_uuid(),
  plano_id    uuid not null references public.planos_trabalho(id) on delete cascade,
  nome        text not null,
  estado      text not null default 'proposta' check (estado in ('proposta', 'aprovado', 'revisao', 'copia')),
  resumo      jsonb not null default '{}'::jsonb,
  dados       jsonb not null,
  criado_por  text default public.fn_my_username(),
  created_at  timestamptz not null default now()
);
create index if not exists planos_trabalho_versoes_plano_idx on public.planos_trabalho_versoes (plano_id, created_at desc);

alter table public.planos_trabalho_versoes enable row level security;

drop policy if exists so_david on public.planos_trabalho_versoes;
create policy so_david on public.planos_trabalho_versoes for all to authenticated
  using (public.fn_my_username() in ('admin', 'david.mosca'))
  with check (public.fn_my_username() in ('admin', 'david.mosca'));

revoke all on public.planos_trabalho_versoes from anon;
grant select, insert, update, delete on public.planos_trabalho_versoes to authenticated;
