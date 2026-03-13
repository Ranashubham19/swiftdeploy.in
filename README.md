# Adaptive AI Search

Adaptive AI Search is a full-stack Next.js platform for production-grade search, research, and retrieval-backed answers. It resolves follow-up questions with conversation memory, rewrites the query, searches the live web, extracts source content, stores and retrieves evidence from a vector store, and returns structured answers with sources over a streaming UI.

## Core stack

- Next.js App Router for the product UI and API routes
- NVIDIA AI for reasoning and embeddings
- Tavily, SerpAPI, and Jina Search for live search
- Firecrawl, Jina Reader, Apify, and ScraperAPI for extraction
- Pinecone with Weaviate fallback for vector storage and retrieval
- Firebase Auth for browser-side authentication
- Supabase REST for optional thread and research-run persistence

## API surface

- `POST /api/research`
- `POST /api/search`
- `POST /api/crawl`
- `POST /api/embed`
- `POST /api/retrieve`
- `GET /api/health`

## Runtime flow

1. Build conversation memory from recent thread history.
2. Rewrite ambiguous follow-ups into standalone search questions.
3. Fan out live search across multiple providers.
4. Crawl and normalize the strongest sources.
5. Chunk, embed, index, retrieve, and rerank evidence.
6. Generate a structured answer or report with source grounding.
7. Persist research runs and stream the result to the UI.

## Smoke tests

- `node scripts/live-smoke.mjs`
- `node scripts/category-smoke.mjs`

These verify greeting, live search, follow-up memory, research, website analysis, document retrieval, and coding-mode routing against the running app.

## Notes

- The UI streams research progress and renders a structured report with sources.
- If the chat model is unavailable, the search, research, website, and document flows still fall back to deterministic source-backed synthesis.
- Thread sync is best-effort. If the Supabase `chat_threads` table is missing, the app falls back to local browser history.
- The included `supabase/schema.sql` creates the `chat_threads` and `research_runs` tables expected by the app.
