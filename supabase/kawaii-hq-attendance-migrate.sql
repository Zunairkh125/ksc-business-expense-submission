-- Kawaii HQ: Attendance migration. Run ONCE in Supabase SQL Editor, BEFORE the import file.
-- Use this if you already ran the first attendance schema. Safe to run again.

-- 1) Attendance roster (its own list, not the Birthday employee list).
create table if not exists public.attendance_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  slack_user_id text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.attendance_employees enable row level security;

-- 2) Occurrences: point employee_id at the attendance roster.
--    NOT VALID lets old rows stay without blocking the change.
alter table public.attendance_occurrences drop constraint if exists attendance_occurrences_employee_id_fkey;
alter table public.attendance_occurrences
  add constraint attendance_occurrences_employee_id_fkey
  foreign key (employee_id) references public.attendance_employees(id) not valid;

-- 3) Where a row came from: 'app' or 'sheet_import'.
alter table public.attendance_occurrences add column if not exists source text not null default 'app';

-- 4) Old sheet rows have no location, and some have blank kiosk / management answers.
alter table public.attendance_occurrences alter column location drop not null;
alter table public.attendance_occurrences alter column kiosk_closed_due_to_delay drop not null;
alter table public.attendance_occurrences alter column management_notified_before_shift drop not null;

-- 5) Employee's default location (filled from the form, saved to the employee record).
alter table public.attendance_employees add column if not exists location text;
