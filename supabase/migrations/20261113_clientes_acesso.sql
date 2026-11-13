-- Módulo Clientes (Balanço de Faturação e Carteira de Encomendas): administradores + utilizadores da lista app_config/clientes_acesso.
insert into public.app_config(key, value) values ('clientes_acesso', '["ana.toscano"]'::jsonb)
on conflict (key) do nothing;

create or replace function public.fn_clientes_acesso()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.fn_my_role() = 'admin'
      or coalesce((select c.value ? public.fn_my_username() from public.app_config c where c.key = 'clientes_acesso'), false);
$$;
revoke all on function public.fn_clientes_acesso() from public, anon;
grant execute on function public.fn_clientes_acesso() to authenticated;

drop policy if exists so_admin on public.carteira_encomendas;
drop policy if exists so_admin on public.carteira_faturacao;
create policy clientes_acesso on public.carteira_encomendas for all to authenticated
  using (public.fn_clientes_acesso()) with check (public.fn_clientes_acesso());
create policy clientes_acesso on public.carteira_faturacao for all to authenticated
  using (public.fn_clientes_acesso()) with check (public.fn_clientes_acesso());
