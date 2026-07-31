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

const MAJOR_KEY_BY_FIFTHS: Record<number, Spelling> = {
	[-6]: { phonet: Phonet.g, accidental: Accidental.flat },
	[-5]: { phonet: Phonet.d, accidental: Accidental.flat },
	[-4]: { phonet: Phonet.a, accidental: Accidental.flat },
	[-3]: { phonet: Phonet.e, accidental: Accidental.flat },
	[-2]: { phonet: Phonet.b, accidental: Accidental.flat },
	[-1]: { phonet: Phonet.f },
	[0]: { phonet: Phonet.c },
	[1]: { phonet: Phonet.g },
	[2]: { phonet: Phonet.d },
	[3]: { phonet: Phonet.a },
	[4]: { phonet: Phonet.e },
	[5]: { phonet: Phonet.b },
	[6]: { phonet: Phonet.f, accidental: Accidental.sharp },
};

const MINOR_KEY_BY_FIFTHS: Record<number, Spelling> = {
	[-6]: { phonet: Phonet.e, accidental: Accidental.flat },
	[-5]: { phonet: Phonet.b, accidental: Accidental.flat },
	[-4]: { phonet: Phonet.f },
	[-3]: { phonet: Phonet.c },
	[-2]: { phonet: Phonet.g },
	[-1]: { phonet: Phonet.d },
	[0]: { phonet: Phonet.a },
	[1]: { phonet: Phonet.e },
	[2]: { phonet: Phonet.b },
	[3]: { phonet: Phonet.f, accidental: Accidental.sharp },
	[4]: { phonet: Phonet.c, accidental: Accidental.sharp },
	[5]: { phonet: Phonet.g, accidental: Accidental.sharp },
	[6]: { phonet: Phonet.d, accidental: Accidental.sharp },
};

const DIATONIC_INDEX: Record<Phonet, number> = {
	[Phonet.c]: 0,
	[Phonet.d]: 1,
	[Phonet.e]: 2,
	[Phonet.f]: 3,
	[Phonet.g]: 4,
	[Phonet.a]: 5,
	[Phonet.b]: 6,
};

const NATURAL_MAJOR_FIFTHS: Record<Phonet, number> = {
	[Phonet.c]: 0, [Phonet.d]: 2, [Phonet.e]: 4, [Phonet.f]: -1,
	[Phonet.g]: 1, [Phonet.a]: 3, [Phonet.b]: 5,
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

const pitchClass = (pitch: Pitch): number =>
	PHONET_SEMITONE[pitch.phonet] + (pitch.accidental ? ACCIDENTAL_SEMITONE[pitch.accidental] : 0);

const keyDegreePitchClass = (key: KeySignature, degree: number): number => {
	const scale = key.mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
	return mod(keyPitchClass(key) + scale[degree], 12);
};

const signedAlteration = (actual: number, expected: number): number => {
	let alteration = mod(actual - expected + 6, 12) - 6;
	if (alteration === -6) alteration = 6;
	return alteration;
};

const accidentalFor = (alteration: number): Accidental | undefined => ({
	[-2]: Accidental.doubleFlat,
	[-1]: Accidental.flat,
	[0]: undefined,
	[1]: Accidental.sharp,
	[2]: Accidental.doubleSharp,
} as Record<number, Accidental | undefined>)[alteration];

const transposePitchInKey = (pitch: Pitch, sourceKey: KeySignature, targetKey: KeySignature, semitones: number): Pitch | undefined => {
	const sourceDegree = mod(DIATONIC_INDEX[pitch.phonet] - DIATONIC_INDEX[sourceKey.pitch], 7);
	const alteration = signedAlteration(pitchClass(pitch), keyDegreePitchClass(sourceKey, sourceDegree));
	const targetIndex = mod(DIATONIC_INDEX[targetKey.pitch] + sourceDegree, 7);
	const targetPhonet = (Object.keys(DIATONIC_INDEX) as Phonet[]).find(phonet => DIATONIC_INDEX[phonet] === targetIndex)!;
	const targetExpected = keyDegreePitchClass(targetKey, sourceDegree);
	const writtenAccidental = signedAlteration(targetExpected + alteration, PHONET_SEMITONE[targetPhonet]);
	const accidental = accidentalFor(writtenAccidental);
	if (accidental === undefined && writtenAccidental !== 0) return undefined;
	const targetAbsolute = pitch.octave * 12 + pitchClass(pitch) + semitones;
	const rawTargetClass = PHONET_SEMITONE[targetPhonet] + writtenAccidental;
	const octave = Math.floor((targetAbsolute - rawTargetClass) / 12);
	return {
		phonet: targetPhonet,
		...(accidental ? { accidental } : {}),
		octave,
		...(pitch.courtesy !== undefined ? { courtesy: pitch.courtesy } : {}),
	};
};

const spellingFor = (pitchClass: number, semitones: number): Spelling =>
	(semitones < 0 ? FLAT_SPELLINGS : SHARP_SPELLINGS)[mod(pitchClass, 12)];

const keyFifths = (key: KeySignature): number => {
	let fifths = NATURAL_MAJOR_FIFTHS[key.pitch];
	if (key.accidental === Accidental.sharp) fifths += 7;
	else if (key.accidental === Accidental.flat) fifths -= 7;
	if (key.mode === "minor") fifths -= 3;
	return fifths;
};

const spellingPitchClass = (spelling: Spelling): number =>
	mod(PHONET_SEMITONE[spelling.phonet] + (spelling.accidental ? ACCIDENTAL_SEMITONE[spelling.accidental] : 0), 12);

const keyPitchClass = (key: KeySignature): number =>
	spellingPitchClass({ phonet: key.pitch, accidental: key.accidental });

const normalizedKeyFor = (pitchClass: number, mode: KeySignature["mode"], semitones: number): KeySignature => {
	const candidates = Object.entries(mode === "minor" ? MINOR_KEY_BY_FIFTHS : MAJOR_KEY_BY_FIFTHS)
		.map(([fifths, spelling]) => ({ fifths: Number(fifths), spelling }))
		.filter(candidate => spellingPitchClass(candidate.spelling) === mod(pitchClass, 12));
	const preferred = candidates.find(candidate => semitones < 0 ? candidate.fifths < 0 : candidate.fifths >= 0)
		?? candidates[0];
	if (!preferred) throw new Error(`No normalized ${mode} key for pitch class ${mod(pitchClass, 12)}`);
	return {
		pitch: preferred.spelling.phonet,
		...(preferred.spelling.accidental ? { accidental: preferred.spelling.accidental } : {}),
		mode,
	};
};

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
	const sourceClass = keyPitchClass(key);
	const target = spellingFor(sourceClass + semitones, semitones);
	const directional: KeySignature = {
		pitch: target.phonet,
		...(target.accidental ? { accidental: target.accidental } : {}),
		mode: key.mode,
	};
	return Math.abs(keyFifths(directional)) <= 6
		? directional
		: normalizedKeyFor(sourceClass + semitones, key.mode, semitones);
};

const transposePitchWithKeys = (pitch: Pitch, sourceKey: KeySignature, targetKey: KeySignature, semitones: number): Pitch =>
	transposePitchInKey(pitch, sourceKey, targetKey, semitones) ?? transposePitch(pitch, semitones);

interface KeyState { source: KeySignature; target: KeySignature }

const transposeEvent = (event: Event, semitones: number, state: KeyState): Event => {
	switch (event.type) {
	case "note":
		return { ...event, pitches: event.pitches.map(pitch => transposePitchWithKeys(pitch, state.source, state.target, semitones)) };
	case "rest":
		return { ...event, ...(event.pitch ? { pitch: transposePitchWithKeys(event.pitch, state.source, state.target, semitones) } : {}) };
	case "context": {
		const context = event as ContextChange;
		if (context.key) {
			state.source = context.key;
			state.target = transposeKey(context.key, semitones);
		}
		return { ...context, ...(context.key ? { key: state.target } : {}) };
	}
	case "tremolo":
		return { ...event,
			pitchA: event.pitchA.map(p => transposePitchWithKeys(p, state.source, state.target, semitones)),
			pitchB: event.pitchB.map(p => transposePitchWithKeys(p, state.source, state.target, semitones)) };
	case "tuplet":
	case "times":
		return { ...event, events: event.events.map(inner => transposeEvent(inner as Event, semitones, state) as typeof inner) };
	default:
		return { ...event } as Event;
	}
};

const transposeVoice = (voice: Voice, semitones: number, measureKey: KeySignature): Voice => {
	const state: KeyState = { source: measureKey, target: transposeKey(measureKey, semitones) };
	return { ...voice, events: voice.events.map(event => transposeEvent(event, semitones, state)) };
};

const transposePart = (part: Part, semitones: number, measureKey: KeySignature): Part => ({
	...part,
	voices: part.voices.map(voice => transposeVoice(voice, semitones, measureKey)),
});

const transposeMeasure = (measure: Measure, semitones: number, inheritedKey: KeySignature): Measure => {
	const sourceKey = measure.key ?? inheritedKey;
	const targetKey = transposeKey(sourceKey, semitones);
	return {
		...measure,
		...(measure.key ? { key: targetKey } : {}),
		parts: measure.parts.map(part => transposePart(part, semitones, sourceKey)),
	};
};


/** Return a new Lilylet document with every AST pitch shifted chromatically. */
export const transposeDoc = (doc: LilyletDoc, semitones: number): LilyletDoc => {
	if (!Number.isFinite(semitones) || !Number.isInteger(semitones)) {
		throw new Error("transposeDoc semitones must be a finite integer");
	}
	return {
		...doc,
		measures: doc.measures.map(measure => transposeMeasure(measure, semitones, { pitch: Phonet.c, mode: "major" })),
	};
};
