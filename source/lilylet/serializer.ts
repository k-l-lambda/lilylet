/**
 * Lilylet Document Serializer
 *
 * Converts LilyletDoc to Lilylet (.lyl) string format.
 * Uses relative pitch mode matching the parser's behavior.
 */

import {
	LilyletDoc,
	Measure,
	Part,
	Voice,
	Event,
	NoteEvent,
	RestEvent,
	ContextChange,
	TupletEvent,
	TremoloEvent,
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Clef,
	StemDirection,
	Accidental,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	Tempo,
	Placement,
} from "./types";


const PHONETS = "cdefgab";


// Pitch environment for relative pitch serialization
interface PitchEnv {
	step: number;  // 0-6 for c-b
	octave: number; // absolute octave (0 = middle C octave)
}


/**
 * Calculate the octave markers needed to serialize a pitch in relative mode.
 *
 * The parser logic:
 * - Calculate interval from previous pitch
 * - If |interval| > 3, adjust octave (go the "short way")
 * - Add explicit ' and , markers from the pitch
 *
 * We need to reverse this: given the target absolute octave,
 * calculate what markers are needed.
 */
const getRelativeOctaveMarkers = (env: PitchEnv, pitch: Pitch): { markers: string; newEnv: PitchEnv } => {
	const step = PHONETS.indexOf(pitch.phonet as string);
	if (step === -1) {
		return { markers: '', newEnv: env };
	}

	const interval = step - env.step;

	// Parser's octave adjustment calculation
	const octInc = Math.floor(Math.abs(interval) / 4) * -Math.sign(interval);

	// Without any markers, parser would calculate:
	// env.octave + 0 (marker) + octInc = base octave
	const baseOctave = env.octave + octInc;

	// We need markers to reach pitch.octave from baseOctave
	const markerCount = pitch.octave - baseOctave;

	let markers = '';
	if (markerCount > 0) {
		markers = "'".repeat(markerCount);
	} else if (markerCount < 0) {
		markers = ",".repeat(-markerCount);
	}

	// Update environment (mirrors parser behavior)
	const newEnv: PitchEnv = {
		step: step,
		octave: pitch.octave
	};

	return { markers, newEnv };
};


// Accidental to Lilylet notation
const ACCIDENTAL_MAP: Record<string, string> = {
	natural: '!',
	sharp: 's',
	flat: 'f',
	doubleSharp: 'ss',
	doubleFlat: 'ff',
};


// Clef to Lilylet notation
const CLEF_MAP: Record<string, string> = {
	treble: 'G',
	bass: 'F',
	alto: 'C',
};


// Articulation to Lilylet notation
const ARTICULATION_MAP: Record<string, string> = {
	staccato: '.',
	staccatissimo: '!',
	tenuto: '_',
	marcato: '^',
	accent: '>',
	portato: '_.',
};


// Ornament to Lilylet notation
const ORNAMENT_MAP: Record<string, string> = {
	trill: '\\trill',
	turn: '\\turn',
	mordent: '\\mordent',
	prall: '\\prall',
	fermata: '\\fermata',
	shortFermata: '\\shortfermata',
	arpeggio: '\\arpeggio',
};


// Dynamic to Lilylet notation
const DYNAMIC_MAP: Record<string, string> = {
	ppp: '\\ppp',
	pp: '\\pp',
	p: '\\p',
	mp: '\\mp',
	mf: '\\mf',
	f: '\\f',
	ff: '\\ff',
	fff: '\\fff',
	sfz: '\\sfz',
	rfz: '\\rfz',
};


// Hairpin to Lilylet notation
const HAIRPIN_MAP: Record<string, string> = {
	crescendoStart: '\\<',
	crescendoEnd: '\\!',
	diminuendoStart: '\\>',
	diminuendoEnd: '\\!',
};


// Pedal to Lilylet notation
const PEDAL_MAP: Record<string, string> = {
	sustainOn: '\\sustainOn',
	sustainOff: '\\sustainOff',
	sostenutoOn: '\\sostenutoOn',
	sostenutoOff: '\\sostenutoOff',
	unaCordaOn: '\\unaCorda',
	unaCordaOff: '\\treCorde',
};


// Serialize a pitch to Lilylet notation (absolute mode - for contexts like key signature)
const serializePitchAbsolute = (pitch: Pitch): string => {
	let result = String(pitch.phonet);

	// Add accidental
	if (pitch.accidental) {
		result += ACCIDENTAL_MAP[pitch.accidental] || '';
	}

	// Add octave markers
	if (pitch.octave > 0) {
		result += "'".repeat(pitch.octave);
	} else if (pitch.octave < 0) {
		result += ",".repeat(-pitch.octave);
	}

	return result;
};


// Serialize a pitch in relative mode
const serializePitchRelative = (pitch: Pitch, env: PitchEnv): { str: string; newEnv: PitchEnv } => {
	let result = String(pitch.phonet);

	// Add accidental
	if (pitch.accidental) {
		result += ACCIDENTAL_MAP[pitch.accidental] || '';
	}

	// Calculate relative octave markers
	const { markers, newEnv } = getRelativeOctaveMarkers(env, pitch);
	result += markers;

	return { str: result, newEnv };
};


// Serialize duration to Lilylet notation
const serializeDuration = (duration: Duration): string => {
	let result = duration.division.toString();

	// Add dots
	if (duration.dots > 0) {
		result += '.'.repeat(duration.dots);
	}

	return result;
};


// Serialize marks (articulations, ornaments, dynamics, etc.)
const serializeMarks = (marks: Mark[]): string => {
	const parts: string[] = [];

	for (const mark of marks) {
		// Check for markType (tie, slur, beam)
		if ('markType' in mark) {
			if (mark.markType === 'tie' && mark.start) {
				parts.push('~');
			} else if (mark.markType === 'slur') {
				parts.push(mark.start ? '(' : ')');
			} else if (mark.markType === 'beam') {
				parts.push(mark.start ? '[' : ']');
			}
			continue;
		}

		// Check for type field
		if ('type' in mark) {
			const type = mark.type as string;

			// Articulation
			if (ARTICULATION_MAP[type]) {
				const placement = (mark as any).placement;
				const prefix = placement === 'above' ? '^' : placement === 'below' ? '_' : '-';
				parts.push(prefix + ARTICULATION_MAP[type]);
			}
			// Ornament
			else if (ORNAMENT_MAP[type]) {
				parts.push(ORNAMENT_MAP[type]);
			}
			// Dynamic
			else if (DYNAMIC_MAP[type]) {
				parts.push(DYNAMIC_MAP[type]);
			}
			// Hairpin
			else if (HAIRPIN_MAP[type]) {
				parts.push(HAIRPIN_MAP[type]);
			}
			// Pedal
			else if (PEDAL_MAP[type]) {
				parts.push(PEDAL_MAP[type]);
			}
		}
	}

	return parts.join('');
};


// Serialize a note event with pitch environment tracking
const serializeNoteEvent = (
	event: NoteEvent,
	env: PitchEnv,
	prevDuration?: Duration
): { str: string; newEnv: PitchEnv } => {
	const parts: string[] = [];
	let currentEnv = env;

	// Grace note prefix
	if (event.grace) {
		parts.push('\\grace ');
	}

	// Single note or chord
	if (event.pitches.length === 1) {
		const { str, newEnv } = serializePitchRelative(event.pitches[0], currentEnv);
		parts.push(str);
		currentEnv = newEnv;
	} else if (event.pitches.length > 1) {
		// Chord: <c e g>
		// First pitch is relative to previous note, subsequent pitches relative to each other
		const pitchStrs: string[] = [];
		const { str: firstStr, newEnv: firstEnv } = serializePitchRelative(event.pitches[0], currentEnv);
		pitchStrs.push(firstStr);
		currentEnv = firstEnv;

		// Chord pitches are relative to each other within the chord
		let chordEnv = { ...currentEnv };
		for (let i = 1; i < event.pitches.length; i++) {
			const { str, newEnv } = serializePitchRelative(event.pitches[i], chordEnv);
			pitchStrs.push(str);
			chordEnv = newEnv;
		}

		parts.push('<' + pitchStrs.join(' ') + '>');
	}

	// Duration (only if different from previous or first note)
	const durStr = serializeDuration(event.duration);
	if (!prevDuration ||
		prevDuration.division !== event.duration.division ||
		prevDuration.dots !== event.duration.dots) {
		parts.push(durStr);
	}

	// Tremolo
	if (event.tremolo) {
		parts.push(':' + event.tremolo);
	}

	// Marks
	if (event.marks && event.marks.length > 0) {
		parts.push(serializeMarks(event.marks));
	}

	return { str: parts.join(''), newEnv: currentEnv };
};


// Serialize a rest event with pitch environment tracking
const serializeRestEvent = (
	event: RestEvent,
	env: PitchEnv,
	prevDuration?: Duration
): { str: string; newEnv: PitchEnv } => {
	const parts: string[] = [];
	let currentEnv = env;
	let isPitchedRest = false;

	// Full measure rest
	if (event.fullMeasure) {
		parts.push('R');
	}
	// Space rest (invisible)
	else if (event.invisible) {
		parts.push('s');
	}
	// Positioned rest: pitch + duration + \rest
	else if (event.pitch) {
		const { str, newEnv } = serializePitchRelative(event.pitch, currentEnv);
		parts.push(str);
		currentEnv = newEnv;
		isPitchedRest = true;
	} else {
		parts.push('r');
	}

	// Duration
	const durStr = serializeDuration(event.duration);
	if (!prevDuration ||
		prevDuration.division !== event.duration.division ||
		prevDuration.dots !== event.duration.dots) {
		parts.push(durStr);
	}

	// \rest mark comes after duration for positioned rests
	if (isPitchedRest) {
		parts.push('\\rest');
	}

	return { str: parts.join(''), newEnv: currentEnv };
};


// Serialize a context change
const serializeContextChange = (event: ContextChange): string => {
	const parts: string[] = [];

	// Clef
	if (event.clef) {
		parts.push('\\clef "' + CLEF_MAP[event.clef] + '"');
	}

	// Key signature
	if (event.key) {
		let keyStr = String(event.key.pitch);
		if (event.key.accidental) {
			keyStr += ACCIDENTAL_MAP[event.key.accidental] || '';
		}
		keyStr += ' \\' + event.key.mode;
		parts.push('\\key ' + keyStr);
	}

	// Time signature
	if (event.time) {
		parts.push('\\time ' + event.time.numerator + '/' + event.time.denominator);
	}

	// Ottava
	if (event.ottava !== undefined) {
		if (event.ottava === 0) {
			parts.push('\\ottava #0');
		} else {
			parts.push('\\ottava #' + event.ottava);
		}
	}

	// Stem direction
	if (event.stemDirection) {
		if (event.stemDirection === StemDirection.up) {
			parts.push('\\stemUp');
		} else if (event.stemDirection === StemDirection.down) {
			parts.push('\\stemDown');
		} else if (event.stemDirection === StemDirection.auto) {
			parts.push('\\stemNeutral');
		}
	}

	// Tempo
	if (event.tempo) {
		parts.push(serializeTempo(event.tempo));
	}

	return parts.join(' ');
};


// Serialize tempo
const serializeTempo = (tempo: Tempo): string => {
	const parts: string[] = ['\\tempo'];

	if (tempo.text) {
		parts.push('"' + tempo.text + '"');
	}

	if (tempo.beat && tempo.bpm) {
		parts.push(tempo.beat.division + '=' + tempo.bpm);
	}

	return parts.join(' ');
};


// Serialize a tuplet event with pitch environment tracking
const serializeTupletEvent = (
	event: TupletEvent,
	env: PitchEnv
): { str: string; newEnv: PitchEnv } => {
	const parts: string[] = [];
	let currentEnv = env;

	// \times numerator/denominator { ... }
	parts.push('\\times ' + event.ratio.numerator + '/' + event.ratio.denominator + ' {');

	let prevDuration: Duration | undefined;
	for (const e of event.events) {
		if (e.type === 'note') {
			const { str, newEnv } = serializeNoteEvent(e as NoteEvent, currentEnv, prevDuration);
			parts.push(' ' + str);
			currentEnv = newEnv;
			prevDuration = (e as NoteEvent).duration;
		} else if (e.type === 'rest') {
			const { str, newEnv } = serializeRestEvent(e as RestEvent, currentEnv, prevDuration);
			parts.push(' ' + str);
			currentEnv = newEnv;
			prevDuration = (e as RestEvent).duration;
		}
	}

	parts.push(' }');
	return { str: parts.join(''), newEnv: currentEnv };
};


// Serialize a tremolo event with pitch environment tracking
const serializeTremoloEvent = (
	event: TremoloEvent,
	env: PitchEnv
): { str: string; newEnv: PitchEnv } => {
	const parts: string[] = [];
	let currentEnv = env;

	// \repeat tremolo count { noteA noteB }
	parts.push('\\repeat tremolo ' + event.count + ' {');

	// First pitch/chord
	if (event.pitchA.length === 1) {
		const { str, newEnv } = serializePitchRelative(event.pitchA[0], currentEnv);
		parts.push(' ' + str + event.division);
		currentEnv = newEnv;
	} else {
		const pitchStrs: string[] = [];
		const { str: firstStr, newEnv: firstEnv } = serializePitchRelative(event.pitchA[0], currentEnv);
		pitchStrs.push(firstStr);
		currentEnv = firstEnv;
		let chordEnv = { ...currentEnv };
		for (let i = 1; i < event.pitchA.length; i++) {
			const { str, newEnv } = serializePitchRelative(event.pitchA[i], chordEnv);
			pitchStrs.push(str);
			chordEnv = newEnv;
		}
		parts.push(' <' + pitchStrs.join(' ') + '>' + event.division);
	}

	// Second pitch/chord
	if (event.pitchB.length === 1) {
		const { str, newEnv } = serializePitchRelative(event.pitchB[0], currentEnv);
		parts.push(' ' + str + event.division);
		currentEnv = newEnv;
	} else {
		const pitchStrs: string[] = [];
		const { str: firstStr, newEnv: firstEnv } = serializePitchRelative(event.pitchB[0], currentEnv);
		pitchStrs.push(firstStr);
		currentEnv = firstEnv;
		let chordEnv = { ...currentEnv };
		for (let i = 1; i < event.pitchB.length; i++) {
			const { str, newEnv } = serializePitchRelative(event.pitchB[i], chordEnv);
			pitchStrs.push(str);
			chordEnv = newEnv;
		}
		parts.push(' <' + pitchStrs.join(' ') + '>' + event.division);
	}

	parts.push(' }');
	return { str: parts.join(''), newEnv: currentEnv };
};


// Serialize a single event with pitch environment tracking
const serializeEvent = (
	event: Event,
	env: PitchEnv,
	prevDuration?: Duration
): { str: string; newEnv: PitchEnv } => {
	switch (event.type) {
		case 'note':
			return serializeNoteEvent(event as NoteEvent, env, prevDuration);
		case 'rest':
			return serializeRestEvent(event as RestEvent, env, prevDuration);
		case 'context':
			return { str: serializeContextChange(event as ContextChange), newEnv: env };
		case 'tuplet':
			return serializeTupletEvent(event as TupletEvent, env);
		case 'tremolo':
			return serializeTremoloEvent(event as TremoloEvent, env);
		default:
			return { str: '', newEnv: env };
	}
};


// Serialize a voice with pitch environment tracking
const serializeVoice = (voice: Voice): string => {
	const parts: string[] = [];
	let prevDuration: Duration | undefined;
	// Each voice starts fresh from middle C (step=0, octave=0)
	let pitchEnv: PitchEnv = { step: 0, octave: 0 };

	// Staff indicator if not staff 1
	if (voice.staff > 1) {
		parts.push('\\staff "' + voice.staff + '" ');
	}

	for (const event of voice.events) {
		const { str: eventStr, newEnv } = serializeEvent(event, pitchEnv, prevDuration);
		pitchEnv = newEnv;

		if (eventStr) {
			parts.push(eventStr);
		}

		// Track duration for note/rest events
		if (event.type === 'note') {
			prevDuration = (event as NoteEvent).duration;
		} else if (event.type === 'rest') {
			prevDuration = (event as RestEvent).duration;
		}
	}

	return parts.join(' ');
};


// Serialize a part
const serializePart = (part: Part): string => {
	if (part.voices.length === 0) {
		return '';
	}

	if (part.voices.length === 1) {
		return serializeVoice(part.voices[0]);
	}

	// Multiple voices: separated by \\ with newline
	return part.voices.map(serializeVoice).join(' \\\\\n');
};


// Serialize a measure
const serializeMeasure = (measure: Measure, isFirst: boolean): string => {
	const parts: string[] = [];

	// Key signature (usually only on first measure or when changed)
	if (measure.key && isFirst) {
		let keyStr = String(measure.key.pitch);
		if (measure.key.accidental) {
			keyStr += ACCIDENTAL_MAP[measure.key.accidental] || '';
		}
		keyStr += ' \\' + measure.key.mode;
		parts.push('\\key ' + keyStr);
	}

	// Time signature (usually only on first measure or when changed)
	if (measure.timeSig && isFirst) {
		parts.push('\\time ' + measure.timeSig.numerator + '/' + measure.timeSig.denominator);
	}

	// Parts
	if (measure.parts.length === 1) {
		const partStr = serializePart(measure.parts[0]);
		if (partStr) {
			parts.push(partStr);
		}
	} else if (measure.parts.length > 1) {
		// Multiple parts: separated by \\\ with newline
		const partStrs = measure.parts.map(serializePart).filter(s => s);
		parts.push(partStrs.join(' \\\\\\\\\n'));
	}

	return parts.join(' ');
};


// Serialize metadata
const serializeMetadata = (metadata: any): string => {
	const lines: string[] = [];

	if (metadata.title) {
		lines.push('\\title "' + metadata.title + '"');
	}
	if (metadata.subtitle) {
		lines.push('\\subtitle "' + metadata.subtitle + '"');
	}
	if (metadata.composer) {
		lines.push('\\composer "' + metadata.composer + '"');
	}
	if (metadata.arranger) {
		lines.push('\\arranger "' + metadata.arranger + '"');
	}
	if (metadata.lyricist) {
		lines.push('\\lyricist "' + metadata.lyricist + '"');
	}

	return lines.join('\n');
};


/**
 * Serialize a LilyletDoc to Lilylet (.lyl) string format
 */
export const serializeLilyletDoc = (doc: LilyletDoc): string => {
	const parts: string[] = [];

	// Metadata
	if (doc.metadata) {
		const metaStr = serializeMetadata(doc.metadata);
		if (metaStr) {
			parts.push(metaStr);
			parts.push('');
		}
	}

	// Measures with bar lines, measure numbers, and double newlines
	const measureStrs: string[] = [];
	for (let i = 0; i < doc.measures.length; i++) {
		const measureStr = serializeMeasure(doc.measures[i], i === 0);
		if (measureStr) {
			measureStrs.push(measureStr);
		}
	}

	// Join measures with bar, measure number comment, and double newline
	const measuresOutput = measureStrs
		.map((m, i) => m + ' | %' + (i + 1))
		.join('\n\n');
	parts.push(measuresOutput);

	return parts.join('\n');
};
