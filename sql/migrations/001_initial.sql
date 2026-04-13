CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_type') THEN
    CREATE TYPE entity_type AS ENUM (
      'category',
      'person',
      'vehicle',
      'project',
      'place',
      'topic',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decay_class') THEN
    CREATE TYPE decay_class AS ENUM (
      'profile',
      'preference',
      'relationship',
      'decision',
      'task',
      'ephemeral'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consolidation_status') THEN
    CREATE TYPE consolidation_status AS ENUM (
      'pending',
      'processed',
      'rejected'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status') THEN
    CREATE TYPE run_status AS ENUM (
      'pending',
      'completed',
      'aborted',
      'aborted_low_confidence'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correction_status') THEN
    CREATE TYPE correction_status AS ENUM (
      'proposed',
      'under_review',
      'applied',
      'rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS schema_migration (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entity (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  type entity_type NOT NULL,
  parent_entity_id UUID NULL REFERENCES entity(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_atom (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  entity_id UUID NULL REFERENCES entity(id) ON DELETE SET NULL,
  source_ref TEXT NOT NULL,
  source_agent TEXT NULL,
  importance DOUBLE PRECISION NOT NULL CHECK (importance >= 0 AND importance <= 1),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  decay_class decay_class NOT NULL,
  valid_at TIMESTAMPTZ NULL,
  invalid_at TIMESTAMPTZ NULL,
  supersedes_id UUID NULL REFERENCES memory_atom(id) ON DELETE SET NULL,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  consolidation_status consolidation_status NOT NULL DEFAULT 'pending',
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_ref, content_fingerprint)
);

CREATE TABLE IF NOT EXISTS entity_link (
  id UUID PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  related_entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, related_entity_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS consolidation_run (
  id UUID PRIMARY KEY,
  status run_status NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  atom_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NULL
);

CREATE TABLE IF NOT EXISTS correction_action (
  id UUID PRIMARY KEY,
  target_atom_id UUID NULL REFERENCES memory_atom(id) ON DELETE SET NULL,
  proposed_content TEXT NOT NULL,
  reason TEXT NULL,
  status correction_status NOT NULL DEFAULT 'proposed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_item (
  id UUID PRIMARY KEY,
  atom_id UUID NULL REFERENCES memory_atom(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_atom_created_at ON memory_atom (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_atom_entity_id ON memory_atom (entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_atom_decay_class ON memory_atom (decay_class);
CREATE INDEX IF NOT EXISTS idx_memory_atom_validity ON memory_atom (valid_at, invalid_at);
CREATE INDEX IF NOT EXISTS idx_entity_name_trgm ON entity USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_memory_atom_content_trgm ON memory_atom USING gin (content gin_trgm_ops);
