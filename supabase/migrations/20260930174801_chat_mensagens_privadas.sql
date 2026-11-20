-- Mensagens privadas no chat: para = username do destinatário (nulo = canal geral)
alter table public.chat_mensagens add column if not exists para text;
create index if not exists chat_mensagens_para_idx on public.chat_mensagens (para);

drop policy if exists "ler" on public.chat_mensagens;
drop policy if exists "inserir" on public.chat_mensagens;

create policy "ler" on public.chat_mensagens for select to authenticated
  using (
    public.fn_my_role() is not null and public.fn_my_role() <> 'encarregado'
    and (para is null or autor = public.fn_my_username() or para = public.fn_my_username())
  );

create policy "inserir" on public.chat_mensagens for insert to authenticated
  with check (
    autor = public.fn_my_username() and public.fn_my_role() <> 'encarregado'
    and (para is null or exists (
      select 1 from public.utilizadores u where u.username = para and u.role <> 'encarregado'))
  );
