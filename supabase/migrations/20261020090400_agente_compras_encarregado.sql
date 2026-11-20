-- Agente de compras para encarregados: podem registar uso (agente_logs) e as ações propostas (agente_acoes).
-- A Edge Function só executa "criar_pedido_compra" para este perfil e revalida os parâmetros;
-- a RLS de pedidos_compra continua a ser quem decide se o pedido é aceite.
drop policy if exists inserir on public.agente_logs;
create policy inserir on public.agente_logs for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null);

drop policy if exists inserir on public.agente_acoes;
create policy inserir on public.agente_acoes for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null
              and (fn_my_role() <> 'encarregado' or tipo = 'criar_pedido_compra'));
