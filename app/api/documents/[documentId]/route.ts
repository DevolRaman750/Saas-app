import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, DOCUMENTS_BUCKET } from "@/lib/supabase-admin";

/** Status polling for the uploader's progress display. */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ documentId: string }> },
) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { documentId } = await params;
    const admin = createSupabaseAdminClient();

    const { data: document } = await admin
        .from("companion_documents")
        .select("id, user_id, file_name, status, page_count, pages_done, chunk_count, error_message")
        .eq("id", documentId)
        .single();

    // This client bypasses RLS, so ownership has to be checked here or any
    // signed-in user could read someone else's document metadata.
    if (!document || document.user_id !== userId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { user_id, ...safe } = document;
    return NextResponse.json(safe);
}

/** Delete a document: chunks cascade via FK, the stored PDF is removed here. */
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ documentId: string }> },
) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { documentId } = await params;
    const admin = createSupabaseAdminClient();

    const { data: document } = await admin
        .from("companion_documents")
        .select("id, user_id, storage_path")
        .eq("id", documentId)
        .single();

    if (!document || document.user_id !== userId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await admin.storage.from(DOCUMENTS_BUCKET).remove([document.storage_path]);
    const { error } = await admin.from("companion_documents").delete().eq("id", documentId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
}
