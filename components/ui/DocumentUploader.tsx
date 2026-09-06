'use client'
import React, { useRef, useState } from 'react';
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

interface Progress {
    label: string;
    percent: number;
}

const DocumentUploader = ({ companionId }: { companionId: string }) => {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    const handleFile = async (file: File) => {
        setError(null);
        setProgress({ label: 'Uploading PDF', percent: 5 });

        try {
            // Ask the server for a signed URL, then send the file straight to
            // Supabase Storage. The PDF never passes through our own API, which
            // is what keeps it clear of Vercel's 4.5 MB request body limit.
            const urlRes = await fetch('/api/documents/upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companionId, fileName: file.name, fileSize: file.size }),
            });
            const uploaded = await urlRes.json();
            if (!urlRes.ok) throw new Error(uploaded.error || 'Upload failed');

            const { error: storageError } = await createBrowserSupabaseClient()
                .storage
                .from('companion-docs')
                .uploadToSignedUrl(uploaded.path, uploaded.token, file, {
                    contentType: 'application/pdf',
                });

            if (storageError) throw new Error(storageError.message);

            // Ingestion runs in resumable slices so no single request can hit the
            // serverless timeout - loop until the worker reports it is done.
            setProgress({ label: 'Reading the document', percent: 15 });
            let done = false;

            while (!done) {
                const res = await fetch(`/api/documents/${uploaded.documentId}/process`, { method: 'POST' });
                const batch = await res.json();
                if (!res.ok) throw new Error(batch.error || 'Processing failed');

                done = batch.done;
                const pages = batch.totalPages || 0;
                const ratio = pages ? batch.pagesDone / pages : 0;

                setProgress({
                    label: done
                        ? 'Finishing up'
                        : `Understanding page ${batch.pagesDone} of ${pages}`,
                    percent: Math.max(15, Math.round(ratio * 100)),
                });
            }

            setProgress({ label: 'Ready', percent: 100 });
            router.refresh();
            setTimeout(() => setProgress(null), 1200);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong');
            setProgress(null);
        }
    };

    const busy = progress !== null;

    return (
        <div className="flex flex-col gap-3">
            <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && !busy) handleFile(file);
                }}
                onClick={() => !busy && inputRef.current?.click()}
                className={cn(
                    'rounded-4xl border-2 border-dashed p-8 text-center transition-colors',
                    busy ? 'cursor-wait opacity-70' : 'cursor-pointer hover:bg-gray-50',
                    dragging ? 'border-primary bg-gray-50' : 'border-black/20',
                )}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
                        e.target.value = '';
                    }}
                />
                <p className="font-bold text-lg">Add course material</p>
                <p className="text-sm opacity-70 mt-1">
                    Drop a PDF here or click to browse. Up to 20 MB.
                </p>
            </div>

            {progress && (
                <div className="flex flex-col gap-1">
                    <div className="h-2 w-full rounded-full bg-black/10 overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progress.percent}%` }}
                        />
                    </div>
                    <p className="text-sm opacity-70">{progress.label}...</p>
                </div>
            )}

            {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
    );
};

export default DocumentUploader;
