-- Gasóleo: transferência entre obras (ex.: Lagos -> obra sem depósito que leva em cisterna/jerricans).
-- Um único registo: tipo_registo='transferencia', deposito_obra_* = obra de ONDE SAI, obra_* = obra para ONDE VAI.
-- Stock da origem desce, stock da obra de destino sobe. Não conta como consumo (o consumo é quando se abastece o equipamento).
-- Quem regista é livre; confirma o encarregado da obra de origem (fn_comb_decidir já decide por deposito_obra_id).
-- Se quem regista já é o responsável da origem (ou tem permissão de logística), fica logo aprovado.
create or replace function public.trg_comb_transferencia() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_user record; v_pode boolean;
begin
  if new.tipo_registo is distinct from 'transferencia' then return new; end if;
  if new.deposito_obra_id is null or new.obra_id is null or new.deposito_obra_id = new.obra_id then
    raise exception 'Transferência precisa de obra de origem e de destino diferentes';
  end if;
  new.movimento := 'saida'; new.equipamento_id := null;
  new.equipamento_nome := coalesce(new.equipamento_nome, 'Transferência entre obras');
  if auth.uid() is null then return new; end if;  -- service role / SQL direto
  select * into v_user from utilizadores where auth_id = auth.uid();
  v_pode := fn_cap('log') or exists (
    select 1 from obras o
     where o.id = new.deposito_obra_id and v_user.role = 'encarregado'
       and (o.encarregado_id = v_user.username
            or exists (select 1 from obra_encarregados_extra x where x.obra_id = o.id and x.encarregado_id = v_user.username)));
  if v_pode then
    new.aprovacao := 'aprovado'; new.aprovado_por := coalesce(v_user.nome, v_user.username); new.aprovado_em := now();
  else
    new.aprovacao := 'pendente'; new.aprovado_por := null; new.aprovado_em := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_comb_transferencia on public.registos_combustivel;
create trigger trg_comb_transferencia before insert on public.registos_combustivel
  for each row execute function public.trg_comb_transferencia();
