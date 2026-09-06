'use client'
import React, {useEffect, useRef, useState} from 'react';
import {cn, getSubjectColor} from "@/lib/utils";
import Image from "next/image";
import Lottie, {LottieRefCurrentProps} from "lottie-react";
import soundwaves from '@/constants/soundwaves.json'
import {addToSessionHistory} from "@/lib/actions/companion.actions";
import {
    createListener,
    createSpeaker,
    forSpeech,
    isSpeechSupported,
    loadVoices,
    pickVoice,
    stopSpeaking,
    takeSentences,
} from "@/lib/voice/speech";

/**
 * How long the student must be silent before the tutor takes its turn.
 *
 * This replaces waiting for Chrome's own end-of-speech detection, which fires
 * unpredictably 1-3 seconds after you stop. Lower feels snappier; higher gives
 * more room to pause mid-thought without being interrupted.
 */
const SILENCE_MS = 5000;

enum CallStatus {
    INACTIVE = "INACTIVE",
    CONNECTING = 'CONNECTING',
    ACTIVE = 'ACTIVE',
    FINISHED = 'FINISHED',
}

const CompanionComponent = ({companionId, subject, topic, name, userName, userImage, style, voice, documents = []}: CompanionComponentProps) => {
    const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [messages, setMessages] = useState<SavedMessage[]>([]);
    const [citations, setCitations] = useState<RagCitation[]>([]);
    const [partial, setPartial] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [supported, setSupported] = useState(true);

    const lottieRef = useRef<LottieRefCurrentProps>(null);
    const listenerRef = useRef<ReturnType<typeof createListener> | null>(null);
    const speakerRef = useRef<ReturnType<typeof createSpeaker> | null>(null);
    const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
    const busyRef = useRef(false);
    const historyRef = useRef<SavedMessage[]>([]);

    // Endpointing state: what the student has said so far this turn, and the
    // timer that decides the turn is over.
    const heardRef = useRef('');
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const readyDocuments = documents.filter((doc) => doc.status === 'ready');
    const isGrounded = readyDocuments.length > 0;

    useEffect(() => {
        setSupported(isSpeechSupported());
    }, []);

    useEffect(() => {
        if (isSpeaking) lottieRef.current?.play();
        else lottieRef.current?.stop();
    }, [isSpeaking]);

    useEffect(() => () => {
        listenerRef.current?.stop();
        stopSpeaking();
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    }, []);

    const clearSilenceTimer = () => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
    };

    /** Restart the countdown; every word heard pushes the tutor's turn back. */
    const armSilenceTimer = () => {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
            const utterance = heardRef.current.trim();
            heardRef.current = '';
            setPartial('');
            if (utterance) void respondTo(utterance);
        }, SILENCE_MS);
    };

    const respondTo = async (utterance: string) => {
        if (busyRef.current) return;
        busyRef.current = true;
        clearSilenceTimer();
        setIsThinking(true);

        // Pause the mic before the tutor speaks, or the browser transcribes the
        // tutor's own voice straight back in as student input.
        listenerRef.current?.pause();

        const userMessage: SavedMessage = { role: 'user', content: utterance };
        historyRef.current = [...historyRef.current, userMessage];
        setMessages((prev) => [userMessage, ...prev]);

        const speaker = createSpeaker(ttsVoiceRef.current, style);
        speakerRef.current = speaker;

        try {
            const res = await fetch('/api/voice/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companionId, subject, topic, style, messages: historyRef.current }),
            });

            if (!res.ok || !res.body) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.error || 'The tutor could not respond');
            }

            const header = res.headers.get('X-Citations');
            if (header) setCitations(JSON.parse(decodeURIComponent(header)));

            // Speak each sentence the moment it completes, rather than waiting for
            // the full reply - this is what removes most of the dead air.
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let full = '';
            let started = false;

            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                buffer += text;
                full += text;

                const { sentences, rest } = takeSentences(buffer);
                buffer = rest;

                for (const sentence of sentences) {
                    if (!started) {
                        started = true;
                        setIsThinking(false);
                        setIsSpeaking(true);
                    }
                    speaker.say(forSpeech(sentence));
                }
            }

            if (buffer.trim()) {
                if (!started) { setIsThinking(false); setIsSpeaking(true); }
                speaker.say(forSpeech(buffer));
            }

            speaker.finish();

            const reply = forSpeech(full);
            if (reply) {
                const assistantMessage: SavedMessage = { role: 'assistant', content: reply };
                historyRef.current = [...historyRef.current, assistantMessage];
                setMessages((prev) => [assistantMessage, ...prev]);
            }

            await speaker.waitUntilDone();
        } catch (e) {
            speaker.cancel();
            setError(e instanceof Error ? e.message : 'Something went wrong');
        } finally {
            setIsThinking(false);
            setIsSpeaking(false);
            busyRef.current = false;
            if (!isMuted && callStatus !== CallStatus.FINISHED) listenerRef.current?.resume();
        }
    };

    const handleCall = async () => {
        if (!isSpeechSupported()) {
            setSupported(false);
            return;
        }

        setError(null);
        setCallStatus(CallStatus.CONNECTING);
        setCitations([]);
        setMessages([]);
        historyRef.current = [];
        heardRef.current = '';

        ttsVoiceRef.current = pickVoice(await loadVoices(), voice);

        listenerRef.current = createListener({
            onPartial: (text) => {
                setPartial(text);
                armSilenceTimer();
            },
            onFinal: (text) => {
                heardRef.current = `${heardRef.current} ${text}`.trim();
                setPartial(heardRef.current);
                armSilenceTimer();
            },
            onError: (message) => setError(message),
        });

        setCallStatus(CallStatus.ACTIVE);

        const opening = isGrounded
            ? `Hello ${userName}. Let's go through ${topic} together, using the material you uploaded. What would you like to start with?`
            : `Hello ${userName}. Today we'll be talking about ${topic}. What would you like to know?`;

        const greeting: SavedMessage = { role: 'assistant', content: opening };
        historyRef.current = [greeting];
        setMessages([greeting]);

        const speaker = createSpeaker(ttsVoiceRef.current, style);
        speakerRef.current = speaker;
        setIsSpeaking(true);
        speaker.say(opening);
        speaker.finish();
        await speaker.waitUntilDone();
        setIsSpeaking(false);

        listenerRef.current?.start();
    };

    const handleDisconnect = () => {
        setCallStatus(CallStatus.FINISHED);
        clearSilenceTimer();
        listenerRef.current?.stop();
        speakerRef.current?.cancel();
        stopSpeaking();
        setIsSpeaking(false);
        setIsThinking(false);
        setPartial('');
        addToSessionHistory(companionId);
    };

    const toggleMicrophone = () => {
        const next = !isMuted;
        setIsMuted(next);
        if (next) {
            clearSilenceTimer();
            listenerRef.current?.pause();
        } else {
            listenerRef.current?.resume();
        }
    };

    const statusLabel = isThinking ? 'Thinking' : isSpeaking ? 'Speaking' : 'Listening';

    return (
        <section className="flex flex-col h-[70vh]">
            <section className="flex gap-8 max-sm:flex-col">
                <div className="companion-section">
                    <div className="companion-avatar" style={{backgroundColor: getSubjectColor(subject)}}>
                        <div className={cn('absolute transition-opacity duration-1000', callStatus === CallStatus.FINISHED || callStatus === CallStatus.INACTIVE ? 'opacity-1001' : 'opacity-0', callStatus === CallStatus.CONNECTING && 'opacity-100 animate-pulse'
                        )
                        }>
                            <Image
                                src={`/icons/${subject}.svg`} alt={subject} width={150} height={150} className="max-sm:w-fit"

                            />

                        </div>
                        <div className={cn('absolute transition-opacity duration-1000', callStatus === CallStatus.ACTIVE ? 'opacity-100' : 'opacity-0')}>
                            <Lottie lottieRef={lottieRef} animationData={soundwaves}
                                    autoplay={false}
                                    className="companion-lottie"
                            >

                            </Lottie>
                        </div>
                    </div>

                    <p className="font-bold text-2xl">
                        {name}
                    </p>

                    {callStatus === CallStatus.ACTIVE && (
                        <p className="text-xs opacity-70">{statusLabel}...</p>
                    )}

                    {isGrounded && (
                        <p className="text-xs opacity-70 text-center">
                            Grounded in {readyDocuments.length} document{readyDocuments.length > 1 ? 's' : ''}
                        </p>
                    )}

                </div>
                <div className="user-section">
                    <div className="user-avatar">
                        <Image src={userImage} alt={userName} width={130} height={130} className="rounded-lg"/>
                        <p className="font-bold text-2xl">
                            {userName}

                        </p>

                    </div>
                    <button className="btn-mic" onClick={toggleMicrophone} disabled={callStatus !== CallStatus.ACTIVE}>
                        <Image src={isMuted ? '/icons/mic-off.svg' : '/icons/mic-on.svg'} alt="mic" width={36} height={36} />
                        <p className="max-sm:hidden">
                            {isMuted ? 'Turn on microphone' : 'Turn off microphone'}
                        </p>
                    </button>
                    <button className={cn('rounded-lg py-2 cursor-pointer transition-colors w-full text-white', callStatus === CallStatus.ACTIVE ? 'bg-red-700' : 'bg-primary', callStatus === CallStatus.CONNECTING && 'animate-pulse')}
                            onClick={callStatus === CallStatus.ACTIVE ? handleDisconnect : handleCall}>
                        {callStatus === CallStatus.ACTIVE
                            ? "End Session"
                            : callStatus === CallStatus.CONNECTING
                                ? 'Connecting'
                                : 'Start Session'
                        }
                    </button>

                </div>

            </section>

            {!supported && (
                <p className="text-sm text-red-700 mt-2">
                    Voice sessions need the Web Speech API, which Chrome and Edge support but Firefox does not.
                    Please open this page in Chrome or Edge.
                </p>
            )}
            {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

            <section className="transcript">
                <div className="transcript-message no-scrollbar">
                    {citations.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {citations.map((citation) => (
                                <span
                                    key={`${citation.fileName}-${citation.page}`}
                                    className="rounded-full bg-black/5 px-3 py-1 text-xs"
                                    title={citation.fileName}
                                >
                                    {citation.fileName} p.{citation.page}
                                </span>
                            ))}
                        </div>
                    )}

                    {partial && (
                        <p className="text-primary opacity-50 max-sm:text-sm italic">
                            {userName}: {partial}
                        </p>
                    )}

                    {messages.map((message, index) => {
                        if (message.role === 'assistant') {
                            return (
                                <p key={index} className="max-sm:text-sm">
                                    {
                                        name
                                            .split(' ')[0]
                                            .replace('/[.,]/g, ','')
                                    }: {message.content}
                                </p>
                            )
                        } else {
                            return <p key={index} className="text-primary max-sm:text-sm">
                                {userName}: {message.content}
                            </p>
                        }
                    })}
                </div>
                <div className="transcript-fade">

                </div>

            </section>

        </section>
    );
};

export default CompanionComponent;
