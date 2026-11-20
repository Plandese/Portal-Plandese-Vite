-- Segurança: funções SECURITY DEFINER que eram para utilizadores autenticados mas continuavam executáveis sem login
-- (o EXECUTE por omissão para PUBLIC/anon nunca tinha sido retirado). Encontrado na verificação geral de 2026-11-20
-- (Security Advisor: «Public Can Execute SECURITY DEFINER Function»).
--  · guias: fn_guia_aplicar altera o estado das guias de uma fatura; as outras devolvem dados de faturas/fornecedores
--  · fn_eq_obra_por_local (usada pelo trigger trg_eq_obra, que é security definer) e fn_pode_registar_moa (usada em
--    policies só «to authenticated»)
-- As funções do QR público (fn_qr_*) continuam abertas de propósito.

revoke execute on function
  public.fn_guia_aplicar(bigint, text, jsonb),
  public.fn_guia_candidatas(text, text),
  public.fn_guia_sugestoes(text),
  public.fn_guia_fatura(bigint),
  public.fn_guias_da_fatura(bigint, bigint),
  public.fn_eq_obra_por_local(text),
  public.fn_pode_registar_moa()
from public, anon;

grant execute on function
  public.fn_guia_aplicar(bigint, text, jsonb),
  public.fn_guia_candidatas(text, text),
  public.fn_guia_sugestoes(text),
  public.fn_guia_fatura(bigint),
  public.fn_guias_da_fatura(bigint, bigint),
  public.fn_eq_obra_por_local(text),
  public.fn_pode_registar_moa()
to authenticated, service_role;

-- «Function Search Path Mutable»: fixar o search_path (igual ao que já usam hoje: public + extensions)
alter function public.artigos_catalogo() set search_path = public, extensions;
alter function public.artigos_versao() set search_path = public, extensions;
alter function public.fn_sync_mats(jsonb) set search_path = public, extensions;
alter function public.fn_sync_norm(text) set search_path = public, extensions;
alter function public.fn_sync_obra(text) set search_path = public, extensions;
alter function public.fn_sync_preco(text, date, text) set search_path = public, extensions;
alter function public.gt_limpa_linhas(jsonb) set search_path = public, extensions;
alter function public.gt_refs(jsonb, jsonb) set search_path = public, extensions;
alter function public.gt_sync_preco(text, date, text) set search_path = public, extensions;
