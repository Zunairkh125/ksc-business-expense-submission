-- ============================================================================
-- Kawaii Slime Company - Business Expense & Receipt Submission
-- Database Schema & RLS Policies for Supabase (Submissions & Slack DM Auth)
-- ============================================================================

-- Ensure pgcrypto extension is available for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Main expense submissions table
CREATE TABLE IF NOT EXISTS public.expense_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  employee_email TEXT,
  purchase_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  business_purpose TEXT NOT NULL,
  category TEXT NOT NULL,
  requires_reimbursement BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_filename TEXT,
  receipt_slack_url TEXT,
  receipt_file_id TEXT,
  additional_notes TEXT,
  routed_channel_name TEXT,
  routed_channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reimbursed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column migrations for existing instances
ALTER TABLE public.expense_submissions ADD COLUMN IF NOT EXISTS receipt_file_id TEXT;
ALTER TABLE public.expense_submissions ADD COLUMN IF NOT EXISTS employee_email TEXT;
ALTER TABLE public.expense_submissions ADD COLUMN IF NOT EXISTS routed_channel_name TEXT;
ALTER TABLE public.expense_submissions ADD COLUMN IF NOT EXISTS routed_channel_id TEXT;

-- Performance & Lookup Indexes for Submissions
CREATE INDEX IF NOT EXISTS idx_expense_submissions_created_at_desc 
  ON public.expense_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_purchase_date 
  ON public.expense_submissions (purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_slack_user_id 
  ON public.expense_submissions (slack_user_id);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_category 
  ON public.expense_submissions (category);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_status 
  ON public.expense_submissions (status);

-- 2. Expense Slack DM 4-digit login codes table
CREATE TABLE IF NOT EXISTS public.expense_login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes for Login Codes
CREATE INDEX IF NOT EXISTS idx_expense_login_codes_email 
  ON public.expense_login_codes (email);

CREATE INDEX IF NOT EXISTS idx_expense_login_codes_expires_at 
  ON public.expense_login_codes (expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_login_codes_created_at 
  ON public.expense_login_codes (created_at DESC);

-- Enable Row Level Security (RLS) on both tables
ALTER TABLE public.expense_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_login_codes ENABLE ROW LEVEL SECURITY;

-- Grant permissions to standard roles
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.expense_submissions TO authenticated;
GRANT SELECT ON TABLE public.expense_submissions TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_login_codes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.expense_login_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.expense_login_codes TO anon;

-- RLS Policies for expense_submissions
DROP POLICY IF EXISTS "Service role full access on expense_submissions" ON public.expense_submissions;
CREATE POLICY "Service role full access on expense_submissions"
  ON public.expense_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view expense_submissions" ON public.expense_submissions;
CREATE POLICY "Authenticated users view expense_submissions"
  ON public.expense_submissions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users insert expense_submissions" ON public.expense_submissions;
CREATE POLICY "Authenticated users insert expense_submissions"
  ON public.expense_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon read expense_submissions" ON public.expense_submissions;
CREATE POLICY "Anon read expense_submissions"
  ON public.expense_submissions
  FOR SELECT
  TO anon
  USING (true);

-- RLS Policies for expense_login_codes
DROP POLICY IF EXISTS "Service role full access on expense_login_codes" ON public.expense_login_codes;
CREATE POLICY "Service role full access on expense_login_codes"
  ON public.expense_login_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon / Auth read login codes" ON public.expense_login_codes;
CREATE POLICY "Anon / Auth read login codes"
  ON public.expense_login_codes
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon / Auth insert login codes" ON public.expense_login_codes;
CREATE POLICY "Anon / Auth insert login codes"
  ON public.expense_login_codes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon / Auth update login codes" ON public.expense_login_codes;
CREATE POLICY "Anon / Auth update login codes"
  ON public.expense_login_codes
  FOR UPDATE
  TO anon, authenticated
  USING (true);

-- 3. Storage Bucket for Expense Receipts
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access to receipts in expense-receipts bucket
DROP POLICY IF EXISTS "Public access to expense-receipts" ON storage.objects;
CREATE POLICY "Public access to expense-receipts"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'expense-receipts');

-- Upload access for service_role and authenticated users (INSERT must strictly use WITH CHECK, no USING)
DROP POLICY IF EXISTS "Service role upload to expense-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Allow upload to expense-receipts" ON storage.objects;
CREATE POLICY "Allow upload to expense-receipts"
  ON storage.objects
  FOR INSERT
  TO service_role, authenticated
  WITH CHECK (bucket_id = 'expense-receipts');
