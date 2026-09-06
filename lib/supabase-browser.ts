import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, used only to upload a file straight to Storage with
 * a signed URL minted server-side.
 *
 * This exists because Vercel Functions reject request bodies over 4.5 MB, so a
 * PDF must never be routed through the app's own API. The publishable key is
 * safe in the browser by design, and the upload itself is authorised by the
 * short-lived signed token rather than by this key.
 */
export const createBrowserSupabaseClient = () =>
    createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
    );
