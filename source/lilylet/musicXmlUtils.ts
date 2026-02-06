/**
 * MusicXML Utility Functions
 *
 * Helper functions for parsing MusicXML elements and converting values.
 */

import {
	Phonet,
	Accidental,
	Clef,
	StemDirection,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	KeySignature,
	Pitch,
	Duration,
	Fraction,
} from './types';

// ============ XML Element Helpers ============

/**
 * Get text content of a child element by tag name
 */
export const getElementText = (parent: Element, tagName: string): string | undefined => {
	const el = parent.getElementsByTagName(tagName)[0];
	return el?.textContent?.trim() || undefined;
};

/**
 * Get numeric content of a child element
 */
export const getElementNumber = (parent: Element, tagName: string): number | undefined => {
	const text = getElementText(parent, tagName);
	if (text === undefined) return undefined;
	const num = parseFloat(text);
	return isNaN(num) ? undefined : num;
};

/**
 * Get integer content of a child element
 */
export const getElementInt = (parent: Element, tagName: string): number | undefined => {
	const text = getElementText(parent, tagName);
	if (text === undefined) return undefined;
	const num = parseInt(text, 10);
	return isNaN(num) ? undefined : num;
};

/**
 * Check if element has a child with given tag name
 */
export const hasElement = (parent: Element, tagName: string): boolean => {
	return parent.getElementsByTagName(tagName).length > 0;
};

/**
 * Get attribute value from element
 */
export const getAttribute = (el: Element, name: string): string | undefined => {
	const attr = el.getAttribute(name);
	return attr || undefined;
};

/**
 * Get numeric attribute value
 */
export const getAttributeNumber = (el: Element, name: string): number | undefined => {
	const text = getAttribute(el, name);
	if (text === undefined) return undefined;
	const num = parseFloat(text);
	return isNaN(num) ? undefined : num;
};

/**
 * Get all child elements with given tag name
 */
export const getElements = (parent: Element, tagName: string): Element[] => {
	return Array.from(parent.getElementsByTagName(tagName));
};

/**
 * Get all direct child elements (xmldom compatible - uses childNodes)
 */
export const getChildElements = (parent: Element): Element[] => {
	const result: Element[] = [];
	for (let i = 0; i < parent.childNodes.length; i++) {
		const node = parent.childNodes[i];
		if (node.nodeType === 1) {  // ELEMENT_NODE
			result.push(node as Element);
		}
	}
	return result;
};

/**
 * Get direct child elements (not nested)
 * Note: Uses childNodes instead of children for xmldom compatibility
 */
export const getDirectChildren = (parent: Element, tagName: string): Element[] => {
	const result: Element[] = [];
	for (let i = 0; i < parent.childNodes.length; i++) {
		const node = parent.childNodes[i];
		if (node.nodeType === 1 && (node as Element).tagName === tagName) {
			result.push(node as Element);
		}
	}
	return result;
};

// ============ Pitch Conversion ============

const STEP_TO_PHONET: Record<string, Phonet> = {
	C: Phonet.c,
	D: Phonet.d,
	E: Phonet.e,
	F: Phonet.f,
	G: Phonet.g,
	A: Phonet.a,
	B: Phonet.b,
};

const ALTER_TO_ACCIDENTAL: Record<number, Accidental> = {
	[-2]: Accidental.doubleFlat,
	[-1]: Accidental.flat,
	[1]: Accidental.sharp,
	[2]: Accidental.doubleSharp,
};

/**
 * Convert MusicXML pitch to Lilylet Pitch
 * MusicXML octave 4 = middle C octave = Lilylet octave 0
 */
export const convertPitch = (
	step: string,
	alter: number | undefined,
	octave: number
): Pitch => {
	const phonet = STEP_TO_PHONET[step.toUpperCase()];
	if (!phonet) {
		throw new Error(`Invalid pitch step: ${step}`);
	}

	const accidental = alter !== undefined && alter !== 0
		? ALTER_TO_ACCIDENTAL[alter]
		: undefined;

	// MusicXML octave 4 = Lilylet octave 0
	const lilyletOctave = octave - 4;

	return {
		phonet,
		accidental,
		octave: lilyletOctave,
	};
};

// ============ Duration Constants & Mappings ============

// Standard divisions per quarter note (shared by encoder/decoder)
export const DIVISIONS = 4;

// MusicXML note type to division (1=whole, 2=half, 4=quarter, etc.)
export const TYPE_TO_DIVISION: Record<string, number> = {
	maxima: 0.125,
	long: 0.25,
	breve: 0.5,
	whole: 1,
	half: 2,
	quarter: 4,
	eighth: 8,
	'16th': 16,
	'32nd': 32,
	'64th': 64,
	'128th': 128,
	'256th': 256,
	'512th': 512,
	'1024th': 1024,
};

// Division to MusicXML note type (inverse of TYPE_TO_DIVISION)
export const DIVISION_TO_TYPE: Record<number, string> = Object.fromEntries(
	Object.entries(TYPE_TO_DIVISION).map(([type, div]) => [div, type])
);

/**
 * Calculate duration in MusicXML divisions.
 * Shared by encoder (with DIVISIONS=4) and potentially decoder.
 *
 * Duration.tuplet is in Lilylet ratio semantics:
 *   \times 2/3 → {numerator:2, denominator:3} → multiply by 2/3
 */
export const calculateDuration = (duration: Duration, divisions: number = DIVISIONS): number => {
	// Base duration: divisions * (4 / division)
	// e.g., quarter (4) = divisions * 1
	//       half (2) = divisions * 2
	//       eighth (8) = divisions * 0.5
	let dur = divisions * (4 / duration.division);

	// Apply dots
	if (duration.dots) {
		let dotValue = dur / 2;
		for (let i = 0; i < duration.dots; i++) {
			dur += dotValue;
			dotValue /= 2;
		}
	}

	// Apply tuplet ratio: Lilylet ratio num/den means multiply by num/den
	// e.g., \times 2/3 means each note's actual duration = written * 2/3
	if (duration.tuplet) {
		dur = dur * duration.tuplet.numerator / duration.tuplet.denominator;
	}

	return Math.round(dur);
};

/**
 * Convert MusicXML duration to Lilylet Duration
 *
 * @param divisions - Current divisions value (divisions per quarter note)
 * @param duration - Duration value in divisions
 * @param type - Note type (quarter, eighth, etc.)
 * @param dots - Number of dots
 * @param timeModification - Tuplet info
 */
export const convertDuration = (
	divisions: number,
	duration: number,
	type?: string,
	dots: number = 0,
	timeModification?: { actualNotes: number; normalNotes: number }
): Duration => {
	let division: number;

	if (type && TYPE_TO_DIVISION[type]) {
		division = TYPE_TO_DIVISION[type];
	} else {
		// Calculate from duration and divisions
		// duration / divisions = quarter notes
		// division = 4 / quarter_notes
		const quarterNotes = duration / divisions;
		division = 4 / quarterNotes;

		// Round to nearest valid division
		const validDivisions = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];
		division = validDivisions.reduce((prev, curr) =>
			Math.abs(curr - division) < Math.abs(prev - division) ? curr : prev
		);
	}

	const result: Duration = {
		division,
		dots,
	};

	if (timeModification) {
		// Store as Lilylet ratio: normalNotes/actualNotes
		// MusicXML actual=3, normal=2 (triplet) → Lilylet ratio {num:2, den:3}
		result.tuplet = {
			numerator: timeModification.normalNotes,
			denominator: timeModification.actualNotes,
		};
	}

	return result;
};

// ============ Key Signature Conversion ============

// Fifths to key signature mapping (major mode)
const FIFTHS_TO_KEY_MAJOR: Record<number, { pitch: Phonet; accidental?: Accidental }> = {
	[-7]: { pitch: Phonet.c, accidental: Accidental.flat },
	[-6]: { pitch: Phonet.g, accidental: Accidental.flat },
	[-5]: { pitch: Phonet.d, accidental: Accidental.flat },
	[-4]: { pitch: Phonet.a, accidental: Accidental.flat },
	[-3]: { pitch: Phonet.e, accidental: Accidental.flat },
	[-2]: { pitch: Phonet.b, accidental: Accidental.flat },
	[-1]: { pitch: Phonet.f },
	[0]: { pitch: Phonet.c },
	[1]: { pitch: Phonet.g },
	[2]: { pitch: Phonet.d },
	[3]: { pitch: Phonet.a },
	[4]: { pitch: Phonet.e },
	[5]: { pitch: Phonet.b },
	[6]: { pitch: Phonet.f, accidental: Accidental.sharp },
	[7]: { pitch: Phonet.c, accidental: Accidental.sharp },
};

// Fifths to key signature mapping (minor mode)
const FIFTHS_TO_KEY_MINOR: Record<number, { pitch: Phonet; accidental?: Accidental }> = {
	[-7]: { pitch: Phonet.a, accidental: Accidental.flat },
	[-6]: { pitch: Phonet.e, accidental: Accidental.flat },
	[-5]: { pitch: Phonet.b, accidental: Accidental.flat },
	[-4]: { pitch: Phonet.f },
	[-3]: { pitch: Phonet.c },
	[-2]: { pitch: Phonet.g },
	[-1]: { pitch: Phonet.d },
	[0]: { pitch: Phonet.a },
	[1]: { pitch: Phonet.e },
	[2]: { pitch: Phonet.b },
	[3]: { pitch: Phonet.f, accidental: Accidental.sharp },
	[4]: { pitch: Phonet.c, accidental: Accidental.sharp },
	[5]: { pitch: Phonet.g, accidental: Accidental.sharp },
	[6]: { pitch: Phonet.d, accidental: Accidental.sharp },
	[7]: { pitch: Phonet.a, accidental: Accidental.sharp },
};

/**
 * Convert MusicXML key (fifths, mode) to KeySignature
 */
export const convertKeySignature = (
	fifths: number,
	mode?: string
): KeySignature | undefined => {
	const isMinor = mode?.toLowerCase() === 'minor';
	const mapping = isMinor
		? FIFTHS_TO_KEY_MINOR[fifths]
		: FIFTHS_TO_KEY_MAJOR[fifths];

	if (!mapping) {
		console.warn(`Unknown key signature: fifths=${fifths}, mode=${mode}`);
		return undefined;
	}

	return {
		pitch: mapping.pitch,
		accidental: mapping.accidental,
		mode: isMinor ? 'minor' : 'major',
	};
};

// ============ Clef Conversion ============

/**
 * Convert MusicXML clef (sign, line) to Lilylet Clef
 */
export const convertClef = (sign: string, line?: number): Clef | undefined => {
	const upperSign = sign.toUpperCase();

	if (upperSign === 'G') {
		return Clef.treble;
	} else if (upperSign === 'F') {
		return Clef.bass;
	} else if (upperSign === 'C') {
		// C clef - alto clef on line 3, tenor on line 4
		return Clef.alto;
	}

	console.warn(`Unknown clef: sign=${sign}, line=${line}`);
	return undefined;
};

// ============ Stem Direction Conversion ============

export const convertStemDirection = (stem: string): StemDirection | undefined => {
	switch (stem.toLowerCase()) {
		case 'up':
			return StemDirection.up;
		case 'down':
			return StemDirection.down;
		default:
			return undefined;
	}
};

// ============ Articulation Conversion ============

const ARTICULATION_MAP: Record<string, ArticulationType> = {
	staccato: ArticulationType.staccato,
	staccatissimo: ArticulationType.staccatissimo,
	tenuto: ArticulationType.tenuto,
	accent: ArticulationType.accent,
	'strong-accent': ArticulationType.marcato,
	detachedLegato: ArticulationType.portato,
	'detached-legato': ArticulationType.portato,
};

export const convertArticulation = (name: string): ArticulationType | undefined => {
	return ARTICULATION_MAP[name];
};

// ============ Ornament Conversion ============

const ORNAMENT_MAP: Record<string, OrnamentType> = {
	trill: OrnamentType.trill,
	'trill-mark': OrnamentType.trill,
	turn: OrnamentType.turn,
	'inverted-turn': OrnamentType.turn,
	mordent: OrnamentType.mordent,
	'inverted-mordent': OrnamentType.prall,
};

export const convertOrnament = (name: string): OrnamentType | undefined => {
	return ORNAMENT_MAP[name];
};

// ============ Dynamic Conversion ============

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
	sf: DynamicType.sfz,
	rfz: DynamicType.rfz,
	rf: DynamicType.rfz,
	fz: DynamicType.sfz,
	sfp: DynamicType.sfz,
	sfpp: DynamicType.sfz,
	fp: DynamicType.f, // forte-piano, approximate
};

export const convertDynamic = (name: string): DynamicType | undefined => {
	return DYNAMIC_MAP[name.toLowerCase()];
};

// ============ Hairpin Conversion ============

export const convertWedge = (
	type: 'crescendo' | 'diminuendo' | 'stop',
	isStart: boolean
): HairpinType | undefined => {
	if (type === 'crescendo') {
		return isStart ? HairpinType.crescendoStart : HairpinType.crescendoEnd;
	} else if (type === 'diminuendo') {
		return isStart ? HairpinType.diminuendoStart : HairpinType.diminuendoEnd;
	} else if (type === 'stop') {
		// For stop, we need context to know if it's crescendo or diminuendo end
		// Default to crescendo end
		return HairpinType.crescendoEnd;
	}
	return undefined;
};

// ============ Pedal Conversion ============

export const convertPedal = (type: string): PedalType | undefined => {
	switch (type.toLowerCase()) {
		case 'start':
			return PedalType.sustainOn;
		case 'stop':
			return PedalType.sustainOff;
		case 'change':
			// Pedal change = off then on (we'll emit sustainOff)
			return PedalType.sustainOff;
		default:
			return undefined;
	}
};

// ============ Barline Conversion ============

const BARLINE_STYLE_MAP: Record<string, string> = {
	regular: '|',
	'light-light': '||',
	'light-heavy': '|.',
	'heavy-light': '.|',
	'heavy-heavy': '||',
	dashed: ':',
	dotted: ';',
	none: '',
};

export const convertBarlineStyle = (
	barStyle?: string,
	repeatDirection?: 'forward' | 'backward'
): string => {
	if (repeatDirection === 'backward') {
		return ':|.';
	}
	if (repeatDirection === 'forward') {
		return '.|:';
	}
	if (barStyle) {
		return BARLINE_STYLE_MAP[barStyle] || '|';
	}
	return '|';
};

// ============ Harmony/Chord Symbol Conversion ============

const KIND_MAP: Record<string, string> = {
	major: '',
	minor: 'm',
	augmented: 'aug',
	diminished: 'dim',
	dominant: '7',
	'major-seventh': 'maj7',
	'minor-seventh': 'm7',
	'diminished-seventh': 'dim7',
	'augmented-seventh': 'aug7',
	'half-diminished': 'm7b5',
	'major-minor': 'mMaj7',
	'major-sixth': '6',
	'minor-sixth': 'm6',
	'dominant-ninth': '9',
	'major-ninth': 'maj9',
	'minor-ninth': 'm9',
	suspended: 'sus',
	'suspended-second': 'sus2',
	'suspended-fourth': 'sus4',
	power: '5',
	none: '',
};

const STEP_NAMES: Record<string, string> = {
	C: 'C',
	D: 'D',
	E: 'E',
	F: 'F',
	G: 'G',
	A: 'A',
	B: 'B',
};

const ALTER_SYMBOLS: Record<number, string> = {
	[-2]: 'bb',
	[-1]: 'b',
	[0]: '',
	[1]: '#',
	[2]: '##',
};

/**
 * Convert MusicXML harmony to chord symbol text
 */
export const convertHarmonyToText = (
	rootStep: string,
	rootAlter: number | undefined,
	kind: string,
	bassStep?: string,
	bassAlter?: number
): string => {
	let result = STEP_NAMES[rootStep.toUpperCase()] || rootStep;

	if (rootAlter) {
		result += ALTER_SYMBOLS[rootAlter] || '';
	}

	const kindSuffix = KIND_MAP[kind];
	if (kindSuffix !== undefined) {
		result += kindSuffix;
	} else {
		// Unknown kind, just append as-is
		result += kind;
	}

	// Add bass note if present (slash chord)
	if (bassStep) {
		result += '/';
		result += STEP_NAMES[bassStep.toUpperCase()] || bassStep;
		if (bassAlter) {
			result += ALTER_SYMBOLS[bassAlter] || '';
		}
	}

	return result;
};

// ============ Time Signature Helpers ============

export const createFraction = (numerator: number, denominator: number): Fraction => ({
	numerator,
	denominator,
});
