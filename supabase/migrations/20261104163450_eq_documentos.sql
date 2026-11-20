-- Equipamentos: documentação (documentos, seguros, manutenções, garantias, sinistros, fotos)
create table if not exists eq_documentos (
  id bigserial primary key,
  equip_id text not null,
  categoria text not null check (categoria in ('documentos','seguros','manutencoes','garantias','sinistros','fotos')),
  nome text not null,
  path text not null,
  mime text,
  tamanho bigint,
  criado_em timestamptz not null default now(),
  criado_por text
);
create index if not exists eq_documentos_equip_idx on eq_documentos (equip_id, categoria);
alter table eq_documentos enable row level security;

create policy ler on eq_documentos for select to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
create policy inserir on eq_documentos for insert to authenticated
  with check (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
create policy apagar on eq_documentos for delete to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
grant select, insert, delete on eq_documentos to authenticated;
grant usage, select on sequence eq_documentos_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('eq-documentos', 'eq-documentos', false, 26214400)
on conflict (id) do nothing;

create policy eq_documentos_ler on storage.objects for select to authenticated
  using (bucket_id = 'eq-documentos' and fn_cap('log'));
create policy eq_documentos_inserir on storage.objects for insert to authenticated
  with check (bucket_id = 'eq-documentos' and fn_cap('log'));
create policy eq_documentos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'eq-documentos' and fn_cap('log'));
