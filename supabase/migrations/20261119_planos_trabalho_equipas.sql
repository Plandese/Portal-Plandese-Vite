-- Planos de trabalho: equipas de trabalho do plano (mão de obra + equipamentos), atribuídas às tarefas.
-- [{ id, nome, cor, mo: [{ cat, qtd }], eq: [{ tipo, qtd }] }] — as tarefas guardam t.equipas = [{ id, n }].
alter table public.planos_trabalho add column if not exists equipas jsonb not null default '[]'::jsonb;
