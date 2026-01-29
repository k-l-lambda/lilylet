/**
 * MusicXML to Lilylet Decoder
 *
 * Converts MusicXML files to Lilylet's internal LilyletDoc format.
 * Improves upon musicxml2ly by properly tracking spanners (slurs, ties, wedges) by number attribute.
 */

import { DOMParser } from '@xmldom/xmldom';

import {
	LilyletDoc,
	Measure,
	Part,
	Voice,
	Event,
	NoteEvent,
	RestEvent,
	ContextChange,
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Metadata,
	Fraction,
	HairpinType,
	PedalType,
	NavigationMarkType,
	BarlineEvent,
	HarmonyEvent,
} from './types';

import {
	MusicXmlDocument,
	MusicXmlPart,
	MusicXmlMeasure,
	MusicXmlMeasureContent,
	MusicXmlNote,
	MusicXmlAttributes,
	MusicXmlDirection,
	MusicXmlBarline,
	MusicXmlHarmony,
	MusicXmlNotations,
	MusicXmlPitch,
} from './musicXmlTypes';

import {
	getElementText,
	getElementInt,
	getElements,
	getDirectChildren,
	getChildElements,
	getAttribute,
	getAttributeNumber,
	hasElement,
	convertPitch,
	convertDuration,
	convertKeySignature,
	convertClef,
	convertStemDirection,
	convertArticulation,
	convertOrnament,
	convertDynamic,
	convertWedge,
	convertPedal,
	convertBarlineStyle,
	convertHarmonyToText,
	createFraction,
} from './musicXmlUtils';

// ============ Spanner Tracker ============

/**
 * Track spanners (slurs, ties, wedges) by number attribute.
 * This fixes the musicxml2ly bug where nested slurs aren't handled correctly.
 */
class SpannerTracker {
	private slurs: Map<number, boolean> = new Map();  // number → is active
	private wedges: Map<number, 'crescendo' | 'diminuendo'> = new Map();  // number → type
	private ties: Map<string, boolean> = new Map();  // pitch key → is active

	// Slur tracking
	startSlur(number: number = 1): void {
		this.slurs.set(number, true);
	}

	stopSlur(number: number = 1): boolean {
		const wasActive = this.slurs.has(number);
		this.slurs.delete(number);
		return wasActive;
	}

	isSlurActive(number: number = 1): boolean {
		return this.slurs.has(number);
	}

	// Wedge (hairpin) tracking
	startWedge(type: 'crescendo' | 'diminuendo', number: number = 1): void {
		this.wedges.set(number, type);
	}

	stopWedge(number: number = 1): 'crescendo' | 'diminuendo' | undefined {
		const type = this.wedges.get(number);
		this.wedges.delete(number);
		return type;
	}

	// Tie tracking (by pitch)
	private pitchKey(pitch: Pitch): string {
		return `${pitch.phonet}${pitch.accidental || ''}${pitch.octave}`;
	}

	startTie(pitch: Pitch): void {
		this.ties.set(this.pitchKey(pitch), true);
	}

	stopTie(pitch: Pitch): boolean {
		const key = this.pitchKey(pitch);
		const wasActive = this.ties.has(key);
		this.ties.delete(key);
		return wasActive;
	}

	isTieActive(pitch: Pitch): boolean {
		return this.ties.has(this.pitchKey(pitch));
	}

	// Reset all trackers (for new part)
	reset(): void {
		this.slurs.clear();
		this.wedges.clear();
		this.ties.clear();
	}
}

// ============ Voice Position Tracker ============

/**
 * Track position within each voice for proper event ordering.
 * Handles backup/forward elements to manage multiple voices.
 *
 * MusicXML voice handling:
 * - Each <note> has a <voice> element (1, 2, 3, etc.)
 * - <backup> goes back in time to start a new voice
 * - <forward> skips forward (for rests that aren't written)
 */
interface VoiceState {
	events: Event[];
	staff: number;
	lastEvent?: Event;  // For chord merging
}

class VoiceTracker {
	private voices: Map<number, VoiceState> = new Map();
	private currentPosition: number = 0;
	private divisions: number = 1;
	private staves: number = 1;

	setDivisions(div: number): void {
		this.divisions = div;
	}

	getDivisions(): number {
		return this.divisions;
	}

	setStaves(n: number): void {
		this.staves = n;
	}

	getStaves(): number {
		return this.staves;
	}

	getOrCreateVoice(voiceNum: number, staff: number = 1): VoiceState {
		if (!this.voices.has(voiceNum)) {
			this.voices.set(voiceNum, {
				events: [],
				staff,
			});
		}
		const voice = this.voices.get(voiceNum)!;
		// Update staff if specified
		if (staff > 0) {
			voice.staff = staff;
		}
		return voice;
	}

	addEvent(voiceNum: number, event: Event, duration: number, staff: number = 1): void {
		const voice = this.getOrCreateVoice(voiceNum, staff);
		voice.events.push(event);
		voice.lastEvent = event;
		this.currentPosition += duration;
	}

	getLastEvent(voiceNum: number): Event | undefined {
		const voice = this.voices.get(voiceNum);
		return voice?.lastEvent;
	}

	backup(duration: number): void {
		this.currentPosition -= duration;
		// Note: Negative position is OK - it just means we're going back
		// to write a different voice
	}

	forward(duration: number): void {
		this.currentPosition += duration;
	}

	getCurrentPosition(): number {
		return this.currentPosition;
	}

	getVoices(): Map<number, VoiceState> {
		return this.voices;
	}

	getVoiceNumbers(): number[] {
		return Array.from(this.voices.keys()).sort((a, b) => a - b);
	}

	reset(): void {
		this.voices.clear();
		this.currentPosition = 0;
	}
}

// ============ XML Parsing Functions ============

/**
 * Parse <pitch> element to MusicXmlPitch (raw data)
 */
const parsePitchRaw = (pitchEl: Element): MusicXmlPitch | undefined => {
	const step = getElementText(pitchEl, 'step');
	const octave = getElementInt(pitchEl, 'octave');
	const alter = getElementInt(pitchEl, 'alter');

	if (!step || octave === undefined) {
		return undefined;
	}

	return { step, alter, octave };
};

/**
 * Convert MusicXmlPitch to Lilylet Pitch
 */
const musicXmlPitchToLilylet = (xmlPitch: MusicXmlPitch): Pitch => {
	return convertPitch(xmlPitch.step, xmlPitch.alter, xmlPitch.octave);
};

/**
 * Parse <notations> element
 */
const parseNotations = (notationsEl: Element): MusicXmlNotations => {
	const result: MusicXmlNotations = {};

	// Ties
	const tieEls = getElements(notationsEl, 'tied');
	if (tieEls.length > 0) {
		result.ties = tieEls.map(el => ({
			type: getAttribute(el, 'type') as 'start' | 'stop',
		}));
	}

	// Slurs
	const slurEls = getElements(notationsEl, 'slur');
	if (slurEls.length > 0) {
		result.slurs = slurEls.map(el => ({
			type: getAttribute(el, 'type') as 'start' | 'stop',
			number: getAttributeNumber(el, 'number') || 1,
		}));
	}

	// Articulations
	const articulationsEl = notationsEl.getElementsByTagName('articulations')[0];
	if (articulationsEl) {
		const articulations: string[] = [];
		for (const child of getChildElements(articulationsEl)) {
			articulations.push(child.tagName);
		}
		if (articulations.length > 0) {
			result.articulations = articulations;
		}
	}

	// Ornaments
	const ornamentsEl = notationsEl.getElementsByTagName('ornaments')[0];
	if (ornamentsEl) {
		const ornaments: string[] = [];
		for (const child of getChildElements(ornamentsEl)) {
			ornaments.push(child.tagName);
		}
		if (ornaments.length > 0) {
			result.ornaments = ornaments;
		}
	}

	// Fermata
	if (hasElement(notationsEl, 'fermata')) {
		result.fermata = true;
	}

	// Arpeggiate
	if (hasElement(notationsEl, 'arpeggiate')) {
		result.arpeggiate = true;
	}

	// Tremolo
	const tremoloEl = notationsEl.getElementsByTagName('tremolo')[0];
	if (tremoloEl) {
		const tremoloType = getAttribute(tremoloEl, 'type') as 'single' | 'start' | 'stop' || 'single';
		const tremoloValue = parseInt(tremoloEl.textContent || '3', 10);
		result.tremolo = { type: tremoloType, value: tremoloValue };
	}

	// Tuplet
	const tupletEl = notationsEl.getElementsByTagName('tuplet')[0];
	if (tupletEl) {
		result.tuplet = {
			type: getAttribute(tupletEl, 'type') as 'start' | 'stop',
			number: getAttributeNumber(tupletEl, 'number') || 1,
		};
	}

	return result;
};

/**
 * Parse <note> element
 */
const parseNote = (noteEl: Element, divisions: number): MusicXmlNote => {
	const isChord = hasElement(noteEl, 'chord');
	const isRest = hasElement(noteEl, 'rest');
	const isGrace = hasElement(noteEl, 'grace');

	let pitch: MusicXmlPitch | undefined;
	const pitchEl = noteEl.getElementsByTagName('pitch')[0];
	if (pitchEl) {
		pitch = parsePitchRaw(pitchEl);
	}

	// Duration
	const durationVal = getElementInt(noteEl, 'duration') || 0;
	const typeText = getElementText(noteEl, 'type');
	const dotCount = getElements(noteEl, 'dot').length;

	// Time modification (tuplets)
	let timeModification: { actualNotes: number; normalNotes: number } | undefined;
	const timeModEl = noteEl.getElementsByTagName('time-modification')[0];
	if (timeModEl) {
		const actual = getElementInt(timeModEl, 'actual-notes');
		const normal = getElementInt(timeModEl, 'normal-notes');
		if (actual && normal) {
			timeModification = { actualNotes: actual, normalNotes: normal };
		}
	}

	const duration = convertDuration(divisions, durationVal, typeText, dotCount, timeModification);

	// Voice and staff
	const voice = getElementInt(noteEl, 'voice') || 1;
	const staff = getElementInt(noteEl, 'staff');

	// Stem direction
	const stemText = getElementText(noteEl, 'stem');
	const stem = stemText ? convertStemDirection(stemText) : undefined;

	// Notations
	let notations: MusicXmlNotations | undefined;
	const notationsEl = noteEl.getElementsByTagName('notations')[0];
	if (notationsEl) {
		notations = parseNotations(notationsEl);
	}

	// Fingering
	let fingering: number | undefined;
	const technicalEl = noteEl.getElementsByTagName('technical')[0];
	if (technicalEl) {
		const fingeringText = getElementText(technicalEl, 'fingering');
		if (fingeringText) {
			fingering = parseInt(fingeringText, 10);
		}
	}

	// Beams - direct children of note, not in notations
	// We only care about primary beam (number="1") for begin/end
	let beams: { type: 'begin' | 'continue' | 'end'; number: number }[] | undefined;
	const beamEls = getElements(noteEl, 'beam');
	if (beamEls.length > 0) {
		beams = beamEls.map(el => ({
			type: (el.textContent?.trim() || 'continue') as 'begin' | 'continue' | 'end',
			number: getAttributeNumber(el, 'number') || 1,
		}));
	}

	return {
		isChord,
		isRest,
		isGrace,
		pitch,
		duration: {
			divisions: durationVal,
			type: typeText,
			dots: dotCount,
			timeModification,
		},
		voice,
		staff,
		stem: stem as any,
		notations,
		fingering,
		beams,
	};
};

/**
 * Parse <attributes> element
 */
const parseAttributes = (attrEl: Element): MusicXmlAttributes => {
	const result: MusicXmlAttributes = {};

	// Divisions
	const divisions = getElementInt(attrEl, 'divisions');
	if (divisions !== undefined) {
		result.divisions = divisions;
	}

	// Key
	const keyEl = attrEl.getElementsByTagName('key')[0];
	if (keyEl) {
		const fifths = getElementInt(keyEl, 'fifths');
		const mode = getElementText(keyEl, 'mode');
		if (fifths !== undefined) {
			result.key = { fifths, mode };
		}
	}

	// Time
	const timeEl = attrEl.getElementsByTagName('time')[0];
	if (timeEl) {
		const beats = getElementInt(timeEl, 'beats');
		const beatType = getElementInt(timeEl, 'beat-type');
		if (beats !== undefined && beatType !== undefined) {
			result.time = { beats, beatType };
		}
	}

	// Clefs - handle multiple clefs for different staves
	const clefEls = getElements(attrEl, 'clef');
	if (clefEls.length > 0) {
		result.clefs = [];
		for (const clefEl of clefEls) {
			const sign = getElementText(clefEl, 'sign');
			const line = getElementInt(clefEl, 'line');
			const octaveChange = getElementInt(clefEl, 'clef-octave-change');
			const staffNum = getAttributeNumber(clefEl, 'number') || 1;
			if (sign) {
				result.clefs.push({
					staff: staffNum,
					clef: { sign, line, clefOctaveChange: octaveChange },
				});
			}
		}
	}

	// Staves
	const staves = getElementInt(attrEl, 'staves');
	if (staves !== undefined) {
		result.staves = staves;
	}

	return result;
};

/**
 * Parse <direction> element
 */
const parseDirection = (dirEl: Element): MusicXmlDirection => {
	const result: MusicXmlDirection = {};

	result.placement = getAttribute(dirEl, 'placement') as 'above' | 'below' | undefined;
	result.staff = getElementInt(dirEl, 'staff');

	const dirTypeEl = dirEl.getElementsByTagName('direction-type')[0];
	if (!dirTypeEl) {
		return result;
	}

	// Dynamics
	const dynamicsEl = dirTypeEl.getElementsByTagName('dynamics')[0];
	if (dynamicsEl) {
		const dynamics: { type: string }[] = [];
		for (const child of getChildElements(dynamicsEl)) {
			dynamics.push({ type: child.tagName });
		}
		if (dynamics.length > 0) {
			result.dynamics = dynamics;
		}
	}

	// Wedge (hairpin)
	const wedgeEl = dirTypeEl.getElementsByTagName('wedge')[0];
	if (wedgeEl) {
		const type = getAttribute(wedgeEl, 'type') as 'crescendo' | 'diminuendo' | 'stop';
		const number = getAttributeNumber(wedgeEl, 'number');
		if (type) {
			result.wedge = { type, number };
		}
	}

	// Pedal
	const pedalEl = dirTypeEl.getElementsByTagName('pedal')[0];
	if (pedalEl) {
		const type = getAttribute(pedalEl, 'type') as 'start' | 'stop' | 'change';
		const line = getAttribute(pedalEl, 'line') === 'yes';
		if (type) {
			result.pedal = { type, line };
		}
	}

	// Metronome
	const metronomeEl = dirTypeEl.getElementsByTagName('metronome')[0];
	if (metronomeEl) {
		const beatUnit = getElementText(metronomeEl, 'beat-unit');
		const beatUnitDot = hasElement(metronomeEl, 'beat-unit-dot');
		const perMinute = getElementInt(metronomeEl, 'per-minute');
		if (beatUnit && perMinute !== undefined) {
			result.metronome = { beatUnit, beatUnitDot, perMinute };
		}
	}

	// Words
	const wordsEls = getElements(dirTypeEl, 'words');
	if (wordsEls.length > 0) {
		result.words = wordsEls.map(el => ({
			text: el.textContent || '',
			fontStyle: getAttribute(el, 'font-style'),
			fontWeight: getAttribute(el, 'font-weight'),
		}));
	}

	// Octave shift
	const octaveShiftEl = dirTypeEl.getElementsByTagName('octave-shift')[0];
	if (octaveShiftEl) {
		const type = getAttribute(octaveShiftEl, 'type') as 'up' | 'down' | 'stop';
		const size = getAttributeNumber(octaveShiftEl, 'size');
		if (type) {
			result.octaveShift = { type, size };
		}
	}

	// Coda and Segno
	if (hasElement(dirTypeEl, 'coda')) {
		result.coda = true;
	}
	if (hasElement(dirTypeEl, 'segno')) {
		result.segno = true;
	}

	return result;
};

/**
 * Parse <barline> element
 */
const parseBarline = (barlineEl: Element): MusicXmlBarline => {
	const result: MusicXmlBarline = {};

	result.location = getAttribute(barlineEl, 'location') as 'left' | 'right' | 'middle' | undefined;
	result.barStyle = getElementText(barlineEl, 'bar-style');

	const repeatEl = barlineEl.getElementsByTagName('repeat')[0];
	if (repeatEl) {
		const direction = getAttribute(repeatEl, 'direction') as 'forward' | 'backward';
		if (direction) {
			result.repeat = { direction };
		}
	}

	const endingEl = barlineEl.getElementsByTagName('ending')[0];
	if (endingEl) {
		const type = getAttribute(endingEl, 'type') as 'start' | 'stop' | 'discontinue';
		const number = getAttribute(endingEl, 'number') || '1';
		if (type) {
			result.ending = { type, number };
		}
	}

	return result;
};

/**
 * Parse <harmony> element
 */
const parseHarmony = (harmonyEl: Element): MusicXmlHarmony | undefined => {
	const rootEl = harmonyEl.getElementsByTagName('root')[0];
	if (!rootEl) {
		return undefined;
	}

	const rootStep = getElementText(rootEl, 'root-step');
	const rootAlter = getElementInt(rootEl, 'root-alter');
	if (!rootStep) {
		return undefined;
	}

	const kind = getElementText(harmonyEl, 'kind') || 'major';

	const result: MusicXmlHarmony = {
		root: { step: rootStep, alter: rootAlter },
		kind,
	};

	const bassEl = harmonyEl.getElementsByTagName('bass')[0];
	if (bassEl) {
		const bassStep = getElementText(bassEl, 'bass-step');
		const bassAlter = getElementInt(bassEl, 'bass-alter');
		if (bassStep) {
			result.bass = { step: bassStep, alter: bassAlter };
		}
	}

	return result;
};

/**
 * Parse metadata from score header
 */
const parseMetadata = (doc: Document): Metadata => {
	const metadata: Metadata = {};

	// Work title
	const workTitleEl = doc.getElementsByTagName('work-title')[0];
	if (workTitleEl?.textContent) {
		metadata.title = workTitleEl.textContent.trim();
	}

	// Movement title (fallback for title)
	const movementTitleEl = doc.getElementsByTagName('movement-title')[0];
	if (movementTitleEl?.textContent && !metadata.title) {
		metadata.title = movementTitleEl.textContent.trim();
	}

	// Identification (composer, arranger, lyricist)
	const identificationEl = doc.getElementsByTagName('identification')[0];
	if (identificationEl) {
		const creators = getElements(identificationEl, 'creator');
		for (const creator of creators) {
			const type = getAttribute(creator, 'type');
			const text = creator.textContent?.trim();
			if (text) {
				if (type === 'composer') {
					metadata.composer = text;
				} else if (type === 'arranger') {
					metadata.arranger = text;
				} else if (type === 'lyricist' || type === 'poet') {
					metadata.lyricist = text;
				}
			}
		}
	}

	return Object.keys(metadata).length > 0 ? metadata : {};
};

// ============ Conversion Functions ============

/**
 * Convert MusicXML notations to Lilylet marks
 */
const notationsToMarks = (
	notations: MusicXmlNotations | undefined,
	spannerTracker: SpannerTracker,
	pitches: Pitch[]
): Mark[] => {
	const marks: Mark[] = [];

	if (!notations) {
		return marks;
	}

	// Ties
	if (notations.ties) {
		for (const tie of notations.ties) {
			if (tie.type === 'start') {
				marks.push({ markType: 'tie', start: true });
				// Track tie for each pitch
				for (const p of pitches) {
					spannerTracker.startTie(p);
				}
			}
			// Note: tie stop doesn't need an explicit mark in Lilylet
		}
	}

	// Slurs
	if (notations.slurs) {
		for (const slur of notations.slurs) {
			if (slur.type === 'start') {
				marks.push({ markType: 'slur', start: true });
				spannerTracker.startSlur(slur.number);
			} else if (slur.type === 'stop') {
				if (spannerTracker.stopSlur(slur.number)) {
					marks.push({ markType: 'slur', start: false });
				}
			}
		}
	}

	// Articulations
	if (notations.articulations) {
		for (const artName of notations.articulations) {
			const artType = convertArticulation(artName);
			if (artType) {
				marks.push({ markType: 'articulation', type: artType });
			}
		}
	}

	// Ornaments
	if (notations.ornaments) {
		for (const ornName of notations.ornaments) {
			const ornType = convertOrnament(ornName);
			if (ornType) {
				marks.push({ markType: 'ornament', type: ornType });
			}
		}
	}

	// Fermata
	if (notations.fermata) {
		marks.push({ markType: 'ornament', type: 'fermata' as any });
	}

	// Arpeggiate
	if (notations.arpeggiate) {
		marks.push({ markType: 'ornament', type: 'arpeggio' as any });
	}

	return marks;
};

/**
 * Convert direction to marks
 */
const directionToMarks = (
	direction: MusicXmlDirection,
	spannerTracker: SpannerTracker
): Mark[] => {
	const marks: Mark[] = [];

	// Dynamics
	if (direction.dynamics) {
		for (const dyn of direction.dynamics) {
			const dynType = convertDynamic(dyn.type);
			if (dynType) {
				marks.push({ markType: 'dynamic', type: dynType });
			}
		}
	}

	// Wedge (hairpin)
	if (direction.wedge) {
		const { type, number = 1 } = direction.wedge;
		if (type === 'crescendo') {
			marks.push({ markType: 'hairpin', type: HairpinType.crescendoStart });
			spannerTracker.startWedge('crescendo', number);
		} else if (type === 'diminuendo') {
			marks.push({ markType: 'hairpin', type: HairpinType.diminuendoStart });
			spannerTracker.startWedge('diminuendo', number);
		} else if (type === 'stop') {
			const wedgeType = spannerTracker.stopWedge(number);
			if (wedgeType === 'crescendo') {
				marks.push({ markType: 'hairpin', type: HairpinType.crescendoEnd });
			} else if (wedgeType === 'diminuendo') {
				marks.push({ markType: 'hairpin', type: HairpinType.diminuendoEnd });
			} else {
				// Unknown wedge type, default to crescendo end
				marks.push({ markType: 'hairpin', type: HairpinType.crescendoEnd });
			}
		}
	}

	// Pedal
	if (direction.pedal) {
		const pedalType = convertPedal(direction.pedal.type);
		if (pedalType) {
			marks.push({ markType: 'pedal', type: pedalType });
		}
	}

	// Coda
	if (direction.coda) {
		marks.push({ markType: 'navigation', type: NavigationMarkType.coda });
	}

	// Segno
	if (direction.segno) {
		marks.push({ markType: 'navigation', type: NavigationMarkType.segno });
	}

	return marks;
};

/**
 * Result of converting a measure - now includes voices grouped by voice number
 */
interface MeasureConversionResult {
	voiceMap: Map<number, { events: Event[]; staff: number }>;
	key?: KeySignature;
	timeSig?: Fraction;
	barline?: BarlineEvent;
	harmonies: HarmonyEvent[];
	clefs: Map<number, ContextChange>;  // staff number → clef context
}

/**
 * Convert a MusicXML measure to Lilylet events, grouped by voice
 */
const convertMeasure = (
	measureEl: Element,
	voiceTracker: VoiceTracker,
	spannerTracker: SpannerTracker
): MeasureConversionResult => {
	let key: KeySignature | undefined;
	let timeSig: Fraction | undefined;
	let barline: BarlineEvent | undefined;
	const harmonies: HarmonyEvent[] = [];
	const clefs: Map<number, ContextChange> = new Map();

	// Pending marks from directions (to attach to next note), per voice
	const pendingMarks: Map<number, Mark[]> = new Map();
	let currentVoice = 1;  // Track current voice for directions

	// Process all children in order
	for (const child of getChildElements(measureEl)) {
		const tagName = child.tagName;

		if (tagName === 'attributes') {
			const attrs = parseAttributes(child);

			if (attrs.divisions !== undefined) {
				voiceTracker.setDivisions(attrs.divisions);
			}

			if (attrs.staves !== undefined) {
				voiceTracker.setStaves(attrs.staves);
			}

			// Key signature
			if (attrs.key) {
				key = convertKeySignature(attrs.key.fifths, attrs.key.mode);
			}

			// Time signature
			if (attrs.time) {
				timeSig = createFraction(attrs.time.beats, attrs.time.beatType);
			}

			// Clefs - store by staff number
			if (attrs.clefs) {
				for (const clefEntry of attrs.clefs) {
					const clef = convertClef(clefEntry.clef.sign, clefEntry.clef.line);
					if (clef) {
						clefs.set(clefEntry.staff, { type: 'context', clef });
					}
				}
			}
		} else if (tagName === 'note') {
			const note = parseNote(child, voiceTracker.getDivisions());
			const voiceNum = note.voice;
			const staffNum = note.staff || 1;
			currentVoice = voiceNum;

			// Get pending marks for this voice
			const marks: Mark[] = pendingMarks.get(voiceNum) || [];
			pendingMarks.delete(voiceNum);

			if (note.isRest) {
				// Rest event
				const duration = convertDuration(
					voiceTracker.getDivisions(),
					note.duration.divisions,
					note.duration.type,
					note.duration.dots,
					note.duration.timeModification
				);

				const restEvent: RestEvent = {
					type: 'rest',
					duration,
				};

				// Grace notes don't advance time
				const advanceDuration = note.isGrace ? 0 : note.duration.divisions;
				voiceTracker.addEvent(voiceNum, restEvent, advanceDuration, staffNum);
			} else if (note.pitch) {
				// Note or chord - convert MusicXmlPitch to Lilylet Pitch
				const lilyletPitch = musicXmlPitchToLilylet(note.pitch);

				// Get marks from notations
				const notationMarks = notationsToMarks(note.notations, spannerTracker, [lilyletPitch]);
				marks.push(...notationMarks);

				// Add fingering
				if (note.fingering !== undefined && note.fingering >= 1 && note.fingering <= 5) {
					marks.push({ markType: 'fingering', finger: note.fingering });
				}

				// Handle chord: merge with previous note in same voice
				if (note.isChord) {
					const lastEvent = voiceTracker.getLastEvent(voiceNum);
					if (lastEvent && lastEvent.type === 'note') {
						lastEvent.pitches.push(lilyletPitch);
						// Merge marks
						if (marks.length > 0) {
							lastEvent.marks = [...(lastEvent.marks || []), ...marks];
						}
						continue;  // Don't create a new event
					}
				}

				const duration = convertDuration(
					voiceTracker.getDivisions(),
					note.duration.divisions,
					note.duration.type,
					note.duration.dots,
					note.duration.timeModification
				);

				const noteEvent: NoteEvent = {
					type: 'note',
					pitches: [lilyletPitch],
					duration,
					grace: note.isGrace || undefined,
					staff: staffNum > 1 ? staffNum : undefined,  // Only include if cross-staff
					stemDirection: note.stem ? convertStemDirection(note.stem) : undefined,
				};

				// Add single tremolo
				if (note.notations?.tremolo?.type === 'single') {
					// Convert tremolo value (number of beams) to division
					// 1 beam = 8th, 2 beams = 16th, 3 beams = 32nd
					noteEvent.tremolo = Math.pow(2, note.notations.tremolo.value + 2);
				}

				// Add beam marks - only care about primary beam (number=1)
				if (note.beams) {
					const primaryBeam = note.beams.find(b => b.number === 1);
					if (primaryBeam) {
						if (primaryBeam.type === 'begin') {
							marks.push({ markType: 'beam', start: true });
						} else if (primaryBeam.type === 'end') {
							marks.push({ markType: 'beam', start: false });
						}
						// 'continue' doesn't need a mark
					}
				}

				if (marks.length > 0) {
					noteEvent.marks = marks;
				}

				// Grace notes don't advance time
				const advanceDuration = note.isGrace ? 0 : note.duration.divisions;
				voiceTracker.addEvent(voiceNum, noteEvent, advanceDuration, staffNum);
			}
		} else if (tagName === 'direction') {
			const direction = parseDirection(child);
			const marks = directionToMarks(direction, spannerTracker);
			if (marks.length > 0) {
				// Store marks to attach to next note in current voice
				const existing = pendingMarks.get(currentVoice) || [];
				pendingMarks.set(currentVoice, [...existing, ...marks]);
			}
		} else if (tagName === 'backup') {
			const duration = getElementInt(child, 'duration') || 0;
			voiceTracker.backup(duration);
		} else if (tagName === 'forward') {
			const duration = getElementInt(child, 'duration') || 0;
			voiceTracker.forward(duration);
		} else if (tagName === 'barline') {
			const barlineData = parseBarline(child);
			const style = convertBarlineStyle(barlineData.barStyle, barlineData.repeat?.direction);
			if (style && style !== '|') {
				barline = { type: 'barline', style };
			}
		} else if (tagName === 'harmony') {
			const harmonyData = parseHarmony(child);
			if (harmonyData) {
				const text = convertHarmonyToText(
					harmonyData.root.step,
					harmonyData.root.alter,
					harmonyData.kind,
					harmonyData.bass?.step,
					harmonyData.bass?.alter
				);
				harmonies.push({ type: 'harmony', text });
			}
		}
	}

	// Build voice map from tracker
	const voiceMap = new Map<number, { events: Event[]; staff: number }>();
	for (const [voiceNum, voiceState] of voiceTracker.getVoices()) {
		voiceMap.set(voiceNum, {
			events: voiceState.events,
			staff: voiceState.staff,
		});
	}

	return { voiceMap, key, timeSig, barline, harmonies, clefs };
};

/**
 * Convert a MusicXML part to Lilylet measures
 */
const convertPart = (partEl: Element): { measures: Measure[]; name?: string } => {
	const measures: Measure[] = [];
	const voiceTracker = new VoiceTracker();
	const spannerTracker = new SpannerTracker();

	let lastKey: KeySignature | undefined;
	let lastTimeSig: Fraction | undefined;
	let isFirstMeasure = true;

	const measureEls = getDirectChildren(partEl, 'measure');

	for (const measureEl of measureEls) {
		voiceTracker.reset();
		const { voiceMap, key, timeSig, barline, harmonies, clefs } = convertMeasure(measureEl, voiceTracker, spannerTracker);

		// Update running key/time
		if (key) lastKey = key;
		if (timeSig) lastTimeSig = timeSig;

		// Build voices from voice map, sorted by voice number
		const voiceNumbers = Array.from(voiceMap.keys()).sort((a, b) => a - b);
		const voices: Voice[] = [];

		// Track which staves have had clef added (for first measure)
		const staffsWithClef = new Set<number>();

		for (const voiceNum of voiceNumbers) {
			const voiceData = voiceMap.get(voiceNum)!;
			const events: Event[] = [];

			// Add clef at start of first voice for each staff in first measure
			if (isFirstMeasure && !staffsWithClef.has(voiceData.staff)) {
				const clef = clefs.get(voiceData.staff);
				if (clef) {
					events.push(clef);
				}
				staffsWithClef.add(voiceData.staff);
			}

			// Add voice events
			events.push(...voiceData.events);

			// Add harmonies and barline to first voice only
			if (voiceNum === voiceNumbers[0]) {
				for (const h of harmonies) {
					events.push(h);
				}
				if (barline) {
					events.push(barline);
				}
			}

			voices.push({
				staff: voiceData.staff,
				events,
			});
		}

		// If no voices found, create an empty one
		if (voices.length === 0) {
			voices.push({ staff: 1, events: [] });
		}

		const measure: Measure = {
			parts: [{
				voices,
			}],
		};

		// Only include key/time if they changed
		if (key) measure.key = key;
		if (timeSig) measure.timeSig = timeSig;

		measures.push(measure);
		isFirstMeasure = false;
	}

	return { measures };
};

// ============ Main Decoder Function ============

/**
 * Decode MusicXML string to LilyletDoc
 */
export const decode = (xmlString: string): LilyletDoc => {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xmlString, 'application/xml');

	// Check for parsing errors
	const parseError = doc.getElementsByTagName('parsererror')[0];
	if (parseError) {
		throw new Error(`XML parsing error: ${parseError.textContent}`);
	}

	// Get root element
	const root = doc.documentElement;
	if (!root || (root.tagName !== 'score-partwise' && root.tagName !== 'score-timewise')) {
		throw new Error(`Invalid MusicXML: expected score-partwise or score-timewise, got ${root?.tagName}`);
	}

	// Parse metadata
	const metadata = parseMetadata(doc);

	// Get parts
	const partEls = Array.from(doc.getElementsByTagName('part'));
	if (partEls.length === 0) {
		throw new Error('No parts found in MusicXML');
	}

	// For now, convert only the first part
	// TODO: Handle multiple parts
	const firstPart = partEls[0];
	const { measures } = convertPart(firstPart);

	const result: LilyletDoc = {
		measures,
	};

	if (Object.keys(metadata).length > 0) {
		result.metadata = metadata;
	}

	return result;
};

/**
 * Decode MusicXML file to LilyletDoc
 */
export const decodeFile = async (filePath: string): Promise<LilyletDoc> => {
	const fs = await import('fs/promises');
	const content = await fs.readFile(filePath, 'utf-8');
	return decode(content);
};

export default {
	decode,
	decodeFile,
};
