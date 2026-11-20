-- Tesouraria: propostas de pagamento
-- · Quem propõe fica na fatura (proposta_por/proposta_em); quem paga em lote fica em pago_por/pago_em.
-- · Só administradores e os utilizadores da lista app_config.tesouraria_proponentes podem propor;
--   só administradores marcam como paga em lote. As alterações passam por funções (SECURITY DEFINER)
--   e um trigger impede alterar estes campos por outra via.

alter table public.faturas
  add column if not exists proposta_por text,
  add column if not exists proposta_em  timestamptz,
  add column if not exists pago_por     text,
  add column if not exists pago_em      timestamptz;

-- Lista (editável pelo administrador) de quem pode propor pagamentos, por username
insert into public.app_config (key, value)
values ('tesouraria_proponentes', '["sergio.fernandes","ana.toscano"]'::jsonb)
on conflict (key) do nothing;

create or replace function public.fn_pode_propor()
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when public.fn_my_role() is null then false
    when public.fn_my_role() = 'admin' then true
    when not public.fn_cap('fin') then false
    else coalesce((select c.value ? public.fn_my_username()
                     from public.app_config c where c.key = 'tesouraria_proponentes'), false)
  end;
$$;

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
  return v_n;
end;
$$;

revoke all on function public.fn_pode_propor() from public, anon;
revoke all on function public.fn_propor_pagamento(bigint[], boolean) from public, anon;
revoke all on function public.fn_marcar_pago(bigint[]) from public, anon;
grant execute on function public.fn_pode_propor() to authenticated;
grant execute on function public.fn_propor_pagamento(bigint[], boolean) to authenticated;
grant execute on function public.fn_marcar_pago(bigint[]) to authenticated;

create or replace function public.trg_faturas_proteger_proposta()
returns trigger language plpgsql as $$
begin
  if (new.proposta_por is distinct from old.proposta_por
      or new.proposta_em is distinct from old.proposta_em
      or new.pago_por is distinct from old.pago_por
      or new.pago_em is distinct from old.pago_em)
     and coalesce(current_setting('app.fat_rpc', true), '') <> '1' then
    raise exception 'As propostas de pagamento só podem ser alteradas pela Tesouraria' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists faturas_proteger_proposta on public.faturas;
create trigger faturas_proteger_proposta
  before update on public.faturas
  for each row execute function public.trg_faturas_proteger_proposta();
