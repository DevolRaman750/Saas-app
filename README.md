# Converso

An AI voice tutor that teaches from **your own PDFs**. Upload course material to a
companion, start a spoken session, and the tutor answers from that document — citing
page numbers out loud, and saying so plainly when the material does not cover
something rather than inventing an answer.

Built on retrieval-augmented generation (RAG) with a browser-native voice stack, so
running it costs nothing.

## How it works

**Ingestion** — the browser uploads a PDF straight to Supabase Storage using a
short-lived signed URL (never through the app's own API, which keeps it clear of
serverless request-body limits). A resumable worker then extracts text page by page,
splits it into overlapping ~1200-character chunks that remember their page number,
embeds them, and stores the vectors in Postgres. Progress is persisted per batch, so a
timed-out or crashed batch resumes instead of restarting.

**Conversation** — the browser transcribes speech locally. When you go quiet, one
request embeds your question, finds the closest passages with a vector search, and
streams the tutor's grounded reply back. Sentences are spoken as they arrive rather
than after the full answer, so the tutor starts talking in about a second.

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Auth | Clerk, verified by Supabase as a third-party auth provider |
| Database + vectors | Supabase Postgres with pgvector (`halfvec(2048)`, HNSW cosine) |
| File storage | Supabase Storage, private bucket |
| Embeddings | NVIDIA NIM `nemotron-3-embed-1b` (2048 dims, asymmetric passage/query) |
| Generation | NVIDIA NIM `nemotron-3.5-lightning-30b` |
| Speech | Web Speech API + `speechSynthesis` (browser-native, no key) |

Voice sessions need **Chrome or Edge** — Firefox does not implement `SpeechRecognition`.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. **SQL Editor** → run [`supabase/schema.sql`](supabase/schema.sql). This creates every
   table, the `match_document_chunks` search function, and all row-level security policies.
3. **Storage** → new bucket named exactly `companion-docs`, **private**.

### 2. Clerk, and connecting it to Supabase

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Visit [dashboard.clerk.com/setup/supabase](https://dashboard.clerk.com/setup/supabase),
   confirm the right application is selected, and activate the integration. Copy the
   **Clerk domain** it shows.
3. In Supabase → **Authentication → Third-Party Auth → Add provider → Clerk**, paste that
   domain (hostname only, no `https://`).

This step is what lets Supabase verify Clerk's tokens. Skip it and every query returns
**empty results with no error** — the confusing failure this project is easiest to hit.
The integration also adds the `role: authenticated` claim that every RLS policy depends on.

### 3. NVIDIA

Sign up free at [build.nvidia.com](https://build.nvidia.com) and create an API key.
Both the embedding and chat models run on free credits.

### 4. Environment

Create `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...          # server only, bypasses RLS

NVIDIA_API_KEY=nvapi-...
NVIDIA_EMBED_MODEL=nvidia/nemotron-3-embed-1b
NVIDIA_CHAT_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_EMBED_BASE_URL=https://integrate.api.nvidia.com/v1

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional. Error reporting is disabled entirely unless these are set.
# SENTRY_DSN=
# NEXT_PUBLIC_SENTRY_DSN=
```

To run embeddings on your own GPU instead of the hosted API, start NVIDIA's NIM
container and point `NVIDIA_EMBED_BASE_URL` at `http://localhost:8000/v1`. Same model,
same vectors, no re-ingestion needed.

### 5. Run

```bash
npm install
npm run dev
```

## Verifying it works

Two scripts exercise the pipeline without a browser:

```bash
npx tsx scripts/rag-smoke.ts ./test-sample.pdf "how do plants make food?"
npx tsx scripts/voice-smoke.ts ./test-sample.pdf
```

The first parses, chunks, embeds, stores, searches, and prints matches with page numbers
and similarity scores. The second asks the tutor one question the document answers and one
it does not, so you can confirm it both cites pages and declines honestly. Both clean up
after themselves.

`test-sample.pdf` is a three-page fixture with distinct content per page, useful for
checking that retrieval reaches the *right* page rather than just any page.

## Deploying

Deploys to Vercel as-is. Add every environment variable above in the project settings —
`.env.local` is gitignored and does not travel with the repo.

One thing to plan for: Clerk issues **separate development and production instances**.
The production instance has its own keys *and its own domain*, and that domain must be
added to Supabase as a **second** third-party auth provider. Keep the development one so
localhost keeps working.

## Notes

- `SILENCE_MS` in [`components/ui/CompanionComponent.tsx`](components/ui/CompanionComponent.tsx)
  controls how long you must pause before the tutor replies. Lower feels conversational;
  higher gives more room to think mid-sentence.
- Ingestion rejects scanned PDFs with a clear message — they are images with no text
  layer and need OCR first.
- The embedding model is asymmetric: passages and queries must be embedded with
  different `input_type` values. This is why `embedPassages` and `embedQuery` are separate
  functions rather than one with a flag.
