-- Calendário: partilhar um lembrete com pessoas específicas.
-- partilhado = true → toda a equipa; partilhado_com = lista de usernames com acesso de leitura.
alter table public.calendario_eventos
  add column if not exists partilhado_com text[] not null default '{}';

drop policy if exists "ler" on public.calendario_eventos;
create policy "ler" on public.calendario_eventos for select to authenticated
  using (public.fn_is_member() and (
    criado_por = public.fn_my_username()
    or partilhado
    or public.fn_my_username() = any(partilhado_com)
  ));
