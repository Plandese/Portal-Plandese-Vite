-- 1) utilizadores: password nunca legível; só painel_config/enc_modulos editáveis pelo cliente
REVOKE ALL ON public.utilizadores FROM anon, authenticated;
GRANT SELECT (username, nome, role, initials, painel_config, telefone, enc_modulos) ON public.utilizadores TO anon, authenticated;
GRANT UPDATE (painel_config, enc_modulos) ON public.utilizadores TO anon, authenticated;

-- 2) whatsapp_config: sem acesso pela API pública (o trigger corre como SECURITY DEFINER)
REVOKE ALL ON public.whatsapp_config FROM anon, authenticated;
DROP POLICY IF EXISTS "anon write whatsapp_config" ON public.whatsapp_config;

-- 3) whatsapp_sessoes: idem (RLS sem policies, mas tinha grants totais)
REVOKE ALL ON public.whatsapp_sessoes FROM anon, authenticated;

-- 4) função de trigger não deve ser chamável por RPC
REVOKE EXECUTE ON FUNCTION public.fn_notif_whatsapp() FROM PUBLIC, anon, authenticated;