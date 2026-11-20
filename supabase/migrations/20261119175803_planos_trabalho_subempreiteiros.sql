-- Planos de trabalho: subempreiteiros do plano (trabalhos que não são executados pela Plandese).
-- [{ id, nome, especialidade, contacto, telefone, email, notas }] — as tarefas guardam t.sub = id.
alter table public.planos_trabalho add column if not exists subempreiteiros jsonb not null default '[]'::jsonb;
