alter table public.registos_combustivel
  add column aprovacao text not null default 'aprovado' check (aprovacao in ('aprovado','pendente','rejeitado')),
  add column origem text not null default 'app' check (origem in ('app','qr')),
  add column aprovado_por text,
  add column aprovado_em timestamptz;
create index registos_combustivel_pendentes_idx on public.registos_combustivel(obra_id) where aprovacao = 'pendente';

-- registos vindos do QR (fora da app) ficam pendentes até um encarregado da obra aprovar
create or replace function public.fn_qr_gas_registar(
  p_equip_id text, p_codigo text, p_origem text, p_litros numeric, p_tipo text,
  p_data date, p_obs text, p_encarregado text, p_fornecedor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_info jsonb; v_obra_id text; v_obra_nome text; v_eq_nome text;
begin
  v_info := fn_qr_gas_info(p_equip_id, p_codigo);
  if not coalesce((v_info->>'ok')::boolean, false) then return v_info; end if;
  if p_origem not in ('deposito','bomba') then return jsonb_build_object('ok', false, 'motivo', 'origem'); end if;
  if p_litros is null or p_litros <= 0 or p_litros > 3000 then return jsonb_build_object('ok', false, 'motivo', 'litros'); end if;
  v_obra_id := v_info->'obra'->>'id'; v_obra_nome := v_info->'obra'->>'nome'; v_eq_nome := v_info->'equipamento'->>'nome';
  insert into registos_combustivel (data, equipamento_id, equipamento_nome, obra_id, obra_nome, litros, tipo_combustivel,
                                    tipo_registo, movimento, fornecedor, encarregado_nome, obs, aprovacao, origem)
  values (coalesce(p_data, current_date), p_equip_id, v_eq_nome, v_obra_id, v_obra_nome, p_litros,
          left(coalesce(nullif(btrim(p_tipo),''), 'Gasóleo'), 30),
          case when p_origem = 'deposito' then 'deposito' else 'viatura' end, 'saida',
          case when p_origem = 'bomba' then left(nullif(btrim(p_fornecedor),''), 100) end,
          left(coalesce(nullif(btrim(p_encarregado),''), 'QR'), 100) || ' (QR)',
          left(nullif(btrim(p_obs),''), 500), 'pendente', 'qr');
  return jsonb_build_object('ok', true, 'obra', v_obra_nome, 'equipamento', v_eq_nome, 'pendente', true);
end $$;

-- aprovar / rejeitar um registo pendente (encarregado da obra ou quem gere combustível)
create or replace function public.fn_comb_decidir(p_id bigint, p_aprovar boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_reg record; v_user record; v_pode boolean;
begin
  select * into v_user from utilizadores where auth_id = auth.uid();
  if v_user.auth_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;
  select * into v_reg from registos_combustivel where id = p_id;
  if v_reg.id is null or v_reg.aprovacao <> 'pendente' then return jsonb_build_object('ok', false, 'motivo', 'nao_pendente'); end if;
  v_pode := fn_cap('log') or exists (
    select 1 from obras o
     where o.id = v_reg.obra_id and v_user.role = 'encarregado'
       and (o.encarregado_id = v_user.username
            or exists (select 1 from obra_encarregados_extra x where x.obra_id = o.id and x.encarregado_id = v_user.username)));
  if not v_pode then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  update registos_combustivel
     set aprovacao = case when p_aprovar then 'aprovado' else 'rejeitado' end,
         aprovado_por = coalesce(v_user.nome, v_user.username), aprovado_em = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_comb_decidir(bigint, boolean) to authenticated;