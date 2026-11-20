-- Guias com várias páginas: nº de páginas fotografadas e caminho de cada uma no bucket guias-remessa.
alter table public.guias_remessa
  add column if not exists paginas integer not null default 1,
  add column if not exists fotos jsonb not null default '[]'::jsonb;
