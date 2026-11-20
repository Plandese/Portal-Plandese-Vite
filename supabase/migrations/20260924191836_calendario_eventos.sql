-- Calendário: lembretes e datas importantes.
-- Cada evento é pessoal (só o autor vê) ou partilhado (toda a equipa vê).
-- Só o autor pode alterar ou apagar. hora NULL = dia inteiro; anual = repete todos os anos.
create table if not exists public.calendario_eventos (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  notas       text,
  data        date not null,
  hora        time,
  categoria   text not null default 'lembrete'
              check (categoria in ('lembrete','importante','reuniao','aniversario','outro')),
  anual       boolean not null default false,
  partilhado  boolean not null default false,
  concluido   boolean not null default false,
  criado_por  text not null default public.fn_my_username(),
  criado_em   timestamptz not null default now()
);

create index if not exists calendario_eventos_data_idx on public.calendario_eventos (data);
create index if not exists calendario_eventos_autor_idx on public.calendario_eventos (criado_por);

alter table public.calendario_eventos enable row level security;

create policy "ler" on public.calendario_eventos for select to authenticated
  using (public.fn_is_member() and (criado_por = public.fn_my_username() or partilhado));

create policy "inserir" on public.calendario_eventos for insert to authenticated
  with check (criado_por = public.fn_my_username());

create policy "alterar" on public.calendario_eventos for update to authenticated
  using (criado_por = public.fn_my_username())
  with check (criado_por = public.fn_my_username());

create policy "apagar" on public.calendario_eventos for delete to authenticated
  using (criado_por = public.fn_my_username());
