-- Planos de trabalho: o Manuel Fonseca (manuel.fonseca) passa a ver e editar os planos,
-- além de admin e david.mosca. A interface aplica o mesmo limite em SOLO_USER_SECTIONS (permissions.js)
-- e a Edge Function agente-planos na lista AGENTE_PLANOS_UTILIZADORES.
do $$
begin
  if not exists (select 1 from public.utilizadores where username = 'manuel.fonseca') then
    raise exception 'Utilizador manuel.fonseca não existe em public.utilizadores';
  end if;
end $$;

drop policy if exists so_david on public.planos_trabalho;
create policy so_david on public.planos_trabalho for all to authenticated
  using (public.fn_my_username() in ('admin', 'david.mosca', 'manuel.fonseca'))
  with check (public.fn_my_username() in ('admin', 'david.mosca', 'manuel.fonseca'));

drop policy if exists so_david on public.planos_trabalho_versoes;
create policy so_david on public.planos_trabalho_versoes for all to authenticated
  using (public.fn_my_username() in ('admin', 'david.mosca', 'manuel.fonseca'))
  with check (public.fn_my_username() in ('admin', 'david.mosca', 'manuel.fonseca'));
