-- Leituras de QR dos equipamentos: cada vez que um QR é aberto (encarregado ou desconhecido)
-- guarda-se a localização aproximada (IP) e, se a pessoa autorizar, o GPS exato.
create table if not exists public.eq_leituras_qr (
  id          uuid primary key default gen_random_uuid(),
  equip_id    text not null,
  criado_em   timestamptz not null default now(),
  origem      text not null default 'publico' check (origem in ('publico','encarregado')),
  utilizador  text,
  ip          text,
  pais        text,
  cidade      text,
  ip_lat      double precision,
  ip_lng      double precision,
  gps_lat     double precision,
  gps_lng     double precision,
  gps_precisao double precision,
  user_agent  text
);
create index if not exists eq_leituras_qr_equip_idx on public.eq_leituras_qr (equip_id, criado_em desc);

alter table public.eq_leituras_qr enable row level security;
drop policy if exists ler on public.eq_leituras_qr;
create policy ler on public.eq_leituras_qr for select to authenticated
  using ((fn_cap('log') and not fn_sec_all_off(array['equipamentos'])) or fn_enc_mod('equipamentos'));
drop policy if exists apagar on public.eq_leituras_qr;
create policy apagar on public.eq_leituras_qr for delete to authenticated
  using (fn_cap('log') and not fn_sec_all_off(array['equipamentos']));
-- inserções só via RPC security definer (página pública sem login)
revoke all on public.eq_leituras_qr from anon;
grant select, delete on public.eq_leituras_qr to authenticated;

create or replace function public.fn_qr_leitura(
  p_equip_id text, p_origem text default 'publico', p_utilizador text default null,
  p_pais text default null, p_cidade text default null, p_ip_lat double precision default null, p_ip_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_h json;
  v_ip text;
begin
  if p_equip_id is null or not exists (select 1 from equipamentos where id = p_equip_id) then return null; end if;
  -- limite simples contra abuso: máx. 30 leituras/minuto por equipamento
  if (select count(*) from eq_leituras_qr where equip_id = p_equip_id and criado_em > now() - interval '1 minute') >= 30 then return null; end if;
  begin v_h := current_setting('request.headers', true)::json; exception when others then v_h := null; end;
  v_ip := nullif(trim(split_part(coalesce(v_h->>'x-forwarded-for', v_h->>'cf-connecting-ip', ''), ',', 1)), '');
  insert into eq_leituras_qr (equip_id, origem, utilizador, ip, pais, cidade, ip_lat, ip_lng, user_agent)
  values (p_equip_id, case when p_origem = 'encarregado' then 'encarregado' else 'publico' end,
          left(p_utilizador, 80), v_ip, left(coalesce(p_pais, v_h->>'cf-ipcountry'), 60), left(p_cidade, 80),
          case when p_ip_lat between -90 and 90 then p_ip_lat end, case when p_ip_lng between -180 and 180 then p_ip_lng end,
          left(v_h->>'user-agent', 300))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_qr_leitura_gps(
  p_id uuid, p_lat double precision, p_lng double precision, p_precisao double precision default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return false; end if;
  update eq_leituras_qr set gps_lat = p_lat, gps_lng = p_lng, gps_precisao = p_precisao
   where id = p_id and gps_lat is null and criado_em > now() - interval '10 minutes';
  return found;
end $$;

grant execute on function public.fn_qr_leitura(text,text,text,text,text,double precision,double precision) to anon, authenticated;
grant execute on function public.fn_qr_leitura_gps(uuid,double precision,double precision,double precision) to anon, authenticated;
