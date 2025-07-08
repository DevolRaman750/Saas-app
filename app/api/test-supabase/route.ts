// app/api/test-supabase/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.from("companions").insert([
        {
            name: "Test Companion",
            subject: "Math",
            topic: "Algebra",
            voice: "male",
            style: "formal",
            duration: 10,
        },
    ]);

    console.log("Data:", data);
    console.log("Error:", error);

    return NextResponse.json({ data, error });
}
