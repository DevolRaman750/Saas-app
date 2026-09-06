export interface RagMatch {
    content: string;
    page: number;
    file_name: string;
    similarity: number;
}

// Roughly 2000 tokens. Kept modest on purpose: the voice model has to read this
// before every answer, and a bloated block slows the first spoken word.
const MAX_CHARS = 8000;

/**
 * Format retrieved chunks for injection into the live call.
 *
 * Shared by the call-start preamble and the per-turn injection so the two can
 * never drift apart in wording - the system prompt tells the model to look for
 * exactly this shape.
 */
export const buildContextBlock = (matches: RagMatch[]): string => {
    if (!matches.length) return "";

    const lines: string[] = [];
    let budget = MAX_CHARS;

    for (const match of matches) {
        const line = `[${match.file_name}, page ${match.page}] ${match.content}`;
        if (line.length > budget) break;
        lines.push(line);
        budget -= line.length;
    }

    return [
        "COURSE MATERIAL retrieved for the student's last question - answer from this:",
        ...lines,
    ].join("\n");
};

/** Unique page citations for a set of matches, for the transcript UI. */
export const citationsOf = (matches: RagMatch[]) => {
    const seen = new Set<string>();
    return matches
        .filter((m) => {
            const key = `${m.file_name}#${m.page}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((m) => ({ fileName: m.file_name, page: m.page }));
};
