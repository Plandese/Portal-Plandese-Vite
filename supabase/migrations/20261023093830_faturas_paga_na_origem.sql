-- Faturas marcadas como "Paga" na validação do centro de custo mantêm essa marca
-- até à aprovação do diretor, para chegarem à tesouraria já como pagas.
alter table public.faturas add column if not exists paga_na_origem boolean not null default false;
