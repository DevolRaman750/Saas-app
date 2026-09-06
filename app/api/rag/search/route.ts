import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { embedQuery, toVectorLiteral } from "@/lib/rag/embeddings";

/**
 * Retrieval endpoint hit once per spoken student turn, so it stays lean: embed
 * the question, run one indexed SQL query, return page-tagged excerpts.
 */
export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companionId, query, matchCount = 5 } = await request.json();

    if (typeof companionId !== "string" || typeof query !== "string" || !query.trim()) {
        return NextResponse.json({ error: "companionId and query are required" }, { status: 400 });
    }

    try {
        const vector = await embedQuery(query.trim().slice(0, 2000));
        const supabase = createSupabaseClient();

        // RLS applies inside the RPC (SECURITY INVOKER), so a user can only ever
        // match against chunks they own.
        const { data, error } = await supabase.rpc("match_document_chunks", {
            p_companion_id: companionId,
            p_query_embedding: toVectorLiteral(vector),
            p_match_count: Math.min(Number(matchCount) || 5, 10),
            // Measured against the live model: a clearly correct match (a query
            // about plants making food vs. a passage on photosynthesis) scores
            // ~0.39, while unrelated passages sit near 0.02-0.04. A floor of 0.3
            // would discard genuine hits; 0.15 separates signal from noise with
            // room to spare.
            p_min_similarity: 0.15,
        });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ matches: data ?? [] });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
