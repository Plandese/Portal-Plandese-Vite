-- O administrador volta a ver as folhas de ponto (dias e afetação) de todos; continua a editar apenas a própria pessoa.
drop policy if exists "ler" on public.fp_esc_dias;
create policy "ler" on public.fp_esc_dias for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','financeiro'));

drop policy if exists "ler" on public.fp_esc_afetacao;
create policy "ler" on public.fp_esc_afetacao for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','financeiro'));
