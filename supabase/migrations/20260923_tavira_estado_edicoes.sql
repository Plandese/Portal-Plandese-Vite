-- Pendentes Tavira: permite editar os tópicos da lista base (fixa no código).
-- As edições ficam como sobreposições em tavira_estado; NULL = usar o texto original.
alter table public.tavira_estado
  add column if not exists obra       text,
  add column if not exists rua        text,
  add column if not exists descricao  text,
  add column if not exists reclamacao boolean;
