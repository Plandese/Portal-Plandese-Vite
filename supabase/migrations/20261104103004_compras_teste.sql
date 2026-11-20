-- Compras (teste): pedido → cotações → nota de encomenda. Sistema separado do portal (tabelas ct_*),
-- só o administrador lê e escreve (também no servidor). Nada de pedidos_compra/faturas/guias_remessa é tocado.
create sequence if not exists ct_pedido_seq;
create sequence if not exists ct_encomenda_seq;

create table if not exists ct_pedidos (
  id            bigint generated always as identity primary key,
  numero        text not null unique default ('PC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ct_pedido_seq')::text, 3, '0')),
  obra_id       text,
  obra_nome     text,
  titulo        text not null,
  urgencia      text not null default 'Normal',
  data_necessaria date,
  local         text,
  notas         text,
  linhas        jsonb not null default '[]'::jsonb,   -- [{art_ref, desc, un, qtd}]
  estado        text not null default 'pedido' check (estado in ('pedido','cotacao','encomendado','parcial','entregue','faturado')),
  pedido_por    text,                                  -- papel simulado (diretor de obra, encarregado…)
  criado_por    text not null,
  criado_em     timestamptz not null default now()
);

create table if not exists ct_cotacoes (
  id            bigint generated always as identity primary key,
  pedido_id     bigint not null references ct_pedidos(id) on delete cascade,
  fornecedor_id uuid,
  fornecedor    text not null,
  nif           text,
  email         text,
  enviado_em    timestamptz,
  respondido_em timestamptz,
  prazo_dias    integer,
  condicoes     text,
  precos        jsonb not null default '[]'::jsonb,   -- [{linha, pu, total, disponivel}]
  total         numeric(12,2),
  escolhida     boolean not null default false,
  criado_por    text not null,
  criado_em     timestamptz not null default now()
);
create index if not exists ct_cotacoes_pedido on ct_cotacoes(pedido_id);

create table if not exists ct_encomendas (
  id            bigint generated always as identity primary key,
  numero        text not null unique default ('NE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ct_encomenda_seq')::text, 4, '0')),
  pedido_id     bigint references ct_pedidos(id) on delete set null,
  cotacao_id    bigint references ct_cotacoes(id) on delete set null,
  fornecedor_id uuid,
  fornecedor    text not null,
  nif           text,
  obra_id       text,
  obra_nome     text,
  linhas        jsonb not null default '[]'::jsonb,   -- [{desc, art_ref, un, qtd, pu, total}]
  total         numeric(12,2),
  estado        text not null default 'emitida' check (estado in ('emitida','parcial','completa','faturada')),
  notas         text,
  emitida_em    timestamptz not null default now(),
  criado_por    text not null,
  criado_em     timestamptz not null default now()
);
create index if not exists ct_encomendas_pedido on ct_encomendas(pedido_id);

do $$
declare t text;
begin
  foreach t in array array['ct_pedidos','ct_cotacoes','ct_encomendas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_ler', t);
    execute format('drop policy if exists %I on %I', t||'_inserir', t);
    execute format('drop policy if exists %I on %I', t||'_alterar', t);
    execute format('drop policy if exists %I on %I', t||'_apagar', t);
    execute format('create policy %I on %I for select to authenticated using (fn_my_role() = ''admin'')', t||'_ler', t);
    execute format('create policy %I on %I for insert to authenticated with check (fn_my_role() = ''admin'' and criado_por = fn_my_username())', t||'_inserir', t);
    execute format('create policy %I on %I for update to authenticated using (fn_my_role() = ''admin'') with check (fn_my_role() = ''admin'')', t||'_alterar', t);
    execute format('create policy %I on %I for delete to authenticated using (fn_my_role() = ''admin'')', t||'_apagar', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;
