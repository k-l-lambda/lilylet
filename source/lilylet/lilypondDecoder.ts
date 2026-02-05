/**
 * LilyPond to Lilylet Decoder
 *
 * Converts LilyPond notation files to Lilylet document format using the lotus parser.
 * This module is browser-compatible - it uses pre-compiled parser from lotus.
 */

// Import directly from the compiled lib directory to avoid ESM issues
import * as lilyParser from "@k-l-lambda/lotus/lib/inc/lilyParser/index.js";

// Import pre-compiled LilyPond parser (browser-compatible)
// @ts-ignore - CommonJS module
import * as lilypondParser from "@k-l-lambda/lotus/lib.browser/lib/lilyParser.js";

import {
	LilyletDoc,
	Measure,
	Event,
	NoteEvent,
	RestEvent,
	ContextChange,
	MarkupEvent,
	HarmonyEvent,
	TupletEvent,
	TremoloEvent,
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Clef,
	StemDirection,
	Accidental,
	Phonet,
	Fraction,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	NavigationMarkType,
	Placement,
	Metadata,
	Tempo,
} from "./types";


// Phonet names mapping
const PHONET_NAMES: Record<number, Phonet> = {
	0: Phonet.c,
	1: Phonet.d,
	2: Phonet.e,
	3: Phonet.f,
	4: Phonet.g,
	5: Phonet.a,
	6: Phonet.b,
};


// Alter value to accidental
const ALTER_TO_ACCIDENTAL: Record<number, Accidental> = {
	[-2]: Accidental.doubleFlat,
	[-1]: Accidental.flat,
	[0]: Accidental.natural,
	[1]: Accidental.sharp,
	[2]: Accidental.doubleSharp,
};


// LilyPond clef names to Lilylet clef
const LILYPOND_CLEF_MAP: Record<string, Clef> = {
	treble: Clef.treble,
	G: Clef.treble,
	bass: Clef.bass,
	F: Clef.bass,
	alto: Clef.alto,
	C: Clef.alto,
};


// Key signature fifths to pitch/accidental mapping
const KEY_FIFTHS_MAP: Record<number, { pitch: Phonet; accidental?: Accidental; mode: 'major' | 'minor' }> = {
	[-7]: { pitch: Phonet.c, accidental: Accidental.flat, mode: 'major' },
	[-6]: { pitch: Phonet.g, accidental: Accidental.flat, mode: 'major' },
	[-5]: { pitch: Phonet.d, accidental: Accidental.flat, mode: 'major' },
	[-4]: { pitch: Phonet.a, accidental: Accidental.flat, mode: 'major' },
	[-3]: { pitch: Phonet.e, accidental: Accidental.flat, mode: 'major' },
	[-2]: { pitch: Phonet.b, accidental: Accidental.flat, mode: 'major' },
	[-1]: { pitch: Phonet.f, mode: 'major' },
	[0]: { pitch: Phonet.c, mode: 'major' },
	[1]: { pitch: Phonet.g, mode: 'major' },
	[2]: { pitch: Phonet.d, mode: 'major' },
	[3]: { pitch: Phonet.a, mode: 'major' },
	[4]: { pitch: Phonet.e, mode: 'major' },
	[5]: { pitch: Phonet.b, mode: 'major' },
	[6]: { pitch: Phonet.f, accidental: Accidental.sharp, mode: 'major' },
	[7]: { pitch: Phonet.c, accidental: Accidental.sharp, mode: 'major' },
};


// Articulation mapping from LilyPond
const ARTICULATION_MAP: Record<string, ArticulationType> = {
	staccato: ArticulationType.staccato,
	staccatissimo: ArticulationType.staccatissimo,
	tenuto: ArticulationType.tenuto,
	marcato: ArticulationType.marcato,
	accent: ArticulationType.accent,
	portato: ArticulationType.portato,
};


// Ornament mapping from LilyPond
const ORNAMENT_MAP: Record<string, OrnamentType> = {
	trill: OrnamentType.trill,
	turn: OrnamentType.turn,
	mordent: OrnamentType.mordent,
	prall: OrnamentType.prall,
	fermata: OrnamentType.fermata,
	shortfermata: OrnamentType.shortFermata,
	arpeggio: OrnamentType.arpeggio,
};


// Dynamic regex and mapping
const DYNAMIC_REGEX = /^[fpmrsz]+$/;
const DYNAMIC_MAP: Record<string, DynamicType> = {
	ppp: DynamicType.ppp,
	pp: DynamicType.pp,
	p: DynamicType.p,
	mp: DynamicType.mp,
	mf: DynamicType.mf,
	f: DynamicType.f,
	ff: DynamicType.ff,
	fff: DynamicType.fff,
	sfz: DynamicType.sfz,
	rfz: DynamicType.rfz,
};


// Common tempo text words (from fprod corpus analysis)
// Single words, lowercase for case-insensitive matching
const TEMPO_WORDS = new Set([
	// Basic tempo markings (Italian) - very slow to very fast
	'grave', 'largo', 'larghetto', 'lento', 'adagio', 'adagietto',
	'andante', 'andantino', 'moderato', 'allegretto', 'allegro',
	'vivace', 'presto', 'prestissimo',
	// Tempo modifiers
	'molto', 'poco', 'più', 'meno', 'assai', 'con', 'moto', 'brio',
	'ma', 'non', 'troppo', 'cantabile', 'sostenuto', 'espressivo',
	'grazioso', 'maestoso', 'agitato', 'animato', 'tranquillo',
	// Tempo changes
	'tempo', 'primo',
	'rit', 'ritard', 'ritardando', 'riten', 'ritenuto',
	'rall', 'rallentando',
	'accel', 'accelerando',
	'allarg', 'allargando',
	'calando', 'morendo', 'smorzando', 'smorz',
	'rubato',
]);


// Check if text contains any tempo-related word (case-insensitive)
const containsTempoWord = (text: string): boolean => {
	// Remove punctuation and split into words
	const words = text.toLowerCase().replace(/[.,!?]/g, '').split(/\s+/);
	return words.some(word => TEMPO_WORDS.has(word));
};


// Convert lotus Tempo to Lilylet Tempo
const convertTempo = (lotusTempo: any): Tempo | undefined => {
	if (!lotusTempo) return undefined;

	const tempo: Tempo = {};

	// Text (e.g., "Allegro")
	if (lotusTempo.text) {
		tempo.text = typeof lotusTempo.text === 'string'
			? lotusTempo.text
			: extractTextFromObject(lotusTempo.text);
	}

	// Metronome mark (e.g., ♩ = 120)
	if (lotusTempo.beatsPerMinute !== undefined && Number.isFinite(lotusTempo.beatsPerMinute)) {
		tempo.bpm = lotusTempo.beatsPerMinute;

		// Beat unit (note value)
		if (lotusTempo.unit) {
			tempo.beat = convertDuration(lotusTempo.unit);
		}
	}

	// Return undefined if no meaningful tempo data
	if (!tempo.text && !tempo.bpm) {
		return undefined;
	}

	return tempo;
};


// Internal measure representation during parsing
interface ParsedMeasure {
	key: number | null;
	timeSig: Fraction | null;
	voices: ParsedVoice[];
	partial: boolean;
}


interface ParsedVoice {
	staff: number;
	partIndex: number;  // 1-based part index (from staff ID format "partIndex_staffIndex")
	events: Event[];
}


// Convert LilyPond pitch to Lilylet pitch
const convertPitch = (phonetStep: number, alterValue: number, octave: number): Pitch => {
	const phonet = PHONET_NAMES[phonetStep % 7];
	const accidental = alterValue !== 0 ? ALTER_TO_ACCIDENTAL[alterValue] : undefined;

	// Lotus parser absolute octave: 0 = C3, 1 = C4, 2 = C5
	// Lilylet octave: 0 = C4, 1 = C5, -1 = C3
	// Conversion: lilyletOctave = lotusAbsoluteOctave - 1
	const lilyletOctave = octave - 1;

	return {
		phonet,
		accidental,
		octave: lilyletOctave,
	};
};


// Convert LilyPond duration to Lilylet duration
const convertDuration = (duration: any): Duration => {
	return {
		division: Math.pow(2, duration.division),
		dots: duration.dots || 0,
	};
};


// Parse raw pitch string (e.g., "c'", "fis''", "bes,") to Pitch
const parseRawPitch = (pitchStr: string): Pitch | undefined => {
	if (!pitchStr) return undefined;

	// Match: base note (a-g), optional accidentals (is/es/isis/eses), optional octave marks ('/, or ,)
	const match = pitchStr.match(/^([a-g])(isis|eses|is|es)?([',]*)$/);
	if (!match) return undefined;

	const [, note, accidental, octaveMarks] = match;

	// Map note to phonet
	const phonetMap: Record<string, Phonet> = {
		c: Phonet.c, d: Phonet.d, e: Phonet.e, f: Phonet.f,
		g: Phonet.g, a: Phonet.a, b: Phonet.b,
	};
	const phonet = phonetMap[note];
	if (!phonet) return undefined;

	// Map accidental
	const accidentalMap: Record<string, Accidental> = {
		is: Accidental.sharp,
		es: Accidental.flat,
		isis: Accidental.doubleSharp,
		eses: Accidental.doubleFlat,
	};
	const acc = accidental ? accidentalMap[accidental] : undefined;

	// Calculate octave from marks (default octave 0 = C4)
	let octave = 0;
	for (const mark of octaveMarks || '') {
		if (mark === "'") octave++;
		else if (mark === ",") octave--;
	}

	return { phonet, accidental: acc, octave };
};


// Parse raw duration object from tuplet body
const parseRawDuration = (duration: any): Duration | undefined => {
	if (!duration) return undefined;
	const number = parseInt(duration.number, 10);
	if (isNaN(number)) return undefined;
	return {
		division: number,
		dots: duration.dots || 0,
	};
};


// Convert raw Chord from tuplet body to NoteEvent
const convertRawChord = (chord: any, defaultDuration?: Duration): NoteEvent | undefined => {
	if (!chord || chord.proto !== 'Chord') return undefined;

	const pitches: Pitch[] = [];
	for (const pitchElem of chord.pitches || []) {
		const pitch = parseRawPitch(pitchElem.pitch);
		if (pitch) pitches.push(pitch);
	}

	if (pitches.length === 0) return undefined;

	const duration = parseRawDuration(chord.duration) || defaultDuration;
	if (!duration) return undefined;

	return {
		type: 'note',
		pitches,
		duration,
	};
};


// Parse pitch name with accidental (e.g., "cf" -> { pitch: Phonet.c, accidental: Accidental.flat })
const parsePitchName = (name: string): { pitch: Phonet; accidental?: Accidental } | undefined => {
	if (!name || name.length === 0) return undefined;

	const phonetChar = name[0].toLowerCase();
	const phonet = {
		'c': Phonet.c, 'd': Phonet.d, 'e': Phonet.e, 'f': Phonet.f,
		'g': Phonet.g, 'a': Phonet.a, 'b': Phonet.b
	}[phonetChar];

	if (!phonet) return undefined;

	const accidentalPart = name.slice(1);
	let accidental: Accidental | undefined;
	if (accidentalPart === 's' || accidentalPart === 'is') {
		accidental = Accidental.sharp;
	} else if (accidentalPart === 'ss' || accidentalPart === 'isis') {
		accidental = Accidental.doubleSharp;
	} else if (accidentalPart === 'f' || accidentalPart === 'es') {
		accidental = Accidental.flat;
	} else if (accidentalPart === 'ff' || accidentalPart === 'eses') {
		accidental = Accidental.doubleFlat;
	}

	return { pitch: phonet, accidental };
};

// Convert key from context to KeySignature
const convertKeySignature = (keyContext: any): KeySignature | undefined => {
	const args = keyContext?.args;

	// Always parse from args to get correct pitch and mode
	if (Array.isArray(args) && args.length >= 2) {
		const pitchStr = args[0];
		const modeStr = args[1];

		const pitchInfo = parsePitchName(pitchStr);
		if (pitchInfo) {
			const mode = modeStr?.includes('minor') ? 'minor' : 'major';
			return {
				pitch: pitchInfo.pitch,
				accidental: pitchInfo.accidental,
				mode,
			};
		}
	}

	// Fallback to fifths lookup for compatibility (major keys only)
	const fifths = keyContext?.key;
	if (fifths !== undefined && KEY_FIFTHS_MAP[fifths]) {
		const mapping = KEY_FIFTHS_MAP[fifths];
		return {
			pitch: mapping.pitch,
			accidental: mapping.accidental,
			mode: mapping.mode,
		};
	}

	return undefined;
};


// Parse post-events to marks and detect harmony events
interface PostEventResult {
	marks: Mark[];
	harmonyText?: string;
}

const parsePostEvents = (postEvents: any[]): PostEventResult => {
	const marks: Mark[] = [];
	let harmonyText: string | undefined;

	if (!postEvents) return { marks };

	for (const event of postEvents) {
		// String events
		if (typeof event === 'string') {
			if (event === '~') {
				marks.push({ markType: 'tie', start: true });
			} else if (event === '(') {
				marks.push({ markType: 'slur', start: true });
			} else if (event === ')') {
				marks.push({ markType: 'slur', start: false });
			}
			continue;
		}

		// PostEvent objects
		if (event && typeof event === 'object') {
			const arg = event.arg;

			// String articulation/ornament
			if (typeof arg === 'string') {
				const cleanArg = arg.replace(/^-/, '');
				if (ARTICULATION_MAP[cleanArg]) {
					marks.push({ markType: 'articulation', type: ARTICULATION_MAP[cleanArg] });
				} else if (ORNAMENT_MAP[cleanArg]) {
					marks.push({ markType: 'ornament', type: ORNAMENT_MAP[cleanArg] });
				}
			}

			// Fingering (number 1-5)
			if (typeof arg === 'number' && arg >= 1 && arg <= 5) {
				marks.push({ markType: 'fingering', finger: arg });
			}

			// Command (dynamics, hairpins, etc.)
			if (arg && typeof arg === 'object' && 'cmd' in arg) {
				const cmd = arg.cmd;
				if (DYNAMIC_REGEX.test(cmd) && DYNAMIC_MAP[cmd]) {
					marks.push({ markType: 'dynamic', type: DYNAMIC_MAP[cmd] });
				} else if (cmd === '<') {
					marks.push({ markType: 'hairpin', type: HairpinType.crescendoStart });
				} else if (cmd === '>') {
					marks.push({ markType: 'hairpin', type: HairpinType.diminuendoStart });
				} else if (cmd === '!') {
					marks.push({ markType: 'hairpin', type: HairpinType.crescendoEnd }); // or diminuendoEnd
				} else if (cmd === 'sustainOn') {
					marks.push({ markType: 'pedal', type: PedalType.sustainOn });
				} else if (cmd === 'sustainOff') {
					marks.push({ markType: 'pedal', type: PedalType.sustainOff });
				} else if (cmd === 'coda') {
					marks.push({ markType: 'navigation', type: NavigationMarkType.coda });
				} else if (cmd === 'segno') {
					marks.push({ markType: 'navigation', type: NavigationMarkType.segno });
				} else if (cmd === '\\markup' || cmd === 'markup') {
					// Check if this is a harmony (chord symbol) - marked with \bold
					const harmony = extractHarmonyFromMarkup(arg.args);
					if (harmony) {
						harmonyText = harmony;
					} else {
						// Regular markup attached to note
						const text = extractTextFromObject(arg.args);
						if (text && !containsTempoWord(text)) {
							const direction = event.direction;
							const placement: Placement | undefined =
								direction === 'up' ? Placement.above :
								direction === 'down' ? Placement.below : undefined;
							marks.push({ markType: 'markup', content: text, placement });
						}
					}
				}
			}

			// Handle markup command directly (proto: 'MarkupCommand')
			if (arg && typeof arg === 'object' && arg.proto === 'MarkupCommand') {
				// Check if this is a harmony (chord symbol) - marked with \bold
				const harmony = extractHarmonyFromMarkup(arg.args);
				if (harmony) {
					harmonyText = harmony;
				} else {
					const text = extractTextFromObject(arg.args);
					if (text && !containsTempoWord(text)) {
						const direction = event.direction;
						const placement: Placement | undefined =
							direction === 'up' ? Placement.above :
							direction === 'down' ? Placement.below : undefined;
						marks.push({ markType: 'markup', content: text, placement });
					}
				}
			}
		}
	}

	return { marks, harmonyText };
};


// Parse a LilyPond document to measures
const parseLilyDocument = (lilyDocument: lilyParser.LilyDocument): ParsedMeasure[] => {
	const measureMap = new Map<number, ParsedMeasure>();
	const staffNames: string[] = [];

	const interpreter = lilyDocument.interpret();

	interpreter.layoutMusic.musicTracks.forEach((track, vi) => {
		const appendStaff = (staffName: string): void => {
			if (!staffNames.includes(staffName)) {
				staffNames.push(staffName);
			}
		};

		// Parse staff name to extract partIndex and staff number
		// Format: "partIndex_staffIndex" (e.g., "1_1", "1_2", "2_1")
		// Falls back to partIndex=1 if format doesn't match
		const parseStaffName = (name: string): { partIndex: number; staffNum: number } => {
			const match = name.match(/^(\d+)_(\d+)$/);
			if (match) {
				return { partIndex: parseInt(match[1], 10), staffNum: parseInt(match[2], 10) };
			}
			// Fallback: single part, staff number from name or 1
			const num = parseInt(name, 10);
			return { partIndex: 1, staffNum: isNaN(num) ? 1 : num };
		};

		// Use track.contextDict.Staff as the authoritative staff name (from Staff definition)
		// This won't be affected by \change Staff commands inside the track
		const initialStaffName = track.contextDict?.Staff;
		if (initialStaffName) {
			appendStaff(initialStaffName);
		}
		const parsedStaff = initialStaffName ? parseStaffName(initialStaffName) : { partIndex: 1, staffNum: 1 };
		// Use these as fixed values for this track - don't update from context.staffName
		const trackStaff = parsedStaff.staffNum;
		const trackPartIndex = parsedStaff.partIndex;

		// Track emitted context events across measures for this voice
		let lastKey: number | undefined = undefined;  // Track value changes (key fifths)
		let lastTimeSig: string | undefined = undefined;  // Track value changes (as string for comparison)
		let lastClef: Clef | undefined = undefined;  // Track value changes
		let lastOttava: number | undefined = undefined;  // Track value changes
		let lastStemDirection: string | undefined = undefined;  // Track value changes

		const context = new lilyParser.TrackContext(undefined, {
			listener: (term: lilyParser.BaseTerm, context: lilyParser.TrackContext) => {
				const mi = term._measure;
				if (mi === undefined) return;

				if (!measureMap.has(mi)) {
					measureMap.set(mi, {
						key: null,
						timeSig: null,
						voices: [],
						partial: false,
					});
				}

				const measure = measureMap.get(mi)!;

				// Initialize voice for this track (use fixed staff/part from track definition)
				if (!measure.voices[vi]) {
					measure.voices[vi] = {
						staff: trackStaff,
						partIndex: trackPartIndex,
						events: [],
					};
				}
				const voice = measure.voices[vi];

				// Update key/time from context on music events
				if (term instanceof lilyParser.MusicEvent ||
					term instanceof lilyParser.LilyTerms.StemDirection ||
					term instanceof lilyParser.LilyTerms.OctaveShift) {

					if (context.key && measure.key === null) {
						measure.key = context.key.key;
					}
					if (context.time && measure.timeSig === null) {
						measure.timeSig = {
							numerator: context.time.value.numerator,
							denominator: context.time.value.denominator,
						};
					}
					if (context.partialDuration) {
						measure.partial = true;
					}
				}

				// Handle music events
				if (term instanceof lilyParser.MusicEvent) {
					// Staff is fixed per track (from track definition)
					voice.staff = trackStaff;

					// Handle key context change (emit when value changes)
					if (context.key && context.key.key !== lastKey) {
						const key = convertKeySignature(context.key);
						if (key) {
							voice.events.push({
								type: 'context',
								key,
							});
							lastKey = context.key.key;
						}
					}

					// Handle time signature context change (emit when value changes)
					if (context.time) {
						const timeSigStr = `${context.time.value.numerator}/${context.time.value.denominator}`;
						if (timeSigStr !== lastTimeSig) {
							voice.events.push({
								type: 'context',
								time: {
									numerator: context.time.value.numerator,
									denominator: context.time.value.denominator,
								},
							});
							lastTimeSig = timeSigStr;
						}
					}

					// Handle clef context change (emit when value changes)
					if (context.clef) {
						const clef = LILYPOND_CLEF_MAP[context.clef.clefName];
						if (clef && clef !== lastClef) {
							voice.events.push({
								type: 'context',
								clef,
							});
							lastClef = clef;
						}
					}

					// Handle ottava (emit when value changes)
					if (context.octave != null) {
						const currentOttava = context.octave.value ?? 0;
						if (currentOttava !== lastOttava) {
							voice.events.push({
								type: 'context',
								ottava: currentOttava,
							});
							lastOttava = currentOttava;
						}
					}

					// Handle stem direction context change (emit when value changes)
					if (context.stemDirection && context.stemDirection !== lastStemDirection) {
						const stemDir = context.stemDirection === 'Up' ? StemDirection.up :
							context.stemDirection === 'Down' ? StemDirection.down : undefined;
						if (stemDir) {
							voice.events.push({
								type: 'context',
								stemDirection: stemDir,
							});
							lastStemDirection = context.stemDirection;
						}
					}

					// Process Chord (note or chord)
					if (term instanceof lilyParser.LilyTerms.Chord) {
						const pitches: Pitch[] = [];

						for (const pitch of term.pitchesValue) {
							if (pitch instanceof lilyParser.LilyTerms.ChordElement) {
								pitches.push(convertPitch(
									pitch.phonetStep,
									pitch.alterValue || 0,
									pitch.absolutePitch.octave
								));
							}
						}

						if (pitches.length > 0) {
							const { marks, harmonyText } = parsePostEvents(term.post_events);

							// Add beam marks
							if (term.beamOn) {
								marks.push({ markType: 'beam', start: true });
							} else if (term.beamOff) {
								marks.push({ markType: 'beam', start: false });
							}

							// Add tie
							if (term.isTying) {
								marks.push({ markType: 'tie', start: true });
							}

							const noteEvent: NoteEvent = {
								type: 'note',
								pitches,
								duration: convertDuration(term.durationValue),
								grace: context.inGrace || undefined,
							};

							if (marks.length > 0) {
								noteEvent.marks = marks;
							}

							voice.events.push(noteEvent);

							// Add harmony event if detected (chord symbol encoded as \bold markup)
							if (harmonyText) {
								const harmonyEvent: HarmonyEvent = {
									type: 'harmony',
									text: harmonyText,
								};
								voice.events.push(harmonyEvent);
							}
						}
					}
					// Process Rest
					else if (term instanceof lilyParser.LilyTerms.Rest) {
						const restEvent: RestEvent = {
							type: 'rest',
							duration: convertDuration(term.durationValue),
							invisible: term.isSpacer || undefined,
						};

						// Positioned rest
						if (!term.isSpacer && context.pitch) {
							restEvent.pitch = convertPitch(
								context.pitch.phonetStep,
								0,
								context.pitch.octave
							);
						}

						voice.events.push(restEvent);
					}
				}
				// Handle standalone stem direction (emit when value changes)
				else if (term instanceof lilyParser.LilyTerms.StemDirection) {
					if (term.direction !== lastStemDirection) {
						const stemDir = term.direction === 'Up' ? StemDirection.up :
							term.direction === 'Down' ? StemDirection.down : undefined;
						if (stemDir) {
							voice.events.push({
								type: 'context',
								stemDirection: stemDir,
							});
							lastStemDirection = term.direction;
						}
					}
				}
				// Handle standalone clef (emit when value changes)
				else if (term instanceof lilyParser.LilyTerms.Clef) {
					const clef = LILYPOND_CLEF_MAP[term.clefName];
					if (clef && clef !== lastClef) {
						voice.events.push({
							type: 'context',
							clef,
						});
						lastClef = clef;
					}
				}
				// Handle ottava shift
				else if (term instanceof lilyParser.LilyTerms.OctaveShift) {
					if (term.value !== lastOttava) {
						voice.events.push({
							type: 'context',
							ottava: term.value,
						});
						lastOttava = term.value;
					}
				}
				// Handle staff change
				else if (term instanceof lilyParser.LilyTerms.Change) {
					// Ignore \change Staff commands - staff is fixed per track
					// (Cross-staff notation is not supported in this decoder)
				}
				// Handle tempo
				else if (term instanceof lilyParser.LilyTerms.Tempo) {
					const tempo = convertTempo(term);
					if (tempo) {
						voice.events.push({
							type: 'context',
							tempo,
						});
					}
				}
				// Handle standalone markup command and barlines
				else {
					const termAny = term as any;
					if (termAny.proto === 'Command' && (termAny.cmd === '\\markup' || termAny.cmd === 'markup')) {
						// Check if this is a harmony (chord symbol) - marked with \bold
						const harmonyText = extractHarmonyFromMarkup(termAny.args);
						if (harmonyText) {
							const harmonyEvent: HarmonyEvent = {
								type: 'harmony',
								text: harmonyText,
							};
							voice.events.push(harmonyEvent);
						} else {
							const text = extractTextFromObject(termAny.args);
							if (text && !containsTempoWord(text)) {
								const markupEvent: MarkupEvent = {
									type: 'markup',
									content: text,
								};
								voice.events.push(markupEvent);
							}
						}
					}
					// Handle barline command - barlines belong to the previous measure
					else if (termAny.proto === 'Command' && termAny.cmd === 'bar') {
						const style = termAny.args?.[0]?.exp;
						if (style && mi > 0) {
							// Remove quotes from the style string
							const barStyle = style.replace(/^"|"$/g, '');
							// Add to previous measure's voice
							const prevMeasure = measureMap.get(mi - 1);
							if (prevMeasure && prevMeasure.voices[vi]) {
								prevMeasure.voices[vi].events.push({
									type: 'barline',
									style: barStyle,
								});
							}
						}
					}
					// Handle ChordSymbol (inline chord symbol: \chords "text")
					else if (termAny.proto === 'ChordSymbol') {
						// Extract text from LiteralString (e.g., { exp: '"C"' } -> "C")
						let text = termAny.text;
						if (typeof text === 'object' && text?.exp) {
							text = text.exp.replace(/^"|"$/g, '');
						} else if (typeof text === 'string') {
							text = text.replace(/^"|"$/g, '');
						}
						const harmonyEvent: HarmonyEvent = {
							type: 'harmony',
							text: text,
						};
						voice.events.push(harmonyEvent);
					}
					// Handle tuplet
					// Note: Lotus emits Chord events BEFORE the Tuplet term, so we need to
					// remove the already-added notes and wrap them in a TupletEvent
					else if (termAny.proto === 'Tuplet') {
						const ratioStr = termAny.args?.[0];  // e.g., "3/2"
						const body = termAny.args?.[1]?.body || [];

						if (ratioStr && body.length > 0) {
							// Parse ratio string
							const ratioMatch = ratioStr.match(/^(\d+)\/(\d+)$/);
							if (ratioMatch) {
								const [, num, denom] = ratioMatch;
								const ratio: Fraction = {
									numerator: parseInt(denom, 10),  // Swapped: lilylet uses actual/normal
									denominator: parseInt(num, 10),
								};

								// Count how many note/rest events are in the tuplet body
								const noteCount = body.filter((item: any) =>
									item.proto === 'Chord' || item.proto === 'Rest'
								).length;

								// Remove the last noteCount note/rest events from voice.events
								// (they were already added by the Chord/Rest handlers)
								const tupletEvents: (NoteEvent | RestEvent)[] = [];
								let removed = 0;
								while (removed < noteCount && voice.events.length > 0) {
									const lastEvent = voice.events[voice.events.length - 1];
									if (lastEvent.type === 'note' || lastEvent.type === 'rest') {
										tupletEvents.unshift(voice.events.pop()! as NoteEvent | RestEvent);
										removed++;
									} else {
										break;  // Stop if we hit a non-note/rest event
									}
								}

								if (tupletEvents.length > 0) {
									const tupletEvent: TupletEvent = {
										type: 'tuplet',
										ratio,
										events: tupletEvents,
									};
									voice.events.push(tupletEvent);
								}
							}
						}
					}
					// Handle repeat tremolo
					else if (termAny.proto === 'Repeat' && termAny.args?.[0] === 'tremolo') {
						const count = parseInt(termAny.args?.[1], 10);
						const body = termAny.args?.[2]?.body || [];

						if (!isNaN(count) && body.length === 2) {
							// Double tremolo has exactly 2 pitches
							const pitch1 = body[0]?.pitches?.[0]?.pitch;
							const pitch2 = body[1]?.pitches?.[0]?.pitch;
							const duration = body[0]?.duration;

							if (pitch1 && pitch2 && duration) {
								const pitchA = parseRawPitch(pitch1);
								const pitchB = parseRawPitch(pitch2);
								const div = parseInt(duration.number, 10);

								if (pitchA && pitchB && !isNaN(div)) {
									// Remove the 2 notes that were already added
									let removed = 0;
									while (removed < 2 && voice.events.length > 0) {
										const lastEvent = voice.events[voice.events.length - 1];
										if (lastEvent.type === 'note') {
											voice.events.pop();
											removed++;
										} else {
											break;
										}
									}

									const tremoloEvent: TremoloEvent = {
										type: 'tremolo',
										pitchA: [pitchA],
										pitchB: [pitchB],
										count,
										division: div,
									};
									voice.events.push(tremoloEvent);
								}
							}
						}
					}
				}
			},
		});

		context.execute(track.music);
	});

	// Filter out empty voices and convert to array, sorted by measure number
	const measures = Array.from(measureMap.entries())
		.sort(([a], [b]) => a - b)
		.map(([, measure]) => measure);
	for (const measure of measures) {
		measure.voices = measure.voices.filter(Boolean);
	}

	return measures;
};


// Check if a voice has real music content (not just spacer rests and context changes)
const hasRealContent = (events: Event[]): boolean => {
	return events.some(e => {
		if (e.type === 'note') return true;
		if (e.type === 'rest' && !(e as RestEvent).invisible) return true;
		if (e.type === 'tuplet') return true;
		if (e.type === 'tremolo') return true;
		return false;
	});
};


// Remove quotes from string literal
const unquoteString = (str: string): string => {
	if (str.startsWith('"') && str.endsWith('"')) {
		return str.slice(1, -1);
	}
	return str;
};


// Extract text from lotus parser objects recursively
const extractTextFromObject = (obj: any): string | undefined => {
	if (!obj) return undefined;

	// Simple string
	if (typeof obj === 'string') {
		return obj;
	}

	// Array - concatenate all text
	if (Array.isArray(obj)) {
		const texts: string[] = [];
		for (const item of obj) {
			const text = extractTextFromObject(item);
			if (text) texts.push(text);
		}
		return texts.join(' ').trim() || undefined;
	}

	// Object with proto property (lotus parser objects)
	if (obj && typeof obj === 'object' && obj.proto) {
		switch (obj.proto) {
			case 'LiteralString':
				// exp contains quoted string like '"Hello"'
				if (obj.exp) {
					return unquoteString(obj.exp);
				}
				break;

			case 'MarkupCommand':
			case 'Command':
				// Recursively extract from args
				if (obj.args) {
					return extractTextFromObject(obj.args);
				}
				break;

			case 'InlineBlock':
				// Extract from body, skip primitive commands
				if (obj.body) {
					const texts: string[] = [];
					for (const item of obj.body) {
						if (item.proto !== 'Primitive') {
							const text = extractTextFromObject(item);
							if (text) texts.push(text);
						}
					}
					return texts.join(' ').trim() || undefined;
				}
				break;

			case 'String':
				if (obj.value) {
					return obj.value;
				}
				break;
		}
	}

	// Fallback: try value property
	if (obj.value !== undefined) {
		return extractTextFromObject(obj.value);
	}

	return undefined;
};


// Check if markup contains \bold command (indicates harmony/chord symbol)
// Returns the text if it's a harmony, undefined otherwise
const extractHarmonyFromMarkup = (obj: any): string | undefined => {
	if (!obj) return undefined;

	// Check array of args
	if (Array.isArray(obj)) {
		for (const item of obj) {
			const result = extractHarmonyFromMarkup(item);
			if (result !== undefined) return result;
		}
		return undefined;
	}

	if (obj && typeof obj === 'object') {
		// Check if this is a \bold command (can be Command or MarkupCommand)
		if ((obj.proto === 'Command' || obj.proto === 'MarkupCommand') &&
			(obj.cmd === 'bold' || obj.cmd === '\\bold')) {
			// Extract the text from args
			return extractTextFromObject(obj.args);
		}

		// Recursively search InlineBlock body
		if (obj.proto === 'InlineBlock' && obj.body) {
			return extractHarmonyFromMarkup(obj.body);
		}

		// Recursively search args
		if (obj.args) {
			return extractHarmonyFromMarkup(obj.args);
		}
	}

	return undefined;
};


// Extract string value from header field
const extractStringValue = (value: any): string | undefined => {
	const text = extractTextFromObject(value);
	return text ? text.trim() : undefined;
};


// Extract metadata from LilyDocument
const extractMetadata = (lilyDocument: lilyParser.LilyDocument): Metadata | undefined => {
	try {
		const attrs = lilyDocument.globalAttributesReadOnly();

		const metadata: Metadata = {};

		// Extract each field, handling markup structures
		if (attrs.title) {
			metadata.title = extractStringValue(attrs.title);
		}
		if (attrs.subtitle) {
			metadata.subtitle = extractStringValue(attrs.subtitle);
		}
		if (attrs.composer) {
			metadata.composer = extractStringValue(attrs.composer);
		}
		if (attrs.arranger) {
			metadata.arranger = extractStringValue(attrs.arranger);
		}
		if (attrs.poet) {
			metadata.lyricist = extractStringValue(attrs.poet);
		}
		if (attrs.opus) {
			metadata.opus = extractStringValue(attrs.opus);
		}
		if (attrs.instrument) {
			metadata.instrument = extractStringValue(attrs.instrument);
		}

		// Return undefined if no metadata fields were populated
		if (Object.keys(metadata).length === 0) {
			return undefined;
		}

		return metadata;
	} catch (e) {
		// If metadata extraction fails, continue without it
		return undefined;
	}
};


// Convert parsed measures to LilyletDoc
const parsedMeasuresToDoc = (parsedMeasures: ParsedMeasure[], metadata?: Metadata): LilyletDoc => {
	const measures: Measure[] = parsedMeasures.map(pm => {
		// Filter out voices that only contain spacer rests and context changes
		const filteredVoices = pm.voices.filter(v => hasRealContent(v.events));

		// Group voices by partIndex
		const partMap = new Map<number, Array<{ staff: number; events: Event[] }>>();
		for (const v of filteredVoices) {
			const pi = v.partIndex || 1;
			if (!partMap.has(pi)) {
				partMap.set(pi, []);
			}
			partMap.get(pi)!.push({
				staff: v.staff,
				events: v.events,
			});
		}

		// Convert to parts array (sorted by part index)
		const partIndices = Array.from(partMap.keys()).sort((a, b) => a - b);
		const parts = partIndices.map(pi => ({
			voices: partMap.get(pi)!,
		}));

		// Fallback to single empty part if no voices
		const measure: Measure = {
			parts: parts.length > 0 ? parts : [{ voices: [] }],
		};

		if (pm.key !== null) {
			measure.key = convertKeySignature(pm.key);
		}
		if (pm.timeSig) {
			measure.timeSig = pm.timeSig;
		}
		if (pm.partial) {
			measure.partial = true;
		}

		return measure;
	})
	// Filter out empty measures (no voices in any part)
	.filter(m => m.parts.some(p => p.voices.length > 0));

	const doc: LilyletDoc = { measures };
	if (metadata) {
		doc.metadata = metadata;
	}
	return doc;
};


/**
 * Decode a LilyPond string to LilyletDoc (synchronous, browser-compatible)
 */
const decode = (lilypondSource: string): LilyletDoc => {
	const rawData = lilypondParser.parse(lilypondSource);
	const lilyDocument = new lilyParser.LilyDocument(rawData);
	const parsedMeasures = parseLilyDocument(lilyDocument);
	const metadata = extractMetadata(lilyDocument);
	return parsedMeasuresToDoc(parsedMeasures, metadata);
};


/**
 * Decode from pre-parsed LilyDocument (synchronous, for when you already have parsed data)
 */
const decodeFromDocument = (lilyDocument: lilyParser.LilyDocument): LilyletDoc => {
	const parsedMeasures = parseLilyDocument(lilyDocument);
	const metadata = extractMetadata(lilyDocument);
	return parsedMeasuresToDoc(parsedMeasures, metadata);
};


export {
	decode,
	decodeFromDocument,
	parseLilyDocument,
};
