-- MO Aluguer: aprovação DIÁRIA por obra pelo diretor de obra (igual à MO Plandese,
-- ver 20260924_aprovacoes_ponto.sql). Tabela separada: aprovar a MO Plandese de um
-- dia não aprova a MO Aluguer desse dia, e vice-versa.
create table if not exists public.aprovacoes_ponto_moa (
  obra_id      text not null references public.obras(id) on delete cascade,
  data         date not null,
  aprovado_por text not null default public.fn_my_username(),
  aprovado_em  timestamptz not null default now(),
  primary key (obra_id, data)
);

create index if not exists aprovacoes_ponto_moa_data_idx on public.aprovacoes_ponto_moa (data);

alter table public.aprovacoes_ponto_moa enable row level security;

create policy "ler" on public.aprovacoes_ponto_moa for select to authenticated
  using (public.fn_is_member());

create policy "aprovar" on public.aprovacoes_ponto_moa for insert to authenticated
  with check (public.fn_pode_aprovar_ponto(obra_id) and aprovado_por = public.fn_my_username());

create policy "retirar" on public.aprovacoes_ponto_moa for delete to authenticated
  using (public.fn_pode_aprovar_ponto(obra_id));

grant select, insert, delete on public.aprovacoes_ponto_moa to authenticated;

-- Bloquear alterações a registos MOA de um dia já aprovado
create or replace function public.fn_trg_ponto_moa_dia_aprovado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.obra_id is not null and exists (
       select 1 from public.aprovacoes_ponto_moa a where a.obra_id = old.obra_id and a.data = old.data) then
    raise exception 'Dia já aprovado pelo diretor de obra — retire a aprovação para alterar' using errcode = '42501';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.obra_id is not null and exists (
       select 1 from public.aprovacoes_ponto_moa a where a.obra_id = new.obra_id and a.data = new.data) then
    raise exception 'Dia já aprovado pelo diretor de obra — retire a aprovação para alterar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ponto_moa_dia_aprovado on public.registos_ponto_moa;
create trigger trg_ponto_moa_dia_aprovado
  before insert or update or delete on public.registos_ponto_moa
  for each row execute function public.fn_trg_ponto_moa_dia_aprovado();
