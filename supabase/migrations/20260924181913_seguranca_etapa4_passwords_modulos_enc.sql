-- ═══ 1) Passwords passam a viver só no Supabase Auth ═══════════════════
alter table public.utilizadores alter column password drop not null;
alter table public.utilizadores add column if not exists trocar_password boolean not null default false;
grant select (trocar_password) on public.utilizadores to authenticated;

create or replace function public.fn_sync_auth_user(p_username text, p_hash text default null)
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
  if not found then return null; end if;

  v_email := v_user.username || '@portal.plandese.local';
  v_id := v_user.auth_id;
  if v_id is null then select id into v_id from auth.users where email = v_email; end if;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
            coalesce(p_hash, v_user.password, ''), now(),
            jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'username',v_user.username,'role',v_user.role),
            jsonb_build_object('nome', v_user.nome), now(), now(),
            '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, 'email',
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), null, now(), now());
  else
    update auth.users
       set encrypted_password = coalesce(p_hash, encrypted_password),
           raw_app_meta_data  = coalesce(raw_app_meta_data,'{}'::jsonb)
                                || jsonb_build_object('username', v_user.username, 'role', v_user.role),
           updated_at = now()
     where id = v_id;
  end if;

  update public.utilizadores set auth_id = v_id where username = v_user.username and auth_id is distinct from v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_sync_auth_user(text, text) from public, anon, authenticated;

create or replace function public.fn_trg_sync_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_sync_auth_user(new.username, null);
  return null;
end;
$$;
drop function if exists public.fn_sync_auth_user(text);

create or replace function public.fn_upsert_user(p_username text, p_nome text, p_role text, p_initials text, p_password text default null, p_telefone text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_role text := public.fn_my_role();
  v_me   text := public.fn_my_username();
  v_user text := lower(p_username);
  v_hash text;
begin
  if v_role is distinct from 'admin' then
    if v_me is null or v_user <> v_me or p_role is distinct from v_role then
      raise exception 'Sem permissão para alterar este utilizador' using errcode = '42501';
    end if;
  end if;
  if p_password is not null and p_password <> '' and length(p_password) < 8 then
    raise exception 'A password tem de ter pelo menos 8 caracteres' using errcode = '22023';
  end if;

  insert into public.utilizadores (username, nome, role, initials, telefone)
  values (v_user, p_nome, p_role, p_initials, p_telefone)
  on conflict (username) do update set
    nome = excluded.nome,
    role = excluded.role,
    initials = excluded.initials,
    telefone = coalesce(excluded.telefone, public.utilizadores.telefone);

  if p_password is not null and p_password <> '' then
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
    perform public.fn_sync_auth_user(v_user, v_hash);
    -- password posta por outra pessoa (admin) é provisória: o dono tem de a trocar no próximo login
    update public.utilizadores set trocar_password = (v_user <> coalesce(v_me, '')) where username = v_user;
  else
    perform public.fn_sync_auth_user(v_user, null);
  end if;
end;
$function$;
revoke execute on function public.fn_upsert_user(text,text,text,text,text,text) from public, anon;
grant  execute on function public.fn_upsert_user(text,text,text,text,text,text) to authenticated;

create or replace function public.fn_password_trocada()
returns void language sql security definer set search_path = public as $$
  update public.utilizadores set trocar_password = false where auth_id = auth.uid();
$$;
revoke execute on function public.fn_password_trocada() from public, anon;
grant  execute on function public.fn_password_trocada() to authenticated;

update public.utilizadores p set password = null
 where p.auth_id is not null and exists (select 1 from auth.users u where u.id = p.auth_id and coalesce(u.encrypted_password,'') <> '');

update public.utilizadores set trocar_password = true;

-- ═══ 2) Módulos do encarregado também no servidor ══════════════════════
create or replace function public.fn_enc_mod(p_mod text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.utilizadores
                  where auth_id = auth.uid() and role = 'encarregado'
                    and (enc_modulos is null or enc_modulos ? p_mod));
$$;
revoke execute on function public.fn_enc_mod(text) from public, anon;
grant  execute on function public.fn_enc_mod(text) to authenticated;

create or replace function public.fn_trg_proteger_enc_modulos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enc_modulos is distinct from old.enc_modulos
     and auth.uid() is not null and public.fn_my_role() is distinct from 'admin' then
    raise exception 'Só o administrador pode alterar os módulos' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_trg_proteger_enc_modulos() from public, anon, authenticated;
drop trigger if exists trg_proteger_enc_modulos on public.utilizadores;
create trigger trg_proteger_enc_modulos before update of enc_modulos on public.utilizadores
for each row execute function public.fn_trg_proteger_enc_modulos();

drop policy inserir on public.registos_ponto;  drop policy alterar on public.registos_ponto;  drop policy apagar on public.registos_ponto;
create policy inserir on public.registos_ponto for insert to authenticated with check (public.fn_cap('rh') or public.fn_enc_mod('ponto'));
create policy alterar on public.registos_ponto for update to authenticated using (public.fn_cap('rh') or public.fn_enc_mod('ponto')) with check (public.fn_cap('rh') or public.fn_enc_mod('ponto'));
create policy apagar  on public.registos_ponto for delete to authenticated using (public.fn_cap('rh') or public.fn_enc_mod('ponto'));

drop policy inserir on public.registos_ponto_moa;  drop policy alterar on public.registos_ponto_moa;  drop policy apagar on public.registos_ponto_moa;
create policy inserir on public.registos_ponto_moa for insert to authenticated with check (public.fn_cap('rh') or public.fn_enc_mod('aluguer'));
create policy alterar on public.registos_ponto_moa for update to authenticated using (public.fn_cap('rh') or public.fn_enc_mod('aluguer')) with check (public.fn_cap('rh') or public.fn_enc_mod('aluguer'));
create policy apagar  on public.registos_ponto_moa for delete to authenticated using (public.fn_cap('rh') or public.fn_enc_mod('aluguer'));

drop policy inserir on public.colaboradores_moa;  drop policy alterar on public.colaboradores_moa;  drop policy apagar on public.colaboradores_moa;
create policy inserir on public.colaboradores_moa for insert to authenticated with check (public.fn_cap('def') or public.fn_enc_mod('aluguer'));
create policy alterar on public.colaboradores_moa for update to authenticated using (public.fn_cap('def') or public.fn_enc_mod('aluguer')) with check (public.fn_cap('def') or public.fn_enc_mod('aluguer'));
create policy apagar  on public.colaboradores_moa for delete to authenticated using (public.fn_cap('def') or public.fn_enc_mod('aluguer'));

drop policy ler on public.pedidos_compra;  drop policy inserir on public.pedidos_compra;
create policy ler on public.pedidos_compra for select to authenticated
  using (public.fn_cap('cmp') or (public.fn_enc_mod('compras') and criado_por = public.fn_my_username()));
create policy inserir on public.pedidos_compra for insert to authenticated
  with check (public.fn_cap('cmp') or (public.fn_enc_mod('compras') and criado_por = public.fn_my_username()));

drop policy alterar on public.equipamentos;
create policy alterar on public.equipamentos for update to authenticated
  using (public.fn_cap('log') or public.fn_enc_mod('equipamentos')) with check (public.fn_cap('log') or public.fn_enc_mod('equipamentos'));

drop policy ler on public.eq_movimentos;  drop policy inserir on public.eq_movimentos;
create policy ler on public.eq_movimentos for select to authenticated using (public.fn_cap('log') or public.fn_enc_mod('equipamentos'));
create policy inserir on public.eq_movimentos for insert to authenticated with check (public.fn_cap('log') or public.fn_enc_mod('equipamentos'));

drop policy ler on public.registos_combustivel;  drop policy inserir on public.registos_combustivel;
create policy ler on public.registos_combustivel for select to authenticated using (public.fn_cap('log') or public.fn_enc_mod('combustivel'));
create policy inserir on public.registos_combustivel for insert to authenticated with check (public.fn_cap('log') or public.fn_enc_mod('combustivel'));

-- ═══ 3) Avisos menores ═════════════════════════════════════════════════
alter function public.fn_notif_whatsapp() set search_path = '';
alter function public.fn_url_encode(text) set search_path = '';