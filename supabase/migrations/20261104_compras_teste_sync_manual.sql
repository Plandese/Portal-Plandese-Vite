-- Compras (teste), fase 3: ligações feitas à mão (o motor de sincronização não lhes mexe).
alter table ct_guias add column if not exists sync_manual boolean not null default false;
alter table ct_faturas add column if not exists sync_manual boolean not null default false;
