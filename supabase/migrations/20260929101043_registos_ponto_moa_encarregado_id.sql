alter table public.registos_ponto_moa add column if not exists encarregado_id text;

update public.registos_ponto_moa r
   set encarregado_id = u.username
  from public.utilizadores u
 where r.encarregado_id is null and u.nome = r.encarregado_nome;

-- Um trabalhador só pode ter um registo por dia/obra/encarregado
create unique index if not exists registos_ponto_moa_data_colab_obra_enc_key
  on public.registos_ponto_moa (data, colab_moa_id, obra_id, encarregado_id)
  nulls not distinct
  where colab_moa_id is not null;

create or replace function public.fn_trg_ponto_moa_enc_janela_edicao()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
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
$function$;

-- Encarregados só leem os seus próprios registos de MO Aluguer
drop policy if exists "ler" on public.registos_ponto_moa;
create policy "ler" on public.registos_ponto_moa for select
  using (fn_is_member() and (fn_my_role() <> 'encarregado' or encarregado_id = fn_my_username()));