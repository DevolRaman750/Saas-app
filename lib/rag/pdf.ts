import { extractText, getDocumentProxy } from "unpdf";

export interface PdfPage {
    page: number;   // 1-indexed, matches what a human reads off the page
    text: string;
}

/**
 * pdf.js needs a plain Uint8Array. A Node Buffer is a Uint8Array subclass whose
 * .buffer points into a shared pool, so passing one through unconverted either
 * reads the wrong bytes or fails outright inside the worker. Copying normalises
 * both cases.
 */
const toBytes = (input: ArrayBuffer | Uint8Array) =>
    input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input);

/**
 * Extract a PDF's text one page at a time.
 *
 * Per-page extraction (rather than one merged string) is what makes spoken
 * citations possible later - every chunk carries the page it came from.
 */
export const extractPages = async (
    buffer: ArrayBuffer | Uint8Array,
): Promise<PdfPage[]> => {
    const pdf = await getDocumentProxy(toBytes(buffer));
    const { text } = await extractText(pdf, { mergePages: false });

    return (text as string[])
        .map((raw, index) => ({
            page: index + 1,
            text: normalize(raw),
        }))
        .filter((p) => p.text.length > 0);
};

/** Count pages without pulling all the text out - used to size the ingest job. */
export const countPages = async (
    buffer: ArrayBuffer | Uint8Array,
): Promise<number> => {
    const pdf = await getDocumentProxy(toBytes(buffer));
    return pdf.numPages;
};

/**
 * PDF text extraction leaves hyphenated line breaks and ragged whitespace that
 * hurt both embedding quality and how the excerpt reads when spoken aloud.
 */
const normalize = (raw: string) =>
    raw
        .replace(/-\s*\n\s*/g, "")     // re-join words split across lines
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
