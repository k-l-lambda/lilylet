/**
 * Lilylet to LilyPond Encoder
 *
 * Converts LilyletDoc to LilyPond (.ly) format.
 * Uses relative pitch mode matching LilyPond's default behavior.
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
	HarmonyEvent,
	MarkupEvent,
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Clef,
	StemDirection,
	Accidental,
	Phonet,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	Tempo,
	Metadata,
	Placement,
} from "./types";


// === Constants and Mappings ===

const PHONETS = "cdefgab";

// Key signature to LilyPond notation (using English note names)
const KEY_MAP: Record<string, Record<string, string>> = {
	c: { major: "c \\major", minor: "c \\minor" },
	d: { major: "d \\major", minor: "d \\minor" },
	e: { major: "e \\major", minor: "e \\minor" },
	f: { major: "f \\major", minor: "f \\minor" },
	g: { major: "g \\major", minor: "g \\minor" },
	a: { major: "a \\major", minor: "a \\minor" },
	b: { major: "b \\major", minor: "b \\minor" },
};

// Accidentals for key signatures
const KEY_ACCIDENTAL_MAP: Record<string, string> = {
	sharp: "s",
	flat: "f",
	doubleSharp: "ss",
	doubleFlat: "ff",
};

// Clef names
const CLEF_MAP: Record<string, string> = {
	treble: "treble",
	bass: "bass",
	alto: "alto",
};

// Accidental to LilyPond notation
const ACCIDENTAL_MAP: Record<string, string> = {
	natural: "!",
	sharp: "s",
	flat: "f",
	doubleSharp: "ss",
	doubleFlat: "ff",
};

// Articulation to LilyPond notation
const ARTICULATION_MAP: Record<string, string> = {
	staccato: "-.",
	staccatissimo: "-!",
	tenuto: "--",
	marcato: "-^",
	accent: "->",
	portato: "-_",
};

// Ornament to LilyPond notation
const ORNAMENT_MAP: Record<string, string> = {
	trill: "\\trill",
	turn: "\\turn",
	mordent: "\\mordent",
	prall: "\\prall",
	fermata: "\\fermata",
	shortFermata: "\\shortfermata",
	arpeggio: "\\arpeggio",
};

// Dynamic to LilyPond notation
const DYNAMIC_MAP: Record<string, string> = {
	ppp: "\\ppp",
	pp: "\\pp",
	p: "\\p",
	mp: "\\mp",
	mf: "\\mf",
	f: "\\f",
	ff: "\\ff",
	fff: "\\fff",
	sfz: "\\sfz",
	rfz: "\\rfz",
};

// Hairpin to LilyPond notation
const HAIRPIN_MAP: Record<string, string> = {
	crescendoStart: "\\<",
	crescendoEnd: "\\!",
	diminuendoStart: "\\>",
	diminuendoEnd: "\\!",
};

// Pedal to LilyPond notation
const PEDAL_MAP: Record<string, string> = {
	sustainOn: "\\sustainOn",
	sustainOff: "\\sustainOff",
	sostenutoOn: "\\sostenutoOn",
	sostenutoOff: "\\sostenutoOff",
	unaCordaOn: "\\unaCorda",
	unaCordaOff: "\\treCorde",
};

// Stem direction
const STEM_MAP: Record<string, string> = {
	up: "\\stemUp",
	down: "\\stemDown",
	auto: "\\stemNeutral",
};

// Barline styles
const BARLINE_MAP: Record<string, string> = {
	"|": "|",
	"||": "||",
	"|.": "|.",
	".|:": ".|:",
	":|.": ":|.",
	":..:": ":..:",
	":..:|": ":..:|",
};


// === Helper Functions ===

/**
 * Generate a spacer rest that fills a measure based on time signature.
 * Uses multiplication syntax: s{denominator}*{numerator}
 * @param timeSig - Time signature { numerator, denominator }
 * @returns LilyPond spacer rest string (e.g., "s4*3" for 3/4, "s8*6" for 6/8)
 */
const getSpacerRest = (timeSig?: { numerator: number; denominator: number }): string => {
	if (!timeSig) return 's1';
	const { numerator, denominator } = timeSig;
	return `s${denominator}*${numerator}`;
};


// === Pitch Environment for Relative Mode ===

interface PitchEnv {
	step: number;  // 0-6 for c-b
	octave: number; // absolute octave (0 = middle C octave)
}


/**
 * Calculate the octave markers needed to serialize a pitch in relative mode.
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
	const baseOctave = env.octave + octInc;

	// We need markers to reach pitch.octave from baseOctave
	const markerCount = pitch.octave - baseOctave;

	let markers = '';
	if (markerCount > 0) {
		markers = "'".repeat(markerCount);
	} else if (markerCount < 0) {
		markers = ",".repeat(-markerCount);
	}

	// Update environment
	const newEnv: PitchEnv = {
		step: step,
		octave: pitch.octave
	};

	return { markers, newEnv };
};


// === Render Options ===

interface RenderOptions {
	paper?: {
		width?: number | string;
		height?: number | string;
	};
	fontSize?: number;
	withMIDI?: boolean;
	autoBeaming?: boolean;
}

const DEFAULT_OPTIONS: RenderOptions = {
	paper: { width: 210, height: 297 },  // A4 size in mm
	fontSize: 20,
	withMIDI: false,
	autoBeaming: false,
};


// === Encoding Functions ===

/**
 * Encode key signature to LilyPond
 */
const encodeKey = (key: KeySignature): string => {
	let keyStr: string = key.pitch as string;
	if (key.accidental) {
		keyStr += KEY_ACCIDENTAL_MAP[key.accidental] || '';
	}
	return `\\key ${keyStr} \\${key.mode}`;
};


/**
 * Encode time signature to LilyPond
 */
const encodeTimeSig = (timeSig: { numerator: number; denominator: number; symbol?: string }): string => {
	if (timeSig.symbol === 'common') {
		return "\\time 4/4";  // LilyPond handles C automatically
	}
	if (timeSig.symbol === 'cut') {
		return "\\time 2/2";  // LilyPond handles C| automatically
	}
	return `\\time ${timeSig.numerator}/${timeSig.denominator}`;
};


/**
 * Encode clef to LilyPond
 */
const encodeClef = (clef: Clef): string => {
	return `\\clef ${CLEF_MAP[clef] || clef}`;
};


/**
 * Encode tempo to LilyPond
 */
const encodeTempo = (tempo: Tempo): string => {
	let result = "\\tempo";
	if (tempo.text) {
		result += ` "${tempo.text}"`;
	}
	if (tempo.beat && tempo.bpm) {
		const beatValue = tempo.beat.division;
		let dots = "";
		if (tempo.beat.dots) {
			dots = ".".repeat(tempo.beat.dots);
		}
		result += ` ${beatValue}${dots} = ${tempo.bpm}`;
	}
	return result;
};


/**
 * Encode a single pitch in relative mode
 */
const encodePitch = (pitch: Pitch, env: PitchEnv): { str: string; newEnv: PitchEnv } => {
	let result: string = pitch.phonet as string;

	// Add accidental
	if (pitch.accidental && pitch.accidental !== Accidental.natural) {
		result += ACCIDENTAL_MAP[pitch.accidental] || '';
	} else if (pitch.accidental === Accidental.natural) {
		result += '!';
	}

	// Calculate relative octave markers
	const { markers, newEnv } = getRelativeOctaveMarkers(env, pitch);
	result += markers;

	return { str: result, newEnv };
};


/**
 * Encode duration to LilyPond
 */
const encodeDuration = (duration: Duration): string => {
	let result = String(duration.division);
	if (duration.dots) {
		result += ".".repeat(duration.dots);
	}
	return result;
};


/**
 * Encode marks (articulations, dynamics, etc.) to LilyPond
 */
const encodeMarks = (marks: Mark[]): string => {
	let result = '';

	for (const mark of marks) {
		switch (mark.markType) {
			case 'articulation':
				result += ARTICULATION_MAP[mark.type] || '';
				break;
			case 'ornament':
				result += ORNAMENT_MAP[mark.type] || '';
				break;
			case 'dynamic':
				result += DYNAMIC_MAP[mark.type] || '';
				break;
			case 'hairpin':
				result += HAIRPIN_MAP[mark.type] || '';
				break;
			case 'tie':
				if (mark.start) {
					result += '~';
				}
				break;
			case 'slur':
				result += mark.start ? '(' : ')';
				break;
			case 'beam':
				result += mark.start ? '[' : ']';
				break;
			case 'pedal':
				result += PEDAL_MAP[mark.type] || '';
				break;
			case 'fingering':
				result += `-${mark.finger}`;
				break;
			case 'navigation':
				if (mark.type === 'coda') {
					result += '\\coda';
				} else if (mark.type === 'segno') {
					result += '\\segno';
				}
				break;
			case 'markup':
				const placement = mark.placement === 'below' ? '_' : '^';
				result += `${placement}\\markup { ${mark.content} }`;
				break;
		}
	}

	return result;
};


/**
 * Encode a note event
 */
const encodeNoteEvent = (event: NoteEvent, env: PitchEnv, lastDuration: Duration | null): { str: string; newEnv: PitchEnv; newDuration: Duration } => {
	let result = '';
	let newEnv = env;

	// Grace note
	if (event.grace) {
		result += '\\grace ';
	}

	// Stem direction
	if (event.stemDirection) {
		result += STEM_MAP[event.stemDirection] + ' ';
	}

	// Pitches (chord or single note)
	if (event.pitches.length > 1) {
		result += '<';
		const pitchStrs: string[] = [];
		for (const pitch of event.pitches) {
			const { str, newEnv: ne } = encodePitch(pitch, newEnv);
			pitchStrs.push(str);
			newEnv = ne;
		}
		result += pitchStrs.join(' ');
		result += '>';
	} else if (event.pitches.length === 1) {
		const { str, newEnv: ne } = encodePitch(event.pitches[0], newEnv);
		result += str;
		newEnv = ne;
	}

	// Duration (only if different from last)
	const needDuration = !lastDuration ||
		lastDuration.division !== event.duration.division ||
		lastDuration.dots !== event.duration.dots;

	if (needDuration) {
		result += encodeDuration(event.duration);
	}

	// Tremolo
	if (event.tremolo) {
		result += `:${event.tremolo}`;
	}

	// Marks
	if (event.marks) {
		result += encodeMarks(event.marks);
	}

	return { str: result, newEnv, newDuration: event.duration };
};


/**
 * Encode a rest event
 */
const encodeRestEvent = (event: RestEvent, env: PitchEnv, lastDuration: Duration | null): { str: string; newEnv: PitchEnv; newDuration: Duration } => {
	let result = '';

	// Rest type
	if (event.fullMeasure) {
		result += 'R';
	} else if (event.invisible) {
		result += 's';
	} else {
		result += 'r';
	}

	// Duration
	const needDuration = !lastDuration ||
		lastDuration.division !== event.duration.division ||
		lastDuration.dots !== event.duration.dots;

	if (needDuration) {
		result += encodeDuration(event.duration);
	}

	// Positioned rest
	if (event.pitch && !event.fullMeasure && !event.invisible) {
		const { str } = encodePitch(event.pitch, env);
		result = str + result.slice(1);  // Replace 'r' with pitch
		result += '\\rest';
	}

	return { str: result, newEnv: env, newDuration: event.duration };
};


/**
 * Encode a context change event
 */
const encodeContextChange = (event: ContextChange): string => {
	const parts: string[] = [];

	if (event.key) {
		parts.push(encodeKey(event.key));
	}
	if (event.time) {
		parts.push(encodeTimeSig(event.time));
	}
	if (event.clef) {
		parts.push(encodeClef(event.clef));
	}
	if (event.ottava !== undefined) {
		parts.push(`\\ottava #${event.ottava}`);
	}
	if (event.stemDirection) {
		parts.push(STEM_MAP[event.stemDirection]);
	}
	if (event.tempo) {
		parts.push(encodeTempo(event.tempo));
	}
	if (event.staff) {
		parts.push(`\\change Staff = "${event.staff}"`);
	}

	return parts.join(' ');
};


/**
 * Encode a tuplet event
 */
const encodeTupletEvent = (event: TupletEvent, env: PitchEnv, lastDuration: Duration | null): { str: string; newEnv: PitchEnv; newDuration: Duration | null } => {
	let result = `\\tuplet ${event.ratio.denominator}/${event.ratio.numerator} { `;
	let newEnv = env;
	let newDuration = lastDuration;

	for (const subEvent of event.events) {
		if (subEvent.type === 'note') {
			const { str, newEnv: ne, newDuration: nd } = encodeNoteEvent(subEvent, newEnv, newDuration);
			result += str + ' ';
			newEnv = ne;
			newDuration = nd;
		} else if (subEvent.type === 'rest') {
			const { str, newDuration: nd } = encodeRestEvent(subEvent, newEnv, newDuration);
			result += str + ' ';
			newDuration = nd;
		}
	}

	result += '}';

	return { str: result, newEnv, newDuration };
};


/**
 * Encode a tremolo event
 */
const encodeTremoloEvent = (event: TremoloEvent, env: PitchEnv): { str: string; newEnv: PitchEnv } => {
	let newEnv = env;

	// First chord/note
	let pitchA = '';
	if (event.pitchA.length > 1) {
		pitchA += '<';
		const pitchStrs: string[] = [];
		for (const pitch of event.pitchA) {
			const { str, newEnv: ne } = encodePitch(pitch, newEnv);
			pitchStrs.push(str);
			newEnv = ne;
		}
		pitchA += pitchStrs.join(' ');
		pitchA += '>';
	} else if (event.pitchA.length === 1) {
		const { str, newEnv: ne } = encodePitch(event.pitchA[0], newEnv);
		pitchA += str;
		newEnv = ne;
	}

	// Second chord/note
	let pitchB = '';
	if (event.pitchB.length > 1) {
		pitchB += '<';
		const pitchStrs: string[] = [];
		for (const pitch of event.pitchB) {
			const { str, newEnv: ne } = encodePitch(pitch, newEnv);
			pitchStrs.push(str);
			newEnv = ne;
		}
		pitchB += pitchStrs.join(' ');
		pitchB += '>';
	} else if (event.pitchB.length === 1) {
		const { str, newEnv: ne } = encodePitch(event.pitchB[0], newEnv);
		pitchB += str;
		newEnv = ne;
	}

	const result = `\\repeat tremolo ${event.count} { ${pitchA}${event.division} ${pitchB}${event.division} }`;

	return { str: result, newEnv };
};


/**
 * Encode a barline event
 */
const encodeBarlineEvent = (event: BarlineEvent): string => {
	const style = BARLINE_MAP[event.style] || event.style;
	if (style === '|') {
		return '';  // Default barline, no need to encode
	}
	return `\\bar "${style}"`;
};


/**
 * Encode a harmony event (chord symbol)
 * Note: LilyPond uses ChordNames context for chord symbols, not inline commands.
 * We encode as markup with a recognizable prefix for roundtrip decoding.
 */
const encodeHarmonyEvent = (event: HarmonyEvent): string => {
	return `^\\markup { \\bold "${event.text}" }`;
};


/**
 * Encode a markup event
 */
const encodeMarkupEvent = (event: MarkupEvent): string => {
	const placement = event.placement === 'below' ? '_' : '^';
	return `${placement}\\markup { ${event.content} }`;
};


/**
 * Encode a voice to LilyPond
 */
const encodeVoice = (
	voice: Voice,
	measureContext: { key?: KeySignature; timeSig?: any; isFirst: boolean },
	voiceIndex: number
): string => {
	let result = '';
	let env: PitchEnv = { step: 0, octave: 0 };  // Start at middle C
	let lastDuration: Duration | null = null;

	for (const event of voice.events) {
		switch (event.type) {
			case 'note': {
				const { str, newEnv, newDuration } = encodeNoteEvent(event, env, lastDuration);
				result += str + ' ';
				env = newEnv;
				lastDuration = newDuration;
				break;
			}
			case 'rest': {
				const { str, newDuration } = encodeRestEvent(event, env, lastDuration);
				result += str + ' ';
				lastDuration = newDuration;
				break;
			}
			case 'context': {
				result += encodeContextChange(event) + ' ';
				break;
			}
			case 'tuplet': {
				const { str, newEnv, newDuration } = encodeTupletEvent(event, env, lastDuration);
				result += str + ' ';
				env = newEnv;
				lastDuration = newDuration;
				break;
			}
			case 'tremolo': {
				const { str, newEnv } = encodeTremoloEvent(event, env);
				result += str + ' ';
				env = newEnv;
				break;
			}
			case 'barline': {
				const str = encodeBarlineEvent(event);
				if (str) {
					result += str + ' ';
				}
				break;
			}
			case 'harmony': {
				result += encodeHarmonyEvent(event) + ' ';
				break;
			}
			case 'markup': {
				result += encodeMarkupEvent(event) + ' ';
				break;
			}
			case 'pitchReset': {
				env = { step: 0, octave: 0 };
				break;
			}
		}
	}

	return result.trim();
};


/**
 * Encode metadata to LilyPond header block
 */
const encodeMetadata = (metadata: Metadata): string => {
	const entries: string[] = [];

	if (metadata.title) {
		entries.push(`  title = "${metadata.title}"`);
	}
	if (metadata.subtitle) {
		entries.push(`  subtitle = "${metadata.subtitle}"`);
	}
	if (metadata.composer) {
		entries.push(`  composer = "${metadata.composer}"`);
	}
	if (metadata.arranger) {
		entries.push(`  arranger = "${metadata.arranger}"`);
	}
	if (metadata.lyricist) {
		entries.push(`  poet = "${metadata.lyricist}"`);
	}
	if (metadata.opus) {
		entries.push(`  opus = "${metadata.opus}"`);
	}
	if (metadata.instrument) {
		entries.push(`  instrument = "${metadata.instrument}"`);
	}

	entries.push('  tagline = ##f');

	return entries.join('\n');
};


/**
 * Encode a complete LilyletDoc to LilyPond format
 */
export const encode = (doc: LilyletDoc, options: RenderOptions = {}): string => {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	// Collect all voices across measures, grouped by staff
	const staffVoices: Map<number, string[][]> = new Map();  // staff -> measure -> voice content

	// Track time signature for each measure (for spacer rests)
	const measureTimeSigs: Array<{ numerator: number; denominator: number } | undefined> = [];

	let currentKey: KeySignature | undefined;
	let currentTimeSig: { numerator: number; denominator: number } | undefined;

	for (let mi = 0; mi < doc.measures.length; mi++) {
		const measure = doc.measures[mi];

		// Update context from measure
		if (measure.key) currentKey = measure.key;
		if (measure.timeSig) currentTimeSig = measure.timeSig;

		// Store time signature for this measure
		measureTimeSigs[mi] = currentTimeSig;

		// Process each part
		for (const part of measure.parts) {
			for (let vi = 0; vi < part.voices.length; vi++) {
				const voice = part.voices[vi];
				const staff = voice.staff || 1;

				if (!staffVoices.has(staff)) {
					staffVoices.set(staff, []);
				}
				const staffMeasures = staffVoices.get(staff)!;

				// Ensure we have enough measure slots
				while (staffMeasures.length <= mi) {
					staffMeasures.push([]);
				}

				// Encode voice content
				const voiceContent = encodeVoice(voice, {
					key: currentKey,
					timeSig: currentTimeSig,
					isFirst: mi === 0
				}, vi);

				staffMeasures[mi].push(voiceContent);
			}
		}
	}

	// Build music content
	const staffCount = Math.max(...Array.from(staffVoices.keys()));
	const staffStrings: string[] = [];

	for (let si = 1; si <= staffCount; si++) {
		const measures = staffVoices.get(si) || [];

		// Find max voices per measure for this staff
		const maxVoices = Math.max(...measures.map(m => m.length), 1);

		// Build voice lines
		const voiceLines: string[] = [];
		for (let vi = 0; vi < maxVoices; vi++) {
			const measureContents = measures.map((m, mi) => {
				// Use correct spacer rest based on time signature
				const spacer = getSpacerRest(measureTimeSigs[mi]);
				const content = m[vi] || spacer;
				// Wrap each measure in its own \relative c' to reset pitch context
				return `        \\relative c' { ${content} } |  % ${mi + 1}`;
			});
			voiceLines.push(`      \\new Voice {\n${measureContents.join('\n')}\n      }`);
		}

		staffStrings.push(`    \\new Staff = "${si}" <<\n${voiceLines.join('\n')}\n    >>`);
	}

	const musicContent = staffStrings.join('\n');

	// Build header
	const headerContent = doc.metadata ? encodeMetadata(doc.metadata) : '  tagline = ##f';

	// Build document
	const paperWidth = typeof opts.paper?.width === 'number' ? `${opts.paper.width}\\mm` : opts.paper?.width || '210\\mm';
	const paperHeight = typeof opts.paper?.height === 'number' ? `${opts.paper.height}\\mm` : opts.paper?.height || '297\\mm';

	const lyDoc = `\\version "2.22.0"

\\language "english"

\\header {
${headerContent}
}

#(set-global-staff-size ${opts.fontSize})

\\paper {
  paper-width = ${paperWidth}
  paper-height = ${paperHeight}
  ragged-last = ##t
  ragged-last-bottom = ##f
}

\\layout {
  \\context {
    \\Score
    autoBeaming = ##${opts.autoBeaming ? 't' : 'f'}
  }
}

\\score {
  \\new GrandStaff <<
${musicContent}
  >>

  \\layout { }${opts.withMIDI ? '\n  \\midi { }' : ''}
}
`;

	return lyDoc;
};


/**
 * Encode LilyletDoc to minimal LilyPond (music content only, no headers)
 */
export const encodeMinimal = (doc: LilyletDoc): string => {
	const parts: string[] = [];

	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				const content = encodeVoice(voice, { isFirst: false }, 0);
				parts.push(content);
			}
		}
		parts.push('|');
	}

	return parts.join(' ');
};


export default {
	encode,
	encodeMinimal,
};
