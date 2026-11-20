create or replace function public.fn_lembrete_necessidades(p_modo text)
returns integer language plpgsql security definer set search_path=public as $$
declare
  sem date := (date_trunc('week', current_date) + interval '7 days')::date;
  r record; n integer := 0; msg text; lista text;
begin
  if exists (select 1 from feriados_pt where data = current_date) then return 0; end if;

  if p_modo in ('manha','tarde') then
    -- diretores com obras em curso ainda sem nenhuma necessidade registada para a semana seguinte
    for r in
      select d.diretor, string_agg(o.nome, ', ' order by o.nome) as obras
        from (select id, diretor_id as diretor from obras where diretor_id is not null
              union select obra_id, diretor_id from obra_diretores_extra) d
        join obras o on o.id = d.id
       where o.ativa and coalesce(o.estado,'em_curso') = 'em_curso'
         and not exists (select 1 from necessidades_obra n where n.obra_id = o.id and n.semana = sem and n.estado <> 'cancelado')
       group by d.diretor
    loop
      msg := case p_modo when 'manha'
        then 'Hoje é dia de registar as necessidades de obra da próxima semana. Ainda sem registos: ' || r.obras
        else 'Último aviso: as necessidades de obra da próxima semana terminam hoje. Ainda sem registos: ' || r.obras end;
      insert into notificacoes(actor, actor_nome, acao, seccao, destinatario) values (null, 'Sistema', msg, 'necessidades', r.diretor);
      n := n + 1;
    end loop;
  elsif p_modo = 'sexta' then
    -- resumo para compras / administração
    select string_agg(o.nome, ', ' order by o.nome) into lista
      from obras o
     where o.ativa and coalesce(o.estado,'em_curso') = 'em_curso'
       and not exists (select 1 from necessidades_obra n where n.obra_id = o.id and n.semana = sem and n.estado <> 'cancelado');
    msg := format('Necessidades de obra da próxima semana: %s linha(s) pedidas, %s por tratar.%s',
      (select count(*) from necessidades_obra where semana = sem and estado <> 'cancelado'),
      (select count(*) from necessidades_obra where semana = sem and estado = 'pendente'),
      case when lista is not null then ' Obras sem registos: ' || lista else '' end);
    for r in select username from utilizadores where role in ('compras') loop
      insert into notificacoes(actor, actor_nome, acao, seccao, destinatario) values (null, 'Sistema', msg, 'necessidades', r.username);
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.fn_lembrete_necessidades(text) from public, anon, authenticated;

select cron.schedule('necessidades-lembrete-manha', '30 8 * * 4',  $$select public.fn_lembrete_necessidades('manha')$$);
select cron.schedule('necessidades-lembrete-tarde', '30 15 * * 4', $$select public.fn_lembrete_necessidades('tarde')$$);
select cron.schedule('necessidades-resumo-sexta',   '30 8 * * 5',  $$select public.fn_lembrete_necessidades('sexta')$$);