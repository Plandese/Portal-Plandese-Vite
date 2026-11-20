-- ═══════════════════════════════════════════════════════════════════════════
-- Folha de ponto: permitir vários registos por colaborador/dia
-- (várias obras no mesmo dia e vários encarregados) sem sobrescrever.
--
-- Correr no SQL Editor do projeto Supabase CORRETO: zcigwqvqmqatcivkrrsw
-- (NÃO no projeto antigo kohhtikukzwvwqtnwgvk.)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Coluna que identifica o encarregado que fez o registo
alter table public.registos_ponto add column if not exists encarregado_id text;

-- 2. Remover TODAS as unique constraints atuais (robusto quanto ao nome)
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where rel.relname = 'registos_ponto' and n.nspname = 'public' and con.contype = 'u'
  loop
    execute format('alter table public.registos_ponto drop constraint %I', c.conname);
  end loop;
end $$;

-- 3. Nova unique composta. NULLS NOT DISTINCT trata obra/encarregado nulos como
--    iguais, para o upsert (onConflict) continuar a funcionar nesses casos.
alter table public.registos_ponto
  add constraint registos_ponto_data_colab_obra_enc_key
  unique nulls not distinct (data, colab_numero, obra_id, encarregado_id);

-- 4. Grants (coluna nova precisa de grant explícito — senão falha em silêncio 401/42501)
grant select, insert, update on public.registos_ponto to anon, authenticated;

-- 5. (OPCIONAL) Atribuir o histórico existente ao encarregado da respetiva obra.
--    Só correr se quiserem que os registos antigos deixem de ficar com encarregado nulo.
-- update public.registos_ponto r
--   set encarregado_id = o.encarregado_id
--   from public.obras o
--   where r.obra_id = o.id and r.encarregado_id is null;
