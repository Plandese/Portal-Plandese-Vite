create table public.necessidades_obra (
  id uuid primary key default gen_random_uuid(),
  obra_id text not null references public.obras(id) on delete cascade,
  semana date not null,                       -- segunda-feira da semana a que respeita a necessidade
  categoria text not null default 'materiais' check (categoria in ('materiais','mao_obra','equipamentos','logistica','subempreitada','outros')),
  descricao text not null,
  quantidade numeric,
  unidade text,
  urgencia text not null default 'normal' check (urgencia in ('normal','urgente','critica')),
  data_necessaria date,
  local_entrega text,
  observacoes text,
  estado text not null default 'pendente' check (estado in ('pendente','em_analise','em_compra','encomendado','entregue','cancelado')),
  resposta_compras text,
  criado_por text not null default public.fn_my_username(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index on public.necessidades_obra (semana, obra_id);
alter table public.necessidades_obra enable row level security;

create policy ler on public.necessidades_obra for select to authenticated using (public.fn_cap('cmp'));
create policy inserir on public.necessidades_obra for insert to authenticated with check (public.fn_cap('cmp'));
create policy alterar on public.necessidades_obra for update to authenticated using (public.fn_cap('cmp')) with check (public.fn_cap('cmp'));
create policy apagar on public.necessidades_obra for delete to authenticated using (public.fn_cap('cmp') and (public.fn_my_role() in ('admin','compras') or (criado_por = public.fn_my_username() and estado = 'pendente')));

create or replace function public.tg_necessidades_obra_upd() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := public.fn_my_username();
  -- só administrador/compras mudam o estado e a resposta; diretores só editam o conteúdo enquanto está pendente
  if public.fn_my_role() not in ('admin','compras') then
    if new.estado is distinct from old.estado or new.resposta_compras is distinct from old.resposta_compras then
      if not (new.estado = 'cancelado' and old.estado = 'pendente' and old.criado_por = public.fn_my_username() and new.resposta_compras is not distinct from old.resposta_compras) then
        raise exception 'Só o departamento de compras pode alterar o estado';
      end if;
    end if;
    if old.estado <> 'pendente' and old.estado is not distinct from new.estado and (new.descricao is distinct from old.descricao or new.quantidade is distinct from old.quantidade) then
      raise exception 'Necessidade já em tratamento — não pode ser alterada';
    end if;
  end if;
  return new;
end $$;
create trigger necessidades_obra_upd before update on public.necessidades_obra for each row execute function public.tg_necessidades_obra_upd();