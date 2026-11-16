-- KAWAII HQ: login attempt limiter (Finance and Birthday sign-in).
-- Run this ONCE in EACH Supabase project used for sign-in:
--   1) the Finance project (SUPABASE_URL / SUPABASE_SERVICE_KEY)
--   2) the Birthday project (HQ_SUPABASE_URL / HQ_SUPABASE_SERVICE_KEY)
-- Safe to re-run.

create table if not exists public.login_attempts (
  key text primary key,
  failures integer not null default 0,
  window_start timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Only the server (service role key) should touch this table.
alter table public.login_attempts enable row level security;
