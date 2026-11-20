-- Guias de remessa: o encarregado só fotografa. As fotos são juntas num PDF guardado na pasta «Guias» da Dropbox
-- (função guias-pdf) e o casamento com a fatura é feito no portal da empresa (sem leitura automática).
alter table public.guias_remessa
  alter column numero drop not null,
  add column if not exists pdf_path text,        -- caminho do PDF na Dropbox (null = por gerar)
  add column if not exists pdf_em   timestamptz;

-- Quem trata das faturas (acesso financeiro) também associa as guias às faturas
drop policy if exists "alterar" on public.guias_remessa;
create policy "alterar" on public.guias_remessa for update to authenticated
  using (criado_por = public.fn_my_username() or public.fn_my_role() = 'admin' or public.fn_cap('fin'))
  with check (criado_por = public.fn_my_username() or public.fn_my_role() = 'admin' or public.fn_cap('fin'));
