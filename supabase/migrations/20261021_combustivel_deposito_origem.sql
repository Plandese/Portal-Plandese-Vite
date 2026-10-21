-- Gasóleo: distinguir o depósito de onde sai o combustível (deposito_obra_*) da obra a que se destina (obra_* = centro de custo).
-- Registos antigos: o depósito é a obra já registada (eram a mesma coisa).
alter table public.registos_combustivel
  add column if not exists deposito_obra_id text,
  add column if not exists deposito_obra_nome text;

update public.registos_combustivel
   set deposito_obra_id = obra_id, deposito_obra_nome = obra_nome
 where tipo_registo = 'deposito' and deposito_obra_id is null;

-- QR: o código identifica a obra do depósito; o centro de custo é a obra onde o equipamento está (ou a do depósito, se não tiver).
create or replace function public.fn_qr_gas_registar(
  p_equip_id text, p_codigo text, p_origem text, p_litros numeric, p_tipo text, p_data date,
  p_obs text, p_encarregado text, p_fornecedor text, p_contador numeric default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
  return jsonb_build_object('ok', true, 'obra', v_obra_nome, 'equipamento', v_eq_nome, 'pendente', true);
end $$;

-- Aprovação: decide o encarregado da obra do depósito (quem responde pelo stock); sem depósito, o da obra do registo.
create or replace function public.fn_comb_decidir(p_id bigint, p_aprovar boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_reg record; v_user record; v_pode boolean;
begin
  select * into v_user from utilizadores where auth_id = auth.uid();
  if v_user.auth_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;
  select * into v_reg from registos_combustivel where id = p_id;
  if v_reg.id is null or v_reg.aprovacao <> 'pendente' then return jsonb_build_object('ok', false, 'motivo', 'nao_pendente'); end if;
  v_pode := fn_cap('log') or exists (
    select 1 from obras o
     where o.id = coalesce(v_reg.deposito_obra_id, v_reg.obra_id) and v_user.role = 'encarregado'
       and (o.encarregado_id = v_user.username
            or exists (select 1 from obra_encarregados_extra x where x.obra_id = o.id and x.encarregado_id = v_user.username)));
  if not v_pode then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  update registos_combustivel
     set aprovacao = case when p_aprovar then 'aprovado' else 'rejeitado' end,
         aprovado_por = coalesce(v_user.nome, v_user.username), aprovado_em = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
