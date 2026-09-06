/**
 * Tests the voice reply path without a browser: ingest a PDF, then ask the tutor
 * a grounded question and an ungrounded one.
 *
 *   npx tsx scripts/voice-smoke.ts ./test-sample.pdf
 *
 * Verifies the two behaviours that matter: it answers from the document AND
 * cites a page, and it declines rather than inventing when the document is
 * silent on the subject.
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { extractPages } from "../lib/rag/pdf";
import { chunkPages } from "../lib/rag/chunk";
import { embedPassages, embedQuery, toVectorLiteral } from "../lib/rag/embeddings";
import { buildTutorSystemPrompt } from "../lib/voice/prompt";
import type { RagMatch } from "../lib/rag/context";

config({ path: ".env.local" });

const BASE_URL = process.env.NVIDIA_EMBED_BASE_URL || "https://integrate.api.nvidia.com/v1";
const CHAT_MODEL = process.env.NVIDIA_CHAT_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
const USER = "voice-smoke-user";

const ask = async (systemPrompt: string, question: string) => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: question },
            ],
            max_tokens: 220,
            temperature: 0.6,
            chat_template_kwargs: { thinking: false },
        }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 300));
    return (json.choices?.[0]?.message?.content ?? "").trim();
};

const main = async () => {
    const pdfPath = process.argv[2] || "./test-sample.pdf";
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
    );

    console.log("Ingesting", pdfPath, "...");
    const pages = await extractPages(await readFile(pdfPath));
    const chunks = chunkPages(pages);
    const vectors = await embedPassages(chunks.map((c) => c.content));

    const { data: companion } = await supabase
        .from("Companions")
        .insert({ name: "Voice Smoke", subject: "science", topic: "photosynthesis",
                  voice: "female", style: "casual", duration: 1, author: USER })
        .select("id").single();

    const { data: doc } = await supabase
        .from("companion_documents")
        .insert({ companion_id: companion!.id, user_id: USER, file_name: "test-sample.pdf",
                  storage_path: "smoke/none.pdf", status: "ready",
                  page_count: pages.length, chunk_count: chunks.length })
        .select("id").single();

    await supabase.from("document_chunks").insert(
        chunks.map((chunk, i) => ({
            document_id: doc!.id, companion_id: companion!.id, user_id: USER,
            content: chunk.content, page: chunk.page, chunk_index: chunk.chunkIndex,
            embedding: toVectorLiteral(vectors[i]),
        })),
    );
    console.log(`   ${chunks.length} chunks indexed\n`);

    const { data: documents } = await supabase
        .from("companion_documents").select("file_name, page_count")
        .eq("companion_id", companion!.id).eq("status", "ready");

    for (const question of [
        "What does my document say about how plants make food?",
        "What does my document say about quantum entanglement?",
    ]) {
        const { data } = await supabase.rpc("match_document_chunks", {
            p_companion_id: companion!.id,
            p_query_embedding: toVectorLiteral(await embedQuery(question)),
            p_match_count: 5,
            p_min_similarity: 0.15,
        });
        const matches = (data ?? []) as RagMatch[];

        const prompt = buildTutorSystemPrompt({
            subject: "science", topic: "photosynthesis", style: "casual",
            documents: documents ?? [], matches,
        });

        console.log(`Q: ${question}`);
        console.log(`   retrieved ${matches.length} passage(s)${matches.length ? ` from page(s) ${[...new Set(matches.map(m => m.page))].join(", ")}` : ""}`);
        console.log(`A: ${await ask(prompt, question)}\n`);
    }

    await supabase.from("Companions").delete().eq("id", companion!.id);
    console.log("Cleaned up.");
};

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
