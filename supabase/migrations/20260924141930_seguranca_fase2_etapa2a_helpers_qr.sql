-- Quem está a fazer o pedido é um utilizador do portal? (usado nas políticas RLS)
create or replace function public.fn_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.utilizadores where auth_id = auth.uid());
$$;

create or replace function public.fn_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.utilizadores where auth_id = auth.uid();
$$;

revoke execute on function public.fn_is_member() from public, anon;
revoke execute on function public.fn_my_role()   from public, anon;
grant  execute on function public.fn_is_member() to authenticated;
grant  execute on function public.fn_my_role()   to authenticated;

-- Página pública do QR (?reg=ID): só devolve o mínimo necessário para o formulário
create or replace function public.fn_qr_info(p_equip_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'equipamento', (select jsonb_build_object('id', e.id, 'nome', e.nome, 'categoria', e.categoria)
                    from public.equipamentos e where e.id = p_equip_id),
    'obras', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome)
                       from public.obras o where o.ativa), '[]'::jsonb)
  );
$$;

-- Página pública do QR: regista o movimento e actualiza a última localização do equipamento
create or replace function public.fn_qr_registar(
  p_equip_id text, p_obra_id text, p_lat double precision, p_lng double precision,
  p_obs text, p_encarregado text, p_ultimo_local text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_obra_nome text;
begin
  if not exists (select 1 from public.equipamentos where id = p_equip_id) then return false; end if;
  if p_obra_id is not null then
    select nome into v_obra_nome from public.obras where id = p_obra_id and ativa;
    if v_obra_nome is null then p_obra_id := null; end if;
  end if;
  insert into public.eq_movimentos (equip_id, obra_id, obra_nome, lat, lng, obs, encarregado, criado_em)
  values (p_equip_id, p_obra_id, v_obra_nome, p_lat, p_lng, left(p_obs, 500), left(coalesce(p_encarregado,'Encarregado'), 100), now());
  update public.equipamentos
     set ultimo_local = left(coalesce(v_obra_nome, p_ultimo_local, 'Registado'), 200),
         ultimo_lat = p_lat, ultimo_lng = p_lng, ultimo_registo = now()
   where id = p_equip_id;
  return true;
end;
$$;

revoke execute on function public.fn_qr_info(text) from public;
revoke execute on function public.fn_qr_registar(text,text,double precision,double precision,text,text,text) from public;
grant  execute on function public.fn_qr_info(text) to anon, authenticated;
grant  execute on function public.fn_qr_registar(text,text,double precision,double precision,text,text,text) to anon, authenticated;