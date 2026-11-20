-- Combustível: leitura do contador (horas ou km) do equipamento no momento do abastecimento.
-- Veículos registam quilómetros, máquinas registam horas; o campo é opcional.
alter table public.registos_combustivel
  add column if not exists contador_valor numeric,
  add column if not exists contador_tipo  text;

alter table public.registos_combustivel
  drop constraint if exists registos_combustivel_contador_tipo_chk;
alter table public.registos_combustivel
  add constraint registos_combustivel_contador_tipo_chk
  check (contador_tipo is null or contador_tipo in ('km','horas'));

comment on column public.registos_combustivel.contador_valor is 'Horas ou km do equipamento no abastecimento';
comment on column public.registos_combustivel.contador_tipo  is 'Unidade de contador_valor: km (veículos) ou horas (máquinas)';
