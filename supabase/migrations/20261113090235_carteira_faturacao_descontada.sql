-- Faturação adicionada no portal é descontada ao valor por faturar da carteira de encomendas.
-- As linhas já existentes (importadas) ficam a false: os valores da carteira já as refletem.
alter table public.carteira_faturacao add column if not exists descontada_carteira boolean not null default false;
alter table public.carteira_faturacao alter column descontada_carteira set default true;
