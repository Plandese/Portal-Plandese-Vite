-- Faturas pagas antes da aprovação do diretor de obra.
-- A Tesouraria (quem pode marcar pagamentos: fn_pode_propor) marca como paga uma fatura que ainda está
-- «Aguarda diretor». A fatura continua nas Faturas por aprovar, com a nota de que já foi paga
-- (paga_na_origem + pago_por/pago_em); quando o diretor aprova, chega à Tesouraria já como paga.

-- ── 1. Marcar / desfazer ──
create or replace function public.fn_marcar_paga_por_aprovar(p_ids bigint[], p_paga boolean)
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
  if p_paga then
    update public.faturas
       set paga_na_origem = true, pago_por = public.fn_my_username(), pago_em = now()
     where id = any(p_ids) and status = 'aguarda_diretor' and pago_em is null;
  else
    update public.faturas
       set paga_na_origem = false, pago_por = null, pago_em = null
     where id = any(p_ids) and status = 'aguarda_diretor' and paga_na_origem;
  end if;
  get diagnostics v_n = row_count;
  perform set_config('app.fat_rpc', '', true);
  return v_n;
end;
$function$;
revoke all on function public.fn_marcar_paga_por_aprovar(bigint[], boolean) from public, anon;
grant execute on function public.fn_marcar_paga_por_aprovar(bigint[], boolean) to authenticated;

-- ── 2. A marca não se perde e a aprovação passa logo a «paga» ──
-- (quem aprova pode ter a fatura aberta de antes da marca: a gravação normal não a pode apagar)
create or replace function public.trg_faturas_paga_por_aprovar()
returns trigger language plpgsql as $$
begin
  if old.paga_na_origem and not new.paga_na_origem
     and old.status = 'aguarda_diretor'
     and coalesce(current_setting('app.fat_rpc', true), '') <> '1' then
    new.paga_na_origem := true;
  end if;
  if old.status = 'aguarda_diretor' and new.status = 'aprovada' and new.paga_na_origem then
    new.status := 'paga';
  end if;
  return new;
end;
$$;

drop trigger if exists faturas_paga_por_aprovar on public.faturas;
create trigger faturas_paga_por_aprovar
  before update on public.faturas
  for each row execute function public.trg_faturas_paga_por_aprovar();

-- ── 3. O diretor de obra pode gravar a aprovação de uma fatura já paga (fica «paga») ──
alter policy "diretor_aprovar" on public.faturas
  using (status = 'aguarda_diretor' and public.fn_is_diretor_obra(centro_custo))
  with check ((status in ('aguarda_diretor', 'aprovada', 'rejeitada') or (status = 'paga' and paga_na_origem))
              and public.fn_is_diretor_obra(centro_custo));
