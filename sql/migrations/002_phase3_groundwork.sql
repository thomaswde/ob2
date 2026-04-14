ALTER TABLE memory_atom
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE consolidation_run
  ADD COLUMN IF NOT EXISTS processed_atom_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE consolidation_run
  ADD COLUMN IF NOT EXISTS low_confidence_atom_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE consolidation_run
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL;

ALTER TABLE consolidation_run
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE correction_action
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NULL;

ALTER TABLE correction_action
  ADD COLUMN IF NOT EXISTS applied_atom_id UUID NULL REFERENCES memory_atom(id) ON DELETE SET NULL;

ALTER TABLE correction_action
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE review_item
  ADD COLUMN IF NOT EXISTS entity_id UUID NULL REFERENCES entity(id) ON DELETE SET NULL;

ALTER TABLE review_item
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NULL;

ALTER TABLE review_item
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE entity_link
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NULL;

ALTER TABLE entity_link
  ADD COLUMN IF NOT EXISTS evidence_atom_id UUID NULL REFERENCES memory_atom(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS system_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  consolidation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_aborted_runs INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_state (singleton, consolidation_enabled, consecutive_aborted_runs)
VALUES (TRUE, TRUE, 0)
ON CONFLICT (singleton) DO NOTHING;
