create or replace function public.trg_obra_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into obra_codigos(obra_id, codigo) values (new.id, fn_novo_codigo_obra()) on conflict do nothing;
  return new;
end $$;
create trigger obra_codigo_auto after insert on public.obras for each row execute function public.trg_obra_codigo();