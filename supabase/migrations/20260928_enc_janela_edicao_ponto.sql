-- Encarregado: só pode editar/apagar os registos de ponto que ELE PRÓPRIO
-- submeteu, e só até 24h depois de criados (coluna criado_em). Passado esse
-- prazo — ou assim que o diretor de obra aprovar o dia (ver
-- 20260924_aprovacoes_ponto.sql / _moa.sql, que já bloqueiam o dia aprovado) —
-- só o diretor de obra ou o admin podem alterar.
-- Não se aplica a admin/diretor_obra (continuam a editar livremente, sujeitos
-- apenas ao trigger de dia aprovado já existente).

create or replace function public.fn_trg_ponto_enc_janela_edicao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.fn_my_role() = 'encarregado' then
    if old.encarregado_id is distinct from public.fn_my_username() then
      raise exception 'Só pode editar os registos que submeteu' using errcode = '42501';
    end if;
    if old.criado_em < now() - interval '24 hours' then
      raise exception 'Prazo de 24h para editar este registo expirou — peça ao diretor de obra' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ponto_enc_janela_edicao on public.registos_ponto;
create trigger trg_ponto_enc_janela_edicao
  before update or delete on public.registos_ponto
  for each row execute function public.fn_trg_ponto_enc_janela_edicao();

-- Mesma regra para a MO Aluguer. Esta tabela não tem encarregado_id (só o
-- nome, gravado em encAlugSubmeter) — comparar pelo nome do utilizador atual
-- é o melhor sinal disponível, igual ao filtro já usado em encLoadHistorico.
create or replace function public.fn_trg_ponto_moa_enc_janela_edicao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.fn_my_role() = 'encarregado' then
    if old.encarregado_nome is distinct from (select u.nome from public.utilizadores u where u.auth_id = auth.uid()) then
      raise exception 'Só pode editar os registos que submeteu' using errcode = '42501';
    end if;
    if old.criado_em < now() - interval '24 hours' then
      raise exception 'Prazo de 24h para editar este registo expirou — peça ao diretor de obra' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ponto_moa_enc_janela_edicao on public.registos_ponto_moa;
create trigger trg_ponto_moa_enc_janela_edicao
  before update or delete on public.registos_ponto_moa
  for each row execute function public.fn_trg_ponto_moa_enc_janela_edicao();
