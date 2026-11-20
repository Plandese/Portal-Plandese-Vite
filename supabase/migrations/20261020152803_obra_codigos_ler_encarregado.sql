-- O encarregado (principal ou extra) de uma obra pode ler o código de acesso dessa obra (QR do gasóleo).
drop policy if exists ler_encarregado on public.obra_codigos;
create policy ler_encarregado on public.obra_codigos for select to authenticated
  using (
    exists (select 1 from public.obras o where o.id = obra_codigos.obra_id and o.encarregado_id = fn_my_username())
    or exists (select 1 from public.obra_encarregados_extra e where e.obra_id = obra_codigos.obra_id and e.encarregado_id = fn_my_username())
  );
