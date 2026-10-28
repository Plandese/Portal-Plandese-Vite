-- Guias de remessa: o encarregado fotografa a guia que recebe em obra, a app lê-a e casa-a com a fatura.
-- Fase de TESTE: só os utilizadores listados em app_config 'guias'.teste veem o ecrã; as faturas só são
-- suspensas quando app_config 'guias'.ativo = true. Tudo o resto fica como estava.

-- Interruptor (admin altera em app_config): ativo=false → nada é aplicado às faturas
insert into public.app_config(key, value)
values ('guias', '{"ativo": false, "teste": ["david.mosca"]}'::jsonb)
on conflict (key) do nothing;

-- Números de guia referidos na fatura (lidos pelo Claude) e resultado do casamento
alter table public.faturas
  add column if not exists guias_ref jsonb not null default '[]'::jsonb,
  add column if not exists guia_estado text check (guia_estado in ('ok', 'suspensa')),
  add column if not exists guia_resumo jsonb;

create table if not exists public.guias_remessa (
  id bigint generated always as identity primary key,
  numero text not null,
  numero_norm text generated always as (upper(regexp_replace(numero, '[^A-Za-z0-9]', '', 'g'))) stored,
  fornecedor text,
  nif text,
  data date,
  obra_id text,
  obra_nome text,
  linhas jsonb not null default '[]'::jsonb,
  confianca numeric,
  avisos jsonb not null default '[]'::jsonb,
  foto_path text,
  criado_por text not null default public.fn_my_username(),
  criado_em timestamptz not null default now(),
  teste boolean not null default true,
  fatura_id bigint references public.faturas(id) on delete set null,
  estado text not null default 'por_casar' check (estado in ('por_casar', 'casada', 'divergente')),
  divergencias jsonb not null default '[]'::jsonb,
  casada_em timestamptz
);
create index if not exists guias_remessa_norm_idx on public.guias_remessa (numero_norm, nif);
create index if not exists guias_remessa_fatura_idx on public.guias_remessa (fatura_id);

alter table public.guias_remessa enable row level security;
create policy "ler" on public.guias_remessa for select to authenticated
  using (criado_por = public.fn_my_username() or public.fn_my_role() in ('admin', 'financeiro', 'diretor_obra') or public.fn_cap('fin'));
create policy "inserir" on public.guias_remessa for insert to authenticated
  with check (criado_por = public.fn_my_username());
create policy "alterar" on public.guias_remessa for update to authenticated
  using (criado_por = public.fn_my_username() or public.fn_my_role() = 'admin')
  with check (criado_por = public.fn_my_username() or public.fn_my_role() = 'admin');
create policy "apagar" on public.guias_remessa for delete to authenticated
  using ((criado_por = public.fn_my_username() and teste) or public.fn_my_role() = 'admin');

-- O encarregado não lê faturas (RLS): estas funções devolvem só o mínimo para casar (sem preços).
create or replace function public.fn_guia_candidatas(p_norm text, p_nif text)
returns table (id bigint, numero text, fornecedor text, nif text, data date, status text, centro_custo text, guias_ref jsonb, linhas jsonb)
language sql stable security definer set search_path = public as $$
  select f.id, f.numero, f.fornecedor, f.nif, f.data, f.status, f.centro_custo, f.guias_ref,
         coalesce((select jsonb_agg(jsonb_build_object('desc', l->>'desc', 'ref_forn', l->>'ref_forn', 'qtd', l->'qtd', 'un', l->>'un'))
                     from jsonb_array_elements(f.linhas) l), '[]'::jsonb)
    from faturas f
   where public.fn_is_member()
     and (p_nif is null or p_nif = '' or f.nif = p_nif)
     and exists (select 1 from jsonb_array_elements_text(f.guias_ref) g
                  where upper(regexp_replace(g, '[^A-Za-z0-9]', '', 'g')) = p_norm)
$$;

-- Faturas do mesmo fornecedor (para ligar à mão durante os testes) — sem valores
create or replace function public.fn_guia_sugestoes(p_nif text)
returns table (id bigint, numero text, data date, status text)
language sql stable security definer set search_path = public as $$
  select f.id, f.numero, f.data, f.status
    from faturas f
   where public.fn_is_member() and p_nif is not null and p_nif <> '' and f.nif = p_nif
   order by f.data desc nulls last, f.id desc
   limit 12
$$;

create or replace function public.fn_guia_fatura(p_fatura_id bigint)
returns table (id bigint, numero text, fornecedor text, nif text, data date, status text, centro_custo text, guias_ref jsonb, linhas jsonb)
language sql stable security definer set search_path = public as $$
  select f.id, f.numero, f.fornecedor, f.nif, f.data, f.status, f.centro_custo, f.guias_ref,
         coalesce((select jsonb_agg(jsonb_build_object('desc', l->>'desc', 'ref_forn', l->>'ref_forn', 'qtd', l->'qtd', 'un', l->>'un'))
                     from jsonb_array_elements(f.linhas) l), '[]'::jsonb)
    from faturas f
   where public.fn_is_member() and f.id = p_fatura_id
$$;

-- Aplica o resultado à fatura (suspende / levanta a suspensão) — só com o interruptor ativo
create or replace function public.fn_guia_aplicar(p_fatura_id bigint, p_estado text, p_resumo jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_is_member() then return false; end if;
  if coalesce((select value->>'ativo' from app_config where key = 'guias'), 'false') <> 'true' then return false; end if;
  if p_estado not in ('ok', 'suspensa') then return false; end if;
  update faturas set guia_estado = p_estado, guia_resumo = p_resumo
   where id = p_fatura_id and status in ('aguarda_diretor', 'pendente_aprovacao', 'extraida', 'rever');
  return found;
end $$;

grant execute on function public.fn_guia_candidatas(text, text), public.fn_guia_sugestoes(text),
  public.fn_guia_fatura(bigint), public.fn_guia_aplicar(bigint, text, jsonb) to authenticated;

-- Fotografias das guias (privado)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guias-remessa', 'guias-remessa', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy "guias_remessa_inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'guias-remessa' and public.fn_is_member());
create policy "guias_remessa_ler" on storage.objects for select to authenticated
  using (bucket_id = 'guias-remessa' and public.fn_is_member());
create policy "guias_remessa_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'guias-remessa' and public.fn_is_member());
