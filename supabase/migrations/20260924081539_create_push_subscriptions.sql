create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  destinatario text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "anon read push_subscriptions" on public.push_subscriptions
  for select using (true);

create policy "anon write push_subscriptions" on public.push_subscriptions
  for all using (true) with check (true);

grant select, insert, update, delete on public.push_subscriptions to anon, authenticated;
