-- Stage Pilot: decks table (spec: decks(id, title, status, original_path, json jsonb, created_at))
create table if not exists public.decks (
  id text primary key,
  title text not null,
  status text not null,
  original_path text,
  json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists decks_created_at_idx on public.decks (created_at desc);

-- Hub writes with the service_role key (bypasses RLS). No anon/authenticated access by default.
alter table public.decks enable row level security;
