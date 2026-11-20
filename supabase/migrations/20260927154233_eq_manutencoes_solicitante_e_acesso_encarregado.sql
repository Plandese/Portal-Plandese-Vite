alter table public.eq_manutencoes
  add column if not exists solicitante_nome text,
  add column if not exists obra_nome text;

drop policy if exists inserir on public.eq_manutencoes;
create policy inserir on public.eq_manutencoes for insert to authenticated
  with check (fn_cap('log') or fn_enc_mod('equipamentos'));

drop policy if exists ler on public.eq_manutencoes;
create policy ler on public.eq_manutencoes for select to authenticated
  using (fn_cap('log') or fn_enc_mod('equipamentos'));
