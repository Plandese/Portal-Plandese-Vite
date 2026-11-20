create table public.obra_codigos (
  obra_id text primary key references public.obras(id) on delete cascade,
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{4,12}$'),
  criado_em timestamptz not null default now()
);
alter table public.obra_codigos enable row level security;
create policy ler on public.obra_codigos for select to authenticated using (fn_cap('def') and not fn_sec_all_off(array['obras']));
create policy inserir on public.obra_codigos for insert to authenticated with check (fn_cap('def') and not fn_sec_all_off(array['obras']));
create policy alterar on public.obra_codigos for update to authenticated using (fn_cap('def') and not fn_sec_all_off(array['obras'])) with check (fn_cap('def') and not fn_sec_all_off(array['obras']));
create policy apagar on public.obra_codigos for delete to authenticated using (fn_cap('def') and not fn_sec_all_off(array['obras']));
grant select, insert, update, delete on public.obra_codigos to authenticated;

create table public.qr_tentativas (
  id bigint generated always as identity primary key,
  equip_id text,
  criado_em timestamptz not null default now()
);
alter table public.qr_tentativas enable row level security;  -- sem políticas: só as funções (security definer) lhe mexem

-- gera um código por obra (sem caracteres ambíguos)
create or replace function public.fn_novo_codigo_obra() returns text language plpgsql as $$
declare alfa text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alfa, 1 + floor(random()*length(alfa))::int, 1); end loop;
    exit when not exists (select 1 from public.obra_codigos where codigo = c);
  end loop;
  return c;
end $$;

insert into public.obra_codigos (obra_id, codigo)
select id, public.fn_novo_codigo_obra() from public.obras on conflict do nothing;

create or replace function public.fn_qr_gas_info(p_equip_id text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_obra record; v_eq record;
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
  return jsonb_build_object('ok', true,
    'obra', jsonb_build_object('id', v_obra.id, 'nome', v_obra.nome),
    'equipamento', jsonb_build_object('id', v_eq.id, 'nome', v_eq.nome, 'categoria', v_eq.categoria));
end $$;

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
                                    tipo_registo, movimento, fornecedor, encarregado_nome, obs)
  values (coalesce(p_data, current_date), p_equip_id, v_eq_nome, v_obra_id, v_obra_nome, p_litros,
          left(coalesce(nullif(btrim(p_tipo),''), 'Gasóleo'), 30),
          case when p_origem = 'deposito' then 'deposito' else 'viatura' end, 'saida',
          case when p_origem = 'bomba' then left(nullif(btrim(p_fornecedor),''), 100) end,
          left(coalesce(nullif(btrim(p_encarregado),''), 'QR'), 100) || ' (QR)',
          left(nullif(btrim(p_obs),''), 500));
  return jsonb_build_object('ok', true, 'obra', v_obra_nome, 'equipamento', v_eq_nome);
end $$;

grant execute on function public.fn_qr_gas_info(text, text) to anon, authenticated;
grant execute on function public.fn_qr_gas_registar(text, text, text, numeric, text, date, text, text, text) to anon, authenticated;