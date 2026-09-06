import type { PdfPage } from "./pdf";

export interface Chunk {
    content: string;
    page: number;
    chunkIndex: number;
}

interface ChunkOptions {
    size?: number;
    overlap?: number;
}

/**
 * Split pages into overlapping chunks, each remembering its source page.
 *
 * Splits are attempted on the largest natural boundary that fits (paragraph,
 * then line, then sentence) so an idea is rarely guillotined mid-thought. The
 * overlap means a concept straddling two chunks survives intact in at least one.
 */
export const chunkPages = (
    pages: PdfPage[],
    { size = 1200, overlap = 200 }: ChunkOptions = {},
): Chunk[] => {
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const { page, text } of pages) {
        for (const content of splitText(text, size, overlap)) {
            chunks.push({ content, page, chunkIndex: chunkIndex++ });
        }
    }

    return chunks;
};

const splitText = (text: string, size: number, overlap: number): string[] => {
    if (text.length <= size) return text.trim() ? [text.trim()] : [];

    const out: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + size, text.length);
        const slice = text.slice(start, end);
        const cut = end === text.length ? slice.length : findBreak(slice);

        const piece = slice.slice(0, cut).trim();
        if (piece) out.push(piece);

        if (end === text.length) break;
        // Step forward by the chunk minus the overlap, never backwards.
        start += Math.max(cut - overlap, Math.floor(size / 2));
    }

    return out;
};

/**
 * Prefer the last paragraph break, then line break, then sentence end that
 * falls in the back half of the slice. Anything earlier would waste too much of
 * the chunk, so we fall back to a hard cut at the size limit.
 */
const findBreak = (slice: string): number => {
    const floor = Math.floor(slice.length / 2);

    for (const marker of ["\n\n", "\n", ". ", "? ", "! "]) {
        const at = slice.lastIndexOf(marker);
        if (at > floor) return at + marker.length;
    }

    return slice.length;
};
