# yucabot-api

## Local Setup

- Install dependencies with `npm install`.
- Create `.env.local` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `HUGGINGFACE_API_KEY`.
- Run the API using `npm run dev`.

## Core Endpoints

- `GET /api/test` — Health check.
- `POST /api/ingest` — Multipart upload (`file`) for PDF/DOCX/TXT. Extracts text, generates a 1024-dim embedding, and stores it in Supabase.
- `POST /api/query` — JSON `{ "query": "..." }`. Generates an embedding and fetches the top matching knowledge base chunks.

Ensure the following Postgres function exists for vector search:

```sql
create or replace function match_knowledge_base(
  query_embedding vector(1024),
  match_count int default 4
)
returns table(id uuid, content text, created_at timestamptz, similarity double precision)
language sql stable as $$
  select kb.id,
         kb.content,
         kb.created_at,
         1 - (kb.embedding <=> query_embedding) as similarity
  from public.knowledge_base as kb
  order by kb.embedding <-> query_embedding
  limit match_count;
$$;
```
