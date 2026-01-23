
import {
	LilyletDoc,
	Measure,
	Voice,
	NoteEvent,
	RestEvent,
	ContextChange,
	TupletEvent,
	TremoloEvent,
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
	portato: "ten-stacc",
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


// Convert Pitch to MEI attributes
const encodePitch = (pitch: Pitch): { pname: string; oct: number; accid?: string } => {
	// Lilylet octave: 0 = middle C octave (C4), positive = higher, negative = lower
	const oct = 4 + pitch.octave;
	const accid = pitch.accidental ? ACCIDENTALS[pitch.accidental] : undefined;

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
		artics?: string[];
		fermata?: 'normal' | 'short' | false;
		trill?: boolean;
		arpeggio?: boolean;
		turn?: boolean;
		mordent?: boolean;
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

	const hasChildren = !inChord && (
		(options.artics && options.artics.length > 0) ||
		options.fermata || options.trill || options.arpeggio ||
		options.turn || options.mordent
	);

	if (!hasChildren) {
		return `${indent}<note ${attrs} />\n`;
	}

	let result = `${indent}<note ${attrs}>\n`;

	if (options.artics && options.artics.length > 0) {
		result += `${indent}    <artic artic="${options.artics.join(' ')}" />\n`;
	}
	if (options.fermata) {
		const fermataAttrs = options.fermata === 'short' ? ` shape="angular"` : '';
		result += `${indent}    <fermata xml:id="${generateId('fermata')}"${fermataAttrs} />\n`;
	}
	if (options.trill) {
		result += `${indent}    <trill xml:id="${generateId('trill')}" />\n`;
	}
	if (options.arpeggio) {
		result += `${indent}    <arpeg xml:id="${generateId('arpeg')}" />\n`;
	}
	if (options.turn) {
		result += `${indent}    <turn xml:id="${generateId('turn')}" />\n`;
	}
	if (options.mordent) {
		result += `${indent}    <mordent xml:id="${generateId('mordent')}" />\n`;
	}

	result += `${indent}</note>\n`;
	return result;
};


// Extract mark properties from note event
const extractMarkOptions = (marks?: Mark[]): {
	artics: string[];
	fermata: 'normal' | 'short' | false;
	trill: boolean;
	arpeggio: boolean;
	turn: boolean;
	mordent: boolean;
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
		artics: [] as string[],
		fermata: false as 'normal' | 'short' | false,
		trill: false,
		arpeggio: false,
		turn: false,
		mordent: false,
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
			result.artics.push(ARTIC_MAP[(mark as any).type]);
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
		} else if (ornamentType === OrnamentType.mordent || ornamentType === OrnamentType.prall) {
			result.mordent = true;
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


// Convert NoteEvent to MEI - returns { xml, elementId, hairpin, pedal, hasTieStart, pitches }
const noteEventToMEI = (
	event: NoteEvent,
	indent: string,
	layerStaff?: number,
	tieEnd?: boolean,
	contextStemDir?: StemDirection
): { xml: string; elementId: string; hairpin?: string; pedal?: string; hasTieStart: boolean; pitches: Pitch[] } => {
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

	const noteOptions = {
		grace: event.grace,
		tie,
		stemDir,
		staff: event.staff,
		layerStaff,
		slur,
		artics: markOptions.artics,
		fermata: markOptions.fermata,
		trill: markOptions.trill,
		arpeggio: markOptions.arpeggio,
		turn: markOptions.turn,
		mordent: markOptions.mordent,
		tremolo: markOptions.tremolo,
	};

	// Handle dynamic before note
	let dynamicXml = '';
	if (markOptions.dynamic) {
		dynamicXml = `${indent}<dynam xml:id="${generateId('dynam')}">${markOptions.dynamic}</dynam>\n`;
	}

	// Single note
	if (event.pitches.length === 1) {
		const pitch = encodePitch(event.pitches[0]);
		const noteId = generateId('note');
		return {
			xml: dynamicXml + buildNoteElement(pitch, dur, dots, indent, false, noteOptions, noteId),
			elementId: noteId,
			hairpin: markOptions.hairpin,
			pedal: markOptions.pedal,
			hasTieStart: markOptions.tieStart,
			pitches: event.pitches,
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

	let result = dynamicXml + `${indent}<chord ${chordAttrs}>\n`;

	for (const p of event.pitches) {
		const pitch = encodePitch(p);
		result += buildNoteElement(pitch, dur, dots, indent + '    ', true);
	}

	if (noteOptions.artics.length > 0) {
		result += `${indent}    <artic artic="${noteOptions.artics.join(' ')}" />\n`;
	}
	if (noteOptions.fermata) {
		const fermataAttrs = noteOptions.fermata === 'short' ? ` shape="angular"` : '';
		result += `${indent}    <fermata xml:id="${generateId('fermata')}"${fermataAttrs} />\n`;
	}
	if (noteOptions.trill) {
		result += `${indent}    <trill xml:id="${generateId('trill')}" />\n`;
	}
	if (noteOptions.arpeggio) {
		result += `${indent}    <arpeg xml:id="${generateId('arpeg')}" />\n`;
	}
	if (noteOptions.turn) {
		result += `${indent}    <turn xml:id="${generateId('turn')}" />\n`;
	}
	if (noteOptions.mordent) {
		result += `${indent}    <mordent xml:id="${generateId('mordent')}" />\n`;
	}

	result += `${indent}</chord>\n`;
	return {
		xml: result,
		elementId: chordId,
		hairpin: markOptions.hairpin,
		pedal: markOptions.pedal,
		hasTieStart: markOptions.tieStart,
		pitches: event.pitches,
	};
};


// Convert RestEvent to MEI
const restEventToMEI = (event: RestEvent, indent: string): string => {
	const dur = DURATIONS[event.duration.division] || "4";
	let attrs = `xml:id="${generateId('rest')}" dur="${dur}"`;
	if (event.duration.dots > 0) attrs += ` dots="${event.duration.dots}"`;

	// Pitched rest (positioned at specific pitch)
	if (event.pitch) {
		const pitch = encodePitch(event.pitch);
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
const tupletEventToMEI = (event: TupletEvent, indent: string, layerStaff?: number): string => {
	// LilyPond \times 2/3 means "multiply duration by 2/3"
	// So 3 notes × 2/3 = 2 beats worth (3 in time of 2)
	// MEI: num = number of notes written, numbase = normal equivalent
	const num = event.ratio.denominator;      // denominator = actual note count
	const numbase = event.ratio.numerator;    // numerator = time equivalent

	let result = `${indent}<tuplet xml:id="${generateId('tuplet')}" num="${num}" numbase="${numbase}">\n`;

	for (const e of event.events) {
		if (e.type === 'note') {
			result += noteEventToMEI(e as NoteEvent, indent + '    ', layerStaff).xml;
		} else if (e.type === 'rest') {
			result += restEventToMEI(e as RestEvent, indent + '    ');
		}
	}

	result += `${indent}</tuplet>\n`;
	return result;
};


// Convert TremoloEvent to MEI (bowed tremolo between two notes)
const tremoloEventToMEI = (event: TremoloEvent, indent: string): string => {
	const btremId = generateId('btrem');

	// Calculate the duration of each note based on count and division
	// For \repeat tremolo 4 { c16 d16 }, the visual duration is a quarter note (4 * 16th = quarter)
	const totalDuration = event.count * event.division;
	const noteDur = totalDuration >= 1 ? totalDuration : 4;  // Default to quarter if calculation fails

	// unitdur is the tremolo stroke speed (the division value)
	let result = `${indent}<bTrem xml:id="${btremId}" unitdur="${event.division}">\n`;

	// First note
	if (event.pitchA.length === 1) {
		const pitch = encodePitch(event.pitchA[0]);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		result += `${indent}    <note ${attrs} />\n`;
	}

	// Second note
	if (event.pitchB.length === 1) {
		const pitch = encodePitch(event.pitchB[0]);
		let attrs = `xml:id="${generateId('note')}" pname="${pitch.pname}" oct="${pitch.oct}" dur="${noteDur}"`;
		if (pitch.accid) attrs += ` accid="${pitch.accid}"`;
		result += `${indent}    <note ${attrs} />\n`;
	}

	result += `${indent}</bTrem>\n`;
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

// Encode a layer (voice) - returns xml, hairpin spans, pedal spans, and octave spans
const encodeLayer = (voice: Voice, layerN: number, indent: string): { xml: string; hairpins: HairpinSpan[]; pedals: PedalSpan[]; octaves: OctaveSpan[] } => {
	const layerId = generateId("layer");
	let xml = `${indent}<layer xml:id="${layerId}" n="${layerN}">\n`;

	let inBeam = false;
	const baseIndent = indent + '    ';

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

	// Track current stem direction from context changes
	let currentStemDirection: StemDirection | undefined = undefined;

	// Track pending tie pitches (for tie="t" on next note)
	let pendingTiePitches: Pitch[] = [];

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

				const result = noteEventToMEI(noteEvent, currentIndent, voice.staff, tieEnd, currentStemDirection);
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
				break;
			}
			case 'rest':
				xml += restEventToMEI(event as RestEvent, currentIndent);
				break;
			case 'tuplet':
				xml += tupletEventToMEI(event as TupletEvent, currentIndent, voice.staff);
				break;
			case 'tremolo':
				xml += tremoloEventToMEI(event as TremoloEvent, currentIndent);
				break;
			case 'context': {
				// Check for ottava changes
				const ctx = event as ContextChange;
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
	return { xml, hairpins, pedals, octaves };
};


// Encode a staff - returns both xml, hairpin spans, pedal spans, and octave spans
const encodeStaff = (voices: Voice[], staffN: number, indent: string): { xml: string; hairpins: HairpinSpan[]; pedals: PedalSpan[]; octaves: OctaveSpan[] } => {
	const staffId = generateId("staff");
	let xml = `${indent}<staff xml:id="${staffId}" n="${staffN}">\n`;
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalSpan[] = [];
	const allOctaves: OctaveSpan[] = [];

	if (voices.length === 0) {
		xml += `${indent}    <layer xml:id="${generateId('layer')}" n="1" />\n`;
	} else {
		voices.forEach((voice, vi) => {
			const result = encodeLayer(voice, vi + 1, indent + '    ');
			xml += result.xml;
			allHairpins.push(...result.hairpins);
			allPedals.push(...result.pedals);
			allOctaves.push(...result.octaves);
		});
	}

	xml += `${indent}</staff>\n`;
	return { xml, hairpins: allHairpins, pedals: allPedals, octaves: allOctaves };
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

// Encode a measure
const encodeMeasure = (measure: Measure, measureN: number, indent: string, maxStaff: number): string => {
	const measureId = generateId("measure");
	let xml = `${indent}<measure xml:id="${measureId}" n="${measureN}">\n`;
	const allHairpins: HairpinSpan[] = [];
	const allPedals: PedalSpan[] = [];
	const allOctaves: OctaveSpan[] = [];

	// Extract tempo from context changes
	let measureTempo: Tempo | undefined;
	for (const voice of measure.voices) {
		for (const event of voice.events) {
			if (event.type === 'context') {
				const ctx = event as ContextChange;
				if (ctx.tempo) {
					measureTempo = ctx.tempo;
				}
			}
		}
	}

	// Group voices by staff
	const voicesByStaff: Record<number, Voice[]> = {};
	for (const voice of measure.voices) {
		const staffNum = voice.staff || 1;
		if (!voicesByStaff[staffNum]) {
			voicesByStaff[staffNum] = [];
		}
		voicesByStaff[staffNum].push(voice);
	}

	// Encode each staff
	for (let si = 1; si <= maxStaff; si++) {
		const voices = voicesByStaff[si] || [];
		const result = encodeStaff(voices, si, indent + '    ');
		xml += result.xml;
		allHairpins.push(...result.hairpins);
		allPedals.push(...result.pedals);
		allOctaves.push(...result.octaves);
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

	xml += `${indent}</measure>\n`;
	return xml;
};


// Encode scoreDef
const encodeScoreDef = (
	keySig: string,
	timeNum: number,
	timeDen: number,
	staffCount: number,
	staffClefs: Record<number, Clef>,
	indent: string
): string => {
	const scoreDefId = generateId("scoredef");

	let xml = `${indent}<scoreDef xml:id="${scoreDefId}" key.sig="${keySig}" meter.count="${timeNum}" meter.unit="${timeDen}">\n`;
	xml += `${indent}    <staffGrp xml:id="${generateId("staffgrp")}">\n`;

	for (let s = 1; s <= staffCount; s++) {
		const clef = staffClefs[s] || Clef.treble;
		const clefInfo = CLEF_SHAPES[clef] || CLEF_SHAPES.treble;
		xml += `${indent}        <staffDef xml:id="${generateId('staffdef')}" n="${s}" lines="5" clef.shape="${clefInfo.shape}" clef.line="${clefInfo.line}" />\n`;
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

	// Determine staff count and collect initial context
	let maxStaff = 1;
	let currentKey = 0;
	let currentTimeNum = 4;
	let currentTimeDen = 4;
	const staffClefs: Record<number, Clef> = { 1: Clef.treble };

	for (const measure of doc.measures) {
		// Get key signature
		if (measure.key) {
			currentKey = keyToFifths(measure.key);
		}

		// Get time signature
		if (measure.timeSig) {
			currentTimeNum = measure.timeSig.numerator;
			currentTimeDen = measure.timeSig.denominator;
		}

		// Count staves and get clefs from context changes
		for (const voice of measure.voices) {
			maxStaff = Math.max(maxStaff, voice.staff || 1);

			for (const event of voice.events) {
				if (event.type === 'context') {
					const ctx = event as ContextChange;
					if (ctx.clef) {
						staffClefs[voice.staff || 1] = ctx.clef;
					}
				}
			}
		}
	}

	// Use first measure's key/time if set
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
	mei += encodeScoreDef(keySig, currentTimeNum, currentTimeDen, maxStaff, staffClefs, `${indent}${indent}${indent}${indent}${indent}`);
	mei += `${indent}${indent}${indent}${indent}${indent}<section xml:id="${generateId("section")}">\n`;

	// Encode measures
	doc.measures.forEach((measure, mi) => {
		mei += encodeMeasure(measure, mi + 1, `${indent}${indent}${indent}${indent}${indent}${indent}`, maxStaff);
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
