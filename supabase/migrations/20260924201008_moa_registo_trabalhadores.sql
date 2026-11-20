-- MO Aluguer: registo de trabalhadores pelo encarregado ou pelo diretor de obra.
-- Obrigatório: nome, empresa e função. Opcional: fotografia da cara (bucket privado).
-- O encarregado/diretor pode também criar a empresa cedente se ainda não existir.

-- 1. Colunas novas
alter table public.colaboradores_moa
  add column if not exists foto_path     text,
  add column if not exists registado_por text default public.fn_my_username(),
  add column if not exists registado_em  timestamptz default now();

-- Ligação do registo de ponto ao trabalhador registado (nome continua gravado para histórico)
alter table public.registos_ponto_moa
  add column if not exists colab_moa_id text;

-- 2. Quem pode registar trabalhadores/empresas: admin/"def", encarregado com módulo aluguer, diretor de obra
create or replace function public.fn_pode_registar_moa()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_cap('def') or public.fn_enc_mod('aluguer')
      or coalesce(public.fn_my_role() = 'diretor_obra', false);
$$;

drop policy if exists "inserir" on public.colaboradores_moa;
create policy "inserir" on public.colaboradores_moa for insert to authenticated
  with check (public.fn_pode_registar_moa());

drop policy if exists "alterar" on public.colaboradores_moa;
create policy "alterar" on public.colaboradores_moa for update to authenticated
  using (public.fn_pode_registar_moa()) with check (public.fn_pode_registar_moa());

-- Empresas: criar passa a ser permitido também a encarregados/diretores; alterar/apagar continua só "def"
drop policy if exists "inserir" on public.empresas_moa;
create policy "inserir" on public.empresas_moa for insert to authenticated
  with check (public.fn_pode_registar_moa());

grant select, insert, update on public.colaboradores_moa to authenticated;
grant select, insert on public.empresas_moa to authenticated;
grant select, insert, update on public.registos_ponto_moa to authenticated;

-- 3. Fotografias: bucket PRIVADO (dados pessoais) — só utilizadores do portal veem, via URL assinado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moa-fotos', 'moa-fotos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "moa_fotos_ler" on storage.objects for select to authenticated
  using (bucket_id = 'moa-fotos' and public.fn_is_member());

create policy "moa_fotos_inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'moa-fotos' and public.fn_pode_registar_moa());

create policy "moa_fotos_alterar" on storage.objects for update to authenticated
  using (bucket_id = 'moa-fotos' and public.fn_pode_registar_moa());

create policy "moa_fotos_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'moa-fotos' and public.fn_pode_registar_moa());
