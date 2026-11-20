-- Repõe o sinalizador interno no fim das funções da Tesouraria (o trigger de proteção das
-- colunas proposta_*/pago_* volta a bloquear alterações diretas no resto da transação).
create or replace function public.fn_propor_pagamento(p_ids bigint[], p_propor boolean)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_user  text := public.fn_my_username();
  v_admin boolean := public.fn_my_role() = 'admin';
  v_n     integer;
begin
  if not public.fn_pode_propor() then
    raise exception 'Sem permissão para propor pagamentos' using errcode = '42501';
  end if;
  perform set_config('app.fat_rpc', '1', true);
  if p_propor then
    update public.faturas
       set proposta_por = v_user, proposta_em = now()
     where id = any(p_ids) and status in ('aprovada', 'validada') and proposta_por is null;
  else
    update public.faturas
       set proposta_por = null, proposta_em = null
     where id = any(p_ids) and status in ('aprovada', 'validada')
       and (v_admin or proposta_por = v_user);
  end if;
  get diagnostics v_n = row_count;
  perform set_config('app.fat_rpc', '', true);
  return v_n;
end;
$$;

create or replace function public.fn_marcar_pago(p_ids bigint[])
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  if public.fn_my_role() is distinct from 'admin' then
    raise exception 'Só o administrador pode marcar faturas como pagas' using errcode = '42501';
  end if;
  perform set_config('app.fat_rpc', '1', true);
  update public.faturas
     set status = 'paga', pago_por = public.fn_my_username(), pago_em = now()
   where id = any(p_ids) and status in ('aprovada', 'validada');
  get diagnostics v_n = row_count;
  perform set_config('app.fat_rpc', '', true);
  return v_n;
end;
$$;
