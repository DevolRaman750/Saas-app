'use client'
import React, { useState } from 'react';
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const statusLabels: Record<string, string> = {
    queued: 'Queued',
    processing: 'Processing',
    ready: 'Ready',
    failed: 'Failed',
};

const DocumentList = ({ documents }: { documents: CompanionDocument[] }) => {
    const router = useRouter();
    const [deleting, setDeleting] = useState<string | null>(null);

    const remove = async (id: string) => {
        setDeleting(id);
        await fetch(`/api/documents/${id}`, { method: 'DELETE' });
        setDeleting(null);
        router.refresh();
    };

    if (!documents.length) {
        return (
            <p className="text-sm opacity-70">
                No material yet. Once you add a PDF, this companion will teach from it and cite its pages.
            </p>
        );
    }

    return (
        <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
                <li
                    key={doc.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-black/10 p-4"
                >
                    <div className="min-w-0">
                        <p className="font-semibold truncate">{doc.file_name}</p>
                        <p className="text-sm opacity-70">
                            {doc.status === 'ready' && `${doc.page_count ?? 0} pages, ${doc.chunk_count ?? 0} passages indexed`}
                            {doc.status === 'processing' && `Processing page ${doc.pages_done ?? 0} of ${doc.page_count ?? '?'}`}
                            {doc.status === 'queued' && 'Waiting to be processed'}
                            {doc.status === 'failed' && (doc.error_message || 'Processing failed')}
                        </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                        <span
                            className={cn(
                                'rounded-full px-3 py-1 text-xs font-semibold',
                                doc.status === 'ready' && 'bg-green-100 text-green-800',
                                doc.status === 'failed' && 'bg-red-100 text-red-800',
                                (doc.status === 'processing' || doc.status === 'queued') && 'bg-gray-100 text-gray-800',
                            )}
                        >
                            {statusLabels[doc.status] ?? doc.status}
                        </span>
                        <button
                            onClick={() => remove(doc.id)}
                            disabled={deleting === doc.id}
                            className="text-sm underline opacity-70 hover:opacity-100 cursor-pointer disabled:opacity-40"
                        >
                            {deleting === doc.id ? 'Removing' : 'Remove'}
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    );
};

export default DocumentList;
