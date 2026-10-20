-- Registo de gasóleo por QR: a leitura do contador (km/horas) passa a ser obrigatória.
-- (corpo igual ao de 20261020_qr_gas_contador.sql, mas p_contador nulo é recusado com motivo 'contador')
create or replace function public.fn_qr_gas_registar(
  p_equip_id text, p_codigo text, p_origem text, p_litros numeric, p_tipo text, p_data date,
  p_obs text, p_encarregado text, p_fornecedor text, p_contador numeric default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_info jsonb; v_obra_id text; v_obra_nome text; v_eq_nome text; v_cat text; v_cnt_tipo text; v_cnt numeric;
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
  insert into registos_combustivel (data, equipamento_id, equipamento_nome, obra_id, obra_nome, litros, tipo_combustivel,
                                    tipo_registo, movimento, fornecedor, encarregado_nome, obs, aprovacao, origem,
                                    contador_valor, contador_tipo)
  values (coalesce(p_data, current_date), p_equip_id, v_eq_nome, v_obra_id, v_obra_nome, p_litros,
          left(coalesce(nullif(btrim(p_tipo),''), 'Gasóleo'), 30),
          case when p_origem = 'deposito' then 'deposito' else 'viatura' end, 'saida',
          case when p_origem = 'bomba' then left(nullif(btrim(p_fornecedor),''), 100) end,
          left(coalesce(nullif(btrim(p_encarregado),''), 'QR'), 100) || ' (QR)',
          left(nullif(btrim(p_obs),''), 500), 'pendente', 'qr', v_cnt, v_cnt_tipo);
  return jsonb_build_object('ok', true, 'obra', v_obra_nome, 'equipamento', v_eq_nome, 'pendente', true);
end $$;
