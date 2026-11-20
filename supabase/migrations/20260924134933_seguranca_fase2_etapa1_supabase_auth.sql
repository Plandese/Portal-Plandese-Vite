-- Etapa 1: cada utilizador passa a ter conta no Supabase Auth (email sintético <username>@portal.plandese.local),
-- com o MESMO hash bcrypt — ninguém muda de password. Políticas RLS ficam iguais nesta etapa.

alter table public.utilizadores add column if not exists auth_id uuid unique references auth.users(id) on delete set null;

create or replace function public.fn_sync_auth_user(p_username text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_user  public.utilizadores;
  v_id    uuid;
  v_email text;
begin
  select * into v_user from public.utilizadores where username = lower(p_username);
  if not found or v_user.password is null then return null; end if;

  v_email := v_user.username || '@portal.plandese.local';
  v_id := v_user.auth_id;
  if v_id is null then select id into v_id from auth.users where email = v_email; end if;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, v_user.password, now(),
            jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'username',v_user.username,'role',v_user.role),
            jsonb_build_object('nome', v_user.nome), now(), now(),
            '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, 'email',
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            null, now(), now());
  else
    update auth.users
       set encrypted_password = v_user.password,
           raw_app_meta_data  = coalesce(raw_app_meta_data,'{}'::jsonb)
                                || jsonb_build_object('username', v_user.username, 'role', v_user.role),
           updated_at = now()
     where id = v_id;
  end if;

  update public.utilizadores set auth_id = v_id where username = v_user.username and auth_id is distinct from v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_sync_auth_user(text) from public, anon, authenticated;

-- Mantém auth.users em sincronia sempre que se cria um utilizador ou muda password/role (fn_upsert_user, etc.)
create or replace function public.fn_trg_sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_sync_auth_user(new.username);
  return null;
end;
$$;
revoke execute on function public.fn_trg_sync_auth_user() from public, anon, authenticated;

drop trigger if exists trg_sync_auth_user on public.utilizadores;
create trigger trg_sync_auth_user
after insert or update of password, role on public.utilizadores
for each row execute function public.fn_trg_sync_auth_user();

-- Migra as contas existentes
select public.fn_sync_auth_user(username) from public.utilizadores;

-- empresas_moa só tinha políticas para anon; com sessão os pedidos vão como authenticated
create policy "authenticated read empresas_moa" on public.empresas_moa for select to authenticated using (true);
create policy "authenticated write empresas_moa" on public.empresas_moa for all to authenticated using (true) with check (true);