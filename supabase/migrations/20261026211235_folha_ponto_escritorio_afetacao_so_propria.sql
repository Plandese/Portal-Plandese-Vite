-- A afetação também só a vê a própria pessoa e o financeiro.
drop policy if exists "ler" on public.fp_esc_afetacao;
create policy "ler" on public.fp_esc_afetacao for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'financeiro');
