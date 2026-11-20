-- Estrutura Central: as faturas do centro de custo O099 (CC Estrutura central) só são visíveis/editáveis
-- pela área financeira (administrador + perfil financeiro) e só se a sub-página «estrutura-central»
-- não estiver bloqueada para essa pessoa na matriz de permissões.
-- Política RESTRITIVA: soma-se às existentes (ler/alterar/inserir/apagar/diretor_*), não as substitui.
drop policy if exists estrutura_central_so_financeiro on public.faturas;
create policy estrutura_central_so_financeiro on public.faturas
  as restrictive for all to authenticated
  using (
    coalesce(centro_custo, '') not ilike 'O099%'
    or (public.fn_my_role() in ('admin', 'financeiro') and not public.fn_sec_off('estrutura-central'))
  )
  with check (
    coalesce(centro_custo, '') not ilike 'O099%'
    or (public.fn_my_role() in ('admin', 'financeiro') and not public.fn_sec_off('estrutura-central'))
  );
