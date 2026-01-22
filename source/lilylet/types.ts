// === Enums ===

export enum Phonet {
	c = 'c',
	d = 'd',
	e = 'e',
	f = 'f',
	g = 'g',
	a = 'a',
	b = 'b',
}

export enum Accidental {
	natural = 'natural',
	sharp = 'sharp',
	flat = 'flat',
	doubleSharp = 'doubleSharp',
	doubleFlat = 'doubleFlat',
}

export enum Clef {
	treble = 'treble',
	bass = 'bass',
	alto = 'alto',
}

export enum StemDirection {
	up = 'up',
	down = 'down',
	auto = 'auto',
}

export enum ArticulationType {
	staccato = 'staccato',
	staccatissimo = 'staccatissimo',
	tenuto = 'tenuto',
	marcato = 'marcato',
	accent = 'accent',
	portato = 'portato',
}

export enum OrnamentType {
	trill = 'trill',
	turn = 'turn',
	mordent = 'mordent',
	prall = 'prall',
	fermata = 'fermata',
	shortFermata = 'shortFermata',
	arpeggio = 'arpeggio',
}

export enum DynamicType {
	ppp = 'ppp',
	pp = 'pp',
	p = 'p',
	mp = 'mp',
	mf = 'mf',
	f = 'f',
	ff = 'ff',
	fff = 'fff',
	sfz = 'sfz',
	rfz = 'rfz',
}

export enum HairpinType {
	crescendoStart = 'crescendoStart',
	crescendoEnd = 'crescendoEnd',
	diminuendoStart = 'diminuendoStart',
	diminuendoEnd = 'diminuendoEnd',
}

export enum PedalType {
	sustainOn = 'sustainOn',
	sustainOff = 'sustainOff',
	sostenutoOn = 'sostenutoOn',
	sostenutoOff = 'sostenutoOff',
	unaCordaOn = 'unaCordaOn',
	unaCordaOff = 'unaCordaOff',
}

// === Basic Types ===

export interface Fraction {
	numerator: number;
	denominator: number;
}

export interface Pitch {
	phonet: Phonet;
	accidental?: Accidental;
	octave: number; // 0 = middle C octave, positive = higher, negative = lower
}

export interface Duration {
	division: number; // 1=whole, 2=half, 4=quarter, 8=eighth, etc.
	dots: number;		 // 0, 1, or 2
	tuplet?: Fraction; // e.g., {numerator: 2, denominator: 3} for triplet
}

// === Expressive Marks ===

export interface Articulation {
	type: ArticulationType;
}

export interface Ornament {
	type: OrnamentType;
}

export interface Dynamic {
	type: DynamicType;
}

export interface Hairpin {
	type: HairpinType;
}

export interface Tie {
	start: boolean;
}

export interface Slur {
	start: boolean;
}

export interface Beam {
	start: boolean;
}

export interface Pedal {
	type: PedalType;
}

export type Mark = Articulation | Ornament | Dynamic | Hairpin | Tie | Slur | Beam | Pedal;

// === Key Signature ===

export interface KeySignature {
	pitch: Phonet;
	accidental?: Accidental;
	mode: 'major' | 'minor';
}

// === Tempo ===

export interface Tempo {
	text?: string;
	beat?: Duration;
	bpm?: number;
}

// === Events ===

export interface NoteEvent {
	type: 'note';
	pitches: Pitch[];			 // Single note or chord
	duration: Duration;
	marks?: Mark[];
	grace?: boolean;
	tremolo?: number;			 // Tremolo division (8, 16, 32, etc.)
	staff?: number;				 // For cross-staff notation
	stemDirection?: StemDirection;
}

export interface RestEvent {
	type: 'rest';
	duration: Duration;
	invisible?: boolean;		// space rest (s)
	fullMeasure?: boolean;	// full measure rest (R)
}

export interface ContextChange {
	type: 'context';
	key?: KeySignature;
	time?: Fraction;
	clef?: Clef;
	ottava?: number;				// -1, 0, 1
	stemDirection?: StemDirection;
	tempo?: Tempo;
}

export interface TremoloEvent {
	type: 'tremolo';
	pitchA: Pitch[];				// First note/chord
	pitchB: Pitch[];				// Second note/chord
	count: number;					// Number of repetitions
	division: number;			 // Note division (16, 32, etc.)
}

export interface TupletEvent {
	type: 'tuplet';
	ratio: Fraction;				// e.g., {numerator: 2, denominator: 3} for triplet
	events: (NoteEvent | RestEvent)[];
}

export type Event = NoteEvent | RestEvent | ContextChange | TremoloEvent | TupletEvent;

// === Structure ===

export interface Voice {
	staff: number;
	events: Event[];
}

export interface Measure {
	key?: KeySignature;
	timeSig?: Fraction;
	voices: Voice[];
	partial?: boolean;
}

export interface Metadata {
	title?: string;
	subtitle?: string;
	composer?: string;
	opus?: string;
	instrument?: string;
	genre?: string;
}

// Measurewise structure: document contains measures directly
// Each measure contains voices from all staves
export interface LilyletDoc {
	metadata?: Metadata;
	measures: Measure[];
}

// === Partwise conversion (for export to MusicXML, etc.) ===

export interface Part {
	name?: string;
	staff: number;
	measures: Measure[];
}

export interface LilyletDocPartwise {
	metadata?: Metadata;
	parts: Part[];
}
