import React from 'react';
import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCompanion } from "@/lib/actions/companion.actions";
import { getCompanionDocuments } from "@/lib/actions/document.actions";
import { getSubjectColor } from "@/lib/utils";
import DocumentUploader from "@/components/ui/DocumentUploader";
import DocumentList from "@/components/ui/DocumentList";

// Reads the signed-in user (Clerk's auth() inspects request headers), so this
// page cannot be prerendered at build time.
export const dynamic = 'force-dynamic';

interface DocumentsPageProps {
    params: Promise<{ id: string }>;
}

const CompanionDocuments = async ({ params }: DocumentsPageProps) => {
    const { id } = await params;
    const { userId } = await auth();

    if (!userId) redirect('/sign-in');

    const companion = await getCompanion(id);
    if (!companion) redirect('/companions');
    // Only the author may curate a companion's knowledge base.
    if (companion.author !== userId) redirect(`/companions/${id}`);

    const documents = await getCompanionDocuments(id);
    const ready = documents.filter((d) => d.status === 'ready').length;

    return (
        <main className="flex flex-col gap-6">
            <article className="flex rounded-border justify-between p-6 max-md:flex-col gap-4">
                <div className="flex items-center gap-2">
                    <div
                        className="size-[72px] flex items-center justify-center rounded-lg max-md:hidden"
                        style={{ backgroundColor: getSubjectColor(companion.subject) }}
                    >
                        <Image
                            src={`/icons/${companion.subject}.svg`}
                            alt={companion.subject}
                            width={35}
                            height={35}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="font-bold text-2xl">{companion.name}</p>
                        <p className="text-lg">{companion.topic}</p>
                    </div>
                </div>

                <Link
                    href={`/companions/${id}`}
                    className="rounded-lg bg-primary px-6 py-2 text-white self-center"
                >
                    Start Session
                </Link>
            </article>

            <section className="flex flex-col gap-4 rounded-border p-6">
                <div>
                    <h2 className="font-bold text-2xl">Knowledge base</h2>
                    <p className="text-sm opacity-70 mt-1">
                        {ready > 0
                            ? `This companion teaches from ${ready} document${ready > 1 ? 's' : ''} and will cite their pages out loud.`
                            : 'Add a PDF and the companion will teach from it, citing page numbers as it speaks.'}
                    </p>
                </div>

                <DocumentUploader companionId={id} />
                <DocumentList documents={documents as CompanionDocument[]} />
            </section>
        </main>
    );
};

export default CompanionDocuments;
