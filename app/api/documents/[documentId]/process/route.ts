import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, DOCUMENTS_BUCKET } from "@/lib/supabase-admin";
import { extractPages } from "@/lib/rag/pdf";
import { chunkPages } from "@/lib/rag/chunk";
import { embedPassages, toVectorLiteral } from "@/lib/rag/embeddings";

export const maxDuration = 300; // Vercel Hobby's ceiling (Fluid compute)

// One slice per invocation. Kept well inside the duration limit including the
// embedding round-trips, so a large textbook simply takes several calls and a
// failed batch resumes instead of restarting.
const PAGES_PER_BATCH = 40;

/**
 * Resumable ingest worker. The client POSTs repeatedly until `done` is true;
 * progress is persisted on the row, so a crashed or timed-out batch resumes
 * where it stopped instead of restarting the whole document.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ documentId: string }> },
) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { documentId } = await params;
    const admin = createSupabaseAdminClient();

    const { data: document } = await admin
        .from("companion_documents")
        .select("*")
        .eq("id", documentId)
        .single();

    if (!document || document.user_id !== userId) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (document.status === "ready") {
        return NextResponse.json({ done: true, pagesDone: document.page_count, chunkCount: document.chunk_count });
    }

    try {
        const { data: blob, error: downloadError } = await admin.storage
            .from(DOCUMENTS_BUCKET)
            .download(document.storage_path);

        if (downloadError || !blob) throw new Error(downloadError?.message || "Download failed");

        const pages = await extractPages(await blob.arrayBuffer());
        const totalPages = pages.length;

        // A scanned PDF is images with no text layer, so extraction yields
        // nothing. Say that plainly instead of reporting a successful ingest of
        // zero passages, which looks like the feature is broken.
        if (!totalPages) {
            throw new Error(
                "No readable text found. This looks like a scanned PDF - it needs OCR before it can be used.",
            );
        }

        const start = document.cursor ?? 0;
        const slice = pages.slice(start, start + PAGES_PER_BATCH);

        if (!slice.length) {
            await admin
                .from("companion_documents")
                .update({ status: "ready", page_count: totalPages })
                .eq("id", documentId);
            return NextResponse.json({ done: true, pagesDone: totalPages, totalPages });
        }

        await admin
            .from("companion_documents")
            .update({ status: "processing", page_count: totalPages })
            .eq("id", documentId);

        const chunks = chunkPages(slice);
        let inserted = 0;

        if (chunks.length) {
            const vectors = await embedPassages(chunks.map((c) => c.content));

            const { error: insertError } = await admin.from("document_chunks").insert(
                chunks.map((chunk, i) => ({
                    document_id: documentId,
                    companion_id: document.companion_id,
                    user_id: userId,
                    content: chunk.content,
                    page: chunk.page,
                    // chunkIndex restarts per batch, so offset it by what's already stored
                    chunk_index: (document.chunk_count ?? 0) + chunk.chunkIndex,
                    embedding: toVectorLiteral(vectors[i]),
                })),
            );

            if (insertError) throw new Error(insertError.message);
            inserted = chunks.length;
        }

        const nextCursor = start + slice.length;
        const done = nextCursor >= totalPages;

        await admin
            .from("companion_documents")
            .update({
                cursor: nextCursor,
                pages_done: nextCursor,
                chunk_count: (document.chunk_count ?? 0) + inserted,
                status: done ? "ready" : "processing",
            })
            .eq("id", documentId);

        return NextResponse.json({
            done,
            pagesDone: nextCursor,
            totalPages,
            chunkCount: (document.chunk_count ?? 0) + inserted,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Ingest failed";
        await admin
            .from("companion_documents")
            .update({ status: "failed", error_message: message.slice(0, 500) })
            .eq("id", documentId);

        return NextResponse.json({ error: message }, { status: 500 });
    }
}
