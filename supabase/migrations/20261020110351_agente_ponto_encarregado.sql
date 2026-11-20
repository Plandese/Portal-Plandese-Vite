-- Agente da folha de ponto para encarregados: a ação "criar_folha_ponto" passa a poder ser proposta
-- (agente_acoes) por encarregados, além de "criar_pedido_compra". A função agente-ponto só executa
-- este tipo e revalida os parâmetros; os triggers de registos_ponto (dia aprovado, janela de 24h) continuam a valer.
drop policy if exists inserir on public.agente_acoes;
create policy inserir on public.agente_acoes for insert to authenticated
  with check (utilizador = fn_my_username() and fn_my_role() is not null
              and (fn_my_role() <> 'encarregado' or tipo in ('criar_pedido_compra', 'criar_folha_ponto')));
