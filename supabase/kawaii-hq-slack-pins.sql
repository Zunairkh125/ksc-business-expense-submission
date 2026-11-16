-- KAWAII HQ: email + Slack PIN sign-in (Attendance and Birthday).
-- Run ONCE in the Kawaii HQ (Birthday) Supabase project. Safe to re-run.

create table if not exists public.slack_pin_challenges (
  id uuid primary key default gen_random_uuid(),
  scope text not null,              -- 'attendance' or 'birthday'
  email text not null,
  slack_user_id text not null,
  slack_name text,
  pin_hash text not null,
  status text not null default 'open',   -- open | used | replaced | locked
  attempts integer not null default 0,
  dm_channel text,
  dm_ts text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists slack_pin_challenges_lookup
  on public.slack_pin_challenges (scope, email, created_at desc);

-- Server-only (service role key). No public access.
alter table public.slack_pin_challenges enable row level security;
