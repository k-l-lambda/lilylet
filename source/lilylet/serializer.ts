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
	BarlineEvent,
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
	Metadata,
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
	treble: 'treble',
	bass: 'bass',
	alto: 'alto',
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
	fp: '\\fp',
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
		switch (mark.markType) {
			case 'tie':
				if (mark.start) parts.push('~');
				break;
			case 'slur':
				parts.push(mark.start ? '(' : ')');
				break;
			case 'beam':
				parts.push(mark.start ? '[' : ']');
				break;
			case 'articulation': {
				const artStr = ARTICULATION_MAP[mark.type];
				if (artStr) {
					const prefix = mark.placement === 'above' ? '^' : mark.placement === 'below' ? '_' : '-';
					parts.push(prefix + artStr);
				}
				break;
			}
			case 'ornament': {
				const ornStr = ORNAMENT_MAP[mark.type];
				if (ornStr) parts.push(ornStr);
				break;
			}
			case 'dynamic': {
				const dynStr = DYNAMIC_MAP[mark.type];
				if (dynStr) parts.push(dynStr);
				break;
			}
			case 'hairpin': {
				const hairpinStr = HAIRPIN_MAP[mark.type];
				if (hairpinStr) parts.push(hairpinStr);
				break;
			}
			case 'pedal': {
				const pedalStr = PEDAL_MAP[mark.type];
				if (pedalStr) parts.push(pedalStr);
				break;
			}
			case 'fingering':
				parts.push('-' + mark.finger);
				break;
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


// Serialize a barline event
const serializeBarlineEvent = (event: BarlineEvent): string => {
	// Only output non-default barlines
	if (event.style && event.style !== '|') {
		return '\\bar "' + event.style + '"';
	}
	return '';
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
		case 'barline':
			return { str: serializeBarlineEvent(event as BarlineEvent), newEnv: env };
		default:
			return { str: '', newEnv: env };
	}
};


// Key/time/clef signature info to inject into voices
interface MeasureContext {
	key?: KeySignature;
	time?: { numerator: number; denominator: number; symbol?: 'common' | 'cut' };
	clef?: Clef;
}

// Find first clef in voice events
const findVoiceClef = (voice: Voice): Clef | undefined => {
	for (const event of voice.events) {
		if (event.type === 'context') {
			const ctx = event as ContextChange;
			if (ctx.clef) {
				return ctx.clef;
			}
		}
	}
	return undefined;
};

// Serialize a voice with pitch environment tracking
// Takes currentStaff (what parser thinks staff is) and returns { str, newStaff }
// If isGrandStaff is true, always output \staff command for clarity
// measureContext provides key/time for first voice
// allStaffClefs is the clef map for all staves (tracked across measures)
// emittedClefs tracks which clefs have already been output (avoids duplicates)
const serializeVoice = (
	voice: Voice,
	currentStaff: number,
	isGrandStaff: boolean = false,
	measureContext?: MeasureContext,
	isFirstVoice: boolean = false,
	allStaffClefs?: Record<number, Clef>,
	emittedClefs?: Record<number, Clef>
): { str: string; newStaff: number } => {
	const parts: string[] = [];
	let prevDuration: Duration | undefined;
	// Each voice starts fresh from middle C (step=0, octave=0)
	let pitchEnv: PitchEnv = { step: 0, octave: 0 };

	// Output staff command if voice staff differs from current parser staff,
	// or always output if it's a grand staff score for clarity
	if (isGrandStaff || voice.staff !== currentStaff) {
		parts.push('\\staff "' + voice.staff + '"');
	}

	// Output key/time signatures after \staff (for first voice only)
	if (measureContext && isFirstVoice) {
		if (measureContext.key) {
			let keyStr = String(measureContext.key.pitch);
			if (measureContext.key.accidental) {
				keyStr += ACCIDENTAL_MAP[measureContext.key.accidental] || '';
			}
			keyStr += ' \\' + measureContext.key.mode;
			parts.push('\\key ' + keyStr);
		}
		if (measureContext.time) {
			const { numerator, denominator, symbol } = measureContext.time;
			// Output \numericTimeSignature before 4/4 or 2/2 if no symbol is set
			// (meaning numeric display was explicitly requested)
			if (!symbol && ((numerator === 4 && denominator === 4) || (numerator === 2 && denominator === 2))) {
				parts.push('\\numericTimeSignature');
			}
			parts.push('\\time ' + numerator + '/' + denominator);
		}
	}

	// Output clef only if not yet emitted or changed for this staff
	const voiceClef = allStaffClefs?.[voice.staff] || findVoiceClef(voice);
	const clefAlreadyEmitted = voiceClef && emittedClefs?.[voice.staff] === voiceClef;
	if (voiceClef && !clefAlreadyEmitted) {
		parts.push('\\clef "' + CLEF_MAP[voiceClef] + '"');
		if (emittedClefs) emittedClefs[voice.staff] = voiceClef;
	}
	// Skip redundant clef context events if this staff's clef is already established
	const clefOutputted = !!voiceClef && !!emittedClefs?.[voice.staff];

	let activeStaff = voice.staff;
	let activeStemDir: StemDirection | undefined;

	for (const event of voice.events) {
		if (event.type === 'context') {
			const ctx = event as ContextChange;
			// Skip context events that belong to a different staff (cross-staff clef/ottava)
			if (ctx.staff && ctx.staff !== voice.staff) {
				continue;
			}
			// Skip clef-only context events if clef already established for this staff
			if (clefOutputted && ctx.clef && !ctx.key && !ctx.time && !ctx.ottava && !ctx.stemDirection && !ctx.tempo) {
				continue;
			}
		}

		if (event.type === 'note') {
			const noteEvt = event as NoteEvent;

			// Cross-staff: emit \staff when note's effective staff differs from active
			const effectiveStaff = noteEvt.staff || voice.staff;
			if (effectiveStaff !== activeStaff) {
				activeStaff = effectiveStaff;
				parts.push('\\staff "' + activeStaff + '"');
				// Emit the target staff's clef if it differs from what was last emitted for this staff
				const targetClef = allStaffClefs?.[activeStaff];
				if (targetClef && emittedClefs?.[activeStaff] !== targetClef) {
					parts.push('\\clef "' + CLEF_MAP[targetClef] + '"');
					if (emittedClefs) emittedClefs[activeStaff] = targetClef;
				}
			}

			// Stem direction: emit \stemUp/\stemDown/\stemNeutral on change
			const stemDir = noteEvt.stemDirection;
			if (stemDir !== activeStemDir) {
				if (stemDir === StemDirection.up) {
					parts.push('\\stemUp');
				} else if (stemDir === StemDirection.down) {
					parts.push('\\stemDown');
				} else if (activeStemDir) {
					// Was set, now undefined → reset to neutral
					parts.push('\\stemNeutral');
				}
				activeStemDir = stemDir;
			}
		}

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
		} else if (event.type === 'context' && (event as ContextChange).clef && emittedClefs) {
			const ctx = event as ContextChange;
			emittedClefs[ctx.staff || activeStaff] = ctx.clef!;
		}
	}

	return { str: parts.join(' '), newStaff: voice.staff };
};


// Serialize a part, tracking staff state across voices
// measureContext is passed to all voices (for clef), but key/time only to first voice
const serializePart = (
	part: Part,
	currentStaff: number,
	isGrandStaff: boolean = false,
	measureContext?: MeasureContext,
	isFirstPart: boolean = false,
	clefsByStaff?: Record<number, Clef>,
	emittedClefs?: Record<number, Clef>
): { str: string; newStaff: number } => {
	if (part.voices.length === 0) {
		return { str: '', newStaff: currentStaff };
	}

	const voiceStrs: string[] = [];
	let staff = currentStaff;

	for (let i = 0; i < part.voices.length; i++) {
		const voice = part.voices[i];
		// Pass measureContext to all voices, isFirstVoice for key/time
		const isFirstVoice = isFirstPart && i === 0;
		const { str, newStaff } = serializeVoice(voice, staff, isGrandStaff, measureContext, isFirstVoice, clefsByStaff, emittedClefs);
		voiceStrs.push(str);
		staff = newStaff;
	}

	// Multiple voices: separated by \\ with newline
	return { str: voiceStrs.join(' \\\\\n'), newStaff: staff };
};


// Serialize a measure, tracking staff state across parts
// Always output key/time at start of each measure
const serializeMeasure = (
	measure: Measure,
	_isFirst: boolean,
	currentStaff: number,
	isGrandStaff: boolean = false,
	currentKey?: KeySignature,
	currentTime?: { numerator: number; denominator: number; symbol?: 'common' | 'cut' },
	staffClefs?: Record<number, Clef>,
	emittedClefs?: Record<number, Clef>
): { str: string; newStaff: number } => {
	const parts: string[] = [];

	// Build measure context for all voices (key/time)
	// Key and time are written to first voice, clef to all voices based on staff
	// Use passed currentKey/currentTime which tracks across all measures
	const measureContext: MeasureContext = {
		key: currentKey,
		time: currentTime,
	};

	// Pass staffClefs to parts for per-voice clef lookup
	const clefsByStaff = staffClefs || {};

	// Parts
	let staff = currentStaff;
	if (measure.parts.length === 1) {
		const { str: partStr, newStaff } = serializePart(measure.parts[0], staff, isGrandStaff, measureContext, true, clefsByStaff, emittedClefs);
		if (partStr) {
			parts.push(partStr);
		}
		staff = newStaff;
	} else if (measure.parts.length > 1) {
		// Multiple parts: separated by \\\ with newline
		const partStrs: string[] = [];
		for (let i = 0; i < measure.parts.length; i++) {
			const part = measure.parts[i];
			// Pass measureContext to all parts, isFirstPart to first part only
			const { str, newStaff } = serializePart(part, staff, isGrandStaff, measureContext, i === 0, clefsByStaff, emittedClefs);
			if (str) {
				partStrs.push(str);
			}
			staff = newStaff;
		}
		parts.push(partStrs.join(' \\\\\\\\\n'));
	}

	return { str: parts.join(' '), newStaff: staff };
};


// Escape string for serialization (quotes and backslashes)
const escapeString = (str: string): string => {
	return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

// Serialize metadata
const serializeMetadata = (metadata: Metadata): string => {
	const lines: string[] = [];

	if (metadata.title) {
		lines.push('[title "' + escapeString(metadata.title) + '"]');
	}
	if (metadata.subtitle) {
		lines.push('[subtitle "' + escapeString(metadata.subtitle) + '"]');
	}
	if (metadata.composer) {
		lines.push('[composer "' + escapeString(metadata.composer) + '"]');
	}
	if (metadata.arranger) {
		lines.push('[arranger "' + escapeString(metadata.arranger) + '"]');
	}
	if (metadata.lyricist) {
		lines.push('[lyricist "' + escapeString(metadata.lyricist) + '"]');
	}
	if (metadata.autoBeam) {
		lines.push('[auto-beam "' + escapeString(metadata.autoBeam) + '"]');
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

	// Detect grand staff: check if any voice has staff > 1
	const isGrandStaff = doc.measures.some(m =>
		m.parts.some(p =>
			p.voices.some(v => v.staff > 1)
		)
	);

	// Measures with bar lines, measure numbers, and double newlines
	// Track staff state across measures (parser remembers staff across bar lines)
	// Track key/time/clef across measures to output in every measure
	const measureStrs: string[] = [];
	let currentStaff = 1; // Parser starts at staff 1
	let currentKey: KeySignature | undefined;
	let currentTime: { numerator: number; denominator: number; symbol?: 'common' | 'cut' } | undefined;
	const staffClefs: Record<number, Clef> = {}; // Track clef per staff
	const emittedClefs: Record<number, Clef> = {}; // Track which clefs have been output

	for (let i = 0; i < doc.measures.length; i++) {
		const measure = doc.measures[i];
		// Update current key/time if measure has them
		if (measure.key) {
			currentKey = measure.key;
		}
		if (measure.timeSig) {
			currentTime = measure.timeSig;
		}

		// Collect clefs from this measure's voices
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				for (const event of voice.events) {
					if (event.type === 'context' && (event as ContextChange).clef) {
						const ctx = event as ContextChange;
						// Use the event's staff if specified (cross-staff), otherwise the voice's staff
						const clefStaff = ctx.staff || voice.staff;
						staffClefs[clefStaff] = ctx.clef!;
					}
				}
			}
		}

		const { str: measureStr, newStaff } = serializeMeasure(measure, i === 0, currentStaff, isGrandStaff, currentKey, currentTime, staffClefs, emittedClefs);
		// Always include measure, even if empty (use space rest for empty measures)
		measureStrs.push(measureStr || 's1');
		currentStaff = newStaff;
	}

	// Join measures with bar, measure number comment, and double newline
	const measuresOutput = measureStrs
		.map((m, i) => m + ' | %' + (i + 1))
		.join('\n\n');
	parts.push(measuresOutput);

	return parts.join('\n');
};
