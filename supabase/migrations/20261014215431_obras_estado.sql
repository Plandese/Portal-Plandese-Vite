-- Estado da obra dentro das ativas: em_preparacao | em_curso (em funcionamento) | concluida (só custos e fecho)
alter table public.obras add column estado text not null default 'em_curso'
  check (estado in ('em_preparacao','em_curso','concluida'));
grant select (estado), insert (estado), update (estado) on public.obras to authenticated;
