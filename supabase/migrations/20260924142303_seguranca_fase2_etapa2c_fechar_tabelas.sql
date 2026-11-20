-- Todas as tabelas: só utilizadores do portal com sessão (auth.uid() ligado a utilizadores.auth_id)
do $$
declare t text; p record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('utilizadores', 'whatsapp_config', 'whatsapp_sessoes')
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy membros on public.%I for all to authenticated using (public.fn_is_member()) with check (public.fn_is_member())', t);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

-- utilizadores: membros lêem; cada um edita a própria linha, admin edita todas
drop policy if exists "select utilizadores"    on public.utilizadores;
drop policy if exists "anon read utilizadores" on public.utilizadores;
drop policy if exists "update utilizadores"    on public.utilizadores;
revoke all on public.utilizadores from anon;
create policy membros_ler on public.utilizadores for select to authenticated using (public.fn_is_member());
create policy editar_proprio_ou_admin on public.utilizadores for update to authenticated
  using (auth_id = auth.uid() or public.fn_my_role() = 'admin')
  with check (auth_id = auth.uid() or public.fn_my_role() = 'admin');

-- Login antigo deixa de existir para o público (evita adivinhar passwords sem limite de tentativas)
revoke execute on function public.fn_login(text, text) from public, anon, authenticated;

-- fn_upsert_user: admin gere todos; os outros só mudam o próprio nome/password, sem mudar de perfil
create or replace function public.fn_upsert_user(p_username text, p_nome text, p_role text, p_initials text, p_password text default null, p_telefone text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_role text := public.fn_my_role();
  v_me   text;
begin
  select username into v_me from public.utilizadores where auth_id = auth.uid();
  if v_role is distinct from 'admin' then
    if v_me is null or lower(p_username) <> v_me or p_role is distinct from v_role then
      raise exception 'Sem permissão para alterar este utilizador' using errcode = '42501';
    end if;
  end if;

  INSERT INTO public.utilizadores (username, nome, role, initials, password, telefone)
  VALUES (
    lower(p_username), p_nome, p_role, p_initials,
    CASE WHEN p_password IS NOT NULL AND p_password <> ''
         THEN extensions.crypt(p_password, extensions.gen_salt('bf'))
         ELSE NULL END,
    p_telefone
  )
  ON CONFLICT (username) DO UPDATE SET
    nome = EXCLUDED.nome,
    role = EXCLUDED.role,
    initials = EXCLUDED.initials,
    telefone = COALESCE(EXCLUDED.telefone, public.utilizadores.telefone),
    password = CASE WHEN p_password IS NOT NULL AND p_password <> ''
                     THEN extensions.crypt(p_password, extensions.gen_salt('bf'))
                     ELSE public.utilizadores.password END;
END;
$function$;
revoke execute on function public.fn_upsert_user(text,text,text,text,text,text) from public, anon;
grant  execute on function public.fn_upsert_user(text,text,text,text,text,text) to authenticated;