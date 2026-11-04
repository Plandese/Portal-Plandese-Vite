-- Compras (teste): proposta do fornecedor lida com IA (ficheiro + dados lidos) guardada na cotação
alter table ct_cotacoes add column if not exists proposta_fotos text[] not null default '{}';
alter table ct_cotacoes add column if not exists proposta_ficheiro text;
alter table ct_cotacoes add column if not exists proposta_info jsonb;
