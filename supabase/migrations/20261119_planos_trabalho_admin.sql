-- Planos de trabalho: o David entra no portal com a conta «admin» (perfil administrador);
-- a página passa a ser visível para os utilizadores admin e david.mosca (mais ninguém).
-- A interface aplica o mesmo limite em SOLO_USER_SECTIONS (permissions.js).
drop policy if exists so_david on public.planos_trabalho;
create policy so_david on public.planos_trabalho for all to authenticated
  using (public.fn_my_username() in ('admin', 'david.mosca'))
  with check (public.fn_my_username() in ('admin', 'david.mosca'));
