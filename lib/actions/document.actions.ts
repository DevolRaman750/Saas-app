"use server"

import { createSupabaseClient } from "@/lib/supabase";

/** A companion's documents, newest first. RLS scopes this to the caller. */
export const getCompanionDocuments = async (companionId: string) => {
    const supabase = createSupabaseClient();

    const { data, error } = await supabase
        .from("companion_documents")
        .select("id, file_name, status, page_count, pages_done, chunk_count, error_message, created_at")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Failed to load documents:", error.message);
        return [];
    }

    return data ?? [];
};

/** Only the documents that finished ingesting - the ones a session can cite. */
export const getReadyDocuments = async (companionId: string) => {
    const documents = await getCompanionDocuments(companionId);
    return documents.filter((d) => d.status === "ready");
};
