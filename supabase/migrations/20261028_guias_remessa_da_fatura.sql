-- Todas as guias de uma fatura (de qualquer encarregado), para a comparação das quantidades.
create or replace function public.fn_guias_da_fatura(p_fatura_id bigint, p_guia_id bigint)
returns table (id bigint, numero text, numero_norm text, linhas jsonb, estado text, obra_nome text)
language sql stable security definer set search_path = public as $$
  select g.id, g.numero, g.numero_norm, g.linhas, g.estado, g.obra_nome
    from guias_remessa g
    join faturas f on f.id = p_fatura_id
   where public.fn_is_member()
     and (g.id = p_guia_id
          or g.fatura_id = p_fatura_id
          or (coalesce(g.nif, '') = coalesce(f.nif, '')
              and exists (select 1 from jsonb_array_elements_text(f.guias_ref) r
                           where upper(regexp_replace(r, '[^A-Za-z0-9]', '', 'g')) = g.numero_norm)))
$$;
grant execute on function public.fn_guias_da_fatura(bigint, bigint) to authenticated;
