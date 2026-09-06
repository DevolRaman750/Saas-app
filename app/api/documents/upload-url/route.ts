import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { createSupabaseAdminClient, DOCUMENTS_BUCKET } from "@/lib/supabase-admin";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Mint a one-time signed URL so the browser can upload the PDF straight to
 * Supabase Storage.
 *
 * The file deliberately never passes through this app: Vercel Functions reject
 * request bodies over 4.5 MB, which most real course material exceeds. Sending
 * only the metadata here keeps the size limit irrelevant.
 */
export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companionId, fileName, fileSize } = await request.json();

    if (typeof companionId !== "string" || typeof fileName !== "string") {
        return NextResponse.json({ error: "companionId and fileName are required" }, { status: 400 });
    }
    if (!fileName.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Only PDF files are supported" }, { status: 415 });
    }
    if (typeof fileSize === "number" && fileSize > MAX_BYTES) {
        return NextResponse.json({ error: "PDF must be 20 MB or smaller" }, { status: 413 });
    }

    // Ownership is checked through the RLS-enforced client, so a signed URL can
    // only ever be minted for a companion the caller actually authored.
    const supabase = createSupabaseClient();
    const { data: companion } = await supabase
        .from("Companions")
        .select("id, author")
        .eq("id", companionId)
        .single();

    if (!companion || companion.author !== userId) {
        return NextResponse.json({ error: "Companion not found" }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const storagePath = `${userId}/${companionId}/${crypto.randomUUID()}.pdf`;

    const { data: signed, error: signError } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUploadUrl(storagePath);

    if (signError || !signed) {
        return NextResponse.json({ error: signError?.message ?? "Could not start upload" }, { status: 500 });
    }

    const { data: document, error: insertError } = await admin
        .from("companion_documents")
        .insert({
            companion_id: companionId,
            user_id: userId,
            file_name: fileName,
            storage_path: storagePath,
            file_size: typeof fileSize === "number" ? fileSize : null,
            status: "queued",
        })
        .select("id")
        .single();

    if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
        documentId: document.id,
        path: storagePath,
        token: signed.token,
    });
}
