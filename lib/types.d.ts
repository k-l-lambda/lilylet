export declare enum Phonet {
    c = "c",
    d = "d",
    e = "e",
    f = "f",
    g = "g",
    a = "a",
    b = "b"
}
export declare enum Accidental {
    natural = "natural",
    sharp = "sharp",
    flat = "flat",
    doubleSharp = "doubleSharp",
    doubleFlat = "doubleFlat"
}
export declare enum Clef {
    treble = "treble",
    bass = "bass",
    alto = "alto"
}
export declare enum StemDirection {
    up = "up",
    down = "down",
    auto = "auto"
}
export declare enum ArticulationType {
    staccato = "staccato",
    staccatissimo = "staccatissimo",
    tenuto = "tenuto",
    marcato = "marcato",
    accent = "accent",
    portato = "portato"
}
export declare enum OrnamentType {
    trill = "trill",
    turn = "turn",
    mordent = "mordent",
    prall = "prall",
    fermata = "fermata",
    shortFermata = "shortFermata",
    arpeggio = "arpeggio"
}
export declare enum DynamicType {
    ppp = "ppp",
    pp = "pp",
    p = "p",
    mp = "mp",
    mf = "mf",
    f = "f",
    ff = "ff",
    fff = "fff",
    sfz = "sfz",
    rfz = "rfz"
}
export declare enum HairpinType {
    crescendoStart = "crescendoStart",
    crescendoEnd = "crescendoEnd",
    diminuendoStart = "diminuendoStart",
    diminuendoEnd = "diminuendoEnd"
}
export declare enum PedalType {
    sustainOn = "sustainOn",
    sustainOff = "sustainOff",
    sostenutoOn = "sostenutoOn",
    sostenutoOff = "sostenutoOff",
    unaCordaOn = "unaCordaOn",
    unaCordaOff = "unaCordaOff"
}
export interface Fraction {
    numerator: number;
    denominator: number;
}
export interface Pitch {
    phonet: Phonet;
    accidental?: Accidental;
    octave: number;
}
export interface Duration {
    division: number;
    dots: number;
    tuplet?: Fraction;
}
export declare enum Placement {
    above = "above",
    below = "below"
}
export interface Articulation {
    type: ArticulationType;
    placement?: Placement;
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
    markType: 'tie';
    start: boolean;
}
export interface Slur {
    markType: 'slur';
    start: boolean;
}
export interface Beam {
    markType: 'beam';
    start: boolean;
}
export interface Pedal {
    type: PedalType;
}
export type Mark = Articulation | Ornament | Dynamic | Hairpin | Tie | Slur | Beam | Pedal;
export interface KeySignature {
    pitch: Phonet;
    accidental?: Accidental;
    mode: 'major' | 'minor';
}
export interface Tempo {
    text?: string;
    beat?: Duration;
    bpm?: number;
}
export interface NoteEvent {
    type: 'note';
    pitches: Pitch[];
    duration: Duration;
    marks?: Mark[];
    grace?: boolean;
    tremolo?: number;
    staff?: number;
    stemDirection?: StemDirection;
}
export interface RestEvent {
    type: 'rest';
    duration: Duration;
    invisible?: boolean;
    fullMeasure?: boolean;
    pitch?: Pitch;
}
export interface ContextChange {
    type: 'context';
    key?: KeySignature;
    time?: Fraction;
    clef?: Clef;
    ottava?: number;
    stemDirection?: StemDirection;
    tempo?: Tempo;
}
export interface TremoloEvent {
    type: 'tremolo';
    pitchA: Pitch[];
    pitchB: Pitch[];
    count: number;
    division: number;
}
export interface TupletEvent {
    type: 'tuplet';
    ratio: Fraction;
    events: (NoteEvent | RestEvent)[];
}
export type Event = NoteEvent | RestEvent | ContextChange | TremoloEvent | TupletEvent;
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
}
export interface Part {
    name?: string;
    voices: Voice[];
}
export interface Measure {
    key?: KeySignature;
    timeSig?: Fraction;
    parts: Part[];
    partial?: boolean;
}
export interface LilyletDoc {
    metadata?: Metadata;
    measures: Measure[];
}
