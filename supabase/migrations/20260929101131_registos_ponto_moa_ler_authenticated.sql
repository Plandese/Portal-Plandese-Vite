drop policy if exists "ler" on public.registos_ponto_moa;
create policy "ler" on public.registos_ponto_moa for select to authenticated
  using (fn_is_member() and (fn_my_role() <> 'encarregado' or encarregado_id = fn_my_username()));