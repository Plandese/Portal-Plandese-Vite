alter table public.equipamentos
  add column if not exists codigo          text,
  add column if not exists matricula       text,
  add column if not exists marca_modelo    text,
  add column if not exists ano             integer,
  add column if not exists combustivel     text,
  add column if not exists propriedade     text not null default 'propria',
  add column if not exists estado          text not null default 'operacional',
  add column if not exists condutor        text,
  add column if not exists kms_horas       numeric,
  add column if not exists seguro_validade date,
  add column if not exists ipo_validade    date,
  add column if not exists fornecedor      text,
  add column if not exists data_aquisicao  date,
  add column if not exists valor_aquisicao numeric(12,2),
  add column if not exists garantia_ate    date,
  add column if not exists trello_id       text,
  add column if not exists trello_url      text,
  add column if not exists atualizado_em   timestamptz default now();

create unique index if not exists equipamentos_trello_id_key on public.equipamentos (trello_id);

create table if not exists public.eq_manutencoes (
  id         bigint generated always as identity primary key,
  equip_id   text not null references public.equipamentos(id) on delete cascade,
  data       date,
  descricao  text not null,
  custo      numeric(12,2),
  estado     text not null default 'pendente',
  origem     text not null default 'portal',
  criado_em  timestamptz not null default now()
);

create index if not exists eq_manutencoes_equip_idx on public.eq_manutencoes (equip_id);

alter table public.eq_manutencoes enable row level security;

create policy "anon read eq_manutencoes"  on public.eq_manutencoes for select using (true);
create policy "anon write eq_manutencoes" on public.eq_manutencoes for all using (true) with check (true);

grant select, insert, update, delete on public.eq_manutencoes to anon, authenticated;
