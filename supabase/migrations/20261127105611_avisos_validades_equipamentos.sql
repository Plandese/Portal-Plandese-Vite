-- Avisos por email das validades dos equipamentos (Seguro, Inspeção/IPO, Garantia)
-- Mesmo sistema dos colaboradores (painel «Avisos por email», Edge Function «avisos-validades»,
-- pg_cron diário das 08:00), mas com destinatários e regras próprios e permissões de Equipamentos
-- (fn_cap('log')), para quem gere a frota não mexer nos avisos de Recursos Humanos e vice-versa.

-- ── Configuração (uma só linha) ──
create table if not exists public.avisos_eq_config (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default true,
  destinatarios jsonb not null default '[]'::jsonb,   -- [{"nome":"…","email":"…"}]
  regras jsonb not null default '{
    "seguro":   {"ativo":true,"primeiro":30,"n":3,"intervalo":7,"no_dia":true},
    "ipo":      {"ativo":true,"primeiro":30,"n":3,"intervalo":7,"no_dia":true},
    "garantia": {"ativo":true,"primeiro":30,"n":2,"intervalo":15,"no_dia":true}
  }'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.avisos_eq_config (id) values (1) on conflict (id) do nothing;

alter table public.avisos_eq_config enable row level security;
drop policy if exists ler on public.avisos_eq_config;
drop policy if exists alterar on public.avisos_eq_config;
create policy ler on public.avisos_eq_config for select to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
create policy alterar on public.avisos_eq_config for update to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']))
  with check (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
grant select, update on public.avisos_eq_config to authenticated;

-- ── Avisos já enviados (para não repetir) ──
create table if not exists public.avisos_eq_enviados (
  id bigserial primary key,
  equip_id text not null references public.equipamentos(id) on delete cascade,
  tipo text not null check (tipo in ('seguro','ipo','garantia')),
  ate date not null,          -- data em que caduca
  dias integer not null,      -- dias de antecedência do aviso (0 = no dia / já caducado)
  enviado_em timestamptz not null default now(),
  unique (equip_id, tipo, ate, dias)
);
alter table public.avisos_eq_enviados enable row level security;
drop policy if exists ler on public.avisos_eq_enviados;
create policy ler on public.avisos_eq_enviados for select to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
grant select on public.avisos_eq_enviados to authenticated;
-- só a Edge Function (service role) escreve nesta tabela
grant all on public.avisos_eq_config, public.avisos_eq_enviados to service_role;
grant usage, select on sequence public.avisos_eq_enviados_id_seq to service_role;
