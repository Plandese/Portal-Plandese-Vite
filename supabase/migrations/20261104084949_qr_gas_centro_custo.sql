create or replace function public.fn_qr_gas_info(p_equip_id text, p_codigo text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_obra record; v_eq record; v_obras jsonb;
begin
  if (select count(*) from qr_tentativas where criado_em > now() - interval '15 minutes') > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;
  select o.id, o.nome into v_obra
    from obra_codigos c join obras o on o.id = c.obra_id
   where c.codigo = upper(btrim(coalesce(p_codigo,''))) and coalesce(o.ativa, true) and coalesce(o.estado,'em_curso') = 'em_curso';
  select id, nome, categoria into v_eq from equipamentos where id = p_equip_id;
  if v_obra.id is null or v_eq.id is null then
    insert into qr_tentativas(equip_id) values (p_equip_id);
    delete from qr_tentativas where criado_em < now() - interval '2 days';
    return jsonb_build_object('ok', false, 'motivo', case when v_eq.id is null then 'equipamento' else 'codigo' end);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome), '[]'::jsonb) into v_obras
    from obras o where coalesce(o.ativa, true) and coalesce(o.estado,'em_curso') = 'em_curso';
  return jsonb_build_object('ok', true,
    'obra', jsonb_build_object('id', v_obra.id, 'nome', v_obra.nome),
    'obras', v_obras,
    'equipamento', jsonb_build_object('id', v_eq.id, 'nome', v_eq.nome, 'categoria', v_eq.categoria));
end $function$;

drop function if exists public.fn_qr_gas_registar(text,text,text,numeric,text,date,text,text,text,numeric);

create or replace function public.fn_qr_gas_registar(p_equip_id text, p_codigo text, p_origem text, p_litros numeric, p_tipo text, p_data date, p_obs text, p_encarregado text, p_fornecedor text, p_contador numeric default null, p_obra_destino text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_info jsonb; v_obra_id text; v_obra_nome text; v_eq_nome text; v_cat text; v_cnt_tipo text; v_cnt numeric;
        v_dest_id text; v_dest_nome text; v_dep_id text; v_dep_nome text;
begin
  v_info := fn_qr_gas_info(p_equip_id, p_codigo);
  if not coalesce((v_info->>'ok')::boolean, false) then return v_info; end if;
  if p_origem not in ('deposito','bomba') then return jsonb_build_object('ok', false, 'motivo', 'origem'); end if;
  if p_litros is null or p_litros <= 0 or p_litros > 3000 then return jsonb_build_object('ok', false, 'motivo', 'litros'); end if;
  if p_contador is null or p_contador < 0 or p_contador > 99999999 then return jsonb_build_object('ok', false, 'motivo', 'contador'); end if;
  v_obra_id := v_info->'obra'->>'id'; v_obra_nome := v_info->'obra'->>'nome'; v_eq_nome := v_info->'equipamento'->>'nome';
  v_cat := v_info->'equipamento'->>'categoria';
  v_cnt := p_contador;
  v_cnt_tipo := case when v_cat like 'veiculo%' then 'km' else 'horas' end;
  v_dest_id := v_obra_id; v_dest_nome := v_obra_nome;
  if p_origem = 'deposito' then
    v_dep_id := v_obra_id; v_dep_nome := v_obra_nome;
  end if;
  -- centro de custo escolhido (tem de ser uma obra em curso)
  if nullif(btrim(coalesce(p_obra_destino,'')),'') is not null then
    select o.id, o.nome into v_dest_id, v_dest_nome from obras o
     where o.id = p_obra_destino and coalesce(o.ativa, true) and coalesce(o.estado,'em_curso') = 'em_curso';
    if v_dest_id is null then return jsonb_build_object('ok', false, 'motivo', 'obra'); end if;
  elsif p_origem = 'deposito' then
    select o.id, o.nome into v_dest_id, v_dest_nome
      from equipamentos e join obras o on o.id = e.obra_id where e.id = p_equip_id;
    if v_dest_id is null then v_dest_id := v_obra_id; v_dest_nome := v_obra_nome; end if;
  end if;
  insert into registos_combustivel (data, equipamento_id, equipamento_nome, obra_id, obra_nome, deposito_obra_id, deposito_obra_nome,
                                    litros, tipo_combustivel, tipo_registo, movimento, fornecedor, encarregado_nome, obs,
                                    aprovacao, origem, contador_valor, contador_tipo)
  values (coalesce(p_data, current_date), p_equip_id, v_eq_nome, v_dest_id, v_dest_nome, v_dep_id, v_dep_nome,
          p_litros, left(coalesce(nullif(btrim(p_tipo),''), 'Gasóleo'), 30),
          case when p_origem = 'deposito' then 'deposito' else 'viatura' end, 'saida',
          case when p_origem = 'bomba' then left(nullif(btrim(p_fornecedor),''), 100) end,
          left(coalesce(nullif(btrim(p_encarregado),''), 'QR'), 100) || ' (QR)',
          left(nullif(btrim(p_obs),''), 500), 'pendente', 'qr', v_cnt, v_cnt_tipo);
  return jsonb_build_object('ok', true, 'obra', v_dest_nome, 'equipamento', v_eq_nome, 'pendente', true);
end $function$;

grant execute on function public.fn_qr_gas_registar(text,text,text,numeric,text,date,text,text,text,numeric,text) to anon, authenticated;
grant execute on function public.fn_qr_gas_info(text,text) to anon, authenticated;