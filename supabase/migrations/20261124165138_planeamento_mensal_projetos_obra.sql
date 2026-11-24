-- Planeamento Mensal e Projetos das obras (app dos encarregados + páginas do diretor de obra no portal)
--
-- • Planeamento Mensal (planeamento_tarefas): o diretor de obra cria, por obra e por mês, tarefas em texto livre
--   com a equipa e os dias do mês em que se fazem. O encarregado da obra só lê e marca a tarefa como realizada
--   (fn_plan_marcar_feita), que guarda quem e quando.
-- • Projetos (obra_projetos): o diretor de obra carrega PDFs com descrição em dois sub-módulos — «Projetos Obra»
--   (tipo 'projeto') e «Cadastros» (tipo 'cadastro'); o encarregado da obra lê e abre os PDFs.
--   Ficheiros no bucket privado «obra-projetos», caminho <obra_id>/<tipo>/<ficheiro> (abertos com links assinados).
--
-- Quem acede:
--   portal  — capítulo Produção + página ligada na matriz de permissões («planeamento-mensal» / «projetos-obra»);
--             o diretor de obra lê só as suas obras (diretor principal ou adicional), os outros perfis leem todas;
--             edita quem é diretor da obra (fn_dir_da_obra; o perfil Administrador passa sempre).
--   app     — o encarregado lê as obras onde é encarregado (principal ou adicional), se tiver o módulo ligado
--             em Utilizadores → Editar (enc_modulos: 'planeamento' / 'projetos').

-- ── Encarregado da obra (principal ou adicional) ──
create or replace function public.fn_enc_da_obra(p_obra_id text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.obras o
                  where o.id = p_obra_id and o.encarregado_id = public.fn_my_username())
      or exists (select 1 from public.obra_encarregados_extra e
                  where e.obra_id = p_obra_id and e.encarregado_id = public.fn_my_username());
$$;
revoke all on function public.fn_enc_da_obra(text) from public, anon;
grant execute on function public.fn_enc_da_obra(text) to authenticated;

-- ── Página do portal: capítulo Produção, página não fechada e, para o diretor de obra, só as suas obras ──
create or replace function public.fn_obra_pag_prod(p_sec text, p_obra_id text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_cap('prod') and not public.fn_sec_off(p_sec)
     and (coalesce(public.fn_my_role(), '') <> 'diretor_obra' or public.fn_dir_da_obra(p_obra_id));
$$;
revoke all on function public.fn_obra_pag_prod(text, text) from public, anon;
grant execute on function public.fn_obra_pag_prod(text, text) to authenticated;

-- ═══════════════════════ PLANEAMENTO MENSAL ═══════════════════════
create table if not exists public.planeamento_tarefas (
  id            bigserial primary key,
  obra_id       text not null references public.obras(id) on delete cascade,
  mes           date not null check (mes = date_trunc('month', mes)::date),
  ordem         integer not null default 0,
  tarefa        text not null check (length(btrim(tarefa)) > 0),
  equipa        text,
  dias          smallint[] not null default '{}'
                check (1 <= all(dias) and extract(day from (mes + interval '1 month' - interval '1 day'))::int >= all(dias)),
  feita_por     text,
  feita_em      timestamptz,
  criado_por    text default public.fn_my_username(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists planeamento_tarefas_obra_mes_idx on public.planeamento_tarefas (obra_id, mes, ordem);
create index if not exists planeamento_tarefas_mes_idx on public.planeamento_tarefas (mes);

-- Quem fez o check e quando é sempre posto pelo servidor (não se pode inventar nem copiar)
create or replace function public.fn_trg_planeamento_tarefas()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' then
    new.feita_por := null;
    new.feita_em := null;
    new.criado_por := coalesce(public.fn_my_username(), new.criado_por);
  elsif new.feita_em is distinct from old.feita_em or new.feita_por is distinct from old.feita_por then
    if new.feita_em is null then
      new.feita_por := null;
    else
      new.feita_em := now();
      new.feita_por := coalesce(public.fn_my_username(), new.feita_por);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_trg_planeamento_tarefas() from public, anon, authenticated;
drop trigger if exists trg_planeamento_tarefas on public.planeamento_tarefas;
create trigger trg_planeamento_tarefas before insert or update on public.planeamento_tarefas
  for each row execute function public.fn_trg_planeamento_tarefas();

alter table public.planeamento_tarefas enable row level security;

create policy ler on public.planeamento_tarefas for select to authenticated
  using (public.fn_obra_pag_prod('planeamento-mensal', obra_id)
         or (public.fn_enc_mod('planeamento') and public.fn_enc_da_obra(obra_id)));
create policy inserir on public.planeamento_tarefas for insert to authenticated
  with check (public.fn_cap('prod') and not public.fn_sec_off('planeamento-mensal') and public.fn_dir_da_obra(obra_id));
create policy alterar on public.planeamento_tarefas for update to authenticated
  using (public.fn_cap('prod') and not public.fn_sec_off('planeamento-mensal') and public.fn_dir_da_obra(obra_id))
  with check (public.fn_cap('prod') and not public.fn_sec_off('planeamento-mensal') and public.fn_dir_da_obra(obra_id));
create policy apagar on public.planeamento_tarefas for delete to authenticated
  using (public.fn_cap('prod') and not public.fn_sec_off('planeamento-mensal') and public.fn_dir_da_obra(obra_id));

revoke all on public.planeamento_tarefas from anon;
grant select, insert, update, delete on public.planeamento_tarefas to authenticated;
grant usage, select on sequence public.planeamento_tarefas_id_seq to authenticated;

-- Check do encarregado (ou do diretor da obra): marca/desmarca a tarefa como realizada
create or replace function public.fn_plan_marcar_feita(p_id bigint, p_feita boolean)
returns public.planeamento_tarefas
language plpgsql security definer set search_path to 'public' as $$
declare t public.planeamento_tarefas;
begin
  select * into t from public.planeamento_tarefas where id = p_id;
  if not found then
    raise exception 'Tarefa não encontrada' using errcode = 'P0002';
  end if;
  if not ((public.fn_enc_mod('planeamento') and public.fn_enc_da_obra(t.obra_id))
          or (public.fn_cap('prod') and not public.fn_sec_off('planeamento-mensal') and public.fn_dir_da_obra(t.obra_id))) then
    raise exception 'Sem permissão para marcar esta tarefa' using errcode = '42501';
  end if;
  if coalesce(p_feita, false) = (t.feita_em is not null) then
    return t;   -- já está como pedido: mantém quem marcou e quando
  end if;
  update public.planeamento_tarefas
     set feita_em  = case when p_feita then now() end,
         feita_por = case when p_feita then public.fn_my_username() end
   where id = p_id
  returning * into t;
  return t;
end;
$$;
revoke all on function public.fn_plan_marcar_feita(bigint, boolean) from public, anon;
grant execute on function public.fn_plan_marcar_feita(bigint, boolean) to authenticated;

-- ═══════════════════════ PROJETOS (PDFs) ═══════════════════════
create table if not exists public.obra_projetos (
  id         bigserial primary key,
  obra_id    text not null references public.obras(id) on delete cascade,
  tipo       text not null check (tipo in ('projeto', 'cadastro')),
  descricao  text not null check (length(btrim(descricao)) > 0),
  nome       text not null,
  path       text not null unique,
  tamanho    bigint,
  criado_por text default public.fn_my_username(),
  criado_em  timestamptz not null default now()
);
create index if not exists obra_projetos_obra_idx on public.obra_projetos (obra_id, tipo);

alter table public.obra_projetos enable row level security;

create policy ler on public.obra_projetos for select to authenticated
  using (public.fn_obra_pag_prod('projetos-obra', obra_id)
         or (public.fn_enc_mod('projetos') and public.fn_enc_da_obra(obra_id)));
create policy inserir on public.obra_projetos for insert to authenticated
  with check (public.fn_cap('prod') and not public.fn_sec_off('projetos-obra') and public.fn_dir_da_obra(obra_id));
create policy alterar on public.obra_projetos for update to authenticated
  using (public.fn_cap('prod') and not public.fn_sec_off('projetos-obra') and public.fn_dir_da_obra(obra_id))
  with check (public.fn_cap('prod') and not public.fn_sec_off('projetos-obra') and public.fn_dir_da_obra(obra_id));
create policy apagar on public.obra_projetos for delete to authenticated
  using (public.fn_cap('prod') and not public.fn_sec_off('projetos-obra') and public.fn_dir_da_obra(obra_id));

revoke all on public.obra_projetos from anon;
grant select, insert, update, delete on public.obra_projetos to authenticated;
grant usage, select on sequence public.obra_projetos_id_seq to authenticated;

-- Bucket privado só para PDFs (até 50 MB cada)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('obra-projetos', 'obra-projetos', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy obra_projetos_ler on storage.objects for select to authenticated
  using (bucket_id = 'obra-projetos'
         and (public.fn_obra_pag_prod('projetos-obra', (storage.foldername(name))[1])
              or (public.fn_enc_mod('projetos') and public.fn_enc_da_obra((storage.foldername(name))[1]))));
create policy obra_projetos_inserir on storage.objects for insert to authenticated
  with check (bucket_id = 'obra-projetos'
              and public.fn_cap('prod') and not public.fn_sec_off('projetos-obra')
              and public.fn_dir_da_obra((storage.foldername(name))[1]));
create policy obra_projetos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'obra-projetos'
         and public.fn_cap('prod') and not public.fn_sec_off('projetos-obra')
         and public.fn_dir_da_obra((storage.foldername(name))[1]));
