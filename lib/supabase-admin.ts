import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely, so it is only ever used
 * inside route handlers AFTER the caller's ownership of the row has been
 * verified against the Clerk-authenticated client.
 *
 * The `server-only` import above makes importing this from a client component a
 * build error rather than a silent key leak.
 */
export const createSupabaseAdminClient = () => {
    const secretKey =
        process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secretKey) {
        throw new Error(
            "SUPABASE_SECRET_KEY is not set - add the sb_secret_... key from Supabase > Settings > API Keys to .env.local",
        );
    }

    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
};

export const DOCUMENTS_BUCKET = "companion-docs";
