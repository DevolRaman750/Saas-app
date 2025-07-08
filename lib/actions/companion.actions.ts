"use server"

import {auth} from "@clerk/nextjs/server";
import {createSupabaseClient} from "@/lib/supabase";
import {PostgrestQueryBuilder} from "@supabase/postgrest-js";



export const createCompanion = async (formData: CreateCompanion) => {
    const { userId: author} = await auth();
    const supabase = createSupabaseClient();

    const {data,error } = await supabase
        .from('Companions')
        .insert({...formData,author })
        .select();

    console.log("Creating companion with data:", formData);
    console.log("Using Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log("Using Supabase ANON KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 10)); // hide full key


    if (error) {
        console.error("Supabase Insert Error:", error);
    } else if (!data) {
        console.error("No data returned from Supabase");
    }

    if (error || !data) throw new Error(error?.message || "Failed to create a companion");

    return data[0];

}