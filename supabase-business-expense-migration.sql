-- ============================================================================
-- Kawaii Slime Company - Business Expense & Receipt Submission
-- Idempotent Additive Migration for Finance & Payroll Database
-- ============================================================================

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
  additional_notes TEXT,
  routed_channel_name TEXT,
  routed_channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reimbursed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_expense_submissions_status 
  ON public.expense_submissions (status);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_created_at_desc 
  ON public.expense_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_slack_user_id 
  ON public.expense_submissions (slack_user_id);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_purchase_date 
  ON public.expense_submissions (purchase_date DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.expense_submissions ENABLE ROW LEVEL SECURITY;

-- Grant permissions to service_role (used by Vercel serverless backend)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_submissions TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Default RLS Policies
-- Allow service_role full unrestricted access
DROP POLICY IF EXISTS "Service role full access on expense_submissions" ON public.expense_submissions;
CREATE POLICY "Service role full access on expense_submissions"
  ON public.expense_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Optional: Allow authenticated users to view
DROP POLICY IF EXISTS "Authenticated users view expense_submissions" ON public.expense_submissions;
CREATE POLICY "Authenticated users view expense_submissions"
  ON public.expense_submissions
  FOR SELECT
  TO authenticated
  USING (true);
