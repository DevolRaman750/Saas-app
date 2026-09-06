import {createClient} from "@supabase/supabase-js";
import {auth} from "@clerk/nextjs/server";

// Supabase's newer projects issue `sb_publishable_...` keys instead of the
// legacy anon JWT. Accept either so the app works on both key formats.
const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const createSupabaseClient = ()=>{
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        publishableKey, {
            async accessToken(){
                return ((await auth()).getToken());
            }
        }
    )
}
