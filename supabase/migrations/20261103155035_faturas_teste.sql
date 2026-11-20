-- Faturas carregadas só para testar as guias de remessa: ficam fora de todas as outras páginas (Inserção, Tesouraria, Aprovar, Análise, Painel).
alter table faturas add column if not exists teste boolean not null default false;
update faturas set teste = true where fonte = 'teste';
