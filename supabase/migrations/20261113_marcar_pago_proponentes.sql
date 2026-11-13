-- Quem pode propor a pagamento (admin ou proponente da Tesouraria) também pode marcar como pago.
create or replace function public.fn_marcar_pago(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if not public.fn_pode_propor() then
    raise exception 'Sem permissão para marcar faturas como pagas' using errcode = '42501';
  end if;
  perform set_config('app.fat_rpc', '1', true);
  update public.faturas
     set status = 'paga', pago_por = public.fn_my_username(), pago_em = now()
   where id = any(p_ids) and status in ('aprovada', 'validada');
  get diagnostics v_n = row_count;
  perform set_config('app.fat_rpc', '', true);
  return v_n;
end;
$function$;
