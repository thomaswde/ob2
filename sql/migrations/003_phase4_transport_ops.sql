CREATE TABLE IF NOT EXISTS request_log (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_log_created_at ON request_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_client_id ON request_log (client_id);

CREATE TABLE IF NOT EXISTS notification (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_created_at ON notification (created_at DESC);
