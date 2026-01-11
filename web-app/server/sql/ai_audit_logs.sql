-- SQL schema for ai_audit_logs (Postgres)
-- Run this in your Postgres management tool to create the table

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  request_id UUID DEFAULT gen_random_uuid(),
  model_stage TEXT NOT NULL,
  input_payload JSONB,
  output_payload JSONB,
  confidence NUMERIC(5,4),
  user_action JSONB,
  notes TEXT,
  duration_ms INTEGER,
  source TEXT,
  tags TEXT[]
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_model_stage ON ai_audit_logs(model_stage);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_request_id ON ai_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON ai_audit_logs(created_at);
