
create table if not exists public.tavira_topicos (
  id uuid primary key default gen_random_uuid(),
  obra text not null,
  rua text not null,
  descricao text not null,
  reclamacao boolean default false,
  custom boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.tavira_estado (
  topico_id text primary key,
  done boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.tavira_fotos (
  id uuid primary key default gen_random_uuid(),
  topico_id text not null,
  data text not null,
  created_at timestamptz default now()
);

alter table public.tavira_topicos enable row level security;
alter table public.tavira_estado enable row level security;
alter table public.tavira_fotos enable row level security;

create policy "public_all_topicos" on public.tavira_topicos for all using (true) with check (true);
create policy "public_all_estado" on public.tavira_estado for all using (true) with check (true);
create policy "public_all_fotos" on public.tavira_fotos for all using (true) with check (true);
