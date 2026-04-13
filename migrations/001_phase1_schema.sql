CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE memory_type AS ENUM ('fact','preference','task','note');
CREATE TYPE durability AS ENUM ('ephemeral','session','long_term');
CREATE TYPE source_type AS ENUM ('user','system','import');
CREATE TYPE verification_state AS ENUM ('unverified','verified','disputed');
CREATE TYPE consolidation_status AS ENUM ('pending','consolidated','needs_review');
CREATE TYPE review_status AS ENUM ('none','open','closed');
CREATE TYPE correction_status AS ENUM ('proposed','under_review','applied','rejected');

CREATE TABLE entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memory_atom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  memory_type memory_type NOT NULL,
  durability durability NOT NULL,
  importance DOUBLE PRECISION NOT NULL CHECK (importance BETWEEN 0 AND 1),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  valid_at TIMESTAMPTZ NOT NULL,
  invalid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id UUID REFERENCES entity(id),
  supersedes_id UUID REFERENCES memory_atom(id),
  source_type source_type NOT NULL,
  source_ref TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  verification_state verification_state NOT NULL DEFAULT 'unverified',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  consolidation_status consolidation_status NOT NULL DEFAULT 'pending',
  review_status review_status NOT NULL DEFAULT 'none',
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved_at TIMESTAMPTZ,
  UNIQUE (source_ref, content)
);

CREATE TABLE entity_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id UUID NOT NULL REFERENCES entity(id),
  to_entity_id UUID NOT NULL REFERENCES entity(id),
  relation_type TEXT NOT NULL,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1.0
);

CREATE TABLE correction_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  proposed_content TEXT NOT NULL,
  status correction_status NOT NULL DEFAULT 'proposed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_atom_id UUID REFERENCES memory_atom(id),
  related_entity_id UUID REFERENCES entity(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  status review_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consolidation_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_memory_atom_created_at ON memory_atom(created_at DESC);
CREATE INDEX idx_memory_atom_entity_id ON memory_atom(entity_id);
CREATE INDEX idx_memory_atom_retrieval ON memory_atom(last_retrieved_at DESC, retrieval_count DESC);
