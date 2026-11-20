-- Cada pessoa vê só a sua folha de ponto; o financeiro (e o admin) vê as de todos.
-- Os diretores de obra só leem as afetações (para lançarem a % nas suas obras sem passar de 100 %), nunca os dias.
drop policy if exists "ler" on public.fp_esc_dias;
create policy "ler" on public.fp_esc_dias for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','financeiro'));

drop policy if exists "ler" on public.fp_esc_afetacao;
create policy "ler" on public.fp_esc_afetacao for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','financeiro','diretor_obra'));
