/**
 * Browser speech: Web Speech API for listening, speechSynthesis for speaking.
 *
 * Free, unlimited, no API key. Chrome and Edge only - Firefox ships no
 * SpeechRecognition, so callers must check isSpeechSupported() and say so
 * rather than presenting a dead button.
 */

type Recognition = {
    start: () => void;
    stop: () => void;
    abort: () => void;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
};

const getRecognitionCtor = (): (new () => Recognition) | null => {
    if (typeof window === "undefined") return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

export const isSpeechSupported = () =>
    typeof window !== "undefined" &&
    !!getRecognitionCtor() &&
    "speechSynthesis" in window;

interface ListenerHandlers {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (message: string) => void;
}

/**
 * A restartable microphone.
 *
 * Chrome ends recognition on its own after a pause, so staying "on" for a whole
 * session means restarting it whenever it stops - but only while the caller
 * still wants to listen, otherwise it fights the caller's stop().
 */
export const createListener = ({ onPartial, onFinal, onError }: ListenerHandlers) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) throw new Error("Speech recognition is not supported in this browser");

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let wanted = false;   // does the caller want the mic open?
    let running = false;  // is the engine actually running?

    recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0].transcript.trim();
            if (!text) continue;
            if (result.isFinal) onFinal(text);
            else interim += ` ${text}`;
        }
        if (interim.trim()) onPartial(interim.trim());
    };

    recognition.onerror = (event: any) => {
        // "no-speech" and "aborted" are routine, not failures worth surfacing.
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "not-allowed") {
            wanted = false;
            onError("Microphone permission was denied. Allow it in your browser and start again.");
            return;
        }
        onError(`Microphone error: ${event.error}`);
    };

    recognition.onend = () => {
        running = false;
        if (wanted) {
            try {
                recognition.start();
                running = true;
            } catch {
                // start() throws if it is already starting; the next onend retries.
            }
        }
    };

    return {
        start() {
            wanted = true;
            if (running) return;
            try {
                recognition.start();
                running = true;
            } catch {
                // Already started - harmless.
            }
        },
        stop() {
            wanted = false;
            try {
                recognition.stop();
            } catch {
                /* not running */
            }
        },
        /** Pause while the tutor talks, so its own voice is not transcribed. */
        pause() {
            wanted = false;
            try {
                recognition.abort();
            } catch {
                /* not running */
            }
        },
        resume() {
            this.start();
        },
    };
};

/**
 * Voice list loading is asynchronous in Chrome: the first getVoices() call
 * usually returns an empty array and fills in later via voiceschanged.
 */
export const loadVoices = (): Promise<SpeechSynthesisVoice[]> =>
    new Promise((resolve) => {
        const existing = window.speechSynthesis.getVoices();
        if (existing.length) return resolve(existing);

        const timeout = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
        window.speechSynthesis.addEventListener(
            "voiceschanged",
            () => {
                clearTimeout(timeout);
                resolve(window.speechSynthesis.getVoices());
            },
            { once: true },
        );
    });

/**
 * Pick the best available English voice for the companion's gender setting.
 *
 * Edge exposes Microsoft's "Natural" neural voices, which sound dramatically
 * better than the default system ones, so they are strongly preferred.
 */
export const pickVoice = (voices: SpeechSynthesisVoice[], gender: string) => {
    const english = voices.filter((v) => v.lang.startsWith("en"));
    if (!english.length) return null;

    // "femal" is a legacy value stored by an older version of the companion form.
    const wantsFemale = gender === "female" || gender === "femal";
    const femaleNames = /aria|ava|jenny|michelle|emma|zira|samantha|female|sonia|libby|natasha/i;
    const maleNames = /guy|andrew|brian|christopher|eric|david|male|ryan|george|mark/i;

    const score = (v: SpeechSynthesisVoice) => {
        let n = 0;
        if (/natural/i.test(v.name)) n += 10;      // Edge neural voices
        if (/google/i.test(v.name)) n += 6;        // Chrome's cloud voices
        if (v.lang === "en-US") n += 2;
        if (v.localService === false) n += 1;
        const matchesGender = wantsFemale ? femaleNames.test(v.name) : maleNames.test(v.name);
        if (matchesGender) n += 20;
        return n;
    };

    return [...english].sort((a, b) => score(b) - score(a))[0] ?? null;
};

/**
 * An incremental speaker.
 *
 * Sentences are spoken as they arrive from the model rather than after the whole
 * reply is generated, which is the difference between the tutor starting to talk
 * in well under a second versus up to five. Chrome also truncates very long
 * utterances, so sentence-sized pieces are more reliable regardless.
 */
export const createSpeaker = (voice: SpeechSynthesisVoice | null, style: string) => {
    const synth = window.speechSynthesis;
    synth.cancel();

    let pending = 0;
    let noMoreText = false;
    let cancelled = false;
    let notifyDone: (() => void) | null = null;

    const settle = () => {
        if (pending === 0 && (noMoreText || cancelled) && notifyDone) {
            notifyDone();
            notifyDone = null;
        }
    };

    return {
        /** Queue one sentence. Safe to call repeatedly as tokens stream in. */
        say(sentence: string) {
            const text = sentence.trim();
            if (!text || cancelled) return;

            const utterance = new SpeechSynthesisUtterance(text);
            if (voice) utterance.voice = voice;
            utterance.rate = style === "formal" ? 0.95 : 1.03;
            utterance.pitch = 1;

            pending++;
            utterance.onend = utterance.onerror = () => {
                pending--;
                settle();
            };

            synth.speak(utterance);
        },
        /** No further sentences are coming. */
        finish() {
            noMoreText = true;
            settle();
        },
        /** Resolves once everything queued has actually been spoken. */
        waitUntilDone(): Promise<void> {
            return new Promise((resolve) => {
                notifyDone = resolve;
                settle();
            });
        },
        cancel() {
            cancelled = true;
            pending = 0;
            synth.cancel();
            settle();
        },
    };
};

/** Split off every complete sentence, leaving any partial tail in the buffer. */
export const takeSentences = (buffer: string): { sentences: string[]; rest: string } => {
    const sentences: string[] = [];
    let rest = buffer;

    for (;;) {
        const match = rest.match(/^[\s\S]*?[.!?]+(\s|$)/);
        if (!match) break;
        sentences.push(match[0]);
        rest = rest.slice(match[0].length);
    }

    return { sentences, rest };
};

/**
 * Strip markdown the model slipped through - a synthesiser reads "asterisk"
 * out loud. Applied per sentence on the client since the reply now streams.
 */
export const forSpeech = (text: string) =>
    text
        .replace(/[*_`#]+/g, "")
        .replace(/^\s*[-•]\s*/gm, "")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();

export const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }
};
