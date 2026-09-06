import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { embedQuery, toVectorLiteral } from "@/lib/rag/embeddings";
import { citationsOf, type RagMatch } from "@/lib/rag/context";
import { buildTutorSystemPrompt } from "@/lib/voice/prompt";

const BASE_URL =
    process.env.NVIDIA_EMBED_BASE_URL || "https://integrate.api.nvidia.com/v1";
const CHAT_MODEL =
    process.env.NVIDIA_CHAT_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";

interface Turn {
    role: "user" | "assistant";
    content: string;
}

/**
 * One round-trip per spoken turn: retrieve the relevant passages, ground the
 * tutor in them, and return what it should say plus the pages it drew on.
 *
 * Doing retrieval and generation in a single request keeps the pause between
 * the student finishing their sentence and the tutor starting to speak as short
 * as possible - two sequential browser round-trips would be noticeably worse.
 */
export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companionId, subject, topic, style, messages } = await request.json();

    if (typeof companionId !== "string" || !Array.isArray(messages)) {
        return NextResponse.json({ error: "companionId and messages are required" }, { status: 400 });
    }

    const history = (messages as Turn[]).slice(-8); // keep the prompt small and fast
    const lastUser = [...history].reverse().find((m) => m.role === "user");

    try {
        const supabase = createSupabaseClient();

        const { data: documents } = await supabase
            .from("companion_documents")
            .select("file_name, page_count")
            .eq("companion_id", companionId)
            .eq("status", "ready");

        let matches: RagMatch[] = [];

        if (documents?.length && lastUser?.content) {
            const vector = await embedQuery(lastUser.content.slice(0, 2000));
            const { data } = await supabase.rpc("match_document_chunks", {
                p_companion_id: companionId,
                p_query_embedding: toVectorLiteral(vector),
                p_match_count: 5,
                p_min_similarity: 0.15,
            });
            matches = (data ?? []) as RagMatch[];
        }

        const systemPrompt = buildTutorSystemPrompt({
            subject: subject ?? "",
            topic: topic ?? "",
            style: style ?? "casual",
            documents: documents ?? [],
            matches,
        });

        const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: CHAT_MODEL,
                messages: [{ role: "system", content: systemPrompt }, ...history],
                max_tokens: 220,
                temperature: 0.6,
                // Streamed so the browser can start speaking the first sentence
                // while the rest is still being generated - waiting for the whole
                // reply costs 1 to 5 seconds of silence before any sound.
                stream: true,
                // Nemotron emits its chain of thought into `content` unless this is
                // off, which would otherwise be read aloud to the student.
                chat_template_kwargs: { thinking: false },
            }),
        });

        if (!res.ok || !res.body) {
            const detail = await res.text();
            throw new Error(`Model call failed (${res.status}): ${detail.slice(0, 200)}`);
        }

        // Citations are known before generation starts (retrieval already ran), so
        // they ride along in a header rather than delaying the audio.
        const headers = new Headers({
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Citations": encodeURIComponent(JSON.stringify(citationsOf(matches))),
        });

        return new Response(toTextStream(res.body), { headers });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Reply failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/**
 * Convert the model's SSE stream into plain text deltas.
 *
 * Chunk boundaries fall anywhere, including mid-line, so partial lines are held
 * back until their newline arrives - otherwise JSON.parse fails on half an event.
 */
const toTextStream = (source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let carry = "";

    return new ReadableStream({
        async start(controller) {
            const reader = source.getReader();

            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    carry += decoder.decode(value, { stream: true });
                    const lines = carry.split("\n");
                    carry = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data:")) continue;

                        const payload = trimmed.slice(5).trim();
                        if (!payload || payload === "[DONE]") continue;

                        try {
                            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
                            if (delta) controller.enqueue(encoder.encode(delta));
                        } catch {
                            // A malformed event should not end the whole reply.
                        }
                    }
                }
            } finally {
                controller.close();
                reader.releaseLock();
            }
        },
    });
};
