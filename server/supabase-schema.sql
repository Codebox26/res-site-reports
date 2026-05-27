-- RES Daily Site Reports — Supabase Schema
-- Run this once in the Supabase SQL Editor to set up all tables and storage.

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                  -- slug e.g. 'balwin-greenpark'
  name TEXT NOT NULL,                   -- display name e.g. 'Balwin Greenpark'
  pin_hash TEXT NOT NULL,               -- bcrypt hash of the PIN
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES projects(id),
  report_date DATE NOT NULL,
  arrival_time TEXT,
  departure_time TEXT,
  representative TEXT,
  team_on_site TEXT,
  subcontractors JSONB,                 -- [{"company":"RSLP","lead":"Mica","crew":2}]
  works_completed TEXT,
  works_planned TEXT,
  works_planned_label TEXT,             -- 'Tomorrow', 'Monday', etc.
  hse_issues TEXT DEFAULT 'None',
  comments TEXT DEFAULT 'None',
  docx_url TEXT,
  photo_urls JSONB,                     -- ['url1', 'url2', ...]
  submitted_at TIMESTAMPTZ DEFAULT now(),
  submitted_from_ip TEXT,
  synced_by JSONB DEFAULT '[]'::jsonb,  -- track which laptops have downloaded it
  edit_locked BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_submissions_project_date ON submissions(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_submissions_pending_sync ON submissions(submitted_at) WHERE edit_locked = false;

-- Sync log
CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id),
  laptop_id TEXT,
  synced_at TIMESTAMPTZ DEFAULT now(),
  status TEXT
);

-- Storage bucket (run this if creating via SQL rather than the Supabase Dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT DO NOTHING;

-- Storage policy: allow public reads from the 'reports' bucket
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'reports');

-- Storage policy: allow server (service role) to insert/update/delete
-- The service role key bypasses RLS by default, so this is just for documentation.
-- If you want to lock down further, add additional policies here.
