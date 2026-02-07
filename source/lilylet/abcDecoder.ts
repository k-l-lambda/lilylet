/**
 * ABC Notation Decoder for Lilylet
 *
 * Converts ABC notation files to Lilylet's internal LilyletDoc format.
 */

import { ABC } from "../abc/abc";
import parse from "../abc/parser";
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
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Metadata,
	Fraction,
	TimeSig,
	Phonet,
	Accidental,
	Clef,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	NavigationMarkType,
	Tempo,
	BarlineEvent,
} from "./types";


// ============ Constants ============

const ABC_PHONET_MAP: Record<string, Phonet> = {
	"C": Phonet.c, "D": Phonet.d, "E": Phonet.e, "F": Phonet.f, "G": Phonet.g, "A": Phonet.a, "B": Phonet.b,
	"c": Phonet.c, "d": Phonet.d, "e": Phonet.e, "f": Phonet.f, "g": Phonet.g, "a": Phonet.a, "b": Phonet.b,
};

const ABC_KEY_MAP: Record<string, { pitch: Phonet; accidental?: Accidental }> = {
	"C": { pitch: Phonet.c },
	"G": { pitch: Phonet.g },
	"D": { pitch: Phonet.d },
	"A": { pitch: Phonet.a },
	"E": { pitch: Phonet.e },
	"B": { pitch: Phonet.b },
	"F": { pitch: Phonet.f },
	"Cb": { pitch: Phonet.c, accidental: Accidental.flat },
	"Gb": { pitch: Phonet.g, accidental: Accidental.flat },
	"Db": { pitch: Phonet.d, accidental: Accidental.flat },
	"Ab": { pitch: Phonet.a, accidental: Accidental.flat },
	"Eb": { pitch: Phonet.e, accidental: Accidental.flat },
	"Bb": { pitch: Phonet.b, accidental: Accidental.flat },
	"F#": { pitch: Phonet.f, accidental: Accidental.sharp },
	"C#": { pitch: Phonet.c, accidental: Accidental.sharp },
	"G#": { pitch: Phonet.g, accidental: Accidental.sharp },
	"D#": { pitch: Phonet.d, accidental: Accidental.sharp },
	"A#": { pitch: Phonet.a, accidental: Accidental.sharp },
	"E#": { pitch: Phonet.e, accidental: Accidental.sharp },
	"B#": { pitch: Phonet.b, accidental: Accidental.sharp },
};

const DYNAMIC_MAP: Record<string, DynamicType> = {
	"ppp": DynamicType.ppp,
	"pp": DynamicType.pp,
	"p": DynamicType.p,
	"mp": DynamicType.mp,
	"mf": DynamicType.mf,
	"f": DynamicType.f,
	"ff": DynamicType.ff,
	"fff": DynamicType.fff,
	"sfz": DynamicType.sfz,
};


// ============ Utility Functions ============

/**
 * Convert ABC accidental to Lilylet Accidental
 */
const convertAccidental = (acc: number | null): Accidental | undefined => {
	if (acc === null || acc === undefined) return undefined;
	switch (acc) {
		case -2: return Accidental.doubleFlat;
		case -1: return Accidental.flat;
		case 0: return Accidental.natural;
		case 1: return Accidental.sharp;
		case 2: return Accidental.doubleSharp;
		default: return undefined;
	}
};

/**
 * Convert ABC pitch to Lilylet Pitch
 * Uppercase C-B = octave 0, lowercase c-b = octave 1
 * quotes (from ' and ,) add/subtract octaves
 */
const convertPitch = (abcPitch: ABC.Pitch): Pitch => {
	const phonet = ABC_PHONET_MAP[abcPitch.phonet];
	if (!phonet) {
		throw new Error(`Unknown ABC phonet: ${abcPitch.phonet}`);
	}

	// Uppercase = octave 0 (middle C octave), lowercase = octave 1
	const isLower = abcPitch.phonet >= "a" && abcPitch.phonet <= "g";
	const baseOctave = isLower ? 1 : 0;
	const octave = baseOctave + (abcPitch.quotes || 0);

	const pitch: Pitch = { phonet, octave };
	const accidental = convertAccidental(abcPitch.acc);
	if (accidental) {
		pitch.accidental = accidental;
	}
	return pitch;
};

/**
 * Convert ABC duration fraction to Lilylet Duration.
 * ABC durations are multipliers of the unit length (L: field).
 *
 * actualLength = unitLength * (numerator / denominator)
 * Then convert fraction-of-whole-note to {division, dots}
 */
const convertDuration = (abcDuration: { numerator: number; denominator: number } | undefined, unitLength: { numerator: number; denominator: number }): Duration => {
	const num = abcDuration?.numerator ?? 1;
	const den = abcDuration?.denominator ?? 1;

	// actualLength as fraction of whole note: unitLength * duration
	const actualNum = unitLength.numerator * num;
	const actualDen = unitLength.denominator * den;

	// Try to match {division, dots} where:
	// division=d, dots=0: duration = 1/d
	// division=d, dots=1: duration = 1/d * 1.5 = 3/(2d)
	// division=d, dots=2: duration = 1/d * 1.75 = 7/(4d)
	for (const dots of [0, 1, 2]) {
		let testNum: number;
		let testDen: number;
		if (dots === 0) {
			testNum = 1;
			testDen = 1; // 1/division
		} else if (dots === 1) {
			testNum = 3;
			testDen = 2; // 3/(2*division)
		} else {
			testNum = 7;
			testDen = 4; // 7/(4*division)
		}

		// We need: actualNum/actualDen = testNum / (testDen * division)
		// So: division = testNum * actualDen / (testDen * actualNum)
		const divNum = testNum * actualDen;
		const divDen = testDen * actualNum;

		if (divDen > 0 && divNum % divDen === 0) {
			const division = divNum / divDen;
			// Check it's a valid power of 2
			if (division > 0 && (division & (division - 1)) === 0) {
				return { division, dots };
			}
		}
	}

	// Fallback: find closest power-of-2 division
	const ratio = actualNum / actualDen;
	const division = Math.max(1, Math.round(1 / ratio));
	// Snap to nearest power of 2
	const log2 = Math.round(Math.log2(division));
	return { division: Math.pow(2, Math.max(0, log2)), dots: 0 };
};

/**
 * Apply broken rhythm adjustment.
 * broken > 0 (A>B): current note gets dotted, next gets halved
 * broken < 0 (A<B): current note gets halved, next gets dotted
 */
const applyBrokenRhythm = (
	events: (NoteEvent | RestEvent)[],
	brokenIndex: number,
	broken: number
): void => {
	if (brokenIndex < 0 || brokenIndex >= events.length - 1) return;

	const abs = Math.abs(broken);
	const multiplier = Math.pow(2, abs);

	const current = events[brokenIndex];
	const next = events[brokenIndex + 1];

	if (broken > 0) {
		// Current gets longer (multiply by 2-1/multiplier), next gets shorter
		// A>B: A is dotted (3/2), B is halved (1/2)
		// A>>B: A gets 7/4, B gets 1/4
		adjustDurationMultiply(current.duration, (2 * multiplier - 1), multiplier);
		adjustDurationMultiply(next.duration, 1, multiplier);
	} else {
		adjustDurationMultiply(current.duration, 1, multiplier);
		adjustDurationMultiply(next.duration, (2 * multiplier - 1), multiplier);
	}
};

/**
 * Multiply a duration by num/den and re-derive division+dots
 */
const adjustDurationMultiply = (dur: Duration, num: number, den: number): void => {
	// Current value as fraction of whole note
	let valueNum: number;
	let valueDen: number;
	if (dur.dots === 0) {
		valueNum = 1;
		valueDen = dur.division;
	} else if (dur.dots === 1) {
		valueNum = 3;
		valueDen = 2 * dur.division;
	} else {
		valueNum = 7;
		valueDen = 4 * dur.division;
	}

	const newNum = valueNum * num;
	const newDen = valueDen * den;

	// Re-derive division+dots from the new fraction
	const result = fractionToDivisionDots(newNum, newDen);
	dur.division = result.division;
	dur.dots = result.dots;
};

const fractionToDivisionDots = (num: number, den: number): { division: number; dots: number } => {
	for (const dots of [0, 1, 2]) {
		let testNum: number;
		let testDen: number;
		if (dots === 0) {
			testNum = 1; testDen = 1;
		} else if (dots === 1) {
			testNum = 3; testDen = 2;
		} else {
			testNum = 7; testDen = 4;
		}
		const divNum = testNum * den;
		const divDen = testDen * num;
		if (divDen > 0 && divNum % divDen === 0) {
			const division = divNum / divDen;
			if (division > 0 && (division & (division - 1)) === 0) {
				return { division, dots };
			}
		}
	}
	const ratio = num / den;
	const division = Math.max(1, Math.round(1 / ratio));
	const log2 = Math.round(Math.log2(division));
	return { division: Math.pow(2, Math.max(0, log2)), dots: 0 };
};

/**
 * Convert ABC key signature to Lilylet KeySignature
 */
const convertKeySignature = (abcKey: ABC.KeySignature): KeySignature => {
	const keyEntry = ABC_KEY_MAP[abcKey.root];
	if (!keyEntry) {
		// Try parsing root + accidental from string
		const root = abcKey.root.charAt(0);
		const acc = abcKey.root.substring(1);
		const entry = ABC_KEY_MAP[root] || { pitch: Phonet.c };
		return {
			pitch: entry.pitch,
			accidental: acc === "b" ? Accidental.flat : acc === "#" ? Accidental.sharp : entry.accidental,
			mode: (abcKey.mode === "minor" || abcKey.mode === "min") ? "minor" : "major",
		};
	}
	return {
		pitch: keyEntry.pitch,
		accidental: keyEntry.accidental,
		mode: (abcKey.mode === "minor" || abcKey.mode === "min") ? "minor" : "major",
	};
};

/**
 * Convert ABC clef string to Lilylet Clef
 */
const convertClef = (clefStr: string): Clef | undefined => {
	switch (clefStr?.toLowerCase()) {
		case "treble": return Clef.treble;
		case "bass": return Clef.bass;
		case "alto": case "tenor": return Clef.alto;
		default: return undefined;
	}
};

/**
 * Convert ABC barline to Lilylet barline style
 */
const convertBarline = (bar: string | null): string | undefined => {
	if (!bar) return undefined;
	switch (bar) {
		case "|": return "|";
		case "||": return "||";
		case "|]": return "|.";
		case "|:": return ".|:";
		case ":|": return ":|.";
		case ":|:": case ":||:": return ":..:" ;
		default:
			if (bar.startsWith(":|")) return ":|.";
			if (bar.startsWith("|:")) return ".|:";
			return "|";
	}
};


// ============ Score Layout Parser ============

interface StaffAssignment {
	partIndex: number;
	staffInPart: number;
}

/**
 * Parse %%score layout to determine voice→(part, staff) mapping.
 * {(...) | (...)} = one part with two staves
 * (...) = voices sharing one staff
 */
const parseScoreLayout = (
	headers: any[]
): Map<number, StaffAssignment> | null => {
	const layoutHeader = headers.find((h: any) => h.staffLayout);
	if (!layoutHeader) return null;

	const layout: ABC.StaffGroup[] = layoutHeader.staffLayout;
	const voiceMap = new Map<number, StaffAssignment>();

	let partIndex = 0;

	for (const group of layout) {
		if (group.bound === "curly") {
			// Curly braces = one instrument/part with multiple staves
			let staffInPart = 1;
			for (const item of group.items) {
				if (typeof item === "string") {
					voiceMap.set(parseInt(item), { partIndex, staffInPart });
				} else if ((item as ABC.StaffGroup).items) {
					const sg = item as ABC.StaffGroup;
					for (const subItem of sg.items) {
						if (typeof subItem === "string") {
							voiceMap.set(parseInt(subItem), { partIndex, staffInPart });
						} else if ((subItem as ABC.StaffGroup).items) {
							for (const leaf of (subItem as ABC.StaffGroup).items) {
								if (typeof leaf === "string") {
									voiceMap.set(parseInt(leaf), { partIndex, staffInPart });
								}
							}
						}
					}
					staffInPart++;
				}
			}
			partIndex++;
		} else if (group.bound === "arc" || !group.bound) {
			// Arc or plain = voices sharing a staff in same part
			for (const item of group.items) {
				if (typeof item === "string") {
					voiceMap.set(parseInt(item), { partIndex, staffInPart: 1 });
				} else if ((item as ABC.StaffGroup).items) {
					for (const subItem of (item as ABC.StaffGroup).items) {
						if (typeof subItem === "string") {
							voiceMap.set(parseInt(subItem), { partIndex, staffInPart: 1 });
						}
					}
				}
			}
			partIndex++;
		} else {
			// Square bracket or unknown - treat each item as separate part
			for (const item of group.items) {
				if (typeof item === "string") {
					voiceMap.set(parseInt(item), { partIndex, staffInPart: 1 });
					partIndex++;
				} else if ((item as ABC.StaffGroup).items) {
					const sg = item as ABC.StaffGroup;
					if (sg.bound === "curly") {
						let staffInPart = 1;
						for (const subItem of sg.items) {
							if (typeof subItem === "string") {
								voiceMap.set(parseInt(subItem), { partIndex, staffInPart });
							} else if ((subItem as ABC.StaffGroup).items) {
								for (const leaf of (subItem as ABC.StaffGroup).items) {
									if (typeof leaf === "string") {
										voiceMap.set(parseInt(leaf), { partIndex, staffInPart });
									}
								}
								staffInPart++;
							}
						}
						partIndex++;
					} else {
						for (const subItem of sg.items) {
							if (typeof subItem === "string") {
								voiceMap.set(parseInt(subItem), { partIndex, staffInPart: 1 });
							}
						}
						partIndex++;
					}
				}
			}
		}
	}

	return voiceMap.size > 0 ? voiceMap : null;
};


// ============ Marks/Decorations Conversion ============

const convertArticulationMark = (artName: string): Mark | undefined => {
	switch (artName) {
		case "accent": case "L":
			return { markType: "articulation", type: ArticulationType.accent };
		case "staccato":
			return { markType: "articulation", type: ArticulationType.staccato };
		case "tenuto":
			return { markType: "articulation", type: ArticulationType.tenuto };
		case "marcato":
			return { markType: "articulation", type: ArticulationType.marcato };
		case "emphasis":
			return { markType: "articulation", type: ArticulationType.accent };
		case "trill": case "T":
			return { markType: "ornament", type: OrnamentType.trill };
		case "mordent": case "M":
			return { markType: "ornament", type: OrnamentType.mordent };
		case "prall": case "P":
			return { markType: "ornament", type: OrnamentType.prall };
		case "turn":
			return { markType: "ornament", type: OrnamentType.turn };
		case "fermata": case "H":
			return { markType: "ornament", type: OrnamentType.fermata };
		case "roll": case "R":
			return { markType: "ornament", type: OrnamentType.arpeggio };
		case "arpeggio":
			return { markType: "ornament", type: OrnamentType.arpeggio };
		default: return undefined;
	}
};

/**
 * Process an ABC expressive/articulation term into marks
 */
const processExpressiveTerm = (
	term: any,
	pendingMarks: Mark[],
	pendingContextChanges: ContextChange[],
	slurDepth: { count: number }
): void => {
	if (term.express) {
		const expr = term.express;
		if (expr === "(") {
			pendingMarks.push({ markType: "slur", start: true });
			slurDepth.count++;
		} else if (expr === ")") {
			if (slurDepth.count > 0) {
				pendingMarks.push({ markType: "slur", start: false });
				slurDepth.count--;
			}
		} else if (expr === ".") {
			pendingMarks.push({ markType: "articulation", type: ArticulationType.staccato });
		} else if (expr === "-") {
			pendingMarks.push({ markType: "tie", start: true });
		} else if (expr === "coda") {
			pendingMarks.push({ markType: "navigation", type: NavigationMarkType.coda });
		} else if (expr === "segno") {
			pendingMarks.push({ markType: "navigation", type: NavigationMarkType.segno });
		}
	} else if (term.articulation !== undefined) {
		const artContent = term.articulation;
		const scope = term.scope;

		// Hairpins
		if (artContent === "<") {
			if (scope === "(") {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.crescendoStart });
			} else if (scope === ")") {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.crescendoEnd });
			} else {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.crescendoStart });
			}
		} else if (artContent === ">") {
			if (scope === "(") {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.diminuendoStart });
			} else if (scope === ")") {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.diminuendoEnd });
			} else {
				pendingMarks.push({ markType: "hairpin", type: HairpinType.accent });
			}
		}
		// Dynamics
		else if (DYNAMIC_MAP[artContent]) {
			pendingMarks.push({ markType: "dynamic", type: DYNAMIC_MAP[artContent] });
		}
		// Pedal
		else if (artContent === "ped") {
			pendingMarks.push({ markType: "pedal", type: PedalType.sustainOn });
		} else if (artContent === "ped-up") {
			pendingMarks.push({ markType: "pedal", type: PedalType.sustainOff });
		}
		// Named articulations/ornaments
		else {
			const mark = convertArticulationMark(artContent);
			if (mark) {
				pendingMarks.push(mark);
			}
		}
	} else if (term.fingering !== undefined) {
		const finger = typeof term.fingering === "string" ? parseInt(term.fingering) : term.fingering;
		if (finger >= 1 && finger <= 5) {
			pendingMarks.push({ markType: "fingering", finger });
		}
	} else if (term.octaveShift !== undefined) {
		pendingContextChanges.push({
			type: "context",
			ottava: -term.octaveShift,  // ABC: positive=shift down, Lilylet: positive=shift up
		});
	} else if (term.tremolo !== undefined) {
		// Tremolo marks are handled on notes directly
	}
};


// ============ Voice Processing ============

interface VoiceConfig {
	name: number;
	clef?: string;
	properties?: Record<string, any>;
}

/**
 * Process a single ABC BarPatch (one voice's content for one measure) into events.
 */
const processBarPatch = (
	patch: ABC.BarPatch,
	unitLength: { numerator: number; denominator: number },
	slurDepth: { count: number }
): { events: Event[]; barline?: string } => {
	const events: Event[] = [];
	const terms = patch.terms || [];
	const pendingMarks: Mark[] = [];
	const pendingContextChanges: ContextChange[] = [];

	// Collect all events first, then handle broken rhythms and tuplets
	const rawNoteRests: { event: NoteEvent | RestEvent; index: number; broken?: number }[] = [];

	let i = 0;
	while (i < terms.length) {
		const term = terms[i];

		// Control (inline field like [K:G])
		if ((term as ABC.ControlTerm).control) {
			const ctrl = (term as ABC.ControlTerm).control;
			if (ctrl.name === "K") {
				if (ctrl.value?.clef) {
					const clef = convertClef(ctrl.value.clef);
					if (clef) {
						events.push({ type: "context", clef } as ContextChange);
					}
				} else if (ctrl.value?.root) {
					events.push({
						type: "context",
						key: convertKeySignature(ctrl.value),
					} as ContextChange);
				}
			} else if (ctrl.name === "M") {
				if (ctrl.value?.numerator && ctrl.value?.denominator) {
					events.push({
						type: "context",
						time: { numerator: ctrl.value.numerator, denominator: ctrl.value.denominator },
					} as ContextChange);
				}
			} else if (ctrl.name === "Q") {
				if (ctrl.value?.note && ctrl.value?.bpm) {
					const beatDuration = convertDuration(ctrl.value.note, { numerator: 1, denominator: 1 });
					events.push({
						type: "context",
						tempo: { beat: beatDuration, bpm: ctrl.value.bpm },
					} as ContextChange);
				}
			} else if (ctrl.name === "V") {
				// Voice change within measure - skip (handled at measure level)
			}
			i++;
			continue;
		}

		// Tuplet marker
		if ((term as ABC.Triplet).triplet !== undefined) {
			const tripletTerm = term as ABC.Triplet;
			const p = tripletTerm.triplet;  // number of notes in group
			const q = tripletTerm.multiplier ?? getDefaultTupletMultiplier(p);  // notes in time of q
			const r = tripletTerm.n ?? p;  // applies to r notes

			// Collect next r note/rest events
			const tupletEvents: (NoteEvent | RestEvent)[] = [];
			let j = i + 1;
			let collected = 0;
			while (j < terms.length && collected < r) {
				const nextTerm = terms[j];
				if ((nextTerm as ABC.EventTerm).event) {
					const evt = convertEventTerm(nextTerm as ABC.EventTerm, unitLength, pendingMarks, pendingContextChanges);
					if (evt) {
						// Push any pending context changes before tuplet
						for (const ctx of pendingContextChanges.splice(0)) {
							events.push(ctx);
						}
						if (Array.isArray(evt)) {
							for (const e of evt) {
								if (e.type === "note" || e.type === "rest") {
									tupletEvents.push(e);
									collected++;
								} else {
									events.push(e);
								}
							}
						} else if (evt.type === "note" || evt.type === "rest") {
							tupletEvents.push(evt);
							collected++;
						}
					}
				} else if (isExpressiveTerm(nextTerm)) {
					processExpressiveTerm(nextTerm, pendingMarks, pendingContextChanges, slurDepth);
				} else if ((nextTerm as any).grace) {
					const graceEvents = convertGraceEvents(nextTerm as any, unitLength);
					events.push(...graceEvents);
				}
				j++;
			}

			if (tupletEvents.length > 0) {
				// Lilylet ratio: {num: q, den: p} means "q in time of p"
				events.push({
					type: "tuplet",
					ratio: { numerator: q, denominator: p },
					events: tupletEvents,
				} as TupletEvent);
			}

			i = j;
			continue;
		}

		// Grace notes
		if ((term as any).grace) {
			const graceEvents = convertGraceEvents(term as any, unitLength);
			events.push(...graceEvents);
			i++;
			continue;
		}

		// Expressive marks
		if (isExpressiveTerm(term)) {
			processExpressiveTerm(term, pendingMarks, pendingContextChanges, slurDepth);
			i++;
			continue;
		}

		// Text
		if ((term as ABC.TextTerm).text !== undefined) {
			const text = (term as ABC.TextTerm).text;
			// Check if it's a tempo/expression marking
			if (text.startsWith("^")) {
				// Markup text above staff
			}
			i++;
			continue;
		}

		// Event (note/rest)
		if ((term as ABC.EventTerm).event) {
			const eventTerm = term as ABC.EventTerm;

			// Push pending context changes
			for (const ctx of pendingContextChanges.splice(0)) {
				events.push(ctx);
			}

			const evt = convertEventTerm(eventTerm, unitLength, pendingMarks, pendingContextChanges);
			if (evt) {
				if (Array.isArray(evt)) {
					events.push(...evt);
				} else {
					events.push(evt);
				}

				// Track broken rhythm
				if (eventTerm.broken) {
					const noteRestEvents = events.filter(e => e.type === "note" || e.type === "rest") as (NoteEvent | RestEvent)[];
					if (noteRestEvents.length >= 2) {
						applyBrokenRhythm(noteRestEvents, noteRestEvents.length - 2, eventTerm.broken);
					}
				}
			}
			i++;
			continue;
		}

		i++;
	}

	const barline = convertBarline(patch.bar);
	return { events, barline };
};

/**
 * Check if a term is an expressive mark
 */
const isExpressiveTerm = (term: any): boolean => {
	return term.express !== undefined ||
		term.articulation !== undefined ||
		term.fingering !== undefined ||
		term.octaveShift !== undefined ||
		term.tremolo !== undefined;
};

/**
 * Get default tuplet multiplier based on ABC convention
 */
const getDefaultTupletMultiplier = (p: number): number => {
	// In compound time (6/8, 9/8, 12/8), the defaults differ
	// For simplicity, use standard defaults:
	if (p === 2) return 3;  // duplet: 2 in time of 3
	if (p === 3) return 2;  // triplet: 3 in time of 2
	if (p === 4) return 3;  // quadruplet: 4 in time of 3
	if (p === 5) return 2;  // 5 in time of 2 (or 4/6)
	if (p === 6) return 2;  // sextuplet
	if (p === 7) return 2;  // 7 in time of 4
	if (p === 9) return 2;  // 9 in time of 8
	return 2;  // default
};

/**
 * Convert a single ABC EventTerm to Lilylet event(s)
 */
const convertEventTerm = (
	eventTerm: ABC.EventTerm,
	unitLength: { numerator: number; denominator: number },
	pendingMarks: Mark[],
	pendingContextChanges: ContextChange[]
): Event | Event[] | undefined => {
	const eventData = eventTerm.event;
	if (!eventData) return undefined;

	const chord = eventData.chord;
	if (!chord || !chord.pitches || chord.pitches.length === 0) return undefined;

	const firstPitch = chord.pitches[0];

	// Check if rest
	if (firstPitch.phonet === "z" || firstPitch.phonet === "Z" || firstPitch.phonet === "x") {
		const duration = convertDuration(eventData.duration, unitLength);
		const rest: RestEvent = {
			type: "rest",
			duration,
		};
		if (firstPitch.phonet === "x") {
			rest.invisible = true;
		}
		if (firstPitch.phonet === "Z") {
			rest.fullMeasure = true;
		}

		// Consume pending marks (attach to rest if any)
		pendingMarks.length = 0;

		return rest;
	}

	// Note or chord
	const pitches = chord.pitches.filter(p =>
		p.phonet !== "z" && p.phonet !== "Z" && p.phonet !== "x"
	).map(convertPitch);

	if (pitches.length === 0) return undefined;

	const duration = convertDuration(eventData.duration, unitLength);
	const marks: Mark[] = [...pendingMarks];
	pendingMarks.length = 0;

	// Handle tie
	const hasTie = chord.pitches.some(p => p.tie);
	if (hasTie) {
		marks.push({ markType: "tie", start: true });
	}

	const note: NoteEvent = {
		type: "note",
		pitches,
		duration,
	};

	if (marks.length > 0) {
		note.marks = marks;
	}

	// Push pending context changes before note
	if (pendingContextChanges.length > 0) {
		const result: Event[] = [...pendingContextChanges.splice(0), note];
		return result;
	}

	return note;
};

/**
 * Convert grace notes to NoteEvents with grace flag
 */
const convertGraceEvents = (
	graceTerm: any,
	unitLength: { numerator: number; denominator: number }
): NoteEvent[] => {
	const events: NoteEvent[] = [];
	if (!graceTerm.events) return events;

	for (const item of graceTerm.events) {
		if (item.event) {
			const eventData = item.event;
			const chord = eventData.chord;
			if (!chord || !chord.pitches) continue;

			const pitches = chord.pitches.filter((p: ABC.Pitch) =>
				p.phonet !== "z" && p.phonet !== "Z" && p.phonet !== "x"
			).map(convertPitch);

			if (pitches.length === 0) continue;

			const duration = convertDuration(eventData.duration, unitLength);
			const note: NoteEvent = {
				type: "note",
				pitches,
				duration,
				grace: true,
			};
			events.push(note);
		}
	}

	return events;
};


// ============ Main Decoder ============

/**
 * Decode an ABC tune into a LilyletDoc
 */
const decodeTune = (tune: ABC.Tune): LilyletDoc => {
	const headers = tune.header;
	const body = tune.body;

	// Extract header fields
	const metadata: Metadata = {};
	let unitLength = { numerator: 1, denominator: 8 };  // Default L:1/8
	let timeSig: TimeSig | undefined;
	let keySig: KeySignature | undefined;
	let tempo: Tempo | undefined;
	const voiceConfigs = new Map<number, VoiceConfig>();
	const voiceClefs = new Map<number, Clef>();

	for (const h of headers) {
		if ((h as any).comment) continue;
		if ((h as any).staffLayout) continue;

		const header = h as { name: string; value: any };
		switch (header.name) {
			case "T":
				if (!metadata.title) metadata.title = header.value;
				break;
			case "C":
				metadata.composer = header.value;
				break;
			case "L":
				if (header.value?.numerator && header.value?.denominator) {
					unitLength = header.value;
				}
				break;
			case "M":
				if (header.value?.numerator && header.value?.denominator) {
					timeSig = {
						numerator: header.value.numerator,
						denominator: header.value.denominator,
					};
				}
				break;
			case "K":
				if (header.value?.root) {
					keySig = convertKeySignature(header.value);
				} else if (header.value?.clef) {
					// Key header with clef only
				}
				break;
			case "Q":
				if (header.value?.note && header.value?.bpm) {
					const beatDuration = convertDuration(header.value.note, { numerator: 1, denominator: 1 });
					tempo = { beat: beatDuration, bpm: header.value.bpm };
				} else if (typeof header.value === "number") {
					tempo = { bpm: header.value };
				}
				break;
			case "V": {
				const voiceValue = header.value;
				if (voiceValue) {
					const voiceNum = typeof voiceValue === "number" ? voiceValue :
						(voiceValue.name || 1);
					const clefStr = typeof voiceValue === "string" ? voiceValue :
						(voiceValue.clef || undefined);
					voiceConfigs.set(voiceNum, {
						name: voiceNum,
						clef: clefStr,
						properties: voiceValue.properties,
					});
					if (clefStr) {
						const clef = convertClef(clefStr);
						if (clef) voiceClefs.set(voiceNum, clef);
					}
				}
				break;
			}
		}
	}

	// Parse score layout
	const scoreLayout = parseScoreLayout(headers);

	// Group measures by voice
	// ABC measures contain BarPatches, each with a voice control V:n
	const measures = body.measures;
	const voiceSlurDepths = new Map<number, { count: number }>();

	// Process each ABC measure into Lilylet Measure
	const lilyletMeasures: Measure[] = [];

	for (let mi = 0; mi < measures.length; mi++) {
		const abcMeasure = measures[mi];

		// Group patches by voice number
		const voicePatches = new Map<number, ABC.BarPatch[]>();
		for (const patch of abcMeasure.voices) {
			const voiceNum = patch.control?.V || 1;
			if (!voicePatches.has(voiceNum)) {
				voicePatches.set(voiceNum, []);
			}
			voicePatches.get(voiceNum)!.push(patch);
		}

		// Process each voice
		const partVoicesMap = new Map<number, Map<number, Voice>>();  // partIndex → (staffNum → voices)

		for (const [voiceNum, patches] of voicePatches) {
			const slurDepth = voiceSlurDepths.get(voiceNum) || { count: 0 };
			voiceSlurDepths.set(voiceNum, slurDepth);

			// Merge all patches for this voice in this measure
			const allEvents: Event[] = [];
			let barline: string | undefined;

			for (const patch of patches) {
				const result = processBarPatch(patch, unitLength, slurDepth);
				allEvents.push(...result.events);
				if (result.barline && result.barline !== "|") {
					barline = result.barline;
				}
			}

			if (barline) {
				allEvents.push({ type: "barline", style: barline } as BarlineEvent);
			}

			// Determine part/staff assignment
			let partIndex = 0;
			let staffInPart = 1;

			if (scoreLayout) {
				const assignment = scoreLayout.get(voiceNum);
				if (assignment) {
					partIndex = assignment.partIndex;
					staffInPart = assignment.staffInPart;
				}
			}

			if (!partVoicesMap.has(partIndex)) {
				partVoicesMap.set(partIndex, new Map());
			}

			const voicesInPart = partVoicesMap.get(partIndex)!;
			// If there are multiple voices on same staff in same part, create separate Voice entries
			// Use a key combining staff + voice to avoid collisions
			const voiceKey = staffInPart * 1000 + voiceNum;

			const voice: Voice = {
				staff: staffInPart,
				events: allEvents,
			};

			voicesInPart.set(voiceKey, voice);
		}

		// Build parts from the voice map
		const parts: Part[] = [];
		const sortedPartIndices = Array.from(partVoicesMap.keys()).sort((a, b) => a - b);

		for (const pi of sortedPartIndices) {
			const voicesMap = partVoicesMap.get(pi)!;
			const voices: Voice[] = [];
			const sortedKeys = Array.from(voicesMap.keys()).sort((a, b) => a - b);
			for (const key of sortedKeys) {
				voices.push(voicesMap.get(key)!);
			}

			const part: Part = { voices };

			// Add clef context to first voice of each staff on first measure
			if (mi === 0) {
				for (const voice of voices) {
					// Find voices for this part's staff and add initial clef
					const voiceNums = Array.from(voicePatches.keys());
					for (const vn of voiceNums) {
						if (scoreLayout) {
							const assign = scoreLayout.get(vn);
							if (assign && assign.partIndex === pi && assign.staffInPart === voice.staff) {
								const clef = voiceClefs.get(vn);
								if (clef) {
									voice.events.unshift({ type: "context", clef } as ContextChange);
									break;
								}
							}
						}
					}
				}
			}

			parts.push(part);
		}

		// If no parts, create a default
		if (parts.length === 0) {
			parts.push({ voices: [{ staff: 1, events: [] }] });
		}

		const measure: Measure = { parts };
		if (mi === 0) {
			if (keySig) measure.key = keySig;
			if (timeSig) measure.timeSig = timeSig;
		}

		lilyletMeasures.push(measure);
	}

	// Add tempo to first measure's first voice if present
	if (tempo && lilyletMeasures.length > 0) {
		const firstPart = lilyletMeasures[0].parts[0];
		if (firstPart && firstPart.voices.length > 0) {
			firstPart.voices[0].events.unshift({
				type: "context",
				tempo,
			} as ContextChange);
		}
	}

	const doc: LilyletDoc = {
		measures: lilyletMeasures,
	};

	if (Object.keys(metadata).length > 0) {
		doc.metadata = metadata;
	}

	return doc;
};


// ============ Public API ============

/**
 * Decode ABC notation string to LilyletDoc.
 * If the ABC contains multiple tunes, only the first is decoded.
 */
export const decode = (abcString: string): LilyletDoc => {
	const tunes = parse(abcString);
	if (!tunes || tunes.length === 0) {
		throw new Error("No tunes found in ABC notation");
	}
	return decodeTune(tunes[0]);
};

/**
 * Decode ABC notation string to multiple LilyletDocs (one per tune).
 */
export const decodeAll = (abcString: string): LilyletDoc[] => {
	const tunes = parse(abcString);
	if (!tunes || tunes.length === 0) {
		throw new Error("No tunes found in ABC notation");
	}
	return tunes.map(decodeTune);
};

/**
 * Decode an ABC file to LilyletDoc
 */
export const decodeFile = async (filePath: string): Promise<LilyletDoc> => {
	const fs = await import("fs/promises");
	const content = await fs.readFile(filePath, "utf-8");
	return decode(content);
};

export default {
	decode,
	decodeAll,
	decodeFile,
};
