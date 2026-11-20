-- Os dias da folha só os vê a própria pessoa e o financeiro (nem o admin vê os dos outros); só a própria pessoa os edita.
drop policy if exists "ler" on public.fp_esc_dias;
create policy "ler" on public.fp_esc_dias for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'financeiro');
drop policy if exists "inserir" on public.fp_esc_dias;
create policy "inserir" on public.fp_esc_dias for insert to authenticated with check (public.fn_colab_e_meu(colaborador));
drop policy if exists "alterar" on public.fp_esc_dias;
create policy "alterar" on public.fp_esc_dias for update to authenticated
  using (public.fn_colab_e_meu(colaborador)) with check (public.fn_colab_e_meu(colaborador));
drop policy if exists "apagar" on public.fp_esc_dias;
create policy "apagar" on public.fp_esc_dias for delete to authenticated using (public.fn_colab_e_meu(colaborador));
