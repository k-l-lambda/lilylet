/**
 * MusicXML Intermediate Types
 *
 * These types represent the parsed MusicXML structure before conversion to LilyletDoc.
 * They closely mirror MusicXML elements for easier parsing.
 */

// ============ Basic Types ============

export interface MusicXmlPitch {
	step: string;     // C, D, E, F, G, A, B
	alter?: number;   // -2, -1, 0, 1, 2 (double-flat to double-sharp)
	octave: number;   // MusicXML octave (4 = middle C octave)
}

export interface MusicXmlDuration {
	divisions: number;      // Duration in divisions
	type?: string;          // whole, half, quarter, eighth, 16th, 32nd, 64th
	dots: number;           // Number of dots
	timeModification?: {    // Tuplet info
		actualNotes: number;
		normalNotes: number;
	};
}

// ============ Attributes (Key, Time, Clef) ============

export interface MusicXmlKey {
	fifths: number;         // Circle of fifths (-7 to 7)
	mode?: string;          // major, minor
}

export interface MusicXmlTime {
	beats: number;
	beatType: number;
}

export interface MusicXmlClef {
	sign: string;           // G, F, C
	line?: number;          // Line number
	clefOctaveChange?: number; // -1, 0, 1
}

export interface MusicXmlAttributes {
	divisions?: number;     // Divisions per quarter note
	key?: MusicXmlKey;
	time?: MusicXmlTime;
	clefs?: { staff: number; clef: MusicXmlClef }[];  // Clefs by staff number
	staves?: number;        // Number of staves
}

// ============ Note Types ============

export type MusicXmlStemDirection = 'up' | 'down';

export interface MusicXmlNotations {
	ties?: { type: 'start' | 'stop' }[];
	slurs?: { type: 'start' | 'stop'; number: number }[];
	beams?: { type: 'begin' | 'continue' | 'end'; number: number }[];
	articulations?: string[];   // staccato, accent, tenuto, etc.
	ornaments?: string[];       // trill, turn, mordent, etc.
	fermata?: boolean;
	arpeggiate?: boolean;
	tremolo?: { type: 'single' | 'start' | 'stop'; value: number };
	tuplet?: { type: 'start' | 'stop'; number: number };
}

export interface MusicXmlNote {
	isChord: boolean;           // Has <chord/> tag
	isRest: boolean;            // Has <rest/> tag
	isGrace: boolean;           // Has <grace/> tag
	pitch?: MusicXmlPitch;
	duration: MusicXmlDuration;
	voice: number;              // Voice number (1-based)
	staff?: number;             // Staff number (for cross-staff)
	stem?: MusicXmlStemDirection;
	notations?: MusicXmlNotations;
	fingering?: number;         // 1-5
	beams?: { type: 'begin' | 'continue' | 'end'; number: number }[];
}

// ============ Direction Types ============

export interface MusicXmlDynamic {
	type: string;               // pp, p, mp, mf, f, ff, sfz, etc.
}

export interface MusicXmlWedge {
	type: 'crescendo' | 'diminuendo' | 'stop';
	number?: number;
}

export interface MusicXmlPedal {
	type: 'start' | 'stop' | 'change';
	line?: boolean;
}

export interface MusicXmlMetronome {
	beatUnit: string;           // quarter, half, eighth, etc.
	beatUnitDot?: boolean;
	perMinute: number;
}

export interface MusicXmlWords {
	text: string;
	fontStyle?: string;
	fontWeight?: string;
}

export interface MusicXmlOctaveShift {
	type: 'up' | 'down' | 'stop';
	size?: number;              // 8, 15 (default 8)
}

export interface MusicXmlDirection {
	placement?: 'above' | 'below';
	staff?: number;
	dynamics?: MusicXmlDynamic[];
	wedge?: MusicXmlWedge;
	pedal?: MusicXmlPedal;
	metronome?: MusicXmlMetronome;
	words?: MusicXmlWords[];
	octaveShift?: MusicXmlOctaveShift;
	coda?: boolean;
	segno?: boolean;
}

// ============ Barline Types ============

export interface MusicXmlBarline {
	location?: 'left' | 'right' | 'middle';
	barStyle?: string;          // regular, light-light, light-heavy, heavy-light, heavy-heavy, etc.
	repeat?: {
		direction: 'forward' | 'backward';
	};
	ending?: {
		type: 'start' | 'stop' | 'discontinue';
		number: string;
	};
}

// ============ Harmony (Chord Symbols) ============

export interface MusicXmlHarmony {
	root: {
		step: string;           // C, D, E, F, G, A, B
		alter?: number;
	};
	kind: string;               // major, minor, dominant, etc.
	bass?: {
		step: string;
		alter?: number;
	};
	degrees?: {
		value: number;
		alter: number;
		type: 'add' | 'alter' | 'subtract';
	}[];
}

// ============ Measure and Part ============

export type MusicXmlMeasureContent =
	| { type: 'attributes'; data: MusicXmlAttributes }
	| { type: 'note'; data: MusicXmlNote }
	| { type: 'direction'; data: MusicXmlDirection }
	| { type: 'barline'; data: MusicXmlBarline }
	| { type: 'harmony'; data: MusicXmlHarmony }
	| { type: 'backup'; duration: number }
	| { type: 'forward'; duration: number };

export interface MusicXmlMeasure {
	number: string;
	width?: number;
	implicit?: boolean;         // Pickup/anacrusis measure
	contents: MusicXmlMeasureContent[];
}

export interface MusicXmlPart {
	id: string;
	name?: string;
	measures: MusicXmlMeasure[];
}

// ============ Score Level ============

export interface MusicXmlMetadata {
	workTitle?: string;
	movementTitle?: string;
	composer?: string;
	arranger?: string;
	lyricist?: string;
}

export interface MusicXmlPartInfo {
	id: string;
	name?: string;
	abbreviation?: string;
}

export interface MusicXmlDocument {
	metadata: MusicXmlMetadata;
	partList: MusicXmlPartInfo[];
	parts: MusicXmlPart[];
}
