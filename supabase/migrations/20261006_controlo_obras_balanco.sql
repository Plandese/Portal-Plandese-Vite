-- Controlo de Obras: balanço mensal por empreitada (partilhado, RLS pelo capítulo 'prod')
create table public.co_obra (
  obra_id     text primary key references public.obras(id) on delete cascade,
  sede_pct    numeric not null default 0,
  transferido numeric not null default 0,
  existencias numeric not null default 0,
  nota        text not null default '',
  atualizado  timestamptz not null default now()
);
create table public.co_mensal (
  obra_id   text not null references public.obras(id) on delete cascade,
  mes       text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  proveitos numeric not null default 0,
  mo numeric not null default 0, eq numeric not null default 0, mat numeric not null default 0,
  geral numeric not null default 0, sub numeric not null default 0, outros numeric not null default 0,
  atualizado timestamptz not null default now(),
  primary key (obra_id, mes)
);
alter table public.co_obra enable row level security;
alter table public.co_mensal enable row level security;
-- policies ler/inserir/alterar/apagar com fn_cap('prod') + grants a authenticated (ver migration aplicada)
