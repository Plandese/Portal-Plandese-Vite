-- Página de teste das guias: notas de receção de OUTRO fornecedor (ex.: Secil recebe terras) vs fatura do transportador (Transroque)
-- A fatura do transportador cita «G.T. nnnnnn» em cada linha; esse nº é o «Nº GUIA» impresso na nota de receção.
create or replace function gt_refs(refs jsonb, linhas jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (
    select r as v from jsonb_array_elements_text(case when jsonb_typeof(refs) = 'array' then refs else '[]'::jsonb end) r
    union
    select m[1] from jsonb_array_elements(case when jsonb_typeof(linhas) = 'array' then linhas else '[]'::jsonb end) l,
         lateral regexp_matches(coalesce(l->>'desc', ''), 'G\.?\s?T\.?\s*([0-9]{4,})', 'gi') m
  ) x
$$;
-- gt_importar_faturas: passa a trazer também faturas Transroque (O065) e usa gt_refs para as guias referidas
-- gt_sincronizar_guias: quando o fornecedor da guia e o da fatura são diferentes, não compara o NIF nem os materiais:
--   confere o nº da guia (G.T.) e a quantidade da linha que a cita (tolerância 2%)
-- (definições completas aplicadas na Supabase a partir das funções anteriores; ver histórico do projeto)

-- gt_faturas.dropbox_path: caminho do ficheiro da fatura (botão «Ver fatura (PDF)»); gt_importar_faturas mantém-no atualizado
alter table gt_faturas add column if not exists dropbox_path text;
