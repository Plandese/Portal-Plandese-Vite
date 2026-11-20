-- Carteira de encomendas e balanço de faturação: acesso só ao perfil administrador (substitui a policy so_david).
drop policy if exists so_david on public.carteira_encomendas;
drop policy if exists so_david on public.carteira_faturacao;
drop policy if exists so_admin on public.carteira_encomendas;
drop policy if exists so_admin on public.carteira_faturacao;
create policy so_admin on public.carteira_encomendas for all to authenticated
  using (public.fn_my_role() = 'admin') with check (public.fn_my_role() = 'admin');
create policy so_admin on public.carteira_faturacao for all to authenticated
  using (public.fn_my_role() = 'admin') with check (public.fn_my_role() = 'admin');
