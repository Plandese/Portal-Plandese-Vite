create or replace function public.ag_alertas()
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  r jsonb := '[]'::jsonb;
  n int;
  x record;
begin
  for x in select obra_nome, saldo, margem from ag_balanco() where ativa and proveitos > 0 and margem < 0 order by saldo loop
    r := r || jsonb_build_object('tipo','margem','nivel','alta','seccao','producao',
      'titulo', 'Margem negativa: ' || x.obra_nome,
      'detalhe', 'Saldo de ' || replace(to_char(x.saldo,'FM999G999G990'),',','.') || ' € (' || replace(to_char(x.margem*100,'FM990D0'),'.',',') || '% sobre proveitos).');
  end loop;

  select count(*) into n from faturas where status = 'aguarda_diretor' and criado_em < now() - interval '5 days';
  if n > 0 then
    r := r || jsonb_build_object('tipo','faturas','nivel','media','seccao','faturas-aprovar',
      'titulo', n || ' fatura(s) à espera de aprovação há mais de 5 dias',
      'detalhe', 'Estado "aguarda diretor" sem decisão.');
  end if;

  for x in select nome, matricula, seguro_validade, ipo_validade from equipamentos
           where coalesce(estado,'') <> 'inativo'
             and (seguro_validade < current_date + 30 or ipo_validade < current_date + 30)
           order by least(coalesce(seguro_validade,'2999-01-01'), coalesce(ipo_validade,'2999-01-01')) limit 15 loop
    r := r || jsonb_build_object('tipo','equipamento','nivel',
      case when least(coalesce(x.seguro_validade,'2999-01-01'::date), coalesce(x.ipo_validade,'2999-01-01'::date)) < current_date then 'alta' else 'media' end,
      'seccao','equipamentos',
      'titulo', 'Documentos de ' || x.nome || coalesce(' (' || x.matricula || ')',''),
      'detalhe', concat_ws(' · ',
        case when x.seguro_validade < current_date + 30 then 'Seguro: ' || to_char(x.seguro_validade,'DD/MM/YYYY') end,
        case when x.ipo_validade   < current_date + 30 then 'IPO: '    || to_char(x.ipo_validade,'DD/MM/YYYY') end));
  end loop;

  for x in select nome, prazo from obras where ativa and prazo is not null and prazo < current_date + 30 order by prazo limit 10 loop
    r := r || jsonb_build_object('tipo','prazo','nivel', case when x.prazo < current_date then 'alta' else 'media' end,'seccao','obras',
      'titulo', 'Prazo de ' || x.nome,
      'detalhe', case when x.prazo < current_date then 'Ultrapassado em ' || to_char(x.prazo,'DD/MM/YYYY')
                      else 'Termina em ' || to_char(x.prazo,'DD/MM/YYYY') end);
  end loop;

  select count(*) into n from pedidos_compra where estado = 'pendente' and data_limite is not null and data_limite < current_date + 3;
  if n > 0 then
    r := r || jsonb_build_object('tipo','compras','nivel','media','seccao','compras',
      'titulo', n || ' pedido(s) de compra pendentes com data limite próxima',
      'detalhe', 'Data limite nos próximos 3 dias ou já passada.');
  end if;

  select count(*) into n from (
    select distinct p.obra_id, p.data from registos_ponto p
    where p.data >= current_date - 14 and p.data < current_date and extract(isodow from p.data) < 6
      and not exists (select 1 from aprovacoes_ponto a where a.obra_id = p.obra_id and a.data = p.data)
  ) t;
  if n > 0 then
    r := r || jsonb_build_object('tipo','ponto','nivel','info','seccao','historico',
      'titulo', n || ' dia(s)/obra com ponto por aprovar nos últimos 14 dias',
      'detalhe', 'Registos de encarregados ainda sem aprovação do diretor.');
  end if;

  select count(*) into n from eq_manutencoes where estado = 'pendente' and data < current_date - 30;
  if n > 0 then
    r := r || jsonb_build_object('tipo','manutencao','nivel','info','seccao','equipamentos',
      'titulo', n || ' manutenção(ões) pendentes há mais de 30 dias',
      'detalhe', 'Pedidos de manutenção de equipamentos por resolver.');
  end if;

  return r;
end;
$$;
grant execute on function public.ag_alertas() to authenticated;