/**
 * LilyPond to Lilylet Decoder
 *
 * Converts LilyPond notation files to Lilylet document format using the lotus parser.
 */

// Import directly from the compiled lib directory to avoid ESM issues
import * as lilyParser from "@k-l-lambda/lotus/lib/inc/lilyParser";


// Lazy-loaded parser instance
let parserPromise: Promise<any> | null = null;

const getParser = async () => {
	if (!parserPromise) {
		// Load jison parser directly
		const fs = await import('fs');
		const path = await import('path');
		const Jison = (await import('jison')).default;

		const jisonPath = path.join(
			path.dirname(require.resolve('@k-l-lambda/lotus/package.json')),
			'jison/lilypond.jison'
		);
		const grammar = fs.readFileSync(jisonPath, 'utf-8');
		const parser = new Jison.Parser(grammar);

		parserPromise = Promise.resolve(parser);
	}
	return parserPromise;
};

import {
	LilyletDoc,
	Measure,
	Event,
	NoteEvent,
	RestEvent,
	ContextChange,
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


// Internal measure representation during parsing
interface ParsedMeasure {
	key: number | null;
	timeSig: Fraction | null;
	voices: ParsedVoice[];
	partial: boolean;
}


interface ParsedVoice {
	staff: number;
	events: Event[];
}


// Convert LilyPond pitch to Lilylet pitch
const convertPitch = (phonetStep: number, alterValue: number, octave: number): Pitch => {
	const phonet = PHONET_NAMES[phonetStep % 7];
	const accidental = alterValue !== 0 ? ALTER_TO_ACCIDENTAL[alterValue] : undefined;

	// LilyPond octave: 0 = c', 1 = c'', -1 = c
	// Lilylet octave: 0 = middle C octave (C4)
	// LilyPond octave 1 = Lilylet octave 0
	const lilyletOctave = octave;

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


// Convert key fifths to KeySignature
const convertKeySignature = (fifths: number): KeySignature | undefined => {
	const mapping = KEY_FIFTHS_MAP[fifths];
	if (mapping) {
		return {
			pitch: mapping.pitch,
			accidental: mapping.accidental,
			mode: mapping.mode,
		};
	}
	return undefined;
};


// Parse post-events to marks
const parsePostEvents = (postEvents: any[]): Mark[] => {
	const marks: Mark[] = [];

	if (!postEvents) return marks;

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
					marks.push({ type: ARTICULATION_MAP[cleanArg] });
				} else if (ORNAMENT_MAP[cleanArg]) {
					marks.push({ type: ORNAMENT_MAP[cleanArg] });
				}
			}

			// Command (dynamics, hairpins, etc.)
			if (arg && typeof arg === 'object' && 'cmd' in arg) {
				const cmd = arg.cmd;
				if (DYNAMIC_REGEX.test(cmd) && DYNAMIC_MAP[cmd]) {
					marks.push({ type: DYNAMIC_MAP[cmd] });
				} else if (cmd === '<') {
					marks.push({ type: HairpinType.crescendoStart });
				} else if (cmd === '>') {
					marks.push({ type: HairpinType.diminuendoStart });
				} else if (cmd === '!') {
					marks.push({ type: HairpinType.crescendoEnd }); // or diminuendoEnd
				} else if (cmd === 'sustainOn') {
					marks.push({ type: PedalType.sustainOn });
				} else if (cmd === 'sustainOff') {
					marks.push({ type: PedalType.sustainOff });
				}
			}
		}
	}

	return marks;
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

		const staffName = track.contextDict?.Staff;
		if (staffName) {
			appendStaff(staffName);
		}
		let staff = staffName ? staffNames.indexOf(staffName) + 1 : 1;

		const context = new lilyParser.TrackContext(undefined, {
			listener: (term: lilyParser.BaseTerm, context: lilyParser.TrackContext) => {
				const mi = term._measure!;
				if (mi === undefined) return;

				if (!measureMap.has(mi)) {
					measureMap.set(mi, {
						key: null,
						timeSig: null,
						voices: [],
						partial: false,
					});
				}

				// Update staff from context
				if (context.staffName) {
					appendStaff(context.staffName);
					staff = staffNames.indexOf(context.staffName) + 1;
				}

				const measure = measureMap.get(mi)!;

				// Initialize voice for this track
				if (!measure.voices[vi]) {
					measure.voices[vi] = {
						staff,
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
					// Update staff from voice events
					voice.staff = staff;

					// Handle clef context change
					if (context.clef && !voice.events.some(e => e.type === 'context' && (e as ContextChange).clef)) {
						const clef = LILYPOND_CLEF_MAP[context.clef.clefName];
						if (clef) {
							voice.events.push({
								type: 'context',
								clef,
							});
						}
					}

					// Handle ottava
					if (context.octave?.value && !voice.events.some(e => e.type === 'context' && (e as ContextChange).ottava !== undefined)) {
						voice.events.push({
							type: 'context',
							ottava: context.octave.value,
						});
					}

					// Handle stem direction context
					if (context.stemDirection && !voice.events.some(e => e.type === 'context' && (e as ContextChange).stemDirection)) {
						const stemDir = context.stemDirection === 'Up' ? StemDirection.up :
							context.stemDirection === 'Down' ? StemDirection.down : undefined;
						if (stemDir) {
							voice.events.push({
								type: 'context',
								stemDirection: stemDir,
							});
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
									pitch.octave
								));
							}
						}

						if (pitches.length > 0) {
							const marks = parsePostEvents(term.post_events);

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
				// Handle standalone stem direction
				else if (term instanceof lilyParser.LilyTerms.StemDirection) {
					const stemDir = term.direction === 'Up' ? StemDirection.up :
						term.direction === 'Down' ? StemDirection.down : undefined;
					if (stemDir) {
						voice.events.push({
							type: 'context',
							stemDirection: stemDir,
						});
					}
				}
				// Handle standalone clef
				else if (term instanceof lilyParser.LilyTerms.Clef) {
					const clef = LILYPOND_CLEF_MAP[term.clefName];
					if (clef) {
						voice.events.push({
							type: 'context',
							clef,
						});
					}
				}
				// Handle ottava shift
				else if (term instanceof lilyParser.LilyTerms.OctaveShift) {
					voice.events.push({
						type: 'context',
						ottava: term.value,
					});
				}
				// Handle staff change
				else if (term instanceof lilyParser.LilyTerms.Change) {
					if (term.args?.[0]?.key === 'Staff') {
						// Staff change mid-voice
						voice.staff = staff;
					}
				}
			},
		});

		context.execute(track.music);
	});

	// Filter out empty voices and convert to array
	const measures = Array.from(measureMap.values());
	for (const measure of measures) {
		measure.voices = measure.voices.filter(Boolean);
	}

	return measures;
};


// Convert parsed measures to LilyletDoc
const parsedMeasuresToDoc = (parsedMeasures: ParsedMeasure[]): LilyletDoc => {
	const measures: Measure[] = parsedMeasures.map(pm => {
		const measure: Measure = {
			parts: [{
				voices: pm.voices.map(v => ({
					staff: v.staff,
					events: v.events,
				})),
			}],
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
	});

	return { measures };
};


/**
 * Decode a LilyPond string to LilyletDoc (async - requires parser loading)
 */
const decode = async (lilypondSource: string): Promise<LilyletDoc> => {
	const parser = await getParser();
	const rawData = parser.parse(lilypondSource);
	const lilyDocument = new lilyParser.LilyDocument(rawData);
	const parsedMeasures = parseLilyDocument(lilyDocument);
	return parsedMeasuresToDoc(parsedMeasures);
};


/**
 * Decode a LilyPond file to LilyletDoc
 */
const decodeFile = async (filePath: string): Promise<LilyletDoc> => {
	const fs = await import('fs/promises');
	const source = await fs.readFile(filePath, 'utf-8');
	return decode(source);
};


/**
 * Decode from pre-parsed LilyDocument (synchronous, for when you already have parsed data)
 */
const decodeFromDocument = (lilyDocument: lilyParser.LilyDocument): LilyletDoc => {
	const parsedMeasures = parseLilyDocument(lilyDocument);
	return parsedMeasuresToDoc(parsedMeasures);
};


export {
	decode,
	decodeFile,
	decodeFromDocument,
	parseLilyDocument,
	getParser,
};
