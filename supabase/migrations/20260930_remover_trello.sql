-- O portal fica independente do Trello
update public.equipamentos set descricao = replace(descricao, ' (etiqueta Trello)', '') where descricao like '%(etiqueta Trello)%';
update public.eq_manutencoes set origem = 'portal' where origem = 'trello';
drop index if exists public.equipamentos_trello_id_key;
alter table public.equipamentos drop column if exists trello_id, drop column if exists trello_url;
