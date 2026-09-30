-- Fotografias nos pedidos de manutenção de equipamentos
alter table public.eq_manutencoes add column if not exists fotos text[] not null default '{}';

-- Bucket privado; leitura via URL assinado por membros do portal
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eq-manut-fotos', 'eq-manut-fotos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "eq_manut_fotos_ler" on storage.objects;
create policy "eq_manut_fotos_ler" on storage.objects for select to authenticated
  using (bucket_id = 'eq-manut-fotos' and public.fn_is_member());

drop policy if exists "eq_manut_fotos_inserir" on storage.objects;
create policy "eq_manut_fotos_inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'eq-manut-fotos' and public.fn_is_member());

drop policy if exists "eq_manut_fotos_apagar" on storage.objects;
create policy "eq_manut_fotos_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'eq-manut-fotos' and public.fn_is_member());
