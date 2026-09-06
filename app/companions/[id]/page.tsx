import React from 'react';
import {getCompanion} from "@/lib/actions/companion.actions";
import {getCompanionDocuments} from "@/lib/actions/document.actions";
import {currentUser} from "@clerk/nextjs/server";
import {redirect} from "next/navigation";
import {getSubjectColor} from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import CompanionComponent from "@/components/ui/CompanionComponent";

interface CompanionSessionPageProps{
    params: Promise<{ id: string}>
}
//params -> url/[id] ->id
//searchParams /url?key=value&key1=value1

const CompanionSession = async ({ params }: CompanionSessionPageProps) => {

    const{ id } = await params;
    const companion= await getCompanion(id);
    const user = await currentUser();

    // const  {name,subject,title,topic,duration} = companion;

    if (!user) redirect('/sign-in');
    if (!companion) redirect('/companions');

    // Retrieval happens per spoken turn inside /api/voice/reply, so the page only
    // needs to know which documents exist - for the badge and the link below.
    const documents = await getCompanionDocuments(id);
    const readyDocuments = documents.filter((d) => d.status === 'ready');



    return (
        <main>
            <article className="flex rounded-border justify-between p-6 max-md:flex-col">
                <div className="flex items-center gap-2">
                    <div className="size-[72px] flex items-center justify-center rounded-lg max-md:hidden" style={{ backgroundColor:getSubjectColor(companion.subject)}}>
                        <Image src={`/icons/${companion.subject}.svg`} alt={companion.subject}
                        width={35} height={35}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <p className="font-bold text-2xl">
                                {companion.name}
                            </p>
                            <div className="subject-badge max-sm:hidden">
                                {companion.subject}
                            </div>

                        </div>
                        <p className="text-lg">
                            {companion.topic}

                        </p>
                    </div>

                </div>
                <div className="flex flex-col items-end gap-2 max-md:hidden">
                    <div className="items-start text-2xl">
                        {companion.duration} minutes
                    </div>
                    {companion.author === user.id && (
                        <Link href={`/companions/${id}/documents`} className="text-sm underline opacity-70 hover:opacity-100">
                            {readyDocuments.length
                                ? `${readyDocuments.length} document${readyDocuments.length > 1 ? 's' : ''} attached`
                                : 'Add course material'}
                        </Link>
                    )}
                </div>
            </article>
            <CompanionComponent
                {...companion}
                companionId = {id}
                userName={user.firstName!}
                userImage = {user.imageUrl}
                documents={documents as CompanionDocument[]}

            />


        </main>
    );
};

export default CompanionSession;