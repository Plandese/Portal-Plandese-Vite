-- Planos de trabalho (Gantt tipo MS Project a partir do articulado) — versão de teste,
-- restrita ao utilizador david.mosca (a interface aplica o mesmo limite em permissions.js).
create table if not exists public.planos_trabalho (
  id          uuid primary key default gen_random_uuid(),
  obra_id     text,
  nome        text not null,
  data_inicio date not null,
  calendario  text not null default '5',          -- '5' = seg–sex, '6' = seg–sáb (feriados de feriados_pt)
  tarefas     jsonb not null default '[]'::jsonb,  -- [{id,nome,nivel,dur,pred:[{id,tipo,lag}],inicioMin,pct,valor,cod,un,qtd,notas,fechado}]
  criado_por  text default public.fn_my_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.planos_trabalho enable row level security;

drop policy if exists so_david on public.planos_trabalho;
create policy so_david on public.planos_trabalho for all to authenticated
  using (public.fn_my_username() = 'david.mosca')
  with check (public.fn_my_username() = 'david.mosca');

revoke all on public.planos_trabalho from anon;
grant select, insert, update, delete on public.planos_trabalho to authenticated;
