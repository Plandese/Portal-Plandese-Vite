-- O utilizador autenticado é diretor (principal ou extra) da obra com este nome?
create or replace function public.fn_is_diretor_obra(p_nome text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from public.utilizadores u
    join public.obras o on o.nome = p_nome
    where u.auth_id = auth.uid()
      and u.role = 'diretor_obra'
      and (
        o.diretor_id = u.username
        or exists (select 1 from public.obra_diretores_extra x
                   where x.obra_id = o.id and x.diretor_id = u.username)
      )
  );
$$;
revoke all on function public.fn_is_diretor_obra(text) from public, anon;
grant execute on function public.fn_is_diretor_obra(text) to authenticated;

-- Diretor de obra: lê as faturas "Aguarda diretor" das suas obras
create policy "diretor_ler_aprovar" on public.faturas
  for select to authenticated
  using (status = 'aguarda_diretor' and public.fn_is_diretor_obra(centro_custo));

-- Diretor de obra: aprova/rejeita (carimbo) as faturas das suas obras
create policy "diretor_aprovar" on public.faturas
  for update to authenticated
  using (status = 'aguarda_diretor' and public.fn_is_diretor_obra(centro_custo))
  with check (status in ('aguarda_diretor','aprovada','rejeitada') and public.fn_is_diretor_obra(centro_custo));