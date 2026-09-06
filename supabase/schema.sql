-- Converso schema: base app + RAG.
-- Run once in Supabase Dashboard > SQL Editor > New query.
--
-- Prerequisite: Clerk must be added as a third-party auth provider
-- (Clerk Dashboard > Integrations > Supabase, then Supabase >
-- Authentication > Sign In / Providers > Add provider > Clerk).
-- Without it auth.jwt() is empty and every policy below denies silently.

create extension if not exists vector;   -- pgvector; needs >= 0.7 for halfvec

-- ============ base app ============
create table if not exists "Companions" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  topic text not null,
  voice text not null,
  style text not null,
  duration int not null default 15,
  author text not null,                       -- Clerk userId
  created_at timestamptz default now()
);

create table if not exists "Session_History" (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid references "Companions"(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now()
);

create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid references "Companions"(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  unique (companion_id, user_id)
);

-- ============ RAG ============
create table if not exists companion_documents (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references "Companions"(id) on delete cascade,
  user_id text not null,
  file_name text not null,
  storage_path text not null,
  file_size int,
  page_count int,
  chunk_count int default 0,
  cursor int default 0,                    -- resumable ingest: next page index
  pages_done int default 0,
  status text not null default 'queued',   -- queued | processing | ready | failed
  error_message text,
  created_at timestamptz default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id  uuid not null references companion_documents(id) on delete cascade,
  companion_id uuid not null references "Companions"(id) on delete cascade,
  user_id text not null,
  content text not null,
  page int not null,
  chunk_index int not null,
  -- nemotron-3-embed-1b returns 2048 dims, which exceeds pgvector's 2000-dim
  -- index limit for `vector`. halfvec indexes up to 4096 at half precision.
  embedding halfvec(2048) not null,
  created_at timestamptz default now()
);

create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding halfvec_cosine_ops);
create index if not exists document_chunks_companion_idx on document_chunks (companion_id);
create index if not exists document_chunks_document_idx  on document_chunks (document_id);
create index if not exists companion_documents_companion_idx on companion_documents (companion_id);
create index if not exists session_history_user_idx on "Session_History" (user_id, created_at desc);
create index if not exists bookmarks_user_idx on bookmarks (user_id);

-- ============ retrieval ============
-- SECURITY INVOKER (the default) so the RLS policies below still apply.
create or replace function match_document_chunks(
  p_companion_id uuid,
  p_query_embedding halfvec(2048),
  p_match_count int default 5,
  p_min_similarity float default 0.15
)
returns table (content text, page int, file_name text, similarity float)
language sql stable as $$
  select c.content, c.page, d.file_name,
         1 - (c.embedding <=> p_query_embedding) as similarity
  from document_chunks c
  join companion_documents d on d.id = c.document_id
  where c.companion_id = p_companion_id
    and 1 - (c.embedding <=> p_query_embedding) > p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ============ RLS ============
alter table "Companions"        enable row level security;
alter table "Session_History"   enable row level security;
alter table bookmarks           enable row level security;
alter table companion_documents enable row level security;
alter table document_chunks     enable row level security;

-- The companion library is public to signed-in users; everything else is owned.
create policy "read all companions"   on "Companions" for select to authenticated using (true);
create policy "insert own companions" on "Companions" for insert to authenticated with check (author = auth.jwt()->>'sub');
create policy "update own companions" on "Companions" for update to authenticated using (author = auth.jwt()->>'sub');
create policy "delete own companions" on "Companions" for delete to authenticated using (author = auth.jwt()->>'sub');

create policy "own sessions"  on "Session_History"   for all to authenticated
  using (user_id = auth.jwt()->>'sub') with check (user_id = auth.jwt()->>'sub');
create policy "own bookmarks" on bookmarks           for all to authenticated
  using (user_id = auth.jwt()->>'sub') with check (user_id = auth.jwt()->>'sub');
create policy "own documents" on companion_documents for all to authenticated
  using (user_id = auth.jwt()->>'sub') with check (user_id = auth.jwt()->>'sub');
create policy "own chunks"    on document_chunks     for all to authenticated
  using (user_id = auth.jwt()->>'sub') with check (user_id = auth.jwt()->>'sub');
