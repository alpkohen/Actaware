-- Run in Supabase SQL Editor (once per project).
-- RAG store for ActAware AI Chat. IVFFLAT index: optional after embeddings are populated (see note below).

create extension if not exists vector;
create extension if not exists pg_trgm;

create table if not exists compliance_chunks (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_url text,
  content text not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

-- Fast ILIKE / keyword search for MVP (no embeddings required).
create index if not exists compliance_chunks_content_trgm_idx
  on compliance_chunks using gin (content gin_trgm_ops);

-- Optional: cosine index for OpenAI text-embedding-3-small (1536 dims).
-- Create AFTER you have inserted rows with non-null embeddings, or creation may fail on empty tables.
-- create index compliance_chunks_embedding_ivfflat on compliance_chunks
--   using ivfflat (embedding vector_cosine_ops) with (lists = 50);

alter table compliance_chunks enable row level security;

-- No policies: anon/authenticated clients cannot read/write; only service role (Netlify functions) can.
