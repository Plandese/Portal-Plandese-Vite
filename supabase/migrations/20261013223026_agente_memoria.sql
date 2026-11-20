-- Memória do assistente: factos e preferências que o utilizador pediu para ele guardar.
-- Só o próprio utilizador as vê e gere; entram no contexto do assistente em cada conversa.
create table if not exists public.agente_memoria (
  id         bigint generated always as identity primary key,
  utilizador text not null,
  texto      text not null check (length(texto) between 3 and 400),
  criado_em  timestamptz not null default now()
);
create index if not exists agente_memoria_user on public.agente_memoria (utilizador, criado_em desc);
alter table public.agente_memoria enable row level security;
drop policy if exists ler on public.agente_memoria;
create policy ler on public.agente_memoria for select to authenticated using (utilizador = fn_my_username());
drop policy if exists inserir on public.agente_memoria;
create policy inserir on public.agente_memoria for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null and fn_my_role() <> 'encarregado');
drop policy if exists apagar on public.agente_memoria;
create policy apagar on public.agente_memoria for delete to authenticated using (utilizador = fn_my_username());
revoke all on public.agente_memoria from anon, authenticated;
grant select, insert, delete on public.agente_memoria to authenticated;
