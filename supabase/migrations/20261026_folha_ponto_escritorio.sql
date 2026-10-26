-- Folha de ponto mensal do escritório: presenças/ausências diárias (preenchidas por cada pessoa)
-- e afetação percentual do mês por obra (lançada pelos diretores de obra, só nas suas obras).

alter table public.colaboradores add column if not exists escritorio boolean not null default false;
alter table public.colaboradores add column if not exists utilizador text;  -- username do portal que preenche esta folha

-- o colaborador é o utilizador atual
create or replace function public.fn_colab_e_meu(p_num integer)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.colaboradores c
                  where c.numero = p_num and c.utilizador is not null and c.utilizador = public.fn_my_username());
$$;

-- o utilizador atual é diretor desta obra (principal ou adicional) ou administrador
create or replace function public.fn_dir_da_obra(p_obra_id text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_my_role() = 'admin'
      or exists (select 1 from public.obras o
                  where o.id = p_obra_id and o.diretor_id = public.fn_my_username())
      or exists (select 1 from public.obra_diretores_extra d
                  where d.obra_id = p_obra_id and d.diretor_id = public.fn_my_username());
$$;

create table if not exists public.fp_esc_dias (
  colaborador integer not null references public.colaboradores(numero) on delete cascade on update cascade,
  data        date    not null,
  codigo      text    not null check (codigo in ('X','F','FE','FJ','FI','B','LP','LO')),
  primary key (colaborador, data)
);

create table if not exists public.fp_esc_afetacao (
  colaborador  integer not null references public.colaboradores(numero) on delete cascade on update cascade,
  mes          date    not null check (mes = date_trunc('month', mes)::date),
  obra_id      text    not null references public.obras(id) on delete cascade,
  percentagem  numeric(5,2) not null check (percentagem > 0 and percentagem <= 100),
  definido_por text    not null default public.fn_my_username(),
  atualizado_em timestamptz not null default now(),
  primary key (colaborador, mes, obra_id)
);

-- a soma das afetações de uma pessoa num mês nunca passa de 100 %
create or replace function public.fn_trg_fp_esc_afetacao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_outros numeric;
begin
  select coalesce(sum(percentagem), 0) into v_outros from public.fp_esc_afetacao
   where colaborador = new.colaborador and mes = new.mes and obra_id <> new.obra_id;
  if v_outros + new.percentagem > 100.001 then
    raise exception 'A afetação deste mês não pode passar de 100 %% (já há % %% noutras obras)', v_outros using errcode = '23514';
  end if;
  new.atualizado_em := now();
  new.definido_por := public.fn_my_username();
  return new;
end;
$$;
drop trigger if exists trg_fp_esc_afetacao on public.fp_esc_afetacao;
create trigger trg_fp_esc_afetacao before insert or update on public.fp_esc_afetacao
  for each row execute function public.fn_trg_fp_esc_afetacao();

alter table public.fp_esc_dias enable row level security;
alter table public.fp_esc_afetacao enable row level security;

-- dias: cada pessoa vê e edita os seus; administrador, Recursos Humanos e diretores de obra podem ver; só o administrador corrige as de outros
create policy "ler" on public.fp_esc_dias for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','diretor_obra') or public.fn_cap('rh'));
create policy "inserir" on public.fp_esc_dias for insert to authenticated
  with check (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'admin');
create policy "alterar" on public.fp_esc_dias for update to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'admin')
  with check (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'admin');
create policy "apagar" on public.fp_esc_dias for delete to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() = 'admin');

-- afetação: vê a própria, administrador, RH e diretores; só o diretor da obra (ou admin) lança
create policy "ler" on public.fp_esc_afetacao for select to authenticated
  using (public.fn_colab_e_meu(colaborador) or public.fn_my_role() in ('admin','diretor_obra') or public.fn_cap('rh'));
create policy "inserir" on public.fp_esc_afetacao for insert to authenticated
  with check (public.fn_dir_da_obra(obra_id));
create policy "alterar" on public.fp_esc_afetacao for update to authenticated
  using (public.fn_dir_da_obra(obra_id)) with check (public.fn_dir_da_obra(obra_id));
create policy "apagar" on public.fp_esc_afetacao for delete to authenticated
  using (public.fn_dir_da_obra(obra_id));

grant select, insert, update, delete on public.fp_esc_dias to authenticated;
grant select, insert, update, delete on public.fp_esc_afetacao to authenticated;
