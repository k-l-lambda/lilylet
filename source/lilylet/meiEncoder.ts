
import {
	LilyletDoc,
	Measure,
	Part,
	Voice,
	NoteEvent,
	RestEvent,
	ContextChange,
	TupletEvent,
	TremoloEvent,
	PitchResetEvent,
	Pitch,
	Clef,
	Accidental,
	OrnamentType,
	StemDirection,
	Mark,
	HairpinType,
	PedalType,
	Tempo,
} from "./types";


// MEI key signatures: positive = sharps, negative = flats
const KEY_SIGS: Record<number, string> = {
	0: "0",
	1: "1s",
	2: "2s",
	3: "3s",
	4: "4s",
	5: "5s",
	6: "6s",
	7: "7s",
	[-1]: "1f",
	[-2]: "2f",
	[-3]: "3f",
	[-4]: "4f",
	[-5]: "5f",
	[-6]: "6f",
	[-7]: "7f",
};


// Key signature to fifths number
const keyToFifths = (key?: { pitch: string; accidental?: Accidental; mode: string }): number => {
	if (!key) return 0;

	// Major keys
	const majorKeys: Record<string, number> = {
		'c': 0, 'd': 2, 'e': 4, 'f': -1, 'g': 1, 'a': 3, 'b': 5,
	};

	let fifths = majorKeys[key.pitch] || 0;

	if (key.accidental === Accidental.sharp) fifths += 7;
	else if (key.accidental === Accidental.flat) fifths -= 7;

	if (key.mode === 'minor') fifths -= 3;

	return fifths;
};


const CLEF_SHAPES: Record<string, { shape: string; line: number }> = {
	treble: { shape: "G", line: 2 },
	bass: { shape: "F", line: 4 },
	alto: { shape: "C", line: 3 },
	// Also support uppercase letter clef names
	G: { shape: "G", line: 2 },
	F: { shape: "F", line: 4 },
	C: { shape: "C", line: 3 },
};


// Lilylet duration division to MEI dur
// division: 1=whole, 2=half, 4=quarter, 8=eighth, etc.
const DURATIONS: Record<number, string> = {
	1: "1",      // whole
	2: "2",      // half
	4: "4",      // quarter
	8: "8",      // eighth
	16: "16",
	32: "32",
	64: "64",
	128: "128",
};


// Accidental mapping
const ACCIDENTALS: Record<string, string> = {
	natural: "n",
	sharp: "s",
	flat: "f",
	doubleSharp: "x",
	doubleFlat: "ff",
};


// Articulation to MEI artic
const ARTIC_MAP: Record<string, string> = {
	staccato: "stacc",
	staccatissimo: "stacciss",
	tenuto: "ten",
	marcato: "marc",
	accent: "acc",
	portato: "stacc ten",  // Both staccato and tenuto (portato)
};


// Dynamic to MEI
const DYNAMIC_MAP: Record<string, string> = {
	ppp: "ppp",
	pp: "pp",
	p: "p",
	mp: "mp",
	mf: "mf",
	f: "f",
	ff: "ff",
	fff: "fff",
	sfz: "sfz",
	rfz: "rfz",
};


let idCounter = 0;

const generateId = (prefix: string): string => {
	return `${prefix}-${String(++idCounter).padStart(10, "0")}`;
};

const resetIdCounter = (): void => {
	idCounter = 0;
};


interface MEIEncoderOptions {
	indent?: string;
	xmlDeclaration?: boolean;
}


// Sharp and flat order for key signatures (circle of fifths)
const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

// Get the accidentals implied by a key signature
// fifths > 0 = sharps, fifths < 0 = flats
const getKeyAccidentals = (fifths: number): Record<string, string> => {
	const result: Record<string, string> = {};
	if (fifths > 0) {
		// Sharps
		for (let i = 0; i < Math.min(fifths, 7); i++) {
			result[SHARP_ORDER[i]] = 's';  // sharp
		}
	} else if (fifths < 0) {
		// Flats
		for (let i = 0; i < Math.min(-fifths, 7); i++) {
			result[FLAT_ORDER[i]] = 'f';  // flat
		}
	}
	return result;
};

// Convert Pitch to MEI attributes, checking against key signature
const encodePitch = (pitch: Pitch, keyFifths: number = 0): { pname: string; oct: number; accid?: string } => {
	// Lilylet octave: 0 = middle C octave (C4), positive = higher, negative = lower
	const oct = 4 + pitch.octave;

	// Get the accidental implied by the key signature for this note
	const keyAccidentals = getKeyAccidentals(keyFifths);
	const keyAccid = keyAccidentals[pitch.phonet];

	// Determine if we need to output an accid attribute
	let accid: string | undefined;
	if (pitch.accidental) {
		const noteAccid = ACCIDENTALS[pitch.accidental];
		// Only output accid if it's different from what the key implies
		if (noteAccid !== keyAccid) {
			accid = noteAccid;
		}
	} else if (keyAccid) {
		// Note has no accidental but key implies one - output natural
		accid = 'n';
	}

	return { pname: pitch.phonet, oct, accid };
};


// Convert tremolo division to stem.mod value
const tremoloToStemMod = (division: number): string | undefined => {
	// 8 = 1slash (eighth note strokes), 16 = 2slash, 32 = 3slash, etc.
	const slashes = Math.log2(division) - 2;  // 8->1, 16->2, 32->3
	if (slashes >= 1 && slashes <= 6) {
		return `${slashes}slash`;
	}
	return undefined;
};

// Build note element
const buildNoteElement = (
	pitch: { pname: string; oct: number; accid?: string },
	dur: string,
	dots: number,
	indent: string,
	inChord: boolean,
	options: {
		grace?: boolean;
		tie?: 'i' | 'm' | 't';
		stemDir?: string;
		staff?: number;
		layerStaff?: number;
		slur?: string;
		artics?: { type: string; placement?: 'above' | 'below' }[];
		tremolo?: number;
	} = {},
	noteId?: string
): string => {
	const id = noteId || generateId('note');
	let attrs = `xml:id="${id}" pname="${pitch.pname}" oct="${pitch.oct}"`;

	if (!inChord) {
		attrs += ` dur="${dur}"`;
	}
	if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
	if (!inChord && dots > 0) attrs += ` dots="${dots}"`;
	if (!inChord && options.grace) attrs += ` grace="unacc"`;
	if (!inChord && options.tie) attrs += ` tie="${options.tie}"`;
	if (!inChord && options.stemDir) attrs += ` stem.dir="${options.stemDir}"`;
	if (!inChord && options.layerStaff && options.staff && options.staff !== options.layerStaff) {
		attrs += ` staff="${options.staff}"`;
	}
	if (!inChord && options.slur) attrs += ` slur="${options.slur}"`;
	if (!inChord && options.tremolo) {
		const stemMod = tremoloToStemMod(options.tremolo);
		if (stemMod) attrs += ` stem.mod="${stemMod}"`;
	}

	// Only artics remain as child elements; ornaments are control events
	const hasChildren = !inChord && options.artics && options.artics.length > 0;

	if (!hasChildren) {
		return `${indent}<note ${attrs} />\n`;
	}

	let result = `${indent}<note ${attrs}>\n`;

	if (options.artics && options.artics.length > 0) {
		// Group artics by placement
		const aboveArtics = options.artics.filter(a => a.placement === 'above').map(a => a.type);
		const belowArtics = options.artics.filter(a => a.placement === 'below').map(a => a.type);
		const defaultArtics = options.artics.filter(a => !a.placement).map(a => a.type);

		if (aboveArtics.length > 0) {
			result += `${indent}    <artic artic="${aboveArtics.join(' ')}" place="above" />\n`;
		}
		if (belowArtics.length > 0) {
			result += `${indent}    <artic artic="${belowArtics.join(' ')}" place="below" />\n`;
		}
		if (defaultArtics.length > 0) {
			result += `${indent}    <artic artic="${defaultArtics.join(' ')}" />\n`;
		}
	}

	result += `${indent}</note>\n`;
	return result;
};


// Extract mark properties from note event
const extractMarkOptions = (marks?: Mark[]): {
	artics: { type: string; placement?: 'above' | 'below' }[];
	fermata: 'normal' | 'short' | false;
	trill: boolean;
	arpeggio: boolean;
	turn: boolean;
	mordent: 'lower' | 'upper' | false;  // lower = mordent, upper = prall
	slurStart: boolean;
	slurEnd: boolean;
	tieStart: boolean;
	beamStart: boolean;
	beamEnd: boolean;
	dynamic?: string;
	hairpin?: string;
	pedal?: string;
	tremolo?: number;
} => {
	const result = {
		artics: [] as { type: string; placement?: 'above' | 'below' }[],
		fermata: false as 'normal' | 'short' | false,
		trill: false,
		arpeggio: false,
		turn: false,
		mordent: false as 'lower' | 'upper' | false,  // lower = mordent, upper = prall
		slurStart: false,
		slurEnd: false,
		tieStart: false,
		beamStart: false,
		beamEnd: false,
		dynamic: undefined as string | undefined,
		hairpin: undefined as string | undefined,
		pedal: undefined as string | undefined,
		tremolo: undefined as number | undefined,
	};

	if (!marks) return result;

	for (const mark of marks) {
		// Articulations
		if ('type' in mark && ARTIC_MAP[(mark as any).type]) {
			result.artics.push({
				type: ARTIC_MAP[(mark as any).type],
				placement: (mark as any).placement,
			});
		}

		// Ornaments
		const ornamentType = (mark as any).type;
		if (ornamentType === OrnamentType.fermata) {
			result.fermata = 'normal';
		} else if (ornamentType === OrnamentType.shortFermata) {
			result.fermata = 'short';
		} else if (ornamentType === OrnamentType.trill) {
			result.trill = true;
		} else if (ornamentType === OrnamentType.arpeggio) {
			result.arpeggio = true;
		} else if (ornamentType === OrnamentType.turn) {
			result.turn = true;
		} else if (ornamentType === OrnamentType.mordent) {
			result.mordent = 'lower';
		} else if (ornamentType === OrnamentType.prall) {
			result.mordent = 'upper';
		}

		// Dynamics
		if (DYNAMIC_MAP[ornamentType]) {
			result.dynamic = DYNAMIC_MAP[ornamentType];
		}

		// Hairpins
		if (ornamentType === HairpinType.crescendoStart) {
			result.hairpin = 'crescStart';
		} else if (ornamentType === HairpinType.diminuendoStart) {
			result.hairpin = 'dimStart';
		} else if (ornamentType === HairpinType.crescendoEnd || ornamentType === HairpinType.diminuendoEnd) {
			result.hairpin = 'end';
		}

		// Pedals
		if (ornamentType === PedalType.sustainOn) {
			result.pedal = 'down';
		} else if (ornamentType === PedalType.sustainOff) {
			result.pedal = 'up';
		}

		// Tremolo
		if ('tremolo' in mark && typeof (mark as any).tremolo === 'number') {
			result.tremolo = (mark as any).tremolo;
		}

		// Check markType for tie/slur/beam distinction
		const markType = (mark as any).markType;
		if (markType === 'tie') {
			if ((mark as any).start) {
				result.tieStart = true;
			}
		} else if (markType === 'slur') {
			if ((mark as any).start) {
				result.slurStart = true;
			} else {
				result.slurEnd = true;
			}
		} else if (markType === 'beam') {
			if ((mark as any).start) {
				result.beamStart = true;
			} else {
				result.beamEnd = true;
			}
		}
	}

	return result;
};


// NoteEventResult - return type for noteEventToMEI
interface NoteEventResult {
	xml: string;
	elementId: string;
	hairpin?: string;
	pedal?: string;
	hasTieStart: boolean;
	pitches: Pitch[];
	arpeggio: boolean;
	fermata: 'normal' | 'short' | false;
	trill: boolean;
	mordent: 'lower' | 'upper' | false;  // lower = mordent, upper = prall
	turn: boolean;
	dynamic?: string;  // dynamic marking (p, pp, f, ff, etc.)
}

// Convert NoteEvent to MEI
const noteEventToMEI = (
	event: NoteEvent,
	indent: string,
	layerStaff?: number,
	tieEnd?: boolean,
	contextStemDir?: StemDirection,
	keyFifths: number = 0
): NoteEventResult => {
	const dur = DURATIONS[event.duration.division] || "4";
	const dots = event.duration.dots || 0;
	const markOptions = extractMarkOptions(event.marks);

	// Build slur attribute
	const slurParts: string[] = [];
	if (markOptions.slurStart) slurParts.push('i');
	if (markOptions.slurEnd) slurParts.push('t');
	const slur = slurParts.length > 0 ? slurParts.join(' ') : undefined;

	// Stem direction - use event's own or context's
	const effectiveStemDir = event.stemDirection ?? contextStemDir;
	let stemDir: string | undefined;
	if (effectiveStemDir === StemDirection.up) stemDir = 'up';
	else if (effectiveStemDir === StemDirection.down) stemDir = 'down';

	// Determine tie attribute: 'i' = initial, 'm' = medial, 't' = terminal
	let tie: 'i' | 'm' | 't' | undefined;
	if (markOptions.tieStart && tieEnd) {
		tie = 'm';  // Both start and end = medial
	} else if (markOptions.tieStart) {
		tie = 'i';  // Start only = initial
	} else if (tieEnd) {
		tie = 't';  // End only = terminal
	}

	// Note options - ornaments are now control events, not inline
	const noteOptions = {
		grace: event.grace,
		tie,
		stemDir,
		staff: event.staff,
		layerStaff,
		slur,
		artics: markOptions.artics,
		tremolo: markOptions.tremolo,
	};

	// Single note
	if (event.pitches.length === 1) {
		const pitch = encodePitch(event.pitches[0], keyFifths);
		const noteId = generateId('note');
		return {
			xml: buildNoteElement(pitch, dur, dots, indent, false, noteOptions, noteId),
			elementId: noteId,
			hairpin: markOptions.hairpin,
			pedal: markOptions.pedal,
			hasTieStart: markOptions.tieStart,
			pitches: event.pitches,
			arpeggio: markOptions.arpeggio,
			fermata: markOptions.fermata,
			trill: markOptions.trill,
			mordent: markOptions.mordent,
			turn: markOptions.turn,
			dynamic: markOptions.dynamic,
		};
	}

	// Chord
	const chordId = generateId('chord');
	let chordAttrs = `xml:id="${chordId}" dur="${dur}"`;
	if (dots > 0) chordAttrs += ` dots="${dots}"`;
	if (noteOptions.grace) chordAttrs += ` grace="unacc"`;
	if (noteOptions.tie) chordAttrs += ` tie="${noteOptions.tie}"`;
	if (noteOptions.stemDir) chordAttrs += ` stem.dir="${noteOptions.stemDir}"`;
	if (layerStaff && noteOptions.staff && noteOptions.staff !== layerStaff) {
		chordAttrs += ` staff="${noteOptions.staff}"`;
	}
	if (slur) chordAttrs += ` slur="${slur}"`;

	let result = `${indent}<chord ${chordAttrs}>\n`;

	for (const p of event.pitches) {
		const pitch = encodePitch(p, keyFifths);
		result += buildNoteElement(pitch, dur, dots, indent + '    ', true);
	}

	// Artics for chord - group by placement
	if (noteOptions.artics.length > 0) {
		const aboveArtics = noteOptions.artics.filter(a => a.placement === 'above').map(a => a.type);
		const belowArtics = noteOptions.artics.filter(a => a.placement === 'below').map(a => a.type);
		const defaultArtics = noteOptions.artics.filter(a => !a.placement).map(a => a.type);

		if (aboveArtics.length > 0) {
			result += `${indent}    <artic artic="${aboveArtics.join(' ')}" place="above" />\n`;
		}
		if (belowArtics.length > 0) {
			result += `${indent}    <artic artic="${belowArtics.join(' ')}" place="below" />\n`;
		}
		if (defaultArtics.length > 0) {
			result += `${indent}    <artic artic="${defaultArtics.join(' ')}" />\n`;
		}
	}

	result += `${indent}</chord>\n`;
	return {
		xml: result,
		elementId: chordId,
		hairpin: markOptions.hairpin,
		pedal: markOptions.pedal,
		hasTieStart: markOptions.tieStart,
		pitches: event.pitches,
		arpeggio: markOptions.arpeggio,
		fermata: markOptions.fermata,
		trill: markOptions.trill,
		mordent: markOptions.mordent,
		turn: markOptions.turn,
		dynamic: markOptions.dynamic,
	};
};


// Convert RestEvent to MEI
const restEventToMEI = (event: RestEvent, indent: string, keyFifths: number = 0): string => {
	const dur = DURATIONS[event.duration.division] || "4";
	let attrs = `xml:id="${generateId('rest')}" dur="${dur}"`;
	if (event.duration.dots > 0) attrs += ` dots="${event.duration.dots}"`;

	// Pitched rest (positioned at specific pitch)
	if (event.pitch) {
		const pitch = encodePitch(event.pitch, keyFifths);
		attrs += ` ploc="${pitch.pname}" oloc="${pitch.oct}"`;
	}

	// Space rest (invisible)
	if (event.invisible) {
		return `${indent}<space ${attrs} />\n`;
	}

	// Full measure rest
	if (event.fullMeasure) {
		return `${indent}<mRest xml:id="${generateId('mrest')}" />\n`;
	}

	return `${indent}<rest ${attrs} />\n`;
};


// Convert TupletEvent to MEI
const tupletEventToMEI = (event: TupletEvent, indent: string, layerStaff?: number, keyFifths: number = 0): string => {
	// LilyPond \times 2/3 means "multiply duration by 2/3"
	// So 3 notes × 2/3 = 2 beats worth (3 in time of 2)
	// MEI: num = number of notes written, numbase = normal equivalent
	const num = event.ratio.denominator;      // denominator = actual note count
	const numbase = event.ratio.numerator;    // numerator = time equivalent

	let result = `${indent}<tuplet xml:id="${generateId('tuplet')}" num="${num}" numbase="${numbase}">\n`;

	let inBeam = false;
	const baseIndent = indent + '    ';

	for (const e of event.events) {
		// Check for beam marks in note events
		let beamStart = false;
		let beamEnd = false;
		if (e.type === 'note') {
			const markOptions = extractMarkOptions((e as NoteEvent).marks);
			beamStart = markOptions.beamStart;
			beamEnd = markOptions.beamEnd;
		}

		// Open beam element if beam starts
		if (beamStart && !inBeam) {
			result += `${baseIndent}<beam xml:id="${generateId('beam')}">\n`;
			inBeam = true;
		}

		const currentIndent = inBeam ? baseIndent + '    ' : baseIndent;

		if (e.type === 'note') {
			result += noteEventToMEI(e as NoteEvent, currentIndent, layerStaff, false, undefined, keyFifths).xml;
		} else if (e.type === 'rest') {
			result += restEventToMEI(e as RestEvent, currentIndent, keyFifths);
		}

		// Close beam element if beam ends
		if (beamEnd && inBeam) {
			result += `${baseIndent}</beam>\n`;
			inBeam = false;
		}
	}

	// Close any unclosed beam
	if (inBeam) {
		result += `${baseIndent}</beam>\n`;
	}

	result += `${indent}</tuplet>\n`;
	return result;
};


// Convert TremoloEvent to MEI (fingered tremolo - alternating between two notes)
const tremoloEventToMEI = (event: TremoloEvent, indent: string, keyFifths: number = 0): string => {
	const ftremId = generateId('fTrem');

	// For \repeat tremolo 4 { c16 d16 }:
	// - count = 4 (repetitions)
	// - division = 16 (note value)
	// - Total duration = 4 × 2 × 16th = 8 × 16th = half note
	// - Each visible note = half of total = quarter note

	// Calculate beams (tremolo strokes) based on division
	// 8th = 1 beam, 16th = 2 beams, 32nd = 3 beams
	const beams = Math.max(1, Math.log2(event.division / 8) + 1);

	// Calculate visual duration for each note
	// For \repeat tremolo 4 { c16 d16 }:
	// - Total strokes = 4 × 2 = 8 sixteenth notes = 1/2 whole note
	// - Each visible note = 1/4 whole note = quarter note (dur="4")
	// Formula: dur = division / count (e.g., 16 / 4 = 4 for quarter note)
	const noteDur = Math.round(event.division / event.count) || 4;  // Default to quarter if calculation fails

	let result = `${indent}<fTrem xml:id="${ftremId}" beams="${beams}">\n`;

	// First note (or chord)
	if (event.pitchA.length === 1) {
		const pitch = encodePitch(event.pitchA[0], keyFifths);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		result += `${indent}    <note ${attrs} />\n`;
	} else if (event.pitchA.length > 1) {
		result += `${indent}    <chord xml:id="${generateId('chord')}" dur="${noteDur}">\n`;
		for (const p of event.pitchA) {
			const pitch = encodePitch(p, keyFifths);
			let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}"`;
			if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
			result += `${indent}        <note ${attrs} />\n`;
		}
		result += `${indent}    </chord>\n`;
	}

	// Second note (or chord)
	if (event.pitchB.length === 1) {
		const pitch = encodePitch(event.pitchB[0], keyFifths);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		result += `${indent}    <note ${attrs} />\n`;
	} else if (event.pitchB.length > 1) {
		result += `${indent}    <chord xml:id="${generateId('chord')}" dur="${noteDur}">\n`;
		for (const p of event.pitchB) {
			const pitch = encodePitch(p, keyFifths);
			let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}"`;
			if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
			result += `${indent}        <note ${attrs} />\n`;
		}
		result += `${indent}    </chord>\n`;
	}

	result += `${indent}</fTrem>\n`;
	return result;
};


// Hairpin span data
interface HairpinSpan {
	form: 'cres' | 'dim';
	startId: string;
	endId: string;
}

interface PedalSpan {
	startId: string;
	endId: string;
}

interface OctaveSpan {
	dis: 8 | 15;  // 8 = octave, 15 = double octave (not commonly used)
	disPlace: 'above' | 'below';
	startId: string;
	endId: string;
}

interface ArpegRef {
	plist: string;  // Reference to chord/notes that have arpeggio
}

interface FermataRef {
	startid: string;
	shape?: 'angular';  // For short fermata
}

interface TrillRef {
	startid: string;
}

interface MordentRef {
	startid: string;
	form?: 'upper';  // prall = upper mordent
}

interface TurnRef {
	startid: string;
}

interface DynamRef {
	startid: string;
	label: string;  // p, pp, ppp, f, ff, fff, mf, mp, sfz, rfz
}

// Tie state for cross-measure ties - maps staff:layer to pending pitches
type TieState = Record<string, Pitch[]>;

// Layer result type
interface LayerResult {
	xml: string;
	hairpins: HairpinSpan[];
	pedals: PedalSpan[];
	octaves: OctaveSpan[];
	arpeggios: ArpegRef[];
	fermatas: FermataRef[];
	trills: TrillRef[];
	mordents: MordentRef[];
	turns: TurnRef[];
	dynamics: DynamRef[];
	pendingTiePitches: Pitch[];  // For cross-measure tie tracking
	endingClef?: Clef;  // For cross-measure clef tracking
}

// Encode a layer (voice)
const encodeLayer = (voice: Voice, layerN: number, indent: string, initialTiePitches: Pitch[] = [], keyFifths: number = 0, initialClef?: Clef): LayerResult => {
	const layerId = generateId("layer");
	let xml = `${indent}<layer xml:id="${layerId}" n="${layerN}">\n`;

	let inBeam = false;
	const baseIndent = indent + '    ';

	// Track current clef to only emit changes
	let currentClef: Clef | undefined = initialClef;

	// Track hairpin spans
	const hairpins: HairpinSpan[] = [];
	let currentHairpin: { form: 'cres' | 'dim'; startId: string } | null = null;

	// Track pedal spans
	const pedals: PedalSpan[] = [];
	let currentPedal: { startId: string } | null = null;

	// Track octave spans
	const octaves: OctaveSpan[] = [];
	let currentOctave: { dis: 8 | 15; disPlace: 'above' | 'below'; startId: string } | null = null;
	let pendingOttava: number | null = null;  // Track ottava to apply to next note
	let lastNoteId: string | null = null;  // Track last note id for ending ottava spans

	// Track arpeggio refs
	const arpeggios: ArpegRef[] = [];

	// Track ornament refs
	const fermatas: FermataRef[] = [];
	const trills: TrillRef[] = [];
	const mordents: MordentRef[] = [];
	const turns: TurnRef[] = [];
	const dynamics: DynamRef[] = [];

	// Track current stem direction from context changes
	let currentStemDirection: StemDirection | undefined = undefined;

	// Track pending tie pitches (for tie="t" on next note) - initialized from previous measure
	let pendingTiePitches: Pitch[] = [...initialTiePitches];

	// Helper to check if pitches match for tie continuation
	const pitchesMatch = (p1: Pitch[], p2: Pitch[]): boolean => {
		if (p1.length !== p2.length) return false;
		for (let i = 0; i < p1.length; i++) {
			if (p1[i].phonet !== p2[i].phonet || p1[i].octave !== p2[i].octave) return false;
		}
		return true;
	};

	for (const event of voice.events) {
		// Check for beam start/end in note events
		let beamStart = false;
		let beamEnd = false;
		if (event.type === 'note') {
			const noteEvent = event as NoteEvent;
			const markOptions = extractMarkOptions(noteEvent.marks);
			beamStart = markOptions.beamStart;
			beamEnd = markOptions.beamEnd;
		}

		// Open beam element if beam starts
		if (beamStart && !inBeam) {
			xml += `${baseIndent}<beam xml:id="${generateId('beam')}">\n`;
			inBeam = true;
		}

		const currentIndent = inBeam ? baseIndent + '    ' : baseIndent;

		switch (event.type) {
			case 'note': {
				const noteEvent = event as NoteEvent;
				// Check if this note should have tie="t" (matches pending tie)
				const tieEnd = pendingTiePitches.length > 0 && pitchesMatch(pendingTiePitches, noteEvent.pitches);

				const result = noteEventToMEI(noteEvent, currentIndent, voice.staff, tieEnd, currentStemDirection, keyFifths);
				xml += result.xml;
				lastNoteId = result.elementId;

				// If there's a pending ottava, start the span on this note
				if (pendingOttava !== null && pendingOttava !== 0) {
					const dis: 8 | 15 = Math.abs(pendingOttava) === 2 ? 15 : 8;
					const disPlace: 'above' | 'below' = pendingOttava > 0 ? 'above' : 'below';
					currentOctave = { dis, disPlace, startId: result.elementId };
					pendingOttava = null;
				}

				// Update pending tie pitches
				if (result.hasTieStart) {
					pendingTiePitches = result.pitches;
				} else if (tieEnd) {
					pendingTiePitches = [];
				}

				// Track hairpin spans
				if (result.hairpin === 'crescStart') {
					currentHairpin = { form: 'cres', startId: result.elementId };
				} else if (result.hairpin === 'dimStart') {
					currentHairpin = { form: 'dim', startId: result.elementId };
				} else if (result.hairpin === 'end' && currentHairpin) {
					hairpins.push({
						form: currentHairpin.form,
						startId: currentHairpin.startId,
						endId: result.elementId,
					});
					currentHairpin = null;
				}

				// Track pedal spans
				if (result.pedal === 'down') {
					currentPedal = { startId: result.elementId };
				} else if (result.pedal === 'up' && currentPedal) {
					pedals.push({
						startId: currentPedal.startId,
						endId: result.elementId,
					});
					currentPedal = null;
				}

				// Track arpeggio refs
				if (result.arpeggio) {
					arpeggios.push({ plist: result.elementId });
				}

				// Track ornament refs (fermata, trill, mordent, turn)
				if (result.fermata) {
					fermatas.push({
						startid: result.elementId,
						shape: result.fermata === 'short' ? 'angular' : undefined,
					});
				}
				if (result.trill) {
					trills.push({ startid: result.elementId });
				}
				if (result.mordent) {
					mordents.push({
						startid: result.elementId,
						form: result.mordent === 'upper' ? 'upper' : undefined,
					});
				}
				if (result.turn) {
					turns.push({ startid: result.elementId });
				}
				if (result.dynamic) {
					dynamics.push({ startid: result.elementId, label: result.dynamic });
				}
				break;
			}
			case 'rest':
				xml += restEventToMEI(event as RestEvent, currentIndent, keyFifths);
				break;
			case 'tuplet':
				xml += tupletEventToMEI(event as TupletEvent, currentIndent, voice.staff, keyFifths);
				break;
			case 'tremolo':
				xml += tremoloEventToMEI(event as TremoloEvent, currentIndent, keyFifths);
				break;
			case 'context': {
				const ctx = event as ContextChange;
				// Check for clef changes - emit <clef> element only if different from current
				if (ctx.clef && ctx.clef !== currentClef) {
					const clefInfo = CLEF_SHAPES[ctx.clef] || CLEF_SHAPES.treble;
					xml += `${currentIndent}<clef xml:id="${generateId('clef')}" shape="${clefInfo.shape}" line="${clefInfo.line}" />\n`;
					currentClef = ctx.clef;
				}
				// Check for ottava changes
				if (ctx.ottava !== undefined) {
					if (ctx.ottava === 0) {
						// End current ottava span
						if (currentOctave && lastNoteId) {
							octaves.push({
								dis: currentOctave.dis,
								disPlace: currentOctave.disPlace,
								startId: currentOctave.startId,
								endId: lastNoteId,
							});
							currentOctave = null;
						}
					} else {
						// Start new ottava span - will be applied to next note
						pendingOttava = ctx.ottava;
					}
				}
				// Check for stem direction changes
				if (ctx.stemDirection !== undefined) {
					currentStemDirection = ctx.stemDirection;
				}
				// Other context changes are handled at measure level
				break;
			}
			case 'pitchReset':
				// Pitch reset events are only used during pitch resolution in the parser.
				// They don't produce any MEI output - just skip them.
				break;
		}

		// Close beam element if beam ends
		if (beamEnd && inBeam) {
			xml += `${baseIndent}</beam>\n`;
			inBeam = false;
		}
	}

	// Close any unclosed beam
	if (inBeam) {
		xml += `${baseIndent}</beam>\n`;
	}

	// Close any unclosed ottava span at end of layer
	if (currentOctave && lastNoteId) {
		octaves.push({
			dis: currentOctave.dis,
			disPlace: currentOctave.disPlace,
			startId: currentOctave.startId,
			endId: lastNoteId,
		});
	}

	xml += `${indent}</layer>\n`;
	return { xml, hairpins, pedals, octaves, arpeggios, fermatas, trills, mordents, turns, dynamics, pendingTiePitches, endingClef: currentClef };
};

// Staff result type
interface StaffResult {
	xml: string;
	hairpins: HairpinSpan[];
	pedals: PedalSpan[];
	octaves: OctaveSpan[];
	arpeggios: ArpegRef[];
	fermatas: FermataRef[];
	trills: TrillRef[];
	mordents: MordentRef[];
	turns: TurnRef[];
	dynamics: DynamRef[];
	pendingTies: TieState;  // For cross-measure tie tracking
	endingClef?: Clef;  // For cross-measure clef tracking
}

// Encode a staff
const encodeStaff = (voices: Voice[], staffN: number, indent: string, tieState: TieState = {}, keyFifths: number = 0, initialClef?: Clef): StaffResult => {
	const staffId = generateId("staff");
	let xml = `${indent}<staff xml:id="${staffId}" n="${staffN}">\n`;
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalSpan[] = [];
	const allOctaves: OctaveSpan[] = [];
	const allArpeggios: ArpegRef[] = [];
	const allFermatas: FermataRef[] = [];
	const allTrills: TrillRef[] = [];
	const allMordents: MordentRef[] = [];
	const allTurns: TurnRef[] = [];
	const allDynamics: DynamRef[] = [];
	const pendingTies: TieState = {};
	let endingClef: Clef | undefined = initialClef;

	if (voices.length === 0) {
		xml += `${indent}    <layer xml:id="${generateId('layer')}" n="1" />\n`;
	} else {
		voices.forEach((voice, vi) => {
			const layerN = vi + 1;
			const tieKey = `${staffN}-${layerN}`;
			const initialTies = tieState[tieKey] || [];
			const result = encodeLayer(voice, layerN, indent + '    ', initialTies, keyFifths, endingClef);
			xml += result.xml;
			allHairpins.push(...result.hairpins);
			allPedals.push(...result.pedals);
			allOctaves.push(...result.octaves);
			allArpeggios.push(...result.arpeggios);
			allFermatas.push(...result.fermatas);
			allTrills.push(...result.trills);
			allMordents.push(...result.mordents);
			allTurns.push(...result.turns);
			allDynamics.push(...result.dynamics);
			// Track pending ties for this layer
			if (result.pendingTiePitches.length > 0) {
				pendingTies[tieKey] = result.pendingTiePitches;
			}
			// Track ending clef for cross-measure tracking
			if (result.endingClef) {
				endingClef = result.endingClef;
			}
		});
	}

	xml += `${indent}</staff>\n`;
	return {
		xml,
		hairpins: allHairpins,
		pedals: allPedals,
		octaves: allOctaves,
		arpeggios: allArpeggios,
		fermatas: allFermatas,
		trills: allTrills,
		mordents: allMordents,
		turns: allTurns,
		dynamics: allDynamics,
		pendingTies,
		endingClef,
	};
};


// Generate tempo element
const generateTempoElement = (tempo: Tempo, indent: string): string => {
	let attrs = `xml:id="${generateId('tempo')}" tstamp="1"`;

	// Add BPM if specified
	if (tempo.bpm) {
		attrs += ` midi.bpm="${tempo.bpm}"`;
		if (tempo.beat) {
			attrs += ` mm="${tempo.bpm}" mm.unit="${tempo.beat.division}"`;
		}
	}

	// Generate content
	let content = '';
	if (tempo.text) {
		content = escapeXml(tempo.text);
	}
	if (tempo.beat && tempo.bpm) {
		const beatSymbol = tempo.beat.division === 4 ? '♩' : tempo.beat.division === 2 ? '𝅗𝅥' : '♪';
		if (content) content += ' ';
		content += `${beatSymbol} = ${tempo.bpm}`;
	}

	if (content) {
		return `${indent}<tempo ${attrs}>${content}</tempo>\n`;
	}
	return `${indent}<tempo ${attrs} />\n`;
};

// Clef state for cross-measure clef tracking - maps staff number to current clef
type ClefState = Record<number, Clef>;

// Encode a measure
// encodeMeasure accepts mutable tieState and clefState that persist across measures
const encodeMeasure = (measure: Measure, measureN: number, indent: string, totalStaves: number, tieState: TieState, keyFifths: number = 0, partInfos: PartInfo[] = [], clefState: ClefState = {}): string => {
	const measureId = generateId("measure");
	let xml = `${indent}<measure xml:id="${measureId}" n="${measureN}">\n`;
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalSpan[] = [];
	const allOctaves: OctaveSpan[] = [];
	const allArpeggios: ArpegRef[] = [];
	const allFermatas: FermataRef[] = [];
	const allTrills: TrillRef[] = [];
	const allMordents: MordentRef[] = [];
	const allTurns: TurnRef[] = [];
	const allDynamics: DynamRef[] = [];

	// Extract tempo from context changes
	let measureTempo: Tempo | undefined;
	for (const part of measure.parts) {
		for (const voice of part.voices) {
			for (const event of voice.events) {
				if (event.type === 'context') {
					const ctx = event as ContextChange;
					if (ctx.tempo) {
						measureTempo = ctx.tempo;
					}
				}
			}
		}
	}

	// Group voices by global staff (local staff + part offset)
	const voicesByStaff: Record<number, Voice[]> = {};
	for (let pi = 0; pi < measure.parts.length; pi++) {
		const part = measure.parts[pi];
		const partOffset = partInfos[pi]?.staffOffset || 0;
		for (const voice of part.voices) {
			const localStaff = voice.staff || 1;
			const globalStaff = partOffset + localStaff;
			if (!voicesByStaff[globalStaff]) {
				voicesByStaff[globalStaff] = [];
			}
			voicesByStaff[globalStaff].push(voice);
		}
	}

	// Encode each staff, passing and updating tie state and clef state
	for (let si = 1; si <= totalStaves; si++) {
		const voices = voicesByStaff[si] || [];
		const initialClef = clefState[si];
		const result = encodeStaff(voices, si, indent + '    ', tieState, keyFifths, initialClef);
		xml += result.xml;
		allHairpins.push(...result.hairpins);
		allPedals.push(...result.pedals);
		allOctaves.push(...result.octaves);
		allArpeggios.push(...result.arpeggios);
		allFermatas.push(...result.fermatas);
		allTrills.push(...result.trills);
		allMordents.push(...result.mordents);
		allTurns.push(...result.turns);
		allDynamics.push(...result.dynamics);
		// Update tie state with pending ties from this staff
		Object.assign(tieState, result.pendingTies);
		// Update clef state with ending clef from this staff
		if (result.endingClef) {
			clefState[si] = result.endingClef;
		}
	}

	// Generate tempo element if present
	if (measureTempo) {
		xml += generateTempoElement(measureTempo, indent + '    ');
	}

	// Generate hairpin control events
	for (const hp of allHairpins) {
		xml += `${indent}    <hairpin xml:id="${generateId('hairpin')}" form="${hp.form}" startid="#${hp.startId}" endid="#${hp.endId}" />\n`;
	}

	// Generate pedal control events
	for (const ped of allPedals) {
		xml += `${indent}    <pedal xml:id="${generateId('pedal')}" dir="down" startid="#${ped.startId}" endid="#${ped.endId}" />\n`;
	}

	// Generate octave control events
	for (const oct of allOctaves) {
		xml += `${indent}    <octave xml:id="${generateId('octave')}" dis="${oct.dis}" dis.place="${oct.disPlace}" startid="#${oct.startId}" endid="#${oct.endId}" />\n`;
	}

	// Generate arpeggio control events
	for (const arp of allArpeggios) {
		xml += `${indent}    <arpeg xml:id="${generateId('arpeg')}" plist="#${arp.plist}" />\n`;
	}

	// Generate fermata control events
	for (const ferm of allFermatas) {
		const shapeAttr = ferm.shape ? ` shape="${ferm.shape}"` : '';
		xml += `${indent}    <fermata xml:id="${generateId('fermata')}" startid="#${ferm.startid}"${shapeAttr} />\n`;
	}

	// Generate trill control events
	for (const tr of allTrills) {
		xml += `${indent}    <trill xml:id="${generateId('trill')}" startid="#${tr.startid}" />\n`;
	}

	// Generate mordent control events
	for (const mord of allMordents) {
		const formAttr = mord.form ? ` form="${mord.form}"` : '';
		xml += `${indent}    <mordent xml:id="${generateId('mordent')}" startid="#${mord.startid}"${formAttr} />\n`;
	}

	// Generate turn control events
	for (const tu of allTurns) {
		xml += `${indent}    <turn xml:id="${generateId('turn')}" startid="#${tu.startid}" />\n`;
	}

	// Generate dynamic control events
	for (const dyn of allDynamics) {
		xml += `${indent}    <dynam xml:id="${generateId('dynam')}" startid="#${dyn.startid}">${dyn.label}</dynam>\n`;
	}

	xml += `${indent}</measure>\n`;
	return xml;
};


// Part structure info for encoding
interface PartInfo {
	maxStaff: number;      // Maximum staff number within this part
	staffOffset: number;   // Global staff number offset (0-based)
	clefs: Record<number, Clef>;  // Local staff -> clef mapping
}

// Analyze document to get part structure
const analyzePartStructure = (doc: LilyletDoc): PartInfo[] => {
	// Find maximum number of parts in any measure
	let maxParts = 0;
	for (const measure of doc.measures) {
		maxParts = Math.max(maxParts, measure.parts.length);
	}

	// Initialize part info
	const partInfos: PartInfo[] = [];
	for (let i = 0; i < maxParts; i++) {
		partInfos.push({ maxStaff: 1, staffOffset: 0, clefs: {} });
	}

	// Analyze each measure to find max staff per part and clefs
	for (const measure of doc.measures) {
		for (let pi = 0; pi < measure.parts.length; pi++) {
			const part = measure.parts[pi];
			for (const voice of part.voices) {
				const localStaff = voice.staff || 1;
				partInfos[pi].maxStaff = Math.max(partInfos[pi].maxStaff, localStaff);

				// Get FIRST clef from context changes (for initial staffDef)
				for (const event of voice.events) {
					if (event.type === 'context') {
						const ctx = event as ContextChange;
						if (ctx.clef && !partInfos[pi].clefs[localStaff]) {
							// Only set if not already set - take the FIRST clef
							partInfos[pi].clefs[localStaff] = ctx.clef;
						}
					}
				}
			}
		}
	}

	// Calculate staff offsets
	let offset = 0;
	for (const info of partInfos) {
		info.staffOffset = offset;
		offset += info.maxStaff;
	}

	return partInfos;
};

// Encode scoreDef with part groups
const encodeScoreDef = (
	keySig: string,
	timeNum: number,
	timeDen: number,
	partInfos: PartInfo[],
	indent: string
): string => {
	const scoreDefId = generateId("scoredef");

	let xml = `${indent}<scoreDef xml:id="${scoreDefId}" key.sig="${keySig}" meter.count="${timeNum}" meter.unit="${timeDen}">\n`;
	xml += `${indent}    <staffGrp xml:id="${generateId("staffgrp")}">\n`;

	for (let pi = 0; pi < partInfos.length; pi++) {
		const info = partInfos[pi];

		// If part has multiple staves (grand staff), wrap in staffGrp with brace
		if (info.maxStaff > 1) {
			xml += `${indent}        <staffGrp xml:id="${generateId("staffgrp")}" symbol="brace" bar.thru="true">\n`;
			for (let ls = 1; ls <= info.maxStaff; ls++) {
				const globalStaff = info.staffOffset + ls;
				const clef = info.clefs[ls] || Clef.treble;
				const clefInfo = CLEF_SHAPES[clef] || CLEF_SHAPES.treble;
				xml += `${indent}            <staffDef xml:id="${generateId('staffdef')}" n="${globalStaff}" lines="5" clef.shape="${clefInfo.shape}" clef.line="${clefInfo.line}" />\n`;
			}
			xml += `${indent}        </staffGrp>\n`;
		} else {
			// Single staff part
			const globalStaff = info.staffOffset + 1;
			const clef = info.clefs[1] || Clef.treble;
			const clefInfo = CLEF_SHAPES[clef] || CLEF_SHAPES.treble;
			xml += `${indent}        <staffDef xml:id="${generateId('staffdef')}" n="${globalStaff}" lines="5" clef.shape="${clefInfo.shape}" clef.line="${clefInfo.line}" />\n`;
		}
	}

	xml += `${indent}    </staffGrp>\n`;
	xml += `${indent}</scoreDef>\n`;
	return xml;
};


// Main encode function
const encode = (doc: LilyletDoc, options: MEIEncoderOptions = {}): string => {
	const indent = options.indent || "    ";
	resetIdCounter();

	if (!doc.measures || doc.measures.length === 0) {
		return "";
	}

	// Analyze part structure to get staff offsets
	const partInfos = analyzePartStructure(doc);

	// Calculate total staff count
	const totalStaves = partInfos.reduce((sum, info) => sum + info.maxStaff, 0);

	// Collect initial key/time from first measure
	let currentKey = 0;
	let currentTimeNum = 4;
	let currentTimeDen = 4;

	const firstMeasure = doc.measures[0];
	if (firstMeasure.key) {
		currentKey = keyToFifths(firstMeasure.key);
	}
	if (firstMeasure.timeSig) {
		currentTimeNum = firstMeasure.timeSig.numerator;
		currentTimeDen = firstMeasure.timeSig.denominator;
	}

	const keySig = KEY_SIGS[currentKey] || "0";

	// Build MEI document
	const xmlDecl = options.xmlDeclaration !== false
		? '<?xml version="1.0" encoding="UTF-8"?>\n'
		: "";

	let mei = xmlDecl;
	mei += '<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">\n';
	mei += `${indent}<meiHead>\n`;
	mei += `${indent}${indent}<fileDesc>\n`;
	mei += `${indent}${indent}${indent}<titleStmt>\n`;

	// Add title from metadata if available
	const title = doc.metadata?.title || "Lilylet Export";
	mei += `${indent}${indent}${indent}${indent}<title>${escapeXml(title)}</title>\n`;

	// Add subtitle as second title (verovio reads subsequent titles as subtitle)
	if (doc.metadata?.subtitle) {
		mei += `${indent}${indent}${indent}${indent}<title>${escapeXml(doc.metadata.subtitle)}</title>\n`;
	}

	// Add composer (right-aligned in verovio)
	if (doc.metadata?.composer) {
		mei += `${indent}${indent}${indent}${indent}<composer>${escapeXml(doc.metadata.composer)}</composer>\n`;
	}

	// Add arranger (right-aligned in verovio)
	if (doc.metadata?.arranger) {
		mei += `${indent}${indent}${indent}${indent}<arranger>${escapeXml(doc.metadata.arranger)}</arranger>\n`;
	}

	// Add lyricist (left-aligned in verovio)
	if (doc.metadata?.lyricist) {
		mei += `${indent}${indent}${indent}${indent}<lyricist>${escapeXml(doc.metadata.lyricist)}</lyricist>\n`;
	}

	mei += `${indent}${indent}${indent}</titleStmt>\n`;
	mei += `${indent}${indent}${indent}<pubStmt />\n`;
	mei += `${indent}${indent}</fileDesc>\n`;
	mei += `${indent}${indent}<encodingDesc>\n`;
	mei += `${indent}${indent}${indent}<projectDesc>\n`;
	mei += `${indent}${indent}${indent}${indent}<p>Encoded with Lilylet MEIEncoder</p>\n`;
	mei += `${indent}${indent}${indent}</projectDesc>\n`;
	mei += `${indent}${indent}</encodingDesc>\n`;
	mei += `${indent}</meiHead>\n`;
	mei += `${indent}<music>\n`;
	mei += `${indent}${indent}<body>\n`;
	mei += `${indent}${indent}${indent}<mdiv xml:id="${generateId("mdiv")}">\n`;
	mei += `${indent}${indent}${indent}${indent}<score xml:id="${generateId("score")}">\n`;
	mei += encodeScoreDef(keySig, currentTimeNum, currentTimeDen, partInfos, `${indent}${indent}${indent}${indent}${indent}`);
	mei += `${indent}${indent}${indent}${indent}${indent}<section xml:id="${generateId("section")}">\n`;

	// Track tie state across measures for cross-measure ties
	const tieState: TieState = {};

	// Initialize clef state from partInfos (convert local staff to global staff)
	const clefState: ClefState = {};
	for (let pi = 0; pi < partInfos.length; pi++) {
		const partInfo = partInfos[pi];
		for (const [localStaffStr, clef] of Object.entries(partInfo.clefs)) {
			const globalStaff = partInfo.staffOffset + parseInt(localStaffStr);
			clefState[globalStaff] = clef;
		}
	}

	// Encode measures
	doc.measures.forEach((measure, mi) => {
		// Update key signature if measure has one
		if (measure.key) {
			currentKey = keyToFifths(measure.key);
		}
		mei += encodeMeasure(measure, mi + 1, `${indent}${indent}${indent}${indent}${indent}${indent}`, totalStaves, tieState, currentKey, partInfos, clefState);
	});

	mei += `${indent}${indent}${indent}${indent}${indent}</section>\n`;
	mei += `${indent}${indent}${indent}${indent}</score>\n`;
	mei += `${indent}${indent}${indent}</mdiv>\n`;
	mei += `${indent}${indent}</body>\n`;
	mei += `${indent}</music>\n`;
	mei += '</mei>\n';

	return mei;
};


// Escape XML special characters
const escapeXml = (text: string): string => {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
};


export {
	encode,
	resetIdCounter,
	MEIEncoderOptions,
};
