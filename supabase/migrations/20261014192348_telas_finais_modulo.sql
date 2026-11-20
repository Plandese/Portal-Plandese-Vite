-- Telas Finais: módulo com acesso restrito a uma lista de utilizadores (editável pelo admin em app_config)
-- (já aplicada no projeto Supabase em 2026-10-14; ficheiro guardado para registo)
insert into public.app_config(key, value)
values ('telas_finais_acesso', '["admin","david.mosca","rui.alves"]'::jsonb)
on conflict (key) do nothing;

create or replace function public.fn_tf_acesso()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select c.value ? public.fn_my_username() from public.app_config c where c.key = 'telas_finais_acesso'),
    false);
$$;
revoke all on function public.fn_tf_acesso() from public, anon;
grant execute on function public.fn_tf_acesso() to authenticated;

create table if not exists public.tf_telas (
  sheet_id   text primary key,
  objects    jsonb not null default '[]'::jsonb,
  rev        text,
  client     text,
  updated_at timestamptz not null default now(),
  updated_by text default public.fn_my_username()
);
create table if not exists public.tf_biblioteca (
  id         uuid primary key default gen_random_uuid(),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  created_by text default public.fn_my_username()
);
create table if not exists public.tf_folhas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  path       text not null,
  pages      int not null default 1,
  created_at timestamptz not null default now(),
  created_by text default public.fn_my_username()
);
alter table public.tf_telas enable row level security;
alter table public.tf_biblioteca enable row level security;
alter table public.tf_folhas enable row level security;
create policy tf_telas_all on public.tf_telas for all to authenticated using (public.fn_tf_acesso()) with check (public.fn_tf_acesso());
create policy tf_biblioteca_all on public.tf_biblioteca for all to authenticated using (public.fn_tf_acesso()) with check (public.fn_tf_acesso());
create policy tf_folhas_all on public.tf_folhas for all to authenticated using (public.fn_tf_acesso()) with check (public.fn_tf_acesso());
alter publication supabase_realtime add table public.tf_telas;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('telas-finais', 'telas-finais', false, 26214400, array['application/pdf','application/json'])
on conflict (id) do nothing;
create policy tf_storage_ler on storage.objects for select to authenticated using (bucket_id = 'telas-finais' and public.fn_tf_acesso());
create policy tf_storage_inserir on storage.objects for insert to authenticated with check (bucket_id = 'telas-finais' and public.fn_tf_acesso());
create policy tf_storage_alterar on storage.objects for update to authenticated using (bucket_id = 'telas-finais' and public.fn_tf_acesso()) with check (bucket_id = 'telas-finais' and public.fn_tf_acesso());
create policy tf_storage_apagar on storage.objects for delete to authenticated using (bucket_id = 'telas-finais' and public.fn_tf_acesso());
