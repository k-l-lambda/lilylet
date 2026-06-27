
import {
	LilyletDoc,
	Measure,
	Voice,
	NoteEvent,
	RestEvent,
	ContextChange,
	TupletEvent,
	TimesEvent,
	TremoloEvent,
	BarlineEvent,
	HarmonyEvent,
	MarkupEvent,
	DynamicEvent,
	Pitch,
	Clef,
	Accidental,
	OrnamentType,
	StemDirection,
	Mark,
	Beam,
	HairpinType,
	PedalType,
	NavigationMarkType,
	Tempo,
	Event,
	InstrumentName,
} from "./types";
import { parseStaffLayout, StaffGroup, StaffGroupType } from "./staffLayout";
import { gmProgramOf } from "./gmInstruments";
import { parseMeasureLayout, expandMeasureLayout, decomposeToSegments } from "./measureLayout";


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

	// Clamp to valid range [-7, 7] since standard notation doesn't support more than 7 sharps/flats
	return Math.max(-7, Math.min(7, fifths));
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


// Semitone offsets of the major/perfect intervals within one diatonic octave,
// indexed by diatonic step (0 = unison, 1 = 2nd, … 6 = 7th).
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Convert a LilyPond clef interval-number suffix into an MEI written→sounding
// transposition. The number N is a diatonic interval number (2 = 2nd, 3 = 3rd,
// 5 = 5th, 8 = octave, 15 = two octaves); "_" lowers the sounding pitch, "^"
// raises it. Returns { diat, semi } where diat is the diatonic step shift
// (N - 1, signed) and semi is the corresponding chromatic shift in semitones,
// extended octave-wise for compound intervals.
const clefTransposition = (intervalNumber: number, up: boolean): { diat: number; semi: number } => {
	const k = intervalNumber - 1;					// diatonic steps
	const semis = DIATONIC_SEMITONES[k % 7] + 12 * Math.floor(k / 7);
	const sign = up ? 1 : -1;
	return { diat: sign * k, semi: sign * semis };
};

// Resolve a clef string into MEI shape/line plus optional written→sounding
// transposition. Per the LilyPond convention a "_N"/"^N" suffix transposes the
// clef down/up by the diatonic interval N (e.g. "treble_8" octave down,
// "treble_5" fifth down, "treble^3" third up). MEI's clef.dis only covers octave
// displacement (8|15|22), so all clef transposition — octaves included — is
// encoded uniformly via att.transposition (trans.diat / trans.semi) on staffDef.
const resolveClef = (clefStr: string): { shape: string; line: number; trans?: { diat: number; semi: number } } => {
	const match = clefStr.match(/^(.*?)([_^])(\d+)$/);
	const base = match ? match[1] : clefStr;
	const clefInfo = CLEF_SHAPES[base] || CLEF_SHAPES.treble;
	if (!match) return { shape: clefInfo.shape, line: clefInfo.line };
	const trans = clefTransposition(Number(match[3]), match[2] === "^");
	return {
		shape: clefInfo.shape,
		line: clefInfo.line,
		trans,
	};
};

// Attributes for a standalone <clef> element (mid-measure clef change).
// A mid-measure <clef> cannot carry att.transposition (that is a staff-level
// property Verovio only reads from <staffDef>); the visible clef shape/line is
// emitted here, and a sounding-pitch transposition change is mirrored by a
// between-measure <scoreDef>/<staffDef trans.*> emitted in the measure loop
// (see emitClefTranspositionScoreDef). So only shape/line are emitted here.
const clefElementAttrs = (clefStr: string): string => {
	const c = resolveClef(clefStr);
	return `shape="${c.shape}" line="${c.line}"`;
};

// The written→sounding transposition a clef declares, as {diat, semi}; {0,0}
// when the clef declares none. Used to detect mid-piece transposition changes
// and to emit the resetting <staffDef> when a transposing clef is replaced by a
// plain one (Verovio retains a prior trans.* until an explicit 0/0 overrides it).
const clefTransOf = (clefStr: string): { diat: number; semi: number } => {
	const c = resolveClef(clefStr);
	return c.trans || { diat: 0, semi: 0 };
};

// Attributes for a <staffDef> clef (clef.* namespace), plus att.transposition
// (trans.diat / trans.semi) when the clef declares a transposition.
const staffDefClefAttrs = (clefStr: string): string => {
	const c = resolveClef(clefStr);
	let attrs = `clef.shape="${c.shape}" clef.line="${c.line}"`;
	if (c.trans) attrs += ` trans.diat="${c.trans.diat}" trans.semi="${c.trans.semi}"`;
	return attrs;
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
	fp: "fp",
};


// ID generation state - uses session prefix to prevent collisions in concurrent encoding
let idCounter = 0;
let sessionPrefix = '';

const generateId = (prefix: string): string => {
	return `${prefix}-${sessionPrefix}${String(++idCounter).padStart(10, "0")}`;
};

const resetIdCounter = (): void => {
	idCounter = 0;
	// Generate a unique 4-char hex session prefix for this encode call
	sessionPrefix = Math.random().toString(16).substring(2, 6);
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

// Convert Pitch to MEI attributes, checking against key signature and in-measure accidentals
// ottavaShift: current ottava level (1 = 8va up, -1 = 8vb down, 2 = 15ma up, etc.)
// The written pitch should be adjusted by subtracting the ottava shift
// measureAccidentals: tracks accidentals used earlier in the same measure (keyed by "pname-oct")
//   - mutated to record new accidentals; used to add cancellation naturals
const encodePitch = (pitch: Pitch, keyFifths: number = 0, ottavaShift: number = 0, measureAccidentals?: Map<string, string>): { pname: string; oct: number; octGes?: number; accid?: string; accidGes?: string } => {
	// Lilylet octave: 0 = middle C octave (C4), positive = higher, negative = lower
	// When ottava is active, the source pitch is the sounding pitch, but we need to output the written pitch
	// For 8va up (ottavaShift=1), written pitch is one octave lower than sounding
	const soundingOct = 4 + pitch.octave;
	const oct = soundingOct - ottavaShift;
	const octGes = ottavaShift !== 0 ? soundingOct : undefined;

	// Get the accidental implied by the key signature for this note
	const keyAccidentals = getKeyAccidentals(keyFifths);
	const keyAccid = keyAccidentals[pitch.phonet];

	// Determine accid (written/displayed) and accid.ges (gestural/sounding)
	let accid: string | undefined;
	let accidGes: string | undefined;

	const pitchKey = `${pitch.phonet}-${oct}`;

	// Check what was previously established for this pitch in this measure
	const prevMeasureAccid = measureAccidentals?.get(pitchKey);

	if (pitch.accidental) {
		const noteAccid = ACCIDENTALS[pitch.accidental];
		if (pitch.courtesy) {
			// Courtesy accidental (!) - always display
			accid = noteAccid;
		} else if (prevMeasureAccid !== undefined && noteAccid !== prevMeasureAccid) {
			// Previous note in this measure had a different accidental - must re-assert
			accid = noteAccid;
		} else if (noteAccid !== keyAccid) {
			// Accidental differs from key signature - display it
			accid = noteAccid;
		}
		// Always set gestural accidental for MIDI generation
		accidGes = noteAccid;
		// Record this accidental for in-measure tracking
		if (measureAccidentals) measureAccidentals.set(pitchKey, noteAccid);
	} else if (keyAccid) {
		// Note has no accidental but key implies one - output natural
		if (pitch.courtesy) {
			// Courtesy accidental (!) - always display
			accid = 'n';
		} else if (prevMeasureAccid === 'n') {
			// Already cancelled earlier in this measure - no need to show again
		} else {
			accid = 'n';
		}
		accidGes = 'n';
		if (measureAccidentals) measureAccidentals.set(pitchKey, 'n');
	} else if (pitch.courtesy && prevMeasureAccid && prevMeasureAccid !== 'n') {
		// Courtesy accidental after an in-measure accidental - force natural display
		accid = 'n';
		accidGes = 'n';
		if (measureAccidentals) measureAccidentals.set(pitchKey, 'n');
	} else if (measureAccidentals) {
		// No explicit accidental, no key accidental - check if earlier note in measure had one
		if (prevMeasureAccid && prevMeasureAccid !== 'n') {
			// Previous note had an accidental - add cancellation natural
			accid = 'n';
			measureAccidentals.set(pitchKey, 'n');
		}
	}

	return { pname: pitch.phonet, oct, octGes, accid, accidGes };
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
	pitch: { pname: string; oct: number; octGes?: number; accid?: string; accidGes?: string },
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
	if (pitch.octGes !== undefined) attrs += ` oct.ges="${pitch.octGes}"`;
	if (pitch.accidGes) attrs += ` accid.ges="${pitch.accidGes}"`;
	if (!inChord && dots > 0) attrs += ` dots="${dots}"`;
	if (!inChord && options.grace) attrs += ` grace="unacc"`;
	if (!inChord && options.tie) attrs += ` tie="${options.tie}"`;
	if (!inChord && options.stemDir) attrs += ` stem.dir="${options.stemDir}"`;
	if (!inChord && options.layerStaff && options.staff && options.staff !== options.layerStaff) {
		attrs += ` staff="${options.staff}"`;
	}
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
	dynamics: string[];  // all dynamics on this event (a note may carry several, e.g. fp written as two marks)
	hairpin?: string;
	pedal?: string;
	pedals?: ('up' | 'down')[];
	tremolo?: number;
	fingerings: { finger: number; placement?: 'above' | 'below' }[];
	navigation?: 'coda' | 'segno';
	markups: { content: string; placement?: 'above' | 'below' }[];
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
		dynamics: [] as string[],
		hairpin: undefined as string | undefined,
		pedal: undefined as string | undefined,
		pedals: [] as ('up' | 'down')[],
		tremolo: undefined as number | undefined,
		fingerings: [] as { finger: number; placement?: 'above' | 'below' }[],
		navigation: undefined as 'coda' | 'segno' | undefined,
		markups: [] as { content: string; placement?: 'above' | 'below' }[],
	};

	if (!marks) return result;

	for (const mark of marks) {
		switch (mark.markType) {
			case 'articulation': {
				const articType = ARTIC_MAP[mark.type];
				if (articType) {
					result.artics.push({
						type: articType,
						placement: mark.placement,
					});
				}
				break;
			}
			case 'ornament':
				if (mark.type === OrnamentType.fermata) {
					result.fermata = 'normal';
				} else if (mark.type === OrnamentType.shortFermata) {
					result.fermata = 'short';
				} else if (mark.type === OrnamentType.trill) {
					result.trill = true;
				} else if (mark.type === OrnamentType.arpeggio) {
					result.arpeggio = true;
				} else if (mark.type === OrnamentType.turn) {
					result.turn = true;
				} else if (mark.type === OrnamentType.mordent) {
					result.mordent = 'lower';
				} else if (mark.type === OrnamentType.prall) {
					result.mordent = 'upper';
				}
				break;
			case 'dynamic': {
				const dynStr = DYNAMIC_MAP[mark.type];
				if (dynStr) {
					result.dynamic = dynStr;  // kept for back-compat (first dynamic)
					result.dynamics.push(dynStr);
				}
				break;
			}
			case 'hairpin':
				if (mark.type === HairpinType.crescendoStart) {
					result.hairpin = 'crescStart';
				} else if (mark.type === HairpinType.diminuendoStart) {
					result.hairpin = 'dimStart';
				} else if (mark.type === HairpinType.crescendoEnd) {
					result.hairpin = 'crescEnd';
				} else if (mark.type === HairpinType.diminuendoEnd) {
					result.hairpin = 'dimEnd';
				}
				break;
			case 'pedal':
				// A note can carry more than one pedal mark (a pedal "bounce": an up
				// to release the previous pedal and an immediate down to re-pedal on
				// the same note), so collect ALL of them rather than keep one scalar.
				if (mark.type === PedalType.sustainOn) {
					result.pedals.push('down');
				} else if (mark.type === PedalType.sustainOff) {
					result.pedals.push('up');
				}
				break;
			case 'tie':
				if (mark.start) {
					result.tieStart = true;
				}
				break;
			case 'slur':
				if (mark.start) {
					result.slurStart = true;
				} else {
					result.slurEnd = true;
				}
				break;
			case 'beam':
				if (mark.start) {
					result.beamStart = true;
				} else {
					result.beamEnd = true;
				}
				break;
			case 'fingering':
				result.fingerings.push({
					finger: (mark as { finger: number }).finger,
					placement: (mark as { placement?: 'above' | 'below' }).placement,
				});
				break;
			case 'navigation':
				result.navigation = (mark as { type: 'coda' | 'segno' }).type;
				break;
			case 'markup':
				result.markups.push({
					content: (mark as { content: string }).content,
					placement: (mark as { placement?: 'above' | 'below' }).placement,
				});
				break;
		}

		// Tremolo (special case - from parser internal mark)
		if ('tremolo' in mark && typeof (mark as { tremolo?: number }).tremolo === 'number') {
			result.tremolo = (mark as { tremolo: number }).tremolo;
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
	pedals?: ('up' | 'down')[];
	hasTieStart: boolean;
	pitches: Pitch[];
	arpeggio: boolean;
	fermata: 'normal' | 'short' | false;
	trill: boolean;
	mordent: 'lower' | 'upper' | false;  // lower = mordent, upper = prall
	turn: boolean;
	dynamic?: string;  // dynamic marking (p, pp, f, ff, etc.) — first one (back-compat)
	dynamics: string[];  // all dynamics on this event
	slurStart: boolean;  // For tracking slur spans
	slurEnd: boolean;    // For tracking slur spans
	fingerings: { finger: number; placement?: 'above' | 'below' }[];
	navigation?: 'coda' | 'segno';
	markups: { content: string; placement?: 'above' | 'below' }[];
}

// Convert NoteEvent to MEI
const noteEventToMEI = (
	event: NoteEvent,
	indent: string,
	layerStaff?: number,
	tieEnd?: boolean,
	contextStemDir?: StemDirection,
	keyFifths: number = 0,
	ottavaShift: number = 0,
	measureAccidentals?: Map<string, string>
): NoteEventResult => {
	const dur = DURATIONS[event.duration.division] || "4";
	const dots = event.duration.dots || 0;
	const markOptions = extractMarkOptions(event.marks);

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
		artics: markOptions.artics,
		tremolo: markOptions.tremolo,
	};

	// Single note
	if (event.pitches.length === 1) {
		const pitch = encodePitch(event.pitches[0], keyFifths, ottavaShift, measureAccidentals);
		const noteId = generateId('note');
		return {
			xml: buildNoteElement(pitch, dur, dots, indent, false, noteOptions, noteId),
			elementId: noteId,
			hairpin: markOptions.hairpin,
			pedal: markOptions.pedal,
			pedals: markOptions.pedals,
			hasTieStart: markOptions.tieStart,
			pitches: event.pitches,
			arpeggio: markOptions.arpeggio,
			fermata: markOptions.fermata,
			trill: markOptions.trill,
			mordent: markOptions.mordent,
			turn: markOptions.turn,
			dynamic: markOptions.dynamic,
			dynamics: markOptions.dynamics,
			slurStart: markOptions.slurStart,
			slurEnd: markOptions.slurEnd,
			fingerings: markOptions.fingerings,
			navigation: markOptions.navigation,
			markups: markOptions.markups,
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
	if (noteOptions.tremolo) {
		const stemMod = tremoloToStemMod(noteOptions.tremolo);
		if (stemMod) chordAttrs += ` stem.mod="${stemMod}"`;
	}

	let result = `${indent}<chord ${chordAttrs}>\n`;

	for (const p of event.pitches) {
		const pitch = encodePitch(p, keyFifths, ottavaShift, measureAccidentals);
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
		pedals: markOptions.pedals,
		hasTieStart: markOptions.tieStart,
		pitches: event.pitches,
		arpeggio: markOptions.arpeggio,
		fermata: markOptions.fermata,
		trill: markOptions.trill,
		mordent: markOptions.mordent,
		turn: markOptions.turn,
		dynamic: markOptions.dynamic,
		dynamics: markOptions.dynamics,
		slurStart: markOptions.slurStart,
		slurEnd: markOptions.slurEnd,
		fingerings: markOptions.fingerings,
		navigation: markOptions.navigation,
		markups: markOptions.markups,
	};
};


// Convert RestEvent to MEI
const restEventToMEI = (event: RestEvent, indent: string, keyFifths: number = 0, ottavaShift: number = 0, measureAccidentals?: Map<string, string>, crossStaff?: number): { xml: string; elementId: string; fermata?: 'normal' | 'short' } => {
	const dur = DURATIONS[event.duration.division] || "4";
	const restId = generateId('rest');
	let attrs = `xml:id="${restId}" dur="${dur}"`;
	if (event.duration.dots > 0) attrs += ` dots="${event.duration.dots}"`;

	// Cross-staff attribute
	if (crossStaff) attrs += ` staff="${crossStaff}"`;

	// A rest may carry a fermata (held silence). Surface it so the layer loop can
	// emit a <fermata> control event referencing this rest's id.
	let fermata: 'normal' | 'short' | undefined;
	if (event.marks) {
		for (const mk of event.marks) {
			if (mk.markType === 'ornament' && (mk as { type?: string }).type === 'fermata') fermata = 'normal';
		}
	}

	// Pitched rest (positioned at specific pitch)
	if (event.pitch) {
		const pitch = encodePitch(event.pitch, keyFifths, ottavaShift);
		attrs += ` ploc="${pitch.pname}" oloc="${pitch.oct}"`;
	}

	// Space rest (invisible)
	if (event.invisible) {
		return { xml: `${indent}<space ${attrs} />\n`, elementId: restId, fermata };
	}

	// Full measure rest
	if (event.fullMeasure) {
		const mRestId = generateId('mrest');
		return { xml: `${indent}<mRest xml:id="${mRestId}" />\n`, elementId: mRestId, fermata };
	}

	return { xml: `${indent}<rest ${attrs} />\n`, elementId: restId, fermata };
};


// TupletEventResult - return type for tupletEventToMEI
interface TupletEventResult {
	xml: string;
	firstNoteId: string | null;  // ID of first note in tuplet (for attaching pending markups)
	lastNoteId: string | null;   // ID of last note/rest in tuplet (for closing/extending ottava spans)
	slurStarts: string[];  // Note IDs that start slurs
	slurEnds: string[];    // Note IDs that end slurs
	dynamics: DynamRef[];
	fermatas: FermataRef[];
	trills: TrillRef[];
	mordents: MordentRef[];
	turns: TurnRef[];
	arpeggios: ArpegRef[];
	pedals: PedalMark[];  // pedal marks on notes inside the tuplet (independent events)
	fingerings: FingerRef[];  // fingering marks on notes inside the tuplet
	markups: MarkupRef[];  // text directions (markup) on notes inside the tuplet
	endingClef?: string;  // Updated clef name if changed inside the tuplet
}

// Check if a tuplet has balanced internal beam groups (both [ and ] inside the same tuplet)
// Returns false for cross-tuplet beams where [ is in one tuplet and ] in another
const tupletHasInternalBeams = (event: TupletEvent): boolean => {
	let starts = 0;
	let ends = 0;
	for (const e of event.events) {
		if (e.type === 'note') {
			const markOptions = extractMarkOptions((e as NoteEvent).marks);
			if (markOptions.beamStart) starts++;
			if (markOptions.beamEnd) ends++;
		}
	}
	return starts > 0 && starts === ends;
};

// Convert TupletEvent to MEI
const tupletEventToMEI = (event: TupletEvent, indent: string, layerStaff?: number, keyFifths: number = 0, currentStaff?: number, ottavaShift: number = 0, inParentBeam: boolean = false, measureAccidentals?: Map<string, string>, currentClef?: string): TupletEventResult => {
	// LilyPond \times 2/3 means "multiply duration by 2/3"
	// So 3 notes × 2/3 = 2 beats worth (3 in time of 2)
	// MEI: num = number of notes written, numbase = normal equivalent
	const num = event.ratio.denominator;      // denominator = actual note count
	const numbase = event.ratio.numerator;    // numerator = time equivalent

	let xml = `${indent}<tuplet xml:id="${generateId('tuplet')}" num="${num}" numbase="${numbase}">\n`;

	const baseIndent = indent + '    ';

	// Effective staff for cross-staff notation
	const effectiveStaff = currentStaff ?? layerStaff;

	// Collect control event info from notes inside tuplet
	let firstNoteId: string | null = null;
	let lastNoteId: string | null = null;  // last note/rest id — anchors an ottava span end
	const slurStarts: string[] = [];
	const slurEnds: string[] = [];
	const dynamics: DynamRef[] = [];
	const fermatas: FermataRef[] = [];
	const trills: TrillRef[] = [];
	const mordents: MordentRef[] = [];
	const turns: TurnRef[] = [];
	const arpeggios: ArpegRef[] = [];
	const pedals: PedalMark[] = [];
	const fingerings: FingerRef[] = [];
	const markups: MarkupRef[] = [];

	// Handle internal beam groups: if notes have manual beam marks, respect them
	const hasInternalBeams = !inParentBeam && tupletHasInternalBeams(event);
	let beamOpen = false;
	let activeClef = currentClef;
	let endingClef: string | undefined;

	for (const e of event.events) {
		if (e.type === 'note') {
			const noteEvent = e as NoteEvent;
			const markOptions = extractMarkOptions(noteEvent.marks);

			// Open beam if this note starts a beam group
			if (hasInternalBeams && markOptions.beamStart && !beamOpen) {
				xml += `${baseIndent}<beam xml:id="${generateId('beam')}">\n`;
				beamOpen = true;
			}

			const noteIndent = beamOpen ? baseIndent + '    ' : baseIndent;

			// For cross-staff notation: set note's staff if different from layerStaff
			const effectiveNoteEvent = effectiveStaff && layerStaff && effectiveStaff !== layerStaff
				? { ...noteEvent, staff: effectiveStaff }
				: noteEvent;
			const result = noteEventToMEI(effectiveNoteEvent, noteIndent, layerStaff, false, undefined, keyFifths, ottavaShift, measureAccidentals);
			xml += result.xml;

			if (!firstNoteId) firstNoteId = result.elementId;
			lastNoteId = result.elementId;

			// Collect slur info
			if (result.slurStart) slurStarts.push(result.elementId);
			if (result.slurEnd) slurEnds.push(result.elementId);

			// Collect other control events
			if (result.dynamics) for (const label of result.dynamics) dynamics.push({ startid: result.elementId, label });
			if (result.fermata) fermatas.push({ startid: result.elementId, shape: result.fermata === 'short' ? 'angular' : undefined });
			if (result.trill) trills.push({ startid: result.elementId });
			if (result.mordent) mordents.push({ startid: result.elementId, form: result.mordent === 'upper' ? 'upper' : undefined });
			if (result.turn) turns.push({ startid: result.elementId });
			if (result.arpeggio) arpeggios.push({ plist: result.elementId });
			if (result.pedals) for (const dir of result.pedals) pedals.push({ startId: result.elementId, dir });
			// Fingerings and text directions (markup) on inner notes are control
			// events that attach by id — collect them so the layer loop can emit
			// <fing>/<dir> for them (previously silently dropped inside tuplets).
			for (const fing of result.fingerings)
				fingerings.push({ startid: result.elementId, finger: fing.finger, placement: fing.placement });
			for (const mkup of result.markups)
				markups.push({ startid: result.elementId, content: mkup.content, placement: mkup.placement });

			// Close beam if this note ends a beam group
			if (hasInternalBeams && markOptions.beamEnd && beamOpen) {
				xml += `${baseIndent}</beam>\n`;
				beamOpen = false;
			}
		} else if (e.type === 'rest') {
			const restIndent = beamOpen ? baseIndent + '    ' : baseIndent;
			const restResult = restEventToMEI(e as RestEvent, restIndent, keyFifths, ottavaShift, measureAccidentals);
			xml += restResult.xml;
			lastNoteId = restResult.elementId;
			if (restResult.fermata) fermatas.push({ startid: restResult.elementId, shape: restResult.fermata === 'short' ? 'angular' : undefined });
		} else if (e.type === 'context') {
			const ctx = e as ContextChange;
			if (ctx.clef && ctx.clef !== activeClef) {
				const layerStaffNum = layerStaff || 1;
				const effectiveStaffNum = effectiveStaff ?? layerStaffNum;
				if (effectiveStaffNum === layerStaffNum) {
					const clefIndent = beamOpen ? baseIndent + '    ' : baseIndent;
					xml += `${clefIndent}<clef xml:id="${generateId('clef')}" ${clefElementAttrs(ctx.clef)} />\n`;
				}
				activeClef = ctx.clef;
				endingClef = ctx.clef;
			}
		}
	}

	// Close any unclosed beam
	if (beamOpen) {
		xml += `${baseIndent}</beam>\n`;
	}

	xml += `${indent}</tuplet>\n`;
	return { xml, firstNoteId, lastNoteId, slurStarts, slurEnds, dynamics, fermatas, trills, mordents, turns, arpeggios, pedals, fingerings, markups, endingClef };
};


// Convert TremoloEvent to MEI (fingered tremolo - alternating between two notes)
const tremoloEventToMEI = (event: TremoloEvent, indent: string, keyFifths: number = 0, ottavaShift: number = 0, measureAccidentals?: Map<string, string>): string => {
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
		const pitch = encodePitch(event.pitchA[0], keyFifths, ottavaShift, measureAccidentals);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		if (pitch.octGes !== undefined) attrs += ` oct.ges="${pitch.octGes}"`;
		if (pitch.accidGes) attrs += ` accid.ges="${pitch.accidGes}"`;
		result += `${indent}    <note ${attrs} />\n`;
	} else if (event.pitchA.length > 1) {
		result += `${indent}    <chord xml:id="${generateId('chord')}" dur="${noteDur}">\n`;
		for (const p of event.pitchA) {
			const pitch = encodePitch(p, keyFifths, ottavaShift, measureAccidentals);
			let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}"`;
			if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
			if (pitch.octGes !== undefined) attrs += ` oct.ges="${pitch.octGes}"`;
			if (pitch.accidGes) attrs += ` accid.ges="${pitch.accidGes}"`;
			result += `${indent}        <note ${attrs} />\n`;
		}
		result += `${indent}    </chord>\n`;
	}

	// Second note (or chord)
	if (event.pitchB.length === 1) {
		const pitch = encodePitch(event.pitchB[0], keyFifths, ottavaShift, measureAccidentals);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		if (pitch.octGes !== undefined) attrs += ` oct.ges="${pitch.octGes}"`;
		if (pitch.accidGes) attrs += ` accid.ges="${pitch.accidGes}"`;
		result += `${indent}    <note ${attrs} />\n`;
	} else if (event.pitchB.length > 1) {
		result += `${indent}    <chord xml:id="${generateId('chord')}" dur="${noteDur}">\n`;
		for (const p of event.pitchB) {
			const pitch = encodePitch(p, keyFifths, ottavaShift, measureAccidentals);
			let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}"`;
			if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
			if (pitch.octGes !== undefined) attrs += ` oct.ges="${pitch.octGes}"`;
			if (pitch.accidGes) attrs += ` accid.ges="${pitch.accidGes}"`;
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

interface PedalMark {
	startId: string;
	dir: 'down' | 'up';
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

interface FingerRef {
	startid: string;
	finger: number;
	placement?: 'above' | 'below';
}

interface NavigationRef {
	type: 'coda' | 'segno';
}

interface HarmonyRef {
	startid: string;
	text: string;
}

interface BarlineRef {
	style: string;
}

interface MarkupRef {
	startid: string;
	content: string;
	placement?: 'above' | 'below';
}

// Slur span data - slurs must be encoded as control events in MEI
interface SlurSpan {
	startId: string;
	endId: string;
}

// Tie state for cross-measure ties - maps staff:layer to pending pitches
type TieState = Record<string, Pitch[]>;
type SlurState = Record<string, string[]>;  // voice key -> open slur startIds (stack, oldest first)
type HairpinState = Record<string, { form: 'cres' | 'dim'; startId: string } | null>;  // voice key -> pending hairpin

// Pending octave span for cross-measure continuation
interface PendingOctave {
	dis: 8 | 15;
	disPlace: 'above' | 'below';
	startId: string;
	shift: number;  // The ottava value (1, -1, 2, -2)
	continued?: boolean;
	emitted?: boolean;
	endToken?: string;
	endFallbackId?: string;
}
type OttavaState = Record<string, PendingOctave | null>;  // voice key -> pending octave span

// Layer result type
interface LayerResult {
	xml: string;
	hairpins: HairpinSpan[];
	pedals: PedalMark[];
	octaves: OctaveSpan[];
	slurs: SlurSpan[];  // Slurs must be control events in MEI
	arpeggios: ArpegRef[];
	fermatas: FermataRef[];
	trills: TrillRef[];
	mordents: MordentRef[];
	turns: TurnRef[];
	dynamics: DynamRef[];
	fingerings: FingerRef[];
	navigations: NavigationRef[];
	harmonies: HarmonyRef[];
	barlines: BarlineRef[];
	markups: MarkupRef[];
	pendingTiePitches: Pitch[];  // For cross-measure tie tracking
	pendingSlur: string[];  // For cross-measure slur tracking (all open slur startIds)
	pendingHairpin: { form: 'cres' | 'dim'; startId: string } | null;  // For cross-measure hairpin tracking
	pendingOctave: PendingOctave | null;  // For cross-measure ottava span tracking
	ottavaExplicitlyClosed: boolean;  // True if ottava was closed by explicit \ottava #0 in this layer
	endingClef?: Clef;  // For cross-measure clef tracking
	lastNoteId: string | null;  // For cross-measure ottava span end tracking
	currentOttavaShift: number;  // Current ottava shift for pitch encoding
	octaveEndReplacements: Record<string, string>;
}


// Helper: check if an event (or any note inside a tuplet) has beam start/end
const getEventBeamMarks = (event: NoteEvent | RestEvent | TupletEvent | TimesEvent | TremoloEvent | ContextChange | BarlineEvent | HarmonyEvent | MarkupEvent | DynamicEvent | { type: 'pitchReset' }): { beamStart: boolean; beamEnd: boolean } => {
	if (event.type === 'note') {
		const markOptions = extractMarkOptions((event as NoteEvent).marks);
		return { beamStart: markOptions.beamStart, beamEnd: markOptions.beamEnd };
	}
	if (event.type === 'tuplet' || event.type === 'times') {
		const tuplet = event as TupletEvent;
		// If the tuplet has internal beam groups, don't report beam marks to the parent
		// so the parent won't wrap the tuplet in an external <beam>
		if (tupletHasInternalBeams(tuplet)) {
			return { beamStart: false, beamEnd: false };
		}
		let beamStart = false;
		let beamEnd = false;
		for (const e of tuplet.events) {
			if (e.type === 'note') {
				const markOptions = extractMarkOptions((e as NoteEvent).marks);
				if (markOptions.beamStart) beamStart = true;
				if (markOptions.beamEnd) beamEnd = true;
			}
		}
		return { beamStart, beamEnd };
	}
	return { beamStart: false, beamEnd: false };
};

// Encode a layer (voice)
const encodeLayer = (voice: Voice, layerN: number, indent: string, initialTiePitches: Pitch[] = [], keyFifths: number = 0, initialClef?: Clef, initialSlurs: string[] = [], initialHairpin: { form: 'cres' | 'dim'; startId: string } | null = null, initialOctave: PendingOctave | null = null): LayerResult => {
	const layerId = generateId("layer");
	let xml = `${indent}<layer xml:id="${layerId}" n="${layerN}">\n`;

	let beamElementOpen = false;  // Whether actual <beam> element is open (passed to tuplets)
	const baseIndent = indent + '    ';

	// Track current clef to only emit changes
	let currentClef: Clef | undefined = initialClef;

	// Track hairpin spans. Use a stack of open hairpins (not a single slot): the
	// flattened layer stream can interleave overlapping/cross-staff hairpins
	// (e.g. a crescendo starting before the previous one ended), and a single slot
	// would silently overwrite the earlier one. Seed with any hairpin still open
	// from the previous measure (cross-measure carry).
	const hairpins: HairpinSpan[] = [];
	const openHairpins: { form: 'cres' | 'dim'; startId: string }[] = initialHairpin ? [initialHairpin] : [];

	// Track pedal marks (each is independent, not paired spans)
	const pedals: PedalMark[] = [];

	// Track octave spans - initialize from previous measure if continuing
	const octaves: OctaveSpan[] = [];
	const octaveEndReplacements: Record<string, string> = {};
	let currentOctave: { dis: 8 | 15; disPlace: 'above' | 'below'; startId: string; continued?: boolean; emitted?: boolean; endToken?: string; endFallbackId?: string } | null =
		initialOctave ? { dis: initialOctave.dis, disPlace: initialOctave.disPlace, startId: initialOctave.startId, continued: initialOctave.continued, emitted: initialOctave.emitted, endToken: initialOctave.endToken, endFallbackId: initialOctave.endFallbackId } : null;
	let pendingOttava: number | null = null;  // Track ottava to apply to next note
	let currentOttavaShift: number = initialOctave?.shift || 0;  // Track current ottava shift for pitch encoding
	let lastNoteId: string | null = null;  // Track last note id for ending ottava spans
	let ottavaExplicitlyClosed: boolean = false;  // Track if ottava was explicitly closed by \ottava #0

	// ── Ottava span anchoring (shared by note / rest / tuplet cases) ──
	// Originally the open/extend/close logic lived ONLY in `case 'note'`, so an
	// ottava span running over a tuplet run (ubiquitous in etudes) or over rests
	// was never opened — the whole span vanished (No.26 10→0, No.20 7→0). These
	// helpers let any event type anchor a span. Mirror the note-case ordering:
	// the caller updates lastNoteId to the event's first emitted id, THEN calls
	// these.
	// Apply a pending ottava's pitch shift before the event's notes are encoded.
	const applyPendingOttavaShift = (): void => {
		if (pendingOttava !== null && pendingOttava !== 0) currentOttavaShift = pendingOttava;
	};
	// Extend a carried (endToken) span's end to this event's last emitted id.
	const extendOttavaEnd = (lastId: string): void => {
		if (currentOctave?.endToken) octaveEndReplacements[currentOctave.endToken] = lastId;
	};
	// Open the pending ottava span on `anchorId` (the event's FIRST emitted id),
	// closing any open span of a different value first; or resolve a continued span.
	const applyOttavaAnchor = (anchorId: string): void => {
		if (pendingOttava !== null && pendingOttava !== 0) {
			const dis: 8 | 15 = Math.abs(pendingOttava) === 2 ? 15 : 8;
			const disPlace: 'above' | 'below' = pendingOttava > 0 ? 'above' : 'below';
			if (currentOctave && (currentOctave.dis !== dis || currentOctave.disPlace !== disPlace)) {
				octaves.push({ dis: currentOctave.dis, disPlace: currentOctave.disPlace, startId: currentOctave.startId, endId: anchorId });
				currentOctave = null;
			}
			if (!currentOctave) currentOctave = { dis, disPlace, startId: anchorId };
			pendingOttava = null;
		} else if (currentOctave?.continued) {
			if (!currentOctave.endToken) currentOctave.startId = anchorId;
			currentOctave.continued = false;
		}
	};

	// Track slur spans - slurs must be encoded as control events in MEI.
	// A single slot can't hold the overlapping/concurrent slurs that piano writing
	// produces (measured up to 3 open at once per voice); a new start while one was
	// open overwrote it and the span was lost. Use a STACK and pair each end to the
	// most-recent open slur (LIFO), matching the hairpin fix. `currentSlur` is kept
	// as a view of the stack top for the existing cross-measure carry plumbing.
	const slurs: SlurSpan[] = [];
	const openSlurs: { startId: string }[] = initialSlurs.map(startId => ({ startId }));
	let currentSlur: { startId: string } | null = openSlurs.length ? openSlurs[openSlurs.length - 1] : null;

	// Track arpeggio refs
	const arpeggios: ArpegRef[] = [];

	// Track ornament refs
	const fermatas: FermataRef[] = [];
	const trills: TrillRef[] = [];
	const mordents: MordentRef[] = [];
	const turns: TurnRef[] = [];
	const dynamics: DynamRef[] = [];
	const fingerings: FingerRef[] = [];
	const navigations: NavigationRef[] = [];
	const harmonies: HarmonyRef[] = [];
	const barlines: BarlineRef[] = [];
	const markups: MarkupRef[] = [];
	const pendingMarkups: { content: string; placement?: 'above' | 'below' }[] = [];
	const pendingDynamics: string[] = [];

	// Track current stem direction from context changes
	let currentStemDirection: StemDirection | undefined = undefined;

	// Track current staff for cross-staff notation
	let currentStaff: number = voice.staff || 1;

	// Track in-measure accidentals for cancellation naturals
	const measureAccidentals = new Map<string, string>();

	// Track pending tie pitches (for tie="t" on next note) - initialized from previous measure
	let pendingTiePitches: Pitch[] = [...initialTiePitches];

	// Helper to flush pending markups onto a note ID
	const flushPendingMarkups = (noteId: string) => {
		for (const mkup of pendingMarkups) {
			markups.push({ startid: noteId, content: mkup.content, placement: mkup.placement });
		}
		pendingMarkups.length = 0;
	};

	// Helper to flush pending leading dynamics onto a note ID
	const flushPendingDynamics = (noteId: string) => {
		for (const label of pendingDynamics) {
			dynamics.push({ startid: noteId, label });
		}
		pendingDynamics.length = 0;
	};

	// Helper to check if pitches match for tie continuation
	const pitchesMatch = (p1: Pitch[], p2: Pitch[]): boolean => {
		if (p1.length !== p2.length) return false;
		for (let i = 0; i < p1.length; i++) {
			if (p1[i].phonet !== p2[i].phonet || p1[i].octave !== p2[i].octave) return false;
		}
		return true;
	};

	let graceBeamOpen = false;  // Whether a grace note <beam> is open (independent of main beam)

	for (const event of voice.events) {
		// Check for beam start/end in this event (including inside tuplets)
		const { beamStart, beamEnd } = getEventBeamMarks(event);

		// Grace notes have independent beam groups - don't interfere with main beam
		const isGraceNote = event.type === 'note' && (event as NoteEvent).grace;

		if (isGraceNote) {
			// Grace beam: open/close independently, nested inside parent beam if open
			const graceBaseIndent = beamElementOpen ? baseIndent + '    ' : baseIndent;
			if (beamStart && !graceBeamOpen) {
				xml += `${graceBaseIndent}<beam xml:id="${generateId('beam')}">\n`;
				graceBeamOpen = true;
			}
		} else {
			// Close any open grace beam before processing a non-grace event
			if (graceBeamOpen) {
				const graceBaseIndent = beamElementOpen ? baseIndent + '    ' : baseIndent;
				xml += `${graceBaseIndent}</beam>\n`;
				graceBeamOpen = false;
			}

			// Open main beam element if beam starts
			if (beamStart && !beamElementOpen) {
				xml += `${baseIndent}<beam xml:id="${generateId('beam')}">\n`;
				beamElementOpen = true;
			}
		}

		const graceIndentBase = beamElementOpen ? baseIndent + '    ' : baseIndent;
		const currentIndent = graceBeamOpen ? graceIndentBase + '    ' : (beamElementOpen ? baseIndent + '    ' : baseIndent);

		switch (event.type) {
			case 'note': {
				const noteEvent = event as NoteEvent;
				// Check if this note should have tie="t" (matches pending tie)
				const tieEnd = pendingTiePitches.length > 0 && pitchesMatch(pendingTiePitches, noteEvent.pitches);

				// If there's a pending ottava, apply it BEFORE encoding the note
				applyPendingOttavaShift();

				// For cross-staff notation: set note's staff to currentStaff if different from voice.staff
				const effectiveNoteEvent = currentStaff !== voice.staff
					? { ...noteEvent, staff: currentStaff }
					: noteEvent;

				const result = noteEventToMEI(effectiveNoteEvent, currentIndent, voice.staff, tieEnd, currentStemDirection, keyFifths, currentOttavaShift, measureAccidentals);
				xml += result.xml;
				lastNoteId = result.elementId;
				extendOttavaEnd(result.elementId);

				// Flush any pending markups onto this note
				flushPendingMarkups(result.elementId);

				// Flush any pending leading dynamics onto this note
				flushPendingDynamics(result.elementId);

				// If there's a pending ottava, start the span on this note
				applyOttavaAnchor(result.elementId);

				// Update pending tie pitches
				if (result.hasTieStart) {
					pendingTiePitches = result.pitches;
				} else if (tieEnd) {
					pendingTiePitches = [];
				}

				// Track hairpin spans
				if (result.hairpin === 'crescStart') {
					openHairpins.push({ form: 'cres', startId: result.elementId });
				} else if (result.hairpin === 'dimStart') {
					openHairpins.push({ form: 'dim', startId: result.elementId });
				} else if ((result.hairpin === 'crescEnd' || result.hairpin === 'dimEnd') && openHairpins.length > 0) {
					const endForm: 'cres' | 'dim' = result.hairpin === 'crescEnd' ? 'cres' : 'dim';
					// Close the most-recent open hairpin of the matching form; if none
					// matches (interleaved/malformed input), fall back to the newest open.
					let idx = -1;
					for (let i = openHairpins.length - 1; i >= 0; i--) {
						if (openHairpins[i].form === endForm) { idx = i; break; }
					}
					if (idx < 0) idx = openHairpins.length - 1;
					const open = openHairpins.splice(idx, 1)[0];
					hairpins.push({
						form: open.form,
						startId: open.startId,
						endId: result.elementId,
					});
				}

				// Track pedal marks (each is independent; a note may carry several,
				// e.g. an up+down pedal bounce at the same beat).
				if (result.pedals) {
					for (const dir of result.pedals) {
						pedals.push({ startId: result.elementId, dir });
					}
				}

				// Track slur spans - end must be processed before start
				// in case a note ends one slur and starts another.
				// Pair an end to the most-recent open slur (LIFO).
				if (result.slurEnd && openSlurs.length > 0) {
					const open = openSlurs.pop()!;
					slurs.push({
						startId: open.startId,
						endId: result.elementId,
					});
				}
				if (result.slurStart) {
					openSlurs.push({ startId: result.elementId });
				}
				currentSlur = openSlurs.length ? openSlurs[openSlurs.length - 1] : null;

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
				if (result.dynamics) {
					for (const label of result.dynamics) dynamics.push({ startid: result.elementId, label });
				}
				// Track fingerings
				for (const fing of result.fingerings) {
					fingerings.push({ startid: result.elementId, finger: fing.finger, placement: fing.placement });
				}
				// Track markups from note marks
				for (const mkup of result.markups) {
					markups.push({ startid: result.elementId, content: mkup.content, placement: mkup.placement });
				}
				// Track navigation marks
				if (result.navigation) {
					navigations.push({ type: result.navigation });
				}
				break;
			}
			case 'rest': {
				// For cross-staff notation: pass staff number if different from voice's home staff
				const restCrossStaff = currentStaff !== (voice.staff || 1) ? currentStaff : undefined;
				// A pending ottava shift applies to a rest's gestural octave too.
				applyPendingOttavaShift();
				const restResult = restEventToMEI(event as RestEvent, currentIndent, keyFifths, currentOttavaShift, measureAccidentals, restCrossStaff);
				xml += restResult.xml;
				lastNoteId = restResult.elementId;
				// An ottava span may open on, run through, or close at a rest (e.g. a
				// span that starts just before LH rests). Anchor it like a note.
				extendOttavaEnd(restResult.elementId);
				applyOttavaAnchor(restResult.elementId);
				// Fermata over a rest (held silence) — emit as a control event on the rest.
				if (restResult.fermata) fermatas.push({ startid: restResult.elementId, shape: restResult.fermata === 'short' ? 'angular' : undefined });
				// A leading dynamic/markup attaches to the next event, which may be this rest
				flushPendingMarkups(restResult.elementId);
				flushPendingDynamics(restResult.elementId);
				break;
			}
			case 'tuplet':
			case 'times': {
				// Tuplet can be nested inside beam in MEI: <beam><tuplet>...</tuplet></beam>
				// Pass beamElementOpen to tuplet so it knows not to create its own beam
				// A pending ottava shift applies to the tuplet's notes' written octave.
				applyPendingOttavaShift();
				const tupletResult = tupletEventToMEI(event as TupletEvent, currentIndent, voice.staff, keyFifths, currentStaff, currentOttavaShift, beamElementOpen, measureAccidentals, currentClef);
				xml += tupletResult.xml;

				// An ottava span can open on, run through, or close at a tuplet (common
				// in etudes where the 8va covers a whole tuplet run). Anchor the span on
				// the tuplet's FIRST note and let its LAST note close/extend it — without
				// this the entire span was dropped (start/close lived only in case 'note').
				if (tupletResult.firstNoteId) applyOttavaAnchor(tupletResult.firstNoteId);
				if (tupletResult.lastNoteId) extendOttavaEnd(tupletResult.lastNoteId);

				// Propagate clef change from inside the tuplet to the parent tracker
				if (tupletResult.endingClef) {
					currentClef = tupletResult.endingClef as Clef;
				}

				// Flush any pending markups onto the first note of the tuplet
				if (tupletResult.firstNoteId) {
					flushPendingMarkups(tupletResult.firstNoteId);
					flushPendingDynamics(tupletResult.firstNoteId);
					lastNoteId = tupletResult.lastNoteId ?? tupletResult.firstNoteId;
				}

				// Process slur ends first (to close open slurs, LIFO), then starts.
				for (const endId of tupletResult.slurEnds) {
					if (openSlurs.length > 0) {
						const open = openSlurs.pop()!;
						slurs.push({
							startId: open.startId,
							endId: endId,
						});
					}
				}

				// Then process slur starts (to open new slurs)
				for (const startId of tupletResult.slurStarts) {
					openSlurs.push({ startId });
				}
				currentSlur = openSlurs.length ? openSlurs[openSlurs.length - 1] : null;

				// Collect other control events from tuplet
				dynamics.push(...tupletResult.dynamics);
				fermatas.push(...tupletResult.fermatas);
				trills.push(...tupletResult.trills);
				mordents.push(...tupletResult.mordents);
				turns.push(...tupletResult.turns);
				arpeggios.push(...tupletResult.arpeggios);
				pedals.push(...tupletResult.pedals);
				fingerings.push(...tupletResult.fingerings);
				markups.push(...tupletResult.markups);

				break;
			}
			case 'tremolo':
				xml += tremoloEventToMEI(event as TremoloEvent, currentIndent, keyFifths, currentOttavaShift, measureAccidentals);
				break;
			case 'context': {
				const ctx = event as ContextChange;
				// Check for clef changes - emit <clef> element only if different from current
				// and only when on the home staff (don't emit cross-staff clefs into this layer)
				if (ctx.clef && ctx.clef !== currentClef) {
					const layerStaff = voice.staff || 1;
					if (currentStaff === layerStaff) {
						xml += `${currentIndent}<clef xml:id="${generateId('clef')}" ${clefElementAttrs(ctx.clef)} />\n`;
					}
					currentClef = ctx.clef;
				}
				// Check for ottava changes
				if (ctx.ottava !== undefined) {
					if (ctx.ottava === 0) {
						// End current ottava span
						if (currentOctave && lastNoteId) {
							if (!currentOctave.emitted) {
								octaves.push({
									dis: currentOctave.dis,
									disPlace: currentOctave.disPlace,
									startId: currentOctave.startId,
									endId: lastNoteId,
								});
							}
							currentOctave = null;
							ottavaExplicitlyClosed = true;  // Mark that we explicitly closed the span
						} else if (currentOctave && currentOctave.emitted) {
							// Stop landed at measure START (no note yet in this layer) but the
							// span was carried+emitted in a PREVIOUS measure: it genuinely ends
							// here. Its deferred endToken was already resolved to the correct
							// last note by extendOttavaEnd as the span ran through prior measures
							// (or by the staff-level carry's endFallbackId), so DON'T rewrite it
							// here — just clear the slot and mark closed, so a later same-value
							// ottava opens a NEW span instead of folding into this one.
							// Without this, sequential cross-measure spans collapse into one
							// (No.57: 18 spans → 8).
							currentOctave = null;
							ottavaExplicitlyClosed = true;
						}
						// Note: if no lastNoteId and not yet emitted (e.g., open+close at
						// measure start with no notes), keep currentOctave alive — it may be
						// continued by a subsequent ottava command with the same value.
						currentOttavaShift = 0;  // Reset the shift (will be restored if continued)
					} else {
						// Check if this continues an existing span (same value)
						const dis: 8 | 15 = Math.abs(ctx.ottava) === 2 ? 15 : 8;
						const disPlace: 'above' | 'below' = ctx.ottava > 0 ? 'above' : 'below';
						if (currentOctave && currentOctave.dis === dis && currentOctave.disPlace === disPlace) {
							// Continuation - restore the shift and let the existing 8va line reach this measure's first note
							currentOttavaShift = ctx.ottava;
						} else {
							// Different value - start new ottava span (will be applied to next note)
							// If there's an existing span with different value, it will be closed when the note is processed
							pendingOttava = ctx.ottava;
						}
					}
				}
				// Check for stem direction changes
				if (ctx.stemDirection !== undefined) {
					currentStemDirection = ctx.stemDirection;
				}
				// Check for staff changes (cross-staff notation)
				if (ctx.staff !== undefined) {
					currentStaff = ctx.staff;
				}
				// Other context changes are handled at measure level
				break;
			}
			case 'pitchReset':
				// Pitch reset events are only used during pitch resolution in the parser.
				// They don't produce any MEI output - just skip them.
				break;
			case 'barline':
				barlines.push({ style: (event as BarlineEvent).style });
				break;
			case 'harmony':
				// Harmony needs a note ID to attach to - use the last note if available
				if (lastNoteId) {
					harmonies.push({ startid: lastNoteId, text: (event as HarmonyEvent).text });
				}
				break;
			case 'markup': {
				// Markup needs a note ID to attach to
				const mkupEvent = event as MarkupEvent;
				if (lastNoteId) {
					markups.push({
						startid: lastNoteId,
						content: mkupEvent.content,
						placement: mkupEvent.placement,
					});
				} else {
					// No note yet - save as pending, will attach to next note
					pendingMarkups.push({ content: mkupEvent.content, placement: mkupEvent.placement });
				}
			}
				break;

			case 'dynamic': {
				// Standalone (leading) dynamic - attaches to the following note
				const dynEvent = event as DynamicEvent;
				pendingDynamics.push(dynEvent.dynamicType);
			}
				break;
		}

		// Close beam element if beam ends
		if (beamEnd) {
			if (isGraceNote && graceBeamOpen) {
				// Close grace beam
				const graceBaseIndent = beamElementOpen ? baseIndent + '    ' : baseIndent;
				xml += `${graceBaseIndent}</beam>\n`;
				graceBeamOpen = false;
			} else if (!isGraceNote && beamElementOpen) {
				// Close main beam
				xml += `${baseIndent}</beam>\n`;
				beamElementOpen = false;
			}
		}
	}

	// Close any unclosed grace beam
	if (graceBeamOpen) {
		const graceBaseIndent = beamElementOpen ? baseIndent + '    ' : baseIndent;
		xml += `${graceBaseIndent}</beam>\n`;
	}

	// Close any unclosed beam
	if (beamElementOpen) {
		xml += `${baseIndent}</beam>\n`;
	}

	// Emit one visible octave span for a continuing ottava; a repeated same-value command can extend it to the next measure.
	if (currentOctave && lastNoteId && !currentOctave.emitted) {
		const endToken = `__OTTAVA_END_${generateId('octaveEnd')}__`;
		octaves.push({
			dis: currentOctave.dis,
			disPlace: currentOctave.disPlace,
			startId: currentOctave.startId,
			endId: endToken,
		});
		currentOctave.emitted = true;
		currentOctave.endToken = endToken;
		currentOctave.endFallbackId = lastNoteId;
	}
	const pendingOctave: PendingOctave | null = currentOctave
		? { dis: currentOctave.dis, disPlace: currentOctave.disPlace, startId: currentOctave.startId, shift: currentOttavaShift, continued: true, emitted: currentOctave.emitted, endToken: currentOctave.endToken, endFallbackId: currentOctave.endFallbackId }
		: null;

	// Resolve hairpins still open at layer end. The cross-measure carry supports a
	// single pending hairpin, so keep the OLDEST open span (bottom of stack — most
	// likely to legitimately continue into the next measure) as pendingHairpin, and
	// flush the rest here, ending them at the last note so they aren't dropped
	// (MusicXML files routinely leave wedges unclosed). Without a last note id there
	// is nothing to attach to, so those are unavoidably dropped.
	let pendingHairpin: { form: 'cres' | 'dim'; startId: string } | null = null;
	if (openHairpins.length > 0) {
		pendingHairpin = openHairpins[0];
		for (let i = 1; i < openHairpins.length; i++) {
			if (lastNoteId) {
				hairpins.push({ form: openHairpins[i].form, startId: openHairpins[i].startId, endId: lastNoteId });
			}
		}
	}

	xml += `${indent}</layer>\n`;
	return { xml, hairpins, pedals, octaves, slurs, arpeggios, fermatas, trills, mordents, turns, dynamics, fingerings, navigations, harmonies, barlines, markups, pendingTiePitches, pendingSlur: openSlurs.map(s => s.startId), pendingHairpin, pendingOctave, ottavaExplicitlyClosed, endingClef: currentClef, lastNoteId, currentOttavaShift, octaveEndReplacements };
};

// Staff result type
interface StaffResult {
	xml: string;
	hairpins: HairpinSpan[];
	pedals: PedalMark[];
	octaves: OctaveSpan[];
	slurs: SlurSpan[];
	arpeggios: ArpegRef[];
	fermatas: FermataRef[];
	trills: TrillRef[];
	mordents: MordentRef[];
	turns: TurnRef[];
	dynamics: DynamRef[];
	fingerings: FingerRef[];
	navigations: NavigationRef[];
	harmonies: HarmonyRef[];
	barlines: BarlineRef[];
	markups: MarkupRef[];
	pendingTies: TieState;  // For cross-measure tie tracking
	pendingSlurs: SlurState;  // For cross-measure slur tracking
	pendingHairpins: HairpinState;  // For cross-measure hairpin tracking
	pendingOctaves: OttavaState;  // For cross-measure ottava span tracking
	ottavaExplicitlyClosed: Record<string, boolean>;  // Track which layers had ottava explicitly closed
	lastNoteIds: Record<string, string | null>;  // For cross-measure ottava span end tracking
	octaveEndReplacements: Record<string, string>;
	endingClef?: Clef;  // For cross-measure clef tracking
}

// Encode a staff
const encodeStaff = (voices: Voice[], staffN: number, indent: string, tieState: TieState = {}, slurState: SlurState = {}, hairpinState: HairpinState = {}, ottavaState: OttavaState = {}, keyFifths: number = 0, initialClef?: Clef): StaffResult => {
	const staffId = generateId("staff");
	let xml = `${indent}<staff xml:id="${staffId}" n="${staffN}">\n`;
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalMark[] = [];
	const allOctaves: OctaveSpan[] = [];
	const allSlurs: SlurSpan[] = [];
	const allArpeggios: ArpegRef[] = [];
	const allFermatas: FermataRef[] = [];
	const allTrills: TrillRef[] = [];
	const allMordents: MordentRef[] = [];
	const allTurns: TurnRef[] = [];
	const allDynamics: DynamRef[] = [];
	const allFingerings: FingerRef[] = [];
	const allNavigations: NavigationRef[] = [];
	const allHarmonies: HarmonyRef[] = [];
	const allBarlines: BarlineRef[] = [];
	const allMarkups: MarkupRef[] = [];
	const pendingTies: TieState = {};
	const pendingSlurs: SlurState = {};
	const pendingHairpins: HairpinState = {};
	const pendingOctaves: OttavaState = {};
	const ottavaExplicitlyClosed: Record<string, boolean> = {};
	const lastNoteIds: Record<string, string | null> = {};
	const octaveEndReplacements: Record<string, string> = {};
	let endingClef: Clef | undefined = initialClef;

	if (voices.length === 0) {
		xml += `${indent}    <layer xml:id="${generateId('layer')}" n="1" />\n`;
	} else {
		voices.forEach((voice, vi) => {
			const layerN = vi + 1;
			const tieKey = `${staffN}-${layerN}`;
			const initialTies = tieState[tieKey] || [];
			const initialSlur = slurState[tieKey] || [];
			const initialHairpin = hairpinState[tieKey] || null;
			const initialOctave = ottavaState[tieKey] || null;
			const result = encodeLayer(voice, layerN, indent + '    ', initialTies, keyFifths, endingClef, initialSlur, initialHairpin, initialOctave);
			xml += result.xml;
			allHairpins.push(...result.hairpins);
			allPedals.push(...result.pedals);
			allOctaves.push(...result.octaves);
			allSlurs.push(...result.slurs);
			allArpeggios.push(...result.arpeggios);
			allFermatas.push(...result.fermatas);
			allTrills.push(...result.trills);
			allMordents.push(...result.mordents);
			allTurns.push(...result.turns);
			allDynamics.push(...result.dynamics);
			allFingerings.push(...result.fingerings);
			allNavigations.push(...result.navigations);
			allHarmonies.push(...result.harmonies);
			allBarlines.push(...result.barlines);
			allMarkups.push(...result.markups);
			Object.assign(octaveEndReplacements, result.octaveEndReplacements);
			// Track pending ties for this layer
			if (result.pendingTiePitches.length > 0) {
				pendingTies[tieKey] = result.pendingTiePitches;
			}
			// Track pending slurs for this layer
			// Always record (even empty) so a measure that closed all its slurs
			// clears the carried stack rather than leaving a stale open slur.
			pendingSlurs[tieKey] = result.pendingSlur;
			// Track pending hairpins for this layer
			if (result.pendingHairpin) {
				pendingHairpins[tieKey] = result.pendingHairpin;
			}
			// Track pending ottava spans for this layer
			if (result.pendingOctave) {
				pendingOctaves[tieKey] = result.pendingOctave;
			}
			// Track if ottava was explicitly closed in this layer
			if (result.ottavaExplicitlyClosed) {
				ottavaExplicitlyClosed[tieKey] = true;
			}
			// Track last note IDs for this layer (for closing ottava spans)
			lastNoteIds[tieKey] = result.lastNoteId;
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
		slurs: allSlurs,
		arpeggios: allArpeggios,
		fermatas: allFermatas,
		trills: allTrills,
		mordents: allMordents,
		turns: allTurns,
		dynamics: allDynamics,
		fingerings: allFingerings,
		navigations: allNavigations,
		harmonies: allHarmonies,
		barlines: allBarlines,
		markups: allMarkups,
		pendingTies,
		pendingSlurs,
		pendingHairpins,
		pendingOctaves,
		ottavaExplicitlyClosed,
		lastNoteIds,
		octaveEndReplacements,
		endingClef,
	};
};


// Tempo text to BPM mapping (approximate values based on musical convention)
const TEMPO_TEXT_TO_BPM: Record<string, number> = {
	// Very slow
	'grave': 35,
	'largo': 50,
	'larghetto': 63,
	'lento': 52,
	'adagio': 70,
	// Slow to moderate
	'andante': 92,
	'andantino': 96,
	'moderato': 114,
	// Fast
	'allegretto': 116,
	'allegro': 138,
	'vivace': 166,
	'presto': 184,
	'prestissimo': 208,
};

// Infer BPM from tempo text
const inferBpmFromText = (text: string): number | undefined => {
	const lowerText = text.toLowerCase();
	for (const [keyword, bpm] of Object.entries(TEMPO_TEXT_TO_BPM)) {
		if (lowerText.includes(keyword)) {
			return bpm;
		}
	}
	return undefined;
};

// Generate tempo element
const generateTempoElement = (tempo: Tempo, indent: string, staff: number = 1): string => {
	let attrs = `xml:id="${generateId('tempo')}" tstamp="1" staff="${staff}"`;

	// Determine BPM: use explicit value or infer from text
	let bpm = tempo.bpm;
	if (!bpm && tempo.text) {
		bpm = inferBpmFromText(tempo.text);
	}

	// Add BPM if available
	if (bpm) {
		attrs += ` midi.bpm="${bpm}"`;
		if (tempo.beat) {
			attrs += ` mm="${bpm}" mm.unit="${tempo.beat.division}"`;
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

// The clef governing a measure's sounding pitch on one global staff: the clef
// carried in from the previous measure, overridden by a leading clef change that
// appears before the first note/rest in the measure (the normal boundary-change
// case). A clef change occurring *after* notes does not retune this measure — it
// becomes the carried clef for the next measure via clefState. This per-measure
// granularity matches what Verovio honors for MIDI: a transposition change takes
// effect only via a between-measure <scoreDef>/<staffDef trans.*>, never from a
// mid-measure <clef> element.
const measureStartClef = (measure: Measure, globalStaff: number, partInfos: PartInfo[], carriedClef?: string): string | undefined => {
	let active = carriedClef;
	for (let pi = 0; pi < measure.parts.length; pi++) {
		const partOffset = partInfos[pi]?.staffOffset || 0;
		for (const voice of measure.parts[pi].voices) {
			if ((partOffset + (voice.staff || 1)) !== globalStaff) continue;
			for (const event of voice.events) {
				if (event.type === 'note' || event.type === 'rest' ||
					event.type === 'tuplet' || event.type === 'times' || event.type === 'tremolo') {
					break; // notes have started; a later clef change governs the next measure
				}
				if (event.type === 'context') {
					const ctx = event as ContextChange;
					if (ctx.clef) active = ctx.clef;
				}
			}
		}
	}
	return active;
};


// Barline style to MEI @right attribute mapping
const BARLINE_TO_MEI: Record<string, string> = {
	'|': 'single',
	'||': 'dbl',
	'|.': 'end',
	'.|:': 'rptstart',
	':|.': 'rptend',
	':..:|': 'rptboth',
	':..:': 'rptboth',
};

// Encode a measure
// encodeMeasure accepts mutable tieState, slurState, hairpinState, ottavaState and clefState that persist across measures
const encodeMeasure = (measure: Measure, measureN: number, indent: string, totalStaves: number, tieState: TieState, slurState: SlurState, hairpinState: HairpinState, ottavaState: OttavaState, keyFifths: number = 0, partInfos: PartInfo[] = [], clefState: ClefState = {}, octaveEndReplacements: Record<string, string> = {}, measureIds?: string[]): string => {
	const measureId = generateId("measure");
	if (measureIds) measureIds.push(measureId);
	let staffContent = '';  // Build staff content first, then add measure tag with barline
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalMark[] = [];
	const allOctaves: OctaveSpan[] = [];
	const allSlurs: SlurSpan[] = [];
	const allArpeggios: ArpegRef[] = [];
	const allFermatas: FermataRef[] = [];
	const allTrills: TrillRef[] = [];
	const allMordents: MordentRef[] = [];
	const allTurns: TurnRef[] = [];
	const allDynamics: DynamRef[] = [];
	const allFingerings: FingerRef[] = [];
	const allNavigations: NavigationRef[] = [];
	const allHarmonies: HarmonyRef[] = [];
	const allBarlines: BarlineRef[] = [];
	const allMarkups: MarkupRef[] = [];

	// Extract tempo from context changes (track which staff it came from)
	let measureTempo: Tempo | undefined;
	let tempoStaff = 1;
	for (let pi = 0; pi < measure.parts.length; pi++) {
		const part = measure.parts[pi];
		const partOffset = partInfos[pi]?.staffOffset || 0;
		for (const voice of part.voices) {
			const localStaff = voice.staff || 1;
			const globalStaff = partOffset + localStaff;
			for (const event of voice.events) {
				if (event.type === 'context') {
					const ctx = event as ContextChange;
					if (ctx.tempo) {
						measureTempo = ctx.tempo;
						tempoStaff = globalStaff;
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

	// Encode each staff, passing and updating tie state, slur state, hairpin state, ottava state and clef state
	for (let si = 1; si <= totalStaves; si++) {
		const voices = voicesByStaff[si] || [];
		const initialClef = clefState[si];
		const result = encodeStaff(voices, si, indent + '    ', tieState, slurState, hairpinState, ottavaState, keyFifths, initialClef);
		staffContent += result.xml;
		allHairpins.push(...result.hairpins);
		allPedals.push(...result.pedals);
		allOctaves.push(...result.octaves);
		allSlurs.push(...result.slurs);
		allArpeggios.push(...result.arpeggios);
		allFermatas.push(...result.fermatas);
		allTrills.push(...result.trills);
		allMordents.push(...result.mordents);
		allTurns.push(...result.turns);
		allDynamics.push(...result.dynamics);
		allFingerings.push(...result.fingerings);
		allNavigations.push(...result.navigations);
		allHarmonies.push(...result.harmonies);
		allBarlines.push(...result.barlines);
		allMarkups.push(...result.markups);
		Object.assign(octaveEndReplacements, result.octaveEndReplacements);
		// Update tie state with pending ties from this staff
		Object.assign(tieState, result.pendingTies);
		// Update slur state with pending slurs from this staff
		Object.assign(slurState, result.pendingSlurs);
		// Update hairpin state with pending hairpins from this staff
		Object.assign(hairpinState, result.pendingHairpins);
		// Update ottava state with pending octaves from this staff.
		// encodeLayer already emits measure-local octave spans, so keep the next measure's start independent.
		const currentStaffPrefix = `${si}-`;
		for (const [key, pending] of Object.entries(result.pendingOctaves)) {
			if (pending) {
				if (pending.endToken && pending.endFallbackId && !octaveEndReplacements[pending.endToken]) {
					octaveEndReplacements[pending.endToken] = pending.endFallbackId;
				}
				ottavaState[key] = pending;
			}
		}
		// For layers in this staff that had pending octaves but didn't in this measure, close the spans
		for (const [key, pending] of Object.entries(ottavaState)) {
			// Only process keys for the current staff
			if (key.startsWith(currentStaffPrefix) && pending && !result.pendingOctaves[key]) {
				// Check if the span was already explicitly closed in encodeLayer
				// If so, don't generate another span (it was already pushed to octaves in encodeLayer)
				if (!result.ottavaExplicitlyClosed[key]) {
					// Ottava ended without explicit close - generate the closing span
					const lastNoteId = result.lastNoteIds[key];
					if (lastNoteId) {
						allOctaves.push({
							dis: pending.dis,
							disPlace: pending.disPlace,
							startId: pending.startId,
							endId: lastNoteId,
						});
					}
				}
				delete ottavaState[key];
			}
		}
		// Update clef state with ending clef from this staff
		if (result.endingClef) {
			clefState[si] = result.endingClef;
		}
	}

	// Generate tempo element if present
	if (measureTempo) {
		staffContent += generateTempoElement(measureTempo, indent + '    ', tempoStaff);
	}

	// Generate hairpin control events
	for (const hp of allHairpins) {
		staffContent += `${indent}    <hairpin xml:id="${generateId('hairpin')}" form="${hp.form}" startid="#${hp.startId}" endid="#${hp.endId}" />\n`;
	}

	// Generate pedal control events (each mark is independent)
	for (const ped of allPedals) {
		staffContent += `${indent}    <pedal xml:id="${generateId('pedal')}" dir="${ped.dir}" startid="#${ped.startId}" />\n`;
	}

	// Generate octave control events
	for (const oct of allOctaves) {
		staffContent += `${indent}    <octave xml:id="${generateId('octave')}" dis="${oct.dis}" dis.place="${oct.disPlace}" startid="#${oct.startId}" endid="#${oct.endId}" />\n`;
	}

	// Generate slur control events
	for (const sl of allSlurs) {
		staffContent += `${indent}    <slur xml:id="${generateId('slur')}" startid="#${sl.startId}" endid="#${sl.endId}" />\n`;
	}

	// Generate arpeggio control events
	for (const arp of allArpeggios) {
		staffContent += `${indent}    <arpeg xml:id="${generateId('arpeg')}" plist="#${arp.plist}" />\n`;
	}

	// Generate fermata control events
	for (const ferm of allFermatas) {
		const shapeAttr = ferm.shape ? ` shape="${ferm.shape}"` : '';
		staffContent += `${indent}    <fermata xml:id="${generateId('fermata')}" startid="#${ferm.startid}"${shapeAttr} />\n`;
	}

	// Generate trill control events
	for (const tr of allTrills) {
		staffContent += `${indent}    <trill xml:id="${generateId('trill')}" startid="#${tr.startid}" />\n`;
	}

	// Generate mordent control events
	for (const mord of allMordents) {
		const formAttr = mord.form ? ` form="${mord.form}"` : '';
		staffContent += `${indent}    <mordent xml:id="${generateId('mordent')}" startid="#${mord.startid}"${formAttr} />\n`;
	}

	// Generate turn control events
	for (const tu of allTurns) {
		staffContent += `${indent}    <turn xml:id="${generateId('turn')}" startid="#${tu.startid}" />\n`;
	}

	// Generate dynamic control events
	for (const dyn of allDynamics) {
		staffContent += `${indent}    <dynam xml:id="${generateId('dynam')}" startid="#${dyn.startid}">${dyn.label}</dynam>\n`;
	}

	// Generate fingering control events
	for (const fing of allFingerings) {
		const placeAttr = fing.placement ? ` place="${fing.placement}"` : '';
		staffContent += `${indent}    <fing xml:id="${generateId('fing')}" startid="#${fing.startid}"${placeAttr}>${fing.finger}</fing>\n`;
	}

	// Generate dir elements for navigation marks (coda, segno)
	for (const nav of allNavigations) {
		// Use <dir> element with appropriate glyph
		const glyph = nav.type === 'coda' ? '𝄌' : '𝄋';  // Unicode coda/segno symbols
		staffContent += `${indent}    <dir xml:id="${generateId('dir')}" tstamp="1">${glyph}</dir>\n`;
	}

	// Generate harm elements for chord symbols
	for (const harm of allHarmonies) {
		staffContent += `${indent}    <harm xml:id="${generateId('harm')}" startid="#${harm.startid}">${escapeXml(harm.text)}</harm>\n`;
	}

	// Generate dir elements for markups
	for (const mkup of allMarkups) {
		const placeAttr = mkup.placement ? ` place="${mkup.placement}"` : '';
		staffContent += `${indent}    <dir xml:id="${generateId('dir')}" startid="#${mkup.startid}"${placeAttr}>${escapeXml(mkup.content)}</dir>\n`;
	}

	// Determine barline attribute from collected barlines
	let barlineAttr = '';
	if (allBarlines.length > 0) {
		const lastBarline = allBarlines[allBarlines.length - 1];
		const meiBarline = BARLINE_TO_MEI[lastBarline.style];
		if (meiBarline && meiBarline !== 'single') {
			barlineAttr = ` right="${meiBarline}"`;
		}
	}

	// Build final XML with measure tag including barline
	let xml = `${indent}<measure xml:id="${measureId}" n="${measureN}"${barlineAttr}>\n`;
	xml += staffContent;
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
				let currentStaff = voice.staff || 1;
				partInfos[pi].maxStaff = Math.max(partInfos[pi].maxStaff, currentStaff);

				// Scan context changes for staff switches and clefs
				for (const event of voice.events) {
					if (event.type === 'context') {
						const ctx = event as ContextChange;
						if (ctx.staff !== undefined) {
							currentStaff = ctx.staff;
							partInfos[pi].maxStaff = Math.max(partInfos[pi].maxStaff, currentStaff);
						}
						if (ctx.clef && !partInfos[pi].clefs[currentStaff]) {
							// Only set if not already set - take the FIRST clef per staff
							partInfos[pi].clefs[currentStaff] = ctx.clef;
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

// MEI staffGrp @symbol for a layout group type (Default → none; Square → bracketsq).
const LAYOUT_SYMBOL: (string | null)[] = [null, "brace", "bracket", "bracketsq"];

// MIDI channel allocator: assigns one channel per distinct GM program so that
// instruments get separate timbres. Verovio defaults every staff to channel 0
// unless <instrDef midi.channel> is set, which would make all ProgramChanges
// collide on one channel (only the last program would sound). We dedup by
// program number — duplicate desks (e.g. two "Violins" staves) share a channel
// — and skip channel 9 (the GM percussion channel) for pitched instruments.
interface ChannelAllocator {
	byProgram: Map<number, number>;
	nextChannel: number;
}

const newChannelAllocator = (): ChannelAllocator => ({ byProgram: new Map(), nextChannel: 0 });

// Channel for a program: reuse the channel already assigned to that program,
// else take the next free channel (skipping 9). Wraps past 16 as graceful
// degradation for scores with more than 15 distinct timbres.
const allocChannel = (alloc: ChannelAllocator, program: number): number => {
	const existing = alloc.byProgram.get(program);
	if (existing !== undefined) return existing;
	let ch = alloc.nextChannel;
	if (ch % 16 === 9) ch++;		// skip GM drum channel
	const assigned = ch % 16;
	alloc.byProgram.set(program, assigned);
	alloc.nextChannel = ch + 1;
	return assigned;
};

// Build <label>/<labelAbbr> child XML for an instrument entry, or "" if none.
// When the instrument name resolves to a General MIDI program, also emit an
// <instrDef midi.instrnum midi.channel> sibling so Verovio's MIDI export assigns
// that timbre (it honors only the numeric @midi.instrnum) on its own channel
// (@midi.channel, else all instruments collide on channel 0). Unknown names emit
// just the label, leaving Verovio's default program (0 = piano).
const instrumentLabelXML = (
	instr: InstrumentName | undefined,
	indent: string,
	channels?: ChannelAllocator,
): string => {
	if (!instr) return "";
	let xml = `${indent}<label>${escapeXml(instr.name)}</label>\n`;
	if (instr.shortName !== undefined) {
		xml += `${indent}<labelAbbr>${escapeXml(instr.shortName)}</labelAbbr>\n`;
	}
	const program = gmProgramOf(instr.name);
	if (program !== undefined) {
		const chanAttr = channels ? ` midi.channel="${allocChannel(channels, program)}"` : "";
		xml += `${indent}<instrDef xml:id="${generateId("instrdef")}" midi.instrnum="${program}"${chanAttr} />\n`;
	}
	return xml;
};

// Recursively emit a <staffGrp>/<staffDef> tree from a parsed [staves] layout group.
// `staffDefAttrs` maps a leaf staff index (0-based, in layout order) to the attribute
// string for the matching global staff's <staffDef>. `instruments` maps a layout group
// key (staffLayout's groupKey: a staff id or range) to its instrument name; matching
// names are emitted as <label>/<labelAbbr> on the staffGrp (groups) or staffDef (leaves).
// bar.thru reflects the group's conjunction (Solid).
const layoutGroupToMEI = (
	group: StaffGroup,
	staffDefAttrs: string[],
	leafCounter: { i: number },
	indent: string,
	instruments: { [key: string]: InstrumentName },
	channels: ChannelAllocator,
): string => {
	const isLeaf = !!group.staff && (!group.subs || group.subs.length === 0);
	const instr = group.key !== undefined ? instruments[group.key] : undefined;

	// A leaf with no grouping symbol (Default) emits just the next staffDef (with label).
	if (isLeaf && (group.type === StaffGroupType.Default || !LAYOUT_SYMBOL[group.type])) {
		return staffDefWithLabel(staffDefAttrs[leafCounter.i++], instr, indent, channels);
	}

	const symbol = LAYOUT_SYMBOL[group.type] ? ` symbol="${LAYOUT_SYMBOL[group.type]}"` : "";
	const barThru = (group.bar ?? 0) > 1 ? ' bar.thru="true"' : '';
	let xml = `${indent}<staffGrp xml:id="${generateId("staffgrp")}"${symbol}${barThru}>\n`;
	// A multi-staff group's instrument name labels the whole group.
	if (!isLeaf) xml += instrumentLabelXML(instr, indent + "    ", channels);
	if (isLeaf) {
		// A single staff that still carries a grouping bracket (e.g. "<b>"): MEI allows
		// a staffGrp wrapping one staffDef. The instrument names the lone staff, so the
		// label goes on the staffDef inside.
		xml += staffDefWithLabel(staffDefAttrs[leafCounter.i++], instr, indent + "    ", channels);
	} else {
		for (const sub of group.subs || []) {
			xml += layoutGroupToMEI(sub, staffDefAttrs, leafCounter, indent + "    ", instruments, channels);
		}
	}
	xml += `${indent}</staffGrp>\n`;
	return xml;
};

// Emit a <staffDef> from its attribute string, with optional instrument <label> children.
const staffDefWithLabel = (
	attrs: string | undefined,
	instr: InstrumentName | undefined,
	indent: string,
	channels?: ChannelAllocator,
): string => {
	if (attrs === undefined) return "";
	if (!instr) return `${indent}<staffDef ${attrs} />\n`;
	let xml = `${indent}<staffDef ${attrs}>\n`;
	xml += instrumentLabelXML(instr, indent + "    ", channels);
	xml += `${indent}</staffDef>\n`;
	return xml;
};

// Encode scoreDef with part groups
const encodeScoreDef = (
	keySig: string,
	timeNum: number,
	timeDen: number,
	partInfos: PartInfo[],
	indent: string,
	meterSymbol?: 'common' | 'cut',
	stavesCode?: string,
	instruments: { [key: string]: InstrumentName } = {}
): string => {
	const scoreDefId = generateId("scoredef");

	// One MIDI channel allocator per score: assigns a distinct channel per GM
	// program so instruments don't collide on channel 0 (see allocChannel).
	const channels = newChannelAllocator();

	// Build meter attributes
	const meterSymAttr = meterSymbol ? ` meter.sym="${meterSymbol}"` : '';
	let xml = `${indent}<scoreDef xml:id="${scoreDefId}" key.sig="${keySig}"${meterSymAttr} meter.count="${timeNum}" meter.unit="${timeDen}">\n`;

	// Flat ordered list of global staves (n + clef), in part/voice order.
	const flatStaves: { n: number; clef: Clef }[] = [];
	for (const info of partInfos) {
		for (let ls = 1; ls <= info.maxStaff; ls++) {
			flatStaves.push({ n: info.staffOffset + ls, clef: info.clefs[ls] || Clef.treble });
		}
	}

	// If a [staves] layout is present and its leaf count matches the staves, drive
	// the nested staffGrp (bracket/bracketsq/brace) from it. Otherwise fall back to
	// the per-part grand-staff grouping.
	let layoutUsed = false;
	if (stavesCode) {
		const layout = parseStaffLayout(stavesCode);
		if (layout.stavesCount === flatStaves.length) {
			const staffDefAttrs = flatStaves.map(
				s => `xml:id="${generateId('staffdef')}" n="${s.n}" lines="5" ${staffDefClefAttrs(s.clef)}`
			);
			xml += layoutGroupToMEI(layout.group, staffDefAttrs, { i: 0 }, `${indent}    `, instruments, channels);
			layoutUsed = true;
		}
	}

	if (!layoutUsed) {
		xml += `${indent}    <staffGrp xml:id="${generateId("staffgrp")}">\n`;

		for (let pi = 0; pi < partInfos.length; pi++) {
			const info = partInfos[pi];

			// If part has multiple staves (grand staff), wrap in staffGrp with brace.
			// Instrument key for a part follows staffLayout's groupKey: a single staff
			// number, or "first-last" for a grand staff.
			if (info.maxStaff > 1) {
				const first = info.staffOffset + 1;
				const last = info.staffOffset + info.maxStaff;
				const instr = instruments[`${first}-${last}`];
				xml += `${indent}        <staffGrp xml:id="${generateId("staffgrp")}" symbol="brace" bar.thru="true">\n`;
				xml += instrumentLabelXML(instr, `${indent}            `, channels);
				for (let ls = 1; ls <= info.maxStaff; ls++) {
					const globalStaff = info.staffOffset + ls;
					const clef = info.clefs[ls] || Clef.treble;
					const leafInstr = instruments[`${globalStaff}`];
					const attrs = `xml:id="${generateId('staffdef')}" n="${globalStaff}" lines="5" ${staffDefClefAttrs(clef)}`;
					xml += staffDefWithLabel(attrs, leafInstr, `${indent}            `, channels);
				}
				xml += `${indent}        </staffGrp>\n`;
			} else {
				// Single staff part
				const globalStaff = info.staffOffset + 1;
				const clef = info.clefs[1] || Clef.treble;
				const leafInstr = instruments[`${globalStaff}`];
				const attrs = `xml:id="${generateId('staffdef')}" n="${globalStaff}" lines="5" ${staffDefClefAttrs(clef)}`;
				xml += staffDefWithLabel(attrs, leafInstr, `${indent}        `, channels);
			}
		}

		xml += `${indent}    </staffGrp>\n`;
	}

	xml += `${indent}</scoreDef>\n`;
	return xml;
};


// === Auto-beam logic ===

// Check if any NoteEvent in the document has a beam mark
const docHasBeamMarks = (doc: LilyletDoc): boolean => {
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				for (const event of voice.events) {
					if (event.type === 'note') {
						const note = event as NoteEvent;
						if (note.marks) {
							for (const m of note.marks) {
								if (m.markType === 'beam') return true;
							}
						}
					} else if (event.type === 'tuplet' || event.type === 'times') {
						const tuplet = event as TupletEvent;
						for (const e of tuplet.events) {
							if (e.type === 'note') {
								const note = e as NoteEvent;
								if (note.marks) {
									for (const m of note.marks) {
										if (m.markType === 'beam') return true;
									}
								}
							}
						}
					}
				}
			}
		}
	}
	return false;
};

// Resolve whether auto-beam should be applied
const resolveAutoBeam = (doc: LilyletDoc): boolean => {
	if (doc.metadata?.autoBeam === 'off') return false;
	if (doc.metadata?.autoBeam === 'on') return true;
	// 'auto' or undefined: auto-beam if no manual beam marks exist
	return !docHasBeamMarks(doc);
};

// Compute beam group sizes in eighth-note units for a given time signature
const getBeamGroups = (timeNum: number, timeDen: number): number[] => {
	// Compound meters (n/8 where n is divisible by 3, and n > 3)
	if (timeDen === 8 && timeNum % 3 === 0 && timeNum > 3) {
		const groupCount = timeNum / 3;
		return Array(groupCount).fill(3);
	}

	// Specific common time signatures (LilyPond defaults)
	if (timeDen === 8 && timeNum === 3) return [3];
	if (timeDen === 4 && timeNum === 2) return [2, 2];
	if (timeDen === 4 && timeNum === 3) return [3, 3];
	if (timeDen === 4 && timeNum === 4) return [4, 4];
	if (timeDen === 2 && timeNum === 2) return [4, 4];

	// Generic simple meters: each beat = 8/den eighths
	const eighthsPerBeat = 8 / timeDen;
	if (eighthsPerBeat >= 1) {
		return Array(timeNum).fill(eighthsPerBeat);
	}

	// Fallback: one group for the whole measure
	const totalEighths = timeNum * 8 / timeDen;
	return [totalEighths];
};

// Calculate duration in eighth-note units
const durationInEighths = (division: number, dots: number, tupletRatio?: { numerator: number; denominator: number }): number => {
	// Base duration in eighths: 8 / division
	let dur = 8 / division;
	// Dot multiplier: 1 + 1/2 + 1/4 + ... = 2 - 1/2^dots
	if (dots > 0) {
		dur *= (2 - Math.pow(0.5, dots));
	}
	// Tuplet ratio: multiply by num/den (LilyPond semantics)
	if (tupletRatio) {
		dur *= tupletRatio.numerator / tupletRatio.denominator;
	}
	return dur;
};

// Apply auto-beam to the document, mutating events' marks arrays in-place
const applyAutoBeam = (doc: LilyletDoc): void => {
	// Track time signature across measures
	let timeNum = 4;
	let timeDen = 4;

	// Get initial time signature
	if (doc.measures.length > 0 && doc.measures[0].timeSig) {
		timeNum = doc.measures[0].timeSig.numerator;
		timeDen = doc.measures[0].timeSig.denominator;
	}

	for (const measure of doc.measures) {
		// Update time signature if changed
		if (measure.timeSig) {
			timeNum = measure.timeSig.numerator;
			timeDen = measure.timeSig.denominator;
		}

		const beamGroups = getBeamGroups(timeNum, timeDen);

		for (const part of measure.parts) {
			for (const voice of part.voices) {
				applyAutoBeamToVoice(voice.events, beamGroups);
			}
		}
	}
};

// A beamable note reference: points to a NoteEvent that can receive beam marks
interface BeamableNote {
	note: NoteEvent;
	position: number; // position in eighths at start of this note
}

// Apply auto-beam to a single voice's events
const applyAutoBeamToVoice = (events: Event[], beamGroups: number[]): void => {
	// Compute group boundary positions in eighths
	const groupBoundaries: number[] = [];
	let boundary = 0;
	for (const size of beamGroups) {
		boundary += size;
		groupBoundaries.push(boundary);
	}
	const totalMeasureEighths = boundary;

	// Collect beamable notes with their positions
	let position = 0;
	const beamableRuns: BeamableNote[][] = [];
	let currentRun: BeamableNote[] = [];

	// Helper: find which group index a position belongs to
	const getGroupIndex = (pos: number): number => {
		for (let i = 0; i < groupBoundaries.length; i++) {
			if (pos < groupBoundaries[i]) return i;
		}
		return groupBoundaries.length - 1;
	};

	// Helper: flush current run into beamableRuns
	const flushRun = () => {
		if (currentRun.length >= 2) {
			beamableRuns.push(currentRun);
		}
		currentRun = [];
	};

	for (const event of events) {
		if (event.type === 'note') {
			const note = event as NoteEvent;
			if (note.grace) continue; // skip grace notes

			const dur = durationInEighths(note.duration.division, note.duration.dots);

			if (note.duration.division >= 8) {
				// Beamable note
				const groupIdx = getGroupIndex(position);
				const noteEndPos = position + dur;
				const endGroupIdx = getGroupIndex(Math.min(noteEndPos - 0.001, totalMeasureEighths - 0.001));

				// Note must start and end within the same group
				if (groupIdx === endGroupIdx) {
					// Check if current run is in the same group
					if (currentRun.length > 0) {
						const lastGroupIdx = getGroupIndex(currentRun[0].position);
						if (lastGroupIdx !== groupIdx) {
							flushRun();
						}
					}
					currentRun.push({ note, position });
				} else {
					// Note spans group boundary — break
					flushRun();
				}
			} else {
				// Non-beamable note (quarter or longer) — break
				flushRun();
			}

			position += dur;
		} else if (event.type === 'rest') {
			const rest = event as RestEvent;
			const dur = durationInEighths(rest.duration.division, rest.duration.dots);
			// Rests break beam groups
			flushRun();
			position += dur;
		} else if (event.type === 'tuplet' || event.type === 'times') {
			const tuplet = event as TupletEvent;
			const ratio = tuplet.ratio; // LilyPond ratio: num/den

			// Check if all inner notes are beamable (division >= 8)
			const innerNotes: { note: NoteEvent; dur: number }[] = [];
			let allBeamable = true;
			let tupletDur = 0;

			for (const e of tuplet.events) {
				if (e.type === 'note') {
					const note = e as NoteEvent;
					if (note.grace) continue;
					const dur = durationInEighths(note.duration.division, note.duration.dots, ratio);
					innerNotes.push({ note, dur });
					tupletDur += dur;
					if (note.duration.division < 8) {
						allBeamable = false;
					}
				} else if (e.type === 'rest') {
					allBeamable = false;
					const dur = durationInEighths(e.duration.division, e.duration.dots, ratio);
					tupletDur += dur;
				}
			}

			if (allBeamable && innerNotes.length > 0) {
				const groupIdx = getGroupIndex(position);
				const endGroupIdx = getGroupIndex(Math.min(position + tupletDur - 0.001, totalMeasureEighths - 0.001));

				if (groupIdx === endGroupIdx) {
					// Tuplet fits within one group — add inner notes to current run
					if (currentRun.length > 0) {
						const lastGroupIdx = getGroupIndex(currentRun[0].position);
						if (lastGroupIdx !== groupIdx) {
							flushRun();
						}
					}
					let innerPos = position;
					for (const { note, dur } of innerNotes) {
						currentRun.push({ note, position: innerPos });
						innerPos += dur;
					}
				} else {
					flushRun();
				}
			} else {
				flushRun();
			}

			position += tupletDur;
		} else if (event.type === 'context' || event.type === 'pitchReset' || event.type === 'barline' || event.type === 'harmony' || event.type === 'markup') {
			// Non-musical events: don't advance position, don't break beams
			continue;
		} else if (event.type === 'tremolo') {
			// Tremolo breaks beams
			const trem = event as TremoloEvent;
			// Total duration = count * 2 * (1/division) in whole notes
			// In eighths: count * 2 * (8/division)
			const dur = trem.count * 2 * (8 / trem.division);
			flushRun();
			position += dur;
		}
	}

	// Flush any remaining run
	flushRun();

	// Apply beam marks to collected runs
	for (const run of beamableRuns) {
		const first = run[0].note;
		const last = run[run.length - 1].note;

		if (!first.marks) first.marks = [];
		first.marks.push({ markType: 'beam', start: true } as Beam);

		if (!last.marks) last.marks = [];
		last.marks.push({ markType: 'beam', start: false } as Beam);
	}
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
	let currentMeterSymbol: 'common' | 'cut' | undefined = undefined;

	const firstMeasure = doc.measures[0];
	if (firstMeasure.key) {
		currentKey = keyToFifths(firstMeasure.key);
	}
	if (firstMeasure.timeSig) {
		currentTimeNum = firstMeasure.timeSig.numerator;
		currentTimeDen = firstMeasure.timeSig.denominator;
		currentMeterSymbol = firstMeasure.timeSig.symbol;
	}

	const keySig = KEY_SIGS[currentKey] || "0";

	// Apply auto-beam if needed (before encoding so beam marks are picked up by encodeLayer)
	const shouldAutoBeam = resolveAutoBeam(doc);
	if (shouldAutoBeam) {
		applyAutoBeam(doc);
	}

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
	if (doc.metadata?.title) {
		mei += `${indent}${indent}${indent}${indent}<title>${escapeXml(doc.metadata.title)}</title>\n`;
	}

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
	mei += encodeScoreDef(keySig, currentTimeNum, currentTimeDen, partInfos, `${indent}${indent}${indent}${indent}${indent}`, currentMeterSymbol, doc.metadata?.staves, doc.metadata?.instruments);
	mei += `${indent}${indent}${indent}${indent}${indent}<section xml:id="${generateId("section")}">\n`;
	// Splice point for an <expansion> element (must be the FIRST child of
	// <section>, but its plist needs the measure ids collected during the loop
	// below — so remember where to insert it and build it afterwards).
	const expansionInsertPos = mei.length;
	const measureIds: string[] = [];

	// Volta playback + house brackets. A flat measure-level <expansion> conflicts
	// with <ending> wrappers in verovio (it then drops the volta measures). Verovio
	// instead wants nested <section>/<ending> groups with a SECTION-LEVEL expansion
	// whose plist references those segment ids. So when the layout decomposes into
	// volta segments, emit that structure; otherwise keep the simpler flat path.
	// See [[volta-rendering-gaps]] / [[lilylet-measure-layout]].
	let segDecomp: ReturnType<typeof decomposeToSegments> = null;
	const segOpenAt = new Map<number, string>();    // measure index → opening tag for its segment
	const segCloseAt = new Map<number, string>();   // measure index → closing tag after it
	const segIdById = new Map<string, string>();    // layout segment id → emitted xml:id
	if (doc.metadata?.measureLayout) {
		try {
			segDecomp = decomposeToSegments(parseMeasureLayout(doc.metadata.measureLayout));
		} catch { segDecomp = null; }
	}
	if (segDecomp) {
		const segIndent = `${indent}${indent}${indent}${indent}${indent}${indent}`;
		for (const seg of segDecomp.segments) {
			const xmlId = generateId(seg.kind === "ending" ? "ending" : "section");
			segIdById.set(seg.id, xmlId);
			const lo = seg.measures[0];
			const hi = seg.measures[seg.measures.length - 1];
			if (seg.kind === "ending") {
				const lendsym = seg.endingNumber === 1 ? ' lendsym="angledown"' : '';
				segOpenAt.set(lo, `${segIndent}<ending xml:id="${xmlId}" n="${seg.endingNumber}"${lendsym}>\n`);
			} else {
				segOpenAt.set(lo, `${segIndent}<section xml:id="${xmlId}">\n`);
			}
			segCloseAt.set(hi, `${segIndent}</${seg.kind === "ending" ? "ending" : "section"}>\n`);
		}
	}

	// Track tie state across measures for cross-measure ties
	const tieState: TieState = {};

	// Track slur state across measures for cross-measure slurs
	const slurState: SlurState = {};

	// Track hairpin state across measures for cross-measure hairpins
	const hairpinState: HairpinState = {};

	// Track ottava state across measures for cross-measure ottava spans
	const ottavaState: OttavaState = {};
	const octaveEndReplacements: Record<string, string> = {};

	// Initialize clef state from partInfos (convert local staff to global staff)
	const clefState: ClefState = {};
	// Running written→sounding transposition per global staff, as the verbatim
	// "diat,semi" key. Seeded from the initial clefs (which the leading <scoreDef>
	// already encoded via staffDefClefAttrs), then advanced whenever a measure
	// starts under a clef with a different transposition.
	const transState: Record<number, string> = {};
	for (let pi = 0; pi < partInfos.length; pi++) {
		const partInfo = partInfos[pi];
		for (const [localStaffStr, clef] of Object.entries(partInfo.clefs)) {
			const globalStaff = partInfo.staffOffset + parseInt(localStaffStr);
			clefState[globalStaff] = clef;
			const t = clefTransOf(clef);
			transState[globalStaff] = `${t.diat},${t.semi}`;
		}
	}

	// Helper to check if a measure has any musical content
	const measureHasContent = (measure: Measure): boolean => {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				for (const event of voice.events) {
					// Check for actual musical content (not just context changes or pitch resets)
					if (event.type === 'note' || event.type === 'rest' ||
						event.type === 'tuplet' || event.type === 'times' || event.type === 'tremolo') {
						return true;
					}
				}
			}
		}
		return false;
	};

	// Filter out trailing empty measures
	let measures = doc.measures;
	while (measures.length > 0 && !measureHasContent(measures[measures.length - 1])) {
		measures = measures.slice(0, -1);
	}

	// Encode measures
	measures.forEach((measure, mi) => {
		// Check for key signature change and output scoreDef if needed
		if (measure.key) {
			const newKey = keyToFifths(measure.key);
			if (newKey !== currentKey) {
				currentKey = newKey;
				const newKeySig = KEY_SIGS[currentKey] || "0";
				// Output a scoreDef with the new key signature
				mei += `${indent}${indent}${indent}${indent}${indent}${indent}<scoreDef xml:id="${generateId('scoredef')}" key.sig="${newKeySig}" />\n`;
			}
		}
		// Check for time signature change and output scoreDef if needed
		if (measure.timeSig && mi > 0) {
			const newTimeNum = measure.timeSig.numerator;
			const newTimeDen = measure.timeSig.denominator;
			const newMeterSymbol = measure.timeSig.symbol;
			if (newTimeNum !== currentTimeNum || newTimeDen !== currentTimeDen || newMeterSymbol !== currentMeterSymbol) {
				currentTimeNum = newTimeNum;
				currentTimeDen = newTimeDen;
				currentMeterSymbol = newMeterSymbol;
				// Output a scoreDef with the new time signature
				const meterSymAttr = currentMeterSymbol ? ` meter.sym="${currentMeterSymbol}"` : '';
				mei += `${indent}${indent}${indent}${indent}${indent}${indent}<scoreDef xml:id="${generateId('scoredef')}"${meterSymAttr} meter.count="${currentTimeNum}" meter.unit="${currentTimeDen}" />\n`;
			}
		}
		// Check for a written→sounding transposition change at this measure
		// boundary and mirror it into MIDI. Verovio applies att.transposition only
		// from <staffDef>, never from a mid-measure <clef>, so a change of
		// transposing clef must be re-declared via a between-measure <scoreDef>.
		// We emit only the staves whose transposition actually changed (a partial
		// <staffGrp> leaves the others' state intact), using explicit "0,0" to
		// clear a prior transposition when a transposing clef is replaced by a
		// plain one. mi === 0 is already covered by the leading <scoreDef>.
		if (mi > 0) {
			const changed: string[] = [];
			for (let si = 1; si <= totalStaves; si++) {
				const startClef = measureStartClef(measure, si, partInfos, clefState[si]);
				if (startClef === undefined) continue;
				const t = clefTransOf(startClef);
				const key = `${t.diat},${t.semi}`;
				if (transState[si] === undefined) { transState[si] = key; continue; }
				if (key !== transState[si]) {
					transState[si] = key;
					const c = resolveClef(startClef);
					changed.push(`${indent}${indent}${indent}${indent}${indent}${indent}${indent}${indent}<staffDef xml:id="${generateId('staffdef')}" n="${si}" lines="5" clef.shape="${c.shape}" clef.line="${c.line}" trans.diat="${t.diat}" trans.semi="${t.semi}" />`);
				}
			}
			if (changed.length > 0) {
				const sd = `${indent}${indent}${indent}${indent}${indent}${indent}`;
				mei += `${sd}<scoreDef xml:id="${generateId('scoredef')}">\n`;
				mei += `${sd}${indent}<staffGrp xml:id="${generateId('staffgrp')}">\n`;
				mei += changed.join("\n") + "\n";
				mei += `${sd}${indent}</staffGrp>\n`;
				mei += `${sd}</scoreDef>\n`;
			}
		}
		const mIndex = mi + 1;
		const mIndent = `${indent}${indent}${indent}${indent}${indent}${indent}`;
		// When the layout decomposes into volta segments, wrap each measure run in
		// its <section>/<ending> container (opened/closed by measure index).
		const openTag = segOpenAt.get(mIndex);
		if (openTag) mei += openTag;
		const measureIndent = segDecomp ? `${mIndent}${indent}` : mIndent;
		mei += encodeMeasure(measure, mIndex, measureIndent, totalStaves, tieState, slurState, hairpinState, ottavaState, currentKey, partInfos, clefState, octaveEndReplacements, measureIds);
		const closeTag = segCloseAt.get(mIndex);
		if (closeTag) mei += closeTag;
	});

	// Emit an <expansion> describing playback order from the measure-layout
	// directive ([measures "..."]). Verovio consumes its plist to unfold repeats
	// for MIDI/time-map output. Inserted as the first child of <section>.
	//   - voltas present (segDecomp): plist references the SECTION/ENDING segment
	//     ids in performed order (a body segment id repeats per pass). This is the
	//     only form verovio plays correctly alongside <ending> house brackets.
	//   - otherwise: the simpler flat measure-level plist (one ref per played bar).
	if (segDecomp) {
		const refs = segDecomp.order.map(segId => segIdById.get(segId)).filter((x): x is string => x !== undefined).map(id => `#${id}`);
		if (refs.length > 0) {
			const expIndent = `${indent}${indent}${indent}${indent}${indent}${indent}`;
			const expXml = `${expIndent}<expansion xml:id="${generateId("expansion")}" plist="${refs.join(" ")}" />\n`;
			mei = mei.slice(0, expansionInsertPos) + expXml + mei.slice(expansionInsertPos);
		}
	}
	else if (doc.metadata?.measureLayout) {
		try {
			const layout = parseMeasureLayout(doc.metadata.measureLayout);
			const order = expandMeasureLayout(layout);
			const refs: string[] = [];
			for (const idx of order) {
				const id = measureIds[idx - 1];   // 1-based index into notated measures
				if (id === undefined) {
					console.warn(`[measures] index ${idx} out of range (only ${measureIds.length} measures); skipping`);
					continue;
				}
				refs.push(`#${id}`);
			}
			if (refs.length > 0) {
				const expIndent = `${indent}${indent}${indent}${indent}${indent}${indent}`;
				const expXml = `${expIndent}<expansion xml:id="${generateId("expansion")}" plist="${refs.join(" ")}" />\n`;
				mei = mei.slice(0, expansionInsertPos) + expXml + mei.slice(expansionInsertPos);
			}
		}
		catch (err) {
			console.warn(`[measures] failed to parse "${doc.metadata.measureLayout}": ${(err as Error).message}`);
		}
	}

	mei += `${indent}${indent}${indent}${indent}${indent}</section>\n`;
	mei += `${indent}${indent}${indent}${indent}</score>\n`;
	mei += `${indent}${indent}${indent}</mdiv>\n`;
	mei += `${indent}${indent}</body>\n`;
	mei += `${indent}</music>\n`;
	mei += '</mei>\n';

	for (const [token, endId] of Object.entries(octaveEndReplacements)) {
		mei = mei.replaceAll(token, endId);
	}

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
