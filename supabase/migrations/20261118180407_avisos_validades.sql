-- Avisos por email das validades dos colaboradores (Identificação, FA, EPI)
-- Configuração editável no portal (botão «Avisos por email» da página Colaboradores, capítulo RH);
-- a Edge Function «avisos-validades» corre todos os dias (pg_cron) e envia um email-resumo
-- pelo Gmail da empresa. Cada aviso (colaborador + documento + data limite + dias antes) só é
-- enviado uma vez, graças à tabela avisos_validades_enviados.

-- ── Configuração (uma só linha) ──
create table if not exists public.avisos_validades_config (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default true,
  destinatarios jsonb not null default '[]'::jsonb,   -- [{"nome":"Rui Gonçalves","email":"…"}]
  regras jsonb not null default '{
    "id":  {"ativo":true,"primeiro":30,"n":3,"intervalo":7,"no_dia":true},
    "fa":  {"ativo":true,"primeiro":30,"n":3,"intervalo":7,"no_dia":true},
    "epi": {"ativo":true,"primeiro":30,"n":3,"intervalo":7,"no_dia":true}
  }'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.avisos_validades_config (id) values (1) on conflict (id) do nothing;

alter table public.avisos_validades_config enable row level security;
drop policy if exists ler on public.avisos_validades_config;
drop policy if exists alterar on public.avisos_validades_config;
create policy ler on public.avisos_validades_config for select to authenticated
  using (fn_cap('rh') and not fn_sec_all_off(array['colaboradores']));
create policy alterar on public.avisos_validades_config for update to authenticated
  using (fn_cap('rh') and not fn_sec_all_off(array['colaboradores']))
  with check (fn_cap('rh') and not fn_sec_all_off(array['colaboradores']));
grant select, update on public.avisos_validades_config to authenticated;

-- ── Avisos já enviados (para não repetir) ──
create table if not exists public.avisos_validades_enviados (
  id bigserial primary key,
  numero integer not null references public.colaboradores(numero) on delete cascade,
  tipo text not null check (tipo in ('id','fa','epi')),
  ate date not null,          -- data em que o documento caduca
  dias integer not null,      -- dias de antecedência do aviso (0 = no dia / já caducado)
  enviado_em timestamptz not null default now(),
  unique (numero, tipo, ate, dias)
);
alter table public.avisos_validades_enviados enable row level security;
drop policy if exists ler on public.avisos_validades_enviados;
create policy ler on public.avisos_validades_enviados for select to authenticated
  using (fn_cap('rh') and not fn_sec_all_off(array['colaboradores']));
grant select on public.avisos_validades_enviados to authenticated;
-- só a Edge Function (service role) escreve nesta tabela
grant all on public.avisos_validades_config, public.avisos_validades_enviados to service_role;
grant usage, select on sequence public.avisos_validades_enviados_id_seq to service_role;

-- ── Agendamento diário (08:00 UTC) ──
-- A chave que autoriza o pg_cron a chamar a função fica no Vault (nome «avisos_validades_cron_key»);
-- a Edge Function lê-a com fn_avisos_cron_key(), que só o service role pode executar.
create extension if not exists pg_net;
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'avisos_validades_cron_key', 'Chave do pg_cron para a função avisos-validades')
where not exists (select 1 from vault.secrets where name = 'avisos_validades_cron_key');
create or replace function public.fn_avisos_cron_key() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'avisos_validades_cron_key'
$$;
revoke all on function public.fn_avisos_cron_key() from public, anon, authenticated;
grant execute on function public.fn_avisos_cron_key() to service_role;
select cron.unschedule('avisos-validades') where exists (select 1 from cron.job where jobname = 'avisos-validades');
select cron.schedule('avisos-validades', '0 8 * * *', $$
  select net.http_post(
    url := 'https://zcigwqvqmqatcivkrrsw.supabase.co/functions/v1/avisos-validades',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_validades_cron_key')),
    body := '{"acao":"diario"}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
