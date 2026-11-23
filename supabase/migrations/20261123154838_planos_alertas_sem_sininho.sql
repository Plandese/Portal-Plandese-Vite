-- Alertas dos planos de trabalho: por enquanto só aparecem no próprio plano (painel «Alertas», sino no Gantt e
-- aviso na lista de planos). Desliga o aviso diário no sininho do portal; a função fn_alertas_planos() e a tabela
-- planos_alertas_enviados ficam, para voltar a ligar com:
--   select cron.schedule('alertas-planos', '15 8 * * 1-5', $$select public.fn_alertas_planos()$$);
select cron.unschedule(jobid) from cron.job where jobname = 'alertas-planos';
