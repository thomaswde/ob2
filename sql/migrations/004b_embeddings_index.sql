CREATE INDEX CONCURRENTLY IF NOT EXISTS memory_atom_embedding_cosine_idx
  ON memory_atom
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
