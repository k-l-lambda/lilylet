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
	breath = 'breath',	// breath mark (\breathe) — MusicXML <breath-mark>
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
	fp = 'fp',
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

export enum BarlineType {
	single = '|',
	double = '||',
	end = '|.',
	repeatStart = '.|:',
	repeatEnd = ':|.',
	repeatBoth = ':..:'
}

export enum NavigationMarkType {
	coda = 'coda',
	segno = 'segno',
}

// === Basic Types ===

export interface Fraction {
	numerator: number;
	denominator: number;
}

// Time signature with optional symbol display
// symbol: 'common' for C (4/4), 'cut' for C| (2/2), undefined for numeric
export interface TimeSig extends Fraction {
	symbol?: 'common' | 'cut';
}

export interface Pitch {
	phonet: Phonet;
	accidental?: Accidental;
	octave: number; // 0 = middle C octave, positive = higher, negative = lower
	courtesy?: boolean; // force display of accidental (! in LilyPond)
}

export interface Duration {
	division: number; // 1=whole, 2=half, 4=quarter, 8=eighth, etc.
	dots: number;		 // 0, 1, or 2
	tuplet?: Fraction; // e.g., {numerator: 2, denominator: 3} for triplet
}

// === Placement Direction ===

export enum Placement {
	above = 'above',
	below = 'below',
}

// === Expressive Marks ===

export interface Articulation {
	markType: 'articulation';
	type: ArticulationType;
	placement?: Placement;
}

export interface Ornament {
	markType: 'ornament';
	type: OrnamentType;
}

export interface Dynamic {
	markType: 'dynamic';
	type: DynamicType;
}

export interface Hairpin {
	markType: 'hairpin';
	type: HairpinType;
}

export interface Tie {
	markType: 'tie';
	start: boolean;
}

export interface Slur {
	markType: 'slur';
	start: boolean;
	number?: number;	// MusicXML slur number, for pairing cross-voice/overlapping slurs (encoder hint only)
}

export interface Beam {
	markType: 'beam';
	start: boolean;
}

export interface Pedal {
	markType: 'pedal';
	type: PedalType;
}

export interface Fingering {
	markType: 'fingering';
	finger: number;  // 1-5
	placement?: Placement;
}

export interface NavigationMark {
	markType: 'navigation';
	type: NavigationMarkType;
}

export interface MarkupMark {
	markType: 'markup';
	content: string;
	placement?: Placement;
}

// Glissando / slide: a note-to-note slide line. Mirrors LilyPond's \glissando,
// which is emitted only on the START note (the line auto-connects to the next
// note), so this is a single mark — no start/stop pairing. MusicXML <glissando>
// and <slide> both decode to this.
export interface Glissando {
	markType: 'glissando';
}

export type Mark = Articulation | Ornament | Dynamic | Hairpin | Tie | Slur | Beam | Pedal | Fingering | NavigationMark | MarkupMark | Glissando;

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
	pitch?: Pitch;					// positioned rest (e.g., g'\rest)
	marks?: Mark[];					// control-event marks a rest can host (e.g. fermata over a rest / grand pause)
}

export interface ContextChange {
	type: 'context';
	key?: KeySignature;
	time?: Fraction;
	partial?: Duration;				// Pickup measure duration (check-only, warns if mismatch)
	clef?: Clef;
	ottava?: number;				// -1, 0, 1
	stemDirection?: StemDirection;
	tempo?: Tempo;
	staff?: number;					// Staff number for cross-staff notation
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
	events: (NoteEvent | RestEvent | ContextChange)[];
}

// TimesEvent: from lilylet \times syntax (distinct from \tuplet decoded from LilyPond)
export interface TimesEvent {
	type: 'times';
	ratio: Fraction;
	events: (NoteEvent | RestEvent | ContextChange)[];
}

export interface PitchResetEvent {
	type: 'pitchReset';
}

export interface BarlineEvent {
	type: 'barline';
	style: string;  // "|", "||", "|.", ".|:", ":|.", ":..:", etc.
}

export interface HarmonyEvent {
	type: 'harmony';
	text: string;  // Chord symbol text like "Am7", "Cmaj7", "D/F#"
}

export interface MarkupEvent {
	type: 'markup';
	content: string;  // Text content of the markup
	placement?: Placement;  // Optional placement (above/below)
}

export interface DynamicEvent {
	type: 'dynamic';
	dynamicType: DynamicType;  // Standalone dynamic at a leading position (before any note)
}

export type Event = NoteEvent | RestEvent | ContextChange | TremoloEvent | TupletEvent | TimesEvent | PitchResetEvent | BarlineEvent | HarmonyEvent | MarkupEvent | DynamicEvent;

// === Structure ===

export interface Voice {
	staff: number;
	events: Event[];
}

export interface Metadata {
	title?: string;
	subtitle?: string;
	composer?: string;
	arranger?: string;
	lyricist?: string;
	opus?: string;
	instrument?: string;
	genre?: string;
	staves?: string;				// Raw staff-layout code, e.g. "<[v1-v2].va> {pl-pr} <b>"
	// Raw measure-layout (performance/repeat order) DSL, lotus-style, e.g.
	// "2*[1..8]{9,10}, 11..16" (index-wise) or "s: 4 <2 6> 2" (segment-wise).
	// Stored verbatim; parsing/expansion to MEI <expansion> is a later phase.
	measureLayout?: string;
	// Per-staff / per-group instrument names, keyed by staff-layout group key (a single
	// staff id like "1"/"v1", or a range like "1-2"/"pl-pr"). Declared via the
	// [instrument-<key> "Name" "Short"] header. Maps to MEI <label>/<labelAbbr>.
	instruments?: { [key: string]: InstrumentName };
	autoBeam?: 'auto' | 'on' | 'off';
}

export interface InstrumentName {
	name: string;
	shortName?: string;
}

// Part within a measure: can be a single staff or grand staff (multiple staves)
// When voices have staff > 1, it's a grand staff
export interface Part {
	name?: string;
	voices: Voice[];
}

// Measure contains parts separated by \\\
export interface Measure {
	key?: KeySignature;
	timeSig?: TimeSig;
	parts: Part[];
	partial?: boolean;
}

// Document structure
export interface LilyletDoc {
	metadata?: Metadata;
	measures: Measure[];
}
