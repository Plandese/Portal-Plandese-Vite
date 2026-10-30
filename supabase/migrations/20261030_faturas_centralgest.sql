-- Tesouraria: marca se a fatura já foi lançada no CentralGest (e por quem/quando)
alter table public.faturas
  add column if not exists centralgest_lancada boolean not null default false,
  add column if not exists centralgest_por     text,
  add column if not exists centralgest_em      timestamptz;
