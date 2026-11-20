create table public.eq_alugueres (
  id bigint generated always as identity primary key,
  equip_id text not null references public.equipamentos(id) on delete cascade,
  obra_nome text,
  entrega_em date not null default current_date,
  pedido_recolha_em date,
  recolhido_em date,
  criado_em timestamptz not null default now()
);
create index eq_alugueres_equip_idx on public.eq_alugueres(equip_id);
alter table public.eq_alugueres enable row level security;
create policy ler on public.eq_alugueres for select to authenticated using ((fn_cap('log') and not fn_sec_all_off(array['equipamentos'])) or fn_enc_mod('equipamentos'));
create policy inserir on public.eq_alugueres for insert to authenticated with check (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
create policy alterar on public.eq_alugueres for update to authenticated using (fn_cap('log') and not fn_sec_all_off(array['equipamentos'])) with check (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
create policy apagar on public.eq_alugueres for delete to authenticated using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
grant select, insert, update, delete on public.eq_alugueres to authenticated;
grant usage, select on sequence public.eq_alugueres_id_seq to authenticated;