import {
	Accidental,
	ContextChange,
	Event,
	KeySignature,
	LilyletDoc,
	Measure,
	Phonet,
	Pitch,
	Part,
	RestEvent,
	TremoloEvent,
	TupletEvent,
	TimesEvent,
	Voice,
} from "./types";

const PHONET_SEMITONE: Record<Phonet, number> = {
	[Phonet.c]: 0,
	[Phonet.d]: 2,
	[Phonet.e]: 4,
	[Phonet.f]: 5,
	[Phonet.g]: 7,
	[Phonet.a]: 9,
	[Phonet.b]: 11,
};

const ACCIDENTAL_SEMITONE: Record<Accidental, number> = {
	[Accidental.natural]: 0,
	[Accidental.sharp]: 1,
	[Accidental.flat]: -1,
	[Accidental.doubleSharp]: 2,
	[Accidental.doubleFlat]: -2,
};

type Spelling = { phonet: Phonet; accidental?: Accidental };

// Chromatic pitches have several enharmonic names. Follow the transposition
// direction where a choice exists: upward motion prefers sharps, downward
// motion prefers flats. Both tables use only accidentals supported by Lilylet.
const SHARP_SPELLINGS: Spelling[] = [
	{ phonet: Phonet.c },
	{ phonet: Phonet.c, accidental: Accidental.sharp },
	{ phonet: Phonet.d },
	{ phonet: Phonet.d, accidental: Accidental.sharp },
	{ phonet: Phonet.e },
	{ phonet: Phonet.f },
	{ phonet: Phonet.f, accidental: Accidental.sharp },
	{ phonet: Phonet.g },
	{ phonet: Phonet.g, accidental: Accidental.sharp },
	{ phonet: Phonet.a },
	{ phonet: Phonet.a, accidental: Accidental.sharp },
	{ phonet: Phonet.b },
];

const FLAT_SPELLINGS: Spelling[] = [
	{ phonet: Phonet.c },
	{ phonet: Phonet.d, accidental: Accidental.flat },
	{ phonet: Phonet.d },
	{ phonet: Phonet.e, accidental: Accidental.flat },
	{ phonet: Phonet.e },
	{ phonet: Phonet.f },
	{ phonet: Phonet.g, accidental: Accidental.flat },
	{ phonet: Phonet.g },
	{ phonet: Phonet.a, accidental: Accidental.flat },
	{ phonet: Phonet.a },
	{ phonet: Phonet.b, accidental: Accidental.flat },
	{ phonet: Phonet.b },
];

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

const pitchClass = (pitch: Pitch): number =>
	PHONET_SEMITONE[pitch.phonet] + (pitch.accidental ? ACCIDENTAL_SEMITONE[pitch.accidental] : 0);

const spellingFor = (pitchClass: number, semitones: number): Spelling =>
	(semitones < 0 ? FLAT_SPELLINGS : SHARP_SPELLINGS)[mod(pitchClass, 12)];

/** Transpose one resolved Lilylet pitch by an integer number of semitones. */
export const transposePitch = (pitch: Pitch, semitones: number): Pitch => {
	if (semitones === 0) return { ...pitch };
	const absolute = pitch.octave * 12 + pitchClass(pitch) + semitones;
	const octave = Math.floor(absolute / 12);
	const spelling = spellingFor(absolute, semitones);
	return {
		phonet: spelling.phonet,
		...(spelling.accidental ? { accidental: spelling.accidental } : {}),
		octave,
		...(pitch.courtesy !== undefined ? { courtesy: pitch.courtesy } : {}),
	};
};

const transposeKey = (key: KeySignature, semitones: number): KeySignature => {
	if (semitones === 0) return { ...key };
	const sourceClass = PHONET_SEMITONE[key.pitch] + (key.accidental ? ACCIDENTAL_SEMITONE[key.accidental] : 0);
	const target = spellingFor(sourceClass + semitones, semitones);
	return {
		pitch: target.phonet,
		...(target.accidental ? { accidental: target.accidental } : {}),
		mode: key.mode,
	};
};

const transposeRest = (event: RestEvent, semitones: number): RestEvent => ({
	...event,
	...(event.pitch ? { pitch: transposePitch(event.pitch, semitones) } : {}),
});

const transposeEvent = (event: Event, semitones: number): Event => {
	switch (event.type) {
	case "note":
		return { ...event, pitches: event.pitches.map(pitch => transposePitch(pitch, semitones)) };
	case "rest":
		return transposeRest(event, semitones);
	case "context": {
		const context = event as ContextChange;
		return { ...context, ...(context.key ? { key: transposeKey(context.key, semitones) } : {}) };
	}
	case "tremolo": {
		const tremolo = event as TremoloEvent;
		return {
			...tremolo,
			pitchA: tremolo.pitchA.map(pitch => transposePitch(pitch, semitones)),
			pitchB: tremolo.pitchB.map(pitch => transposePitch(pitch, semitones)),
		};
	}
	case "tuplet": {
		const tuplet = event as TupletEvent;
		return { ...tuplet, events: tuplet.events.map(inner => transposeEvent(inner as Event, semitones) as typeof inner) };
	}
	case "times": {
		const times = event as TimesEvent;
		return { ...times, events: times.events.map(inner => transposeEvent(inner as Event, semitones) as typeof inner) };
	}
	default:
		return { ...event } as Event;
	}
};

const transposeVoice = (voice: Voice, semitones: number): Voice => ({
	...voice,
	events: voice.events.map(event => transposeEvent(event, semitones)),
});

const transposePart = (part: Part, semitones: number): Part => ({
	...part,
	voices: part.voices.map(voice => transposeVoice(voice, semitones)),
});

const transposeMeasure = (measure: Measure, semitones: number): Measure => ({
	...measure,
	...(measure.key ? { key: transposeKey(measure.key, semitones) } : {}),
	parts: measure.parts.map(part => transposePart(part, semitones)),
});

/** Return a new Lilylet document with every AST pitch shifted chromatically. */
export const transposeDoc = (doc: LilyletDoc, semitones: number): LilyletDoc => {
	if (!Number.isFinite(semitones) || !Number.isInteger(semitones)) {
		throw new Error("transposeDoc semitones must be a finite integer");
	}
	return {
		...doc,
		measures: doc.measures.map(measure => transposeMeasure(measure, semitones)),
	};
};
