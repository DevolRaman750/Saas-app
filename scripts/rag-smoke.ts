/**
 * End-to-end RAG pipeline test with no UI and no browser.
 *
 *   npx tsx scripts/rag-smoke.ts ./some.pdf "what is X?"
 *
 * Parses a local PDF, chunks it, embeds it, writes to Supabase, then runs a
 * similarity search and prints the hits with page numbers. Everything it writes
 * is cleaned up on the way out, so it is safe to run against a real project.
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { extractPages } from "../lib/rag/pdf";
import { chunkPages } from "../lib/rag/chunk";
import { embedPassages, embedQuery, toVectorLiteral } from "../lib/rag/embeddings";

config({ path: ".env.local" });

const [, , pdfPath, rawQuery] = process.argv;
const query = rawQuery || "what is this document about?";

const SMOKE_USER = "smoke-test-user";

const main = async () => {
    if (!pdfPath) {
        console.error("Usage: npx tsx scripts/rag-smoke.ts <file.pdf> [query]");
        process.exit(1);
    }

    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secretKey) throw new Error("SUPABASE_SECRET_KEY missing from .env.local");

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
        auth: { persistSession: false },
    });

    console.log("1. Parsing PDF...");
    const pages = await extractPages(await readFile(pdfPath));
    console.log(`   ${pages.length} pages with text`);

    console.log("2. Chunking...");
    const chunks = chunkPages(pages);
    console.log(`   ${chunks.length} chunks, avg ${Math.round(
        chunks.reduce((n, c) => n + c.content.length, 0) / (chunks.length || 1),
    )} chars`);

    console.log("3. Embedding (NVIDIA)...");
    const sample = chunks.slice(0, 60); // keep the smoke test quick
    const vectors = await embedPassages(sample.map((c) => c.content));
    console.log(`   ${vectors.length} vectors of ${vectors[0]?.length} dimensions`);

    console.log("4. Writing to Supabase...");
    // document_chunks.companion_id is a real FK, so the test needs a real
    // companion row. It is torn down again at the end.
    const { data: companion, error: companionError } = await supabase
        .from("Companions")
        .insert({
            name: "Smoke Test",
            subject: "science",
            topic: "smoke test",
            voice: "female",
            style: "casual",
            duration: 1,
            author: SMOKE_USER,
        })
        .select("id")
        .single();

    if (companionError) throw new Error(`insert companion: ${companionError.message}`);
    const SMOKE_COMPANION = companion.id;

    const { data: doc, error: docError } = await supabase
        .from("companion_documents")
        .insert({
            companion_id: SMOKE_COMPANION,
            user_id: SMOKE_USER,
            file_name: `SMOKE ${pdfPath}`,
            storage_path: "smoke/none.pdf",
            status: "ready",
            page_count: pages.length,
            chunk_count: sample.length,
        })
        .select("id")
        .single();

    if (docError) throw new Error(`insert document: ${docError.message}`);

    const { error: chunkError } = await supabase.from("document_chunks").insert(
        sample.map((chunk, i) => ({
            document_id: doc.id,
            companion_id: SMOKE_COMPANION,
            user_id: SMOKE_USER,
            content: chunk.content,
            page: chunk.page,
            chunk_index: chunk.chunkIndex,
            embedding: toVectorLiteral(vectors[i]),
        })),
    );

    if (chunkError) throw new Error(`insert chunks: ${chunkError.message}`);

    console.log(`5. Searching for: "${query}"`);
    const { data: matches, error: searchError } = await supabase.rpc("match_document_chunks", {
        p_companion_id: SMOKE_COMPANION,
        p_query_embedding: toVectorLiteral(await embedQuery(query)),
        p_match_count: 5,
        p_min_similarity: 0.0,
    });

    if (searchError) throw new Error(`search: ${searchError.message}`);

    console.log(`\n   ${matches?.length ?? 0} matches\n`);
    for (const match of matches ?? []) {
        console.log(`   [page ${match.page}] similarity ${match.similarity.toFixed(3)}`);
        console.log(`   ${match.content.slice(0, 200).replace(/\s+/g, " ")}...\n`);
    }

    console.log("6. Cleaning up...");
    // Deleting the companion cascades to the document and its chunks.
    await supabase.from("Companions").delete().eq("id", SMOKE_COMPANION);
    console.log("   Done. Pipeline works end to end.");
};

main().catch((error) => {
    console.error("\nFAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
});
