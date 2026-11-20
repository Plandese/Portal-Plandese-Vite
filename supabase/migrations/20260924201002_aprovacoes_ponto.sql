-- Folha de ponto: aprovação DIÁRIA por obra pelo diretor de obra.
-- Uma linha = o dia de uma obra está aprovado. Não há aprovação trabalhador a trabalhador.
-- Pode aprovar/retirar a aprovação: o diretor da obra (obras.diretor_id) ou o admin.
-- Enquanto o dia estiver aprovado, os registos dessa obra/dia ficam bloqueados.
create table if not exists public.aprovacoes_ponto (
  obra_id      text not null references public.obras(id) on delete cascade,
  data         date not null,
  aprovado_por text not null default public.fn_my_username(),
  aprovado_em  timestamptz not null default now(),
  primary key (obra_id, data)
);

create index if not exists aprovacoes_ponto_data_idx on public.aprovacoes_ponto (data);

-- true se o utilizador atual pode aprovar esta obra
create or replace function public.fn_pode_aprovar_ponto(p_obra_id text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_my_role() = 'admin'
      or exists (select 1 from public.obras o
                  where o.id = p_obra_id and o.diretor_id = public.fn_my_username());
$$;

alter table public.aprovacoes_ponto enable row level security;

create policy "ler" on public.aprovacoes_ponto for select to authenticated
  using (public.fn_is_member());

create policy "aprovar" on public.aprovacoes_ponto for insert to authenticated
  with check (public.fn_pode_aprovar_ponto(obra_id) and aprovado_por = public.fn_my_username());

create policy "retirar" on public.aprovacoes_ponto for delete to authenticated
  using (public.fn_pode_aprovar_ponto(obra_id));

grant select, insert, delete on public.aprovacoes_ponto to authenticated;

-- Bloquear alterações a registos de um dia já aprovado
create or replace function public.fn_trg_ponto_dia_aprovado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.obra_id is not null and exists (
       select 1 from public.aprovacoes_ponto a where a.obra_id = old.obra_id and a.data = old.data) then
    raise exception 'Dia já aprovado pelo diretor de obra — retire a aprovação para alterar' using errcode = '42501';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.obra_id is not null and exists (
       select 1 from public.aprovacoes_ponto a where a.obra_id = new.obra_id and a.data = new.data) then
    raise exception 'Dia já aprovado pelo diretor de obra — retire a aprovação para alterar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ponto_dia_aprovado on public.registos_ponto;
create trigger trg_ponto_dia_aprovado
  before insert or update or delete on public.registos_ponto
  for each row execute function public.fn_trg_ponto_dia_aprovado();
