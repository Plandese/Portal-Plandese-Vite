-- Planos de trabalho: opções gerais do plano (jsonb). Para já, o prazo contratual:
-- { "prazo": { "dias": 120 } } (dias de calendário a contar da data de início) ou { "prazo": { "data": "AAAA-MM-DD" } }.
-- As tarefas (jsonb) passam a poder ter t.cal ('5' | '6' | '7') e t.limite (data-limite); as equipas, e.disp.
alter table public.planos_trabalho add column if not exists opcoes jsonb not null default '{}'::jsonb;