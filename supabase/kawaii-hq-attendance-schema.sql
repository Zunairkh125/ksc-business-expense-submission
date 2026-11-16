-- Kawaii HQ: Attendance & Call-Out Log (Disney). Run once in Supabase SQL Editor, BEFORE the import file.
-- Only the server (service role key) reads and writes these tables. RLS is on with no policies.

-- Attendance roster. Separate from the Birthday employee list, because Disney call-out staff
-- are not all in the Zapier birthday import.
create table if not exists public.attendance_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  slack_user_id text not null unique,
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_pin_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  pin_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists attendance_pin_challenges_email_idx on public.attendance_pin_challenges (email, created_at desc);

create table if not exists public.attendance_occurrences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.attendance_employees(id),
  employee_name text not null,
  slack_user_id text,
  -- Location is null for historical rows: the old sheet did not record it.
  location text,
  occurrence_type text not null,
  occurrence_date date not null,
  scheduled_shift_start text,
  actual_arrival text,
  minutes_late numeric,
  notification_time text not null,
  shift_affected text not null,
  protected text not null check (protected in ('YES', 'NO')),
  sick_vacation text not null check (sick_vacation in ('YES', 'NO')),
  notice_given text not null,
  reason text not null,
  -- Null for historical rows where the old sheet was blank.
  kiosk_closed_due_to_delay text check (kiosk_closed_due_to_delay in ('YES', 'NO')),
  management_notified_before_shift text check (management_notified_before_shift in ('YES', 'NO')),
  points numeric(4,2) not null,
  points_overridden boolean not null default false,
  override_reason text,
  submitted_by text not null,
  submitted_role text,
  -- 'app' for entries made in this app, 'sheet_import' for the old Excel log.
  source text not null default 'app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendance_occurrences_employee_date_idx on public.attendance_occurrences (employee_id, occurrence_date);

create table if not exists public.attendance_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  occurrence_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.attendance_employees enable row level security;
alter table public.attendance_pin_challenges enable row level security;
alter table public.attendance_occurrences enable row level security;
alter table public.attendance_audit_log enable row level security;
