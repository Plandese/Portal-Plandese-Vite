-- Chat interno da equipa (admin, diretores, compras, financeiro). Encarregados ficam de fora.
-- Um único canal geral. Só o autor apaga as suas mensagens.
create table if not exists public.chat_mensagens (
  id        uuid primary key default gen_random_uuid(),
  autor     text not null default public.fn_my_username(),
  texto     text not null check (char_length(btrim(texto)) between 1 and 4000),
  criado_em timestamptz not null default now()
);
create index if not exists chat_mensagens_criado_idx on public.chat_mensagens (criado_em desc);

alter table public.chat_mensagens enable row level security;

create policy "ler" on public.chat_mensagens for select to authenticated
  using (public.fn_my_role() is not null and public.fn_my_role() <> 'encarregado');
create policy "inserir" on public.chat_mensagens for insert to authenticated
  with check (autor = public.fn_my_username() and public.fn_my_role() <> 'encarregado');
create policy "apagar" on public.chat_mensagens for delete to authenticated
  using (autor = public.fn_my_username());

alter publication supabase_realtime add table public.chat_mensagens;
