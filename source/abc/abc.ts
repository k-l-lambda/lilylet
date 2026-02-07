
interface Fraction {
	numerator: number;
	denominator: number;
}


namespace ABC {
	type Token = string;


	interface KeyValue {
		name: string;
		value: any;
	};


	export interface ControlTerm {
		control: KeyValue;
	};


	export interface Triplet {
		triplet: number;
		multiplier?: number;  // optional multiplier for triplet note duration
		n?: number;           // optional number of notes in the triplet
	};


	export interface OctaveShift {
		octaveShift: number;  // positive for shift down (8vb), negative for shift up (8va)
	};


	export interface Fingering {
		fingering: string;
	};


	export interface Tremolo {
		tremolo: number;  // number of slashes
	};


	interface Grace {
		grace: boolean;
		acciaccatura: Token;
		events: GraceMusicTerm[];
	};


	interface Comment {
		comment: string;
	};


	export interface Articulation {
		articulation: Token;
		scope?: '(' | ')';
	};


	export type Expressive =
		| Articulation
		| { express: Token }   // for tokens like '(' , ')', '.' , '-' stored as { express: $1 }
	;


	export interface TextTerm {
		text: string;
	}


	export interface Pitch {
		acc: number | null;      // accidentals: '^' | '_' | '=' or null
		phonet: Token; // underlying letter token or rest
		quotes: number;   // number of single/double quotes: positive for sup, negative for sub, null if none
		tie?: boolean;
	};


	export interface Chord {
		pitches: Pitch[];
		tie?: any;
	};


	export interface EventData {
		chord: Chord;
		duration?: Fraction;
	};


	export interface EventTerm {
		event: EventData;
		broken?: number;
	};


	export type MusicTerm =
		| Expressive
		| TextTerm
		| EventTerm
		| Grace
		| ControlTerm
		| Triplet
		| OctaveShift
		| Fingering
		| Tremolo
	;


	export type GraceMusicTerm =
		| Expressive
		| EventTerm
		| Fingering
	;


	type Header = KeyValue | Comment;


	export interface BarPatch {
		control: { [k: string]: any };
		terms: MusicTerm[];
		bar: Token;
	};


	export interface StaffGroup {
		items: (StaffGroup | string)[];
		bound?: 'arc' | 'square' | 'curly';
	};


	export interface StaffLayout {
		staffLayout: StaffGroup[];
	};


	export interface KeySignature {
		root: string;
		mode?: string;
	};


	export interface ClefValue {
		clef: string;
	};


	interface Measure {
		index: number;
		voices: BarPatch[];
	};


	interface Body {
		measures: Measure[];
	};


	export interface Tune {
		header: Header[];
		body: Body;
	};


	export type Document = Tune[];
}



export {
	ABC,
};
