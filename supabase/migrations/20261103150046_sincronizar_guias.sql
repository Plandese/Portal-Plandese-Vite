-- Sincronização automática das guias de remessa com as faturas.
-- O motor corre na base de dados: dispara quando chega uma guia (ou a leitura dos artigos) ou uma fatura, e de 15 em 15 minutos.
-- Fase 1 — referência: a fatura refere o nº da guia; só sincroniza se a obra, o NIF, a data e o material fizerem sentido.
-- Fase 2 — sem referência: procura entregas consecutivas (por data) da mesma obra cuja soma de quantidades (ou de valor) coincide com a fatura.
-- O que não fizer sentido fica pendente, com a explicação em sync_nota. «Remover sincronização» marca sync_bloqueada e o motor deixa de mexer na guia.

alter table guias_remessa
  add column if not exists sync_auto boolean not null default false,
  add column if not exists sync_score int,
  add column if not exists sync_motivo text,
  add column if not exists sync_nota text,
  add column if not exists sync_em timestamptz,
  add column if not exists sync_bloqueada boolean not null default false;

create or replace function fn_sync_norm(t text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function fn_sync_obra(t text) returns text language sql immutable as $$
  select substring(coalesce(t, '') from 'O[0-9]{2,3}')
$$;

-- materiais (sem transportes) e quantidades de uma lista de linhas
create or replace function fn_sync_mats(p jsonb) returns table(mat text, qtd numeric) language sql immutable as $$
  select fn_sync_norm(l->>'desc') as mat,
         sum(case when coalesce(l->>'qtd', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l->>'qtd')::numeric else 0 end) as qtd
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) l
  where fn_sync_norm(l->>'desc') <> ''
    and fn_sync_norm(l->>'desc') !~ '^transp'
    and fn_sync_norm(l->>'desc') !~ 'custo adicional'
  group by 1
$$;

-- preço unitário de um material, na fatura mais próxima da data (de preferência da mesma obra: os preços variam por obra)
drop function if exists fn_sync_preco(text, date);
create or replace function fn_sync_preco(p_mat text, p_data date, p_obra text default null) returns numeric language sql stable as $$
  select (l->>'pu')::numeric
  from faturas f, jsonb_array_elements(case when jsonb_typeof(f.linhas) = 'array' then f.linhas else '[]'::jsonb end) l
  where f.data is not null
    and fn_sync_norm(l->>'desc') = p_mat
    and coalesce(l->>'pu', '') ~ '^[0-9]+(\.[0-9]+)?$' and (l->>'pu')::numeric > 0
  order by (fn_sync_obra(f.centro_custo) is not distinct from p_obra) desc, abs(f.data - p_data), f.id
  limit 1
$$;

create or replace function fn_sincronizar_guias(p_nif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g record; f record; esc record; nifdif boolean := false;
  cand bigint[]; razoes text[]; alvo jsonb; modo text;
  gd date; sc int; mot text; nc int; nlin int; d1 date; d2 date; nq numeric;
  n_ref int := 0; n_jan int := 0; n_pend int;
begin
  perform pg_advisory_xact_lock(7712001);

  create temp table if not exists _srefs (n text) on commit drop;
  create temp table if not exists _sg (ord int, id bigint, gd date) on commit drop;
  create temp table if not exists _sgm (ord int, mat text, qtd numeric, val numeric) on commit drop;
  create temp table if not exists _sw (i int, j int, q jsonb, v numeric) on commit drop;
  create temp table if not exists _sc (i int, j int, rd numeric) on commit drop;

  truncate _srefs;
  insert into _srefs
    select distinct upper(regexp_replace(r.v, '[^A-Za-z0-9]', '', 'g'))
    from faturas x, jsonb_array_elements_text(case when jsonb_typeof(x.guias_ref) = 'array' then x.guias_ref else '[]'::jsonb end) r(v)
    where x.status is distinct from 'rejeitada' and upper(regexp_replace(r.v, '[^A-Za-z0-9]', '', 'g')) <> '';

  update guias_remessa set sync_nota = null where fatura_id is null and not sync_bloqueada and sync_nota is not null;

  -- Fase 1: a fatura refere o nº da guia
  for g in select * from guias_remessa where fatura_id is null and not sync_bloqueada and numero_norm is not null and (p_nif is null or nif = p_nif) order by id loop
    select array_agg(s.id) into cand from (
      select distinct on (x.numero) x.id from faturas x
      where x.status is distinct from 'rejeitada' and exists (
        select 1 from _srefs r where r.n = g.numero_norm
          or (least(length(r.n), length(g.numero_norm)) >= 5 and (r.n like '%' || g.numero_norm or g.numero_norm like '%' || r.n))
      ) and exists (
        select 1 from jsonb_array_elements_text(case when jsonb_typeof(x.guias_ref) = 'array' then x.guias_ref else '[]'::jsonb end) q(v)
        where upper(regexp_replace(q.v, '[^A-Za-z0-9]', '', 'g')) = g.numero_norm
          or (least(length(upper(regexp_replace(q.v, '[^A-Za-z0-9]', '', 'g'))), length(g.numero_norm)) >= 5
              and (upper(regexp_replace(q.v, '[^A-Za-z0-9]', '', 'g')) like '%' || g.numero_norm or g.numero_norm like '%' || upper(regexp_replace(q.v, '[^A-Za-z0-9]', '', 'g'))))
      ) order by x.numero, x.id) s;
    if cand is null then continue; end if;
    if cardinality(cand) > 1 then
      update guias_remessa set sync_nota = 'Mais do que uma fatura refere esta guia; fica para decisão manual.', sync_em = now() where id = g.id;
      continue;
    end if;
    select * into f from faturas where id = cand[1];
    gd := coalesce(g.data, g.criado_em::date);
    razoes := '{}';
    if fn_sync_obra(g.obra_nome) is not null and fn_sync_obra(f.centro_custo) is not null and fn_sync_obra(g.obra_nome) <> fn_sync_obra(f.centro_custo) then
      razoes := razoes || ('a obra é diferente (' || fn_sync_obra(g.obra_nome) || ' / ' || fn_sync_obra(f.centro_custo) || ')');
    end if;
    nifdif := false;
    if g.nif is not null and f.nif is not null and g.nif <> f.nif then
      -- a leitura do NIF falha às vezes (apanha o do cliente): se o fornecedor é o mesmo, só baixa a confiança
      if split_part(fn_sync_norm(g.fornecedor), ' ', 1) <> '' and split_part(fn_sync_norm(g.fornecedor), ' ', 1) = split_part(fn_sync_norm(f.fornecedor), ' ', 1) then nifdif := true;
      else razoes := razoes || 'o NIF e o fornecedor são diferentes'::text; end if;
    end if;
    if f.data is not null and (gd > f.data + 3 or gd < f.data - 75) then
      razoes := razoes || ('a data da guia (' || to_char(gd, 'DD/MM/YYYY') || ') não condiz com a da fatura (' || to_char(f.data, 'DD/MM/YYYY') || ')');
    end if;
    if exists (select 1 from fn_sync_mats(f.linhas)) and exists (select 1 from fn_sync_mats(g.linhas))
       and not exists (select 1 from fn_sync_mats(g.linhas) a join fn_sync_mats(f.linhas) b using (mat)) then
      razoes := razoes || 'o material é diferente do faturado'::text;
    end if;
    if cardinality(razoes) = 0 then
      sc := (case when f.data is not null and f.data - gd > 30 then 90 else 95 end) - (case when nifdif then 15 else 0 end);
      mot := 'Nº da guia referido na fatura ' || right(f.numero, 10) || case when nifdif then ' · atenção: o NIF lido na guia (' || g.nif || ') difere do da fatura' else '' end
        || case when fn_sync_obra(g.obra_nome) is not null and fn_sync_obra(f.centro_custo) is not null then ' · mesma obra (' || fn_sync_obra(g.obra_nome) || ')' else '' end
        || case when f.data is not null then ' · entrega ' || greatest(f.data - gd, 0) || ' dia(s) antes da fatura' else '' end
        || case when exists (select 1 from fn_sync_mats(f.linhas)) and exists (select 1 from fn_sync_mats(g.linhas)) then ' · material coincide' else '' end;
      update guias_remessa set fatura_id = f.id, estado = 'casada', casada_em = now(), sync_auto = true, sync_score = sc, sync_motivo = mot, sync_nota = null, sync_em = now() where id = g.id;
      n_ref := n_ref + 1;
    else
      update guias_remessa set sync_nota = 'A fatura ' || f.numero || ' refere esta guia, mas ' || array_to_string(razoes, '; ') || '.', sync_em = now() where id = g.id;
    end if;
  end loop;

  -- Fase 2: faturas sem referências — entregas consecutivas que somam o faturado
  for f in select * from faturas x
    where x.status is distinct from 'rejeitada' and x.data is not null and x.nif is not null and (p_nif is null or x.nif = p_nif)
      and coalesce(jsonb_array_length(case when jsonb_typeof(x.guias_ref) = 'array' then x.guias_ref else '[]'::jsonb end), 0) = 0
      and not exists (select 1 from guias_remessa y where y.fatura_id = x.id)
    order by x.data, x.id loop
    select coalesce(jsonb_object_agg(mat, qtd), '{}'::jsonb) into alvo from fn_sync_mats(f.linhas);
    modo := case when alvo <> '{}'::jsonb then 'qtd' when coalesce(f.base, 0) > 0 then 'valor' else null end;
    if modo is null then continue; end if;
    truncate _sg, _sgm, _sw, _sc;
    insert into _sg
      select (row_number() over (order by t.gd, t.numero_norm, t.id))::int, t.id, t.gd from (
        select y.id, y.numero_norm, coalesce(y.data, y.criado_em::date) gd, y.linhas, y.obra_nome, y.nif, y.fornecedor from guias_remessa y
        where y.fatura_id is null and not y.sync_bloqueada and y.numero_norm is not null
      ) t
      where (t.nif is null or t.nif = f.nif or (split_part(fn_sync_norm(t.fornecedor), ' ', 1) <> '' and split_part(fn_sync_norm(t.fornecedor), ' ', 1) = split_part(fn_sync_norm(f.fornecedor), ' ', 1)))
        and not (fn_sync_obra(t.obra_nome) is not null and fn_sync_obra(f.centro_custo) is not null and fn_sync_obra(t.obra_nome) <> fn_sync_obra(f.centro_custo))
        and t.gd between f.data - 75 and f.data + 3
        and exists (select 1 from fn_sync_mats(t.linhas))
        and (modo = 'valor' or not exists (select 1 from fn_sync_mats(t.linhas) m where not (alvo ? m.mat)))
        and not exists (select 1 from _srefs r where r.n = t.numero_norm
              or (least(length(r.n), length(t.numero_norm)) >= 5 and (r.n like '%' || t.numero_norm or t.numero_norm like '%' || r.n)));
    if not exists (select 1 from _sg) then continue; end if;
    insert into _sgm
      select s.ord, m.mat, m.qtd, m.qtd * fn_sync_preco(m.mat, s.gd, fn_sync_obra(f.centro_custo))
      from _sg s join guias_remessa y on y.id = s.id cross join lateral fn_sync_mats(y.linhas) m;
    insert into _sw
      select a.ord, b.ord,
        (select jsonb_object_agg(z.mat, z.s) from (select mat, sum(qtd) s from _sgm where ord between a.ord and b.ord group by mat) z),
        (select case when bool_or(val is null) then null else sum(val) end from _sgm where ord between a.ord and b.ord)
      from _sg a join _sg b on b.ord >= a.ord;
    if modo = 'qtd' then
      insert into _sc
        select w.i, w.j, d.rd from _sw w cross join lateral (
          select count(*) filter (where not (w.q ? a.k)) miss,
                 max(abs(coalesce((w.q->>a.k)::numeric, 0) - a.t::numeric) / nullif(a.t::numeric, 0)) rd
          from jsonb_each_text(alvo) a(k, t)
        ) d
        where d.miss = 0 and d.rd <= 0.005
          and (select count(*) from jsonb_object_keys(w.q)) = (select count(*) from jsonb_object_keys(alvo));
    else
      insert into _sc select w.i, w.j, abs(w.v - f.base) from _sw w where w.v is not null and abs(w.v - f.base) <= 0.30;
    end if;
    select count(*) into nc from _sc;
    if nc = 0 then continue; end if;
    select * into esc from _sc order by (i = 1) desc, rd, i limit 1;
    if nc > 1 and esc.i <> 1 then continue; end if;   -- várias combinações possíveis e nenhuma começa na entrega mais antiga: decisão manual
    sc := case when modo = 'qtd' then (case when esc.rd <= 0.0003 then 90 when esc.rd <= 0.002 then 80 else 72 end)
               else (case when esc.rd <= 0.10 then 90 else 78 end) end - (case when nc > 1 then 8 else 0 end);
    select min(s.gd), max(s.gd), count(*) into d1, d2, nlin from _sg s where s.ord between esc.i and esc.j;
    select sum(qtd) into nq from _sgm where ord between esc.i and esc.j;
    mot := 'Sem referência na fatura · ' || nlin || ' entrega(s) de ' || to_char(d1, 'DD/MM') || ' a ' || to_char(d2, 'DD/MM')
      || case when modo = 'qtd' then ' somam ' || round(nq, 2) || ' t, como o faturado' else ' valem ' || round(f.base, 2) || ' € (base da fatura)' end
      || case when fn_sync_obra(f.centro_custo) is not null then ' · mesma obra (' || fn_sync_obra(f.centro_custo) || ')' else '' end
      || ' · fatura ' || greatest(f.data - d2, 0) || ' dia(s) depois da última entrega';
    update guias_remessa y set fatura_id = f.id, estado = 'casada', casada_em = now(), sync_auto = true, sync_score = sc, sync_motivo = mot, sync_nota = null, sync_em = now()
      from _sg s where s.id = y.id and s.ord between esc.i and esc.j;
    n_jan := n_jan + nlin;
  end loop;

  update guias_remessa set sync_em = now(),
    sync_nota = coalesce(sync_nota, 'Nenhuma fatura da mesma obra e fornecedor cobre esta entrega (ou a fatura ainda não chegou).')
    where fatura_id is null and not sync_bloqueada;
  select count(*) into n_pend from guias_remessa where fatura_id is null and not sync_bloqueada;
  return jsonb_build_object('por_referencia', n_ref, 'por_conjunto', n_jan, 'pendentes', n_pend);
end $$;

revoke all on function fn_sincronizar_guias(text) from public, anon;
grant execute on function fn_sincronizar_guias(text) to authenticated, service_role;

-- Disparo automático (nunca impede a gravação de uma guia ou fatura)
create or replace function trg_sincronizar_guias() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform fn_sincronizar_guias(); exception when others then raise warning 'sincronizar_guias: %', sqlerrm; end;
  return null;
end $$;

drop trigger if exists guias_sincronizar on guias_remessa;
create trigger guias_sincronizar after insert or update of linhas, numero, data, obra_nome, nif, sync_bloqueada on guias_remessa
  for each row when (new.fatura_id is null) execute function trg_sincronizar_guias();

drop trigger if exists faturas_sincronizar on faturas;
create trigger faturas_sincronizar after insert or update of guias_ref, linhas, base, data, centro_custo, status, nif on faturas
  for each row execute function trg_sincronizar_guias();

-- Rede de segurança: de 15 em 15 minutos
select cron.unschedule('sincronizar-guias') where exists (select 1 from cron.job where jobname = 'sincronizar-guias');
select cron.schedule('sincronizar-guias', '*/15 * * * *', 'select public.fn_sincronizar_guias()');
