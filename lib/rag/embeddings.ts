/**
 * NVIDIA NIM embeddings (nvidia/nemotron-3-embed-1b).
 *
 * The model is ASYMMETRIC: document text must be embedded with input_type
 * "passage" and search queries with "query". Mixing them up degrades retrieval
 * badly and raises no error, so the two live in separate functions rather than
 * behind a boolean anyone could pass wrong.
 *
 * Output is 2048 dimensions, fixed (the API rejects a `dimensions` override).
 */

const BASE_URL =
    process.env.NVIDIA_EMBED_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_EMBED_MODEL || "nvidia/nemotron-3-embed-1b";

export const EMBEDDING_DIMENSIONS = 2048;
const MAX_BATCH = 32;

type InputType = "passage" | "query";

const embed = async (inputs: string[], inputType: InputType): Promise<number[][]> => {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY is not set");

    const res = await fetch(`${BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: MODEL,
            input: inputs,
            input_type: inputType,
            encoding_format: "float",
            truncate: "END",
        }),
    });

    if (!res.ok) {
        const detail = await res.text();
        throw new Error(`NVIDIA embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const json = await res.json();
    // The API may return data out of order; `index` is authoritative.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d: { embedding: number[] }) => d.embedding);
};

/** Embed document chunks. Batches automatically, halving on size-related failures. */
export const embedPassages = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH) {
        const batch = texts.slice(i, i + MAX_BATCH);
        try {
            out.push(...(await embed(batch, "passage")));
        } catch (error) {
            // A batch that is too large fails as a 4xx. Retry one at a time so a
            // single oversized chunk cannot take the whole document down with it.
            if (batch.length === 1) throw error;
            for (const text of batch) {
                out.push(...(await embed([text], "passage")));
            }
        }
    }

    return out;
};

/** Embed a single search query. */
export const embedQuery = async (text: string): Promise<number[]> => {
    const [vector] = await embed([text], "query");
    return vector;
};

/** pgvector accepts a vector literal as text: '[0.1,0.2,...]'. */
export const toVectorLiteral = (vector: number[]) => JSON.stringify(vector);
