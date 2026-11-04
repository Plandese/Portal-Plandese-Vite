-- Compras (teste), fase 2: guias de remessa e faturas recebidas, ligadas (depois) às notas de encomenda.
-- Tabelas próprias ct_guias / ct_faturas, só administrador (também no servidor). A função guias-pdf aceita tabela «ct_guias».
create table if not exists ct_guias (
  id            bigint generated always as identity primary key,
  numero        text,
  numero_norm   text generated always as (nullif(regexp_replace(lower(coalesce(numero,'')), '[^a-z0-9]', '', 'g'), '')) stored,
  fornecedor    text,
  nif           text,
  data          date,
  obra_id       text,
  obra_nome     text,
  linhas        jsonb not null default '[]'::jsonb,       -- [{desc, ref_forn, qtd, un}]
  confianca     numeric,
  avisos        jsonb not null default '[]'::jsonb,
  foto_path     text,
  fotos         jsonb not null default '[]'::jsonb,
  paginas       integer not null default 1,
  pdf_path      text,
  pdf_em        timestamptz,
  enviado_por   text,                                     -- papel simulado (encarregado, diretor de obra…)
  encomenda_id  bigint references ct_encomendas(id) on delete set null,
  estado        text not null default 'por_casar' check (estado in ('por_casar','sugerida','casada','divergente')),
  sync_score    integer,
  sync_motivo   text,
  origem_gt_id  bigint,                                   -- guia copiada do teste anterior (gt_guias)
  criado_por    text not null,
  criado_em     timestamptz not null default now()
);
create unique index if not exists ct_guias_origem_gt on ct_guias(origem_gt_id) where origem_gt_id is not null;
create index if not exists ct_guias_encomenda on ct_guias(encomenda_id);

create table if not exists ct_faturas (
  id               bigint generated always as identity primary key,
  numero           text,
  numero_norm      text generated always as (nullif(regexp_replace(lower(coalesce(numero,'')), '[^a-z0-9]', '', 'g'), '')) stored,
  fornecedor       text,
  nif              text,
  data             date,
  data_vencimento  date,
  base             numeric,
  iva              numeric,
  total            numeric,
  centro_custo     text,
  linhas           jsonb not null default '[]'::jsonb,    -- [{desc, ref_forn, qtd, un, pu, total}]
  guias_ref        jsonb not null default '[]'::jsonb,    -- nºs de guia citados na fatura
  confianca        numeric,
  avisos           jsonb not null default '[]'::jsonb,
  fotos            jsonb not null default '[]'::jsonb,    -- páginas em imagem (bucket guias-remessa) para ver a fatura
  ficheiro         text,
  encomenda_id     bigint references ct_encomendas(id) on delete set null,
  estado           text not null default 'por_casar' check (estado in ('por_casar','sugerida','casada','divergente')),
  sync_score       integer,
  sync_motivo      text,
  criado_por       text not null,
  criado_em        timestamptz not null default now()
);
create index if not exists ct_faturas_encomenda on ct_faturas(encomenda_id);

do $$
declare t text;
begin
  foreach t in array array['ct_guias','ct_faturas'] loop
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
