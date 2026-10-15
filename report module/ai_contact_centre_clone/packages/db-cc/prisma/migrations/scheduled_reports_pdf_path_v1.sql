-- Store scheduled report PDFs on disk; DB keeps relative path only.

ALTER TABLE ccass.scheduled_report_runs
  ADD COLUMN IF NOT EXISTS pdf_path TEXT;

CREATE INDEX IF NOT EXISTS idx_scheduled_report_runs_pdf_path
  ON ccass.scheduled_report_runs (pdf_path)
  WHERE pdf_path IS NOT NULL;
