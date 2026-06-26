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
	Placement,
	BarlineEvent,
	HarmonyEvent,
	TupletEvent,
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
	TYPE_TO_DIVISION,
} from './musicXmlUtils';
import { measureLayoutFromPart } from './measureLayoutFromXml';

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

// ============ Tuplet Tracker ============

/**
 * Track tuplet groups by number attribute.
 * Collects notes between tuplet start and stop to create TupletEvent.
 */
class TupletTracker {
	// Map from tuplet number to collected events and ratio. Each tuplet is bound to
	// the voice (and staff) it started in: a tuplet belongs to one voice, so events
	// from OTHER voices must not be swallowed into it (multi-voice piano scores
	// interleave voices, and a voice-1 tuplet would otherwise eat voice-2 notes).
	private activeTuplets: Map<number, {
		events: (NoteEvent | RestEvent)[];
		ratio?: Fraction;
		voice: number;
		staff: number;
	}> = new Map();

	/**
	 * Start a new tuplet group, bound to the voice/staff it starts in.
	 */
	startTuplet(number: number = 1, voice: number = 1, staff: number = 1): void {
		this.activeTuplets.set(number, { events: [], voice, staff });
	}

	/**
	 * Add an event to the innermost active tuplet of the SAME voice.
	 * Returns true if the event was added.
	 *
	 * Nested tuplets share the doc model's flat TupletEvent (which can't hold a
	 * nested TupletEvent), so an event must go to exactly ONE tuplet or it would be
	 * emitted twice — once per enclosing tuplet — inflating the pitch count. We pick
	 * the most-recently-started same-voice tuplet (the innermost): when the inner one
	 * closes, later events fall back to the still-open outer one.
	 */
	addEvent(event: NoteEvent | RestEvent, voice: number): boolean {
		if (this.activeTuplets.size === 0) return false;

		// Innermost = last-inserted entry for this voice (Map preserves insertion order).
		let target: { events: (NoteEvent | RestEvent)[]; ratio?: Fraction; voice: number; staff: number } | undefined;
		for (const [, tuplet] of this.activeTuplets) {
			if (tuplet.voice === voice) target = tuplet;
		}
		if (!target) return false;

		// Set ratio from first event's duration.tuplet
		// convertDuration already stores Lilylet ratio semantics (normalNotes/actualNotes)
		if (!target.ratio && event.duration.tuplet) {
			target.ratio = { ...event.duration.tuplet };
		}
		// Store event without tuplet info in duration (it's handled at TupletEvent level)
		const cleanEvent = { ...event, duration: { ...event.duration } };
		delete cleanEvent.duration.tuplet;
		target.events.push(cleanEvent);
		return true;
	}

	/**
	 * Stop a tuplet group and return the TupletEvent
	 */
	stopTuplet(number: number = 1): TupletEvent | undefined {
		const tuplet = this.activeTuplets.get(number);
		if (!tuplet || tuplet.events.length === 0) {
			this.activeTuplets.delete(number);
			return undefined;
		}

		this.activeTuplets.delete(number);

		// Default ratio if not set (shouldn't happen normally)
		const ratio = tuplet.ratio || { numerator: 2, denominator: 3 };

		return {
			type: 'tuplet',
			ratio,
			events: tuplet.events,
		};
	}

	/**
	 * Check if a tuplet is active for the given voice. A tuplet only swallows notes
	 * of its OWN voice, so the per-note "are we in a tuplet?" check must be scoped to
	 * the note's voice — otherwise a voice-1 tuplet would divert voice-2 notes.
	 */
	isActive(voice?: number): boolean {
		if (voice === undefined) return this.activeTuplets.size > 0;
		for (const [, t] of this.activeTuplets) if (t.voice === voice) return true;
		return false;
	}

	/**
	 * Force-close every still-open tuplet and return them with their owning
	 * voice/staff. Called at measure end: a tuplet is a within-measure time
	 * modification and MUST NOT leak across the bar line. A source file missing a
	 * <tuplet type="stop"> (corpus reality — e.g. 库劳 Op.20) would otherwise leave
	 * the tuplet open forever, swallowing every following note in that voice for the
	 * rest of the piece. Flushing here bounds the damage to the one measure.
	 */
	flushAll(): Array<{ event: TupletEvent; voice: number; staff: number }> {
		const out: Array<{ event: TupletEvent; voice: number; staff: number }> = [];
		for (const [, tuplet] of this.activeTuplets) {
			if (tuplet.events.length === 0) continue;
			const ratio = tuplet.ratio || { numerator: 2, denominator: 3 };
			out.push({
				event: { type: 'tuplet', ratio, events: tuplet.events },
				voice: tuplet.voice,
				staff: tuplet.staff,
			});
		}
		this.activeTuplets.clear();
		return out;
	}

	/**
	 * Reset tracker
	 */
	reset(): void {
		this.activeTuplets.clear();
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
	private currentStaff: Map<number, number> = new Map();

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
			this.currentStaff.set(voiceNum, staff);
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
		const prevStaff = this.currentStaff.get(voiceNum) || 1;
		if (staff > 0 && staff !== prevStaff) {
			voice.events.push({ type: 'context', staff } as ContextChange);
			this.currentStaff.set(voiceNum, staff);
		}
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
		this.currentStaff.clear();
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
	const restEl = isRest ? noteEl.getElementsByTagName('rest')[0] : undefined;

	let pitch: MusicXmlPitch | undefined;
	const pitchEl = noteEl.getElementsByTagName('pitch')[0];
	if (pitchEl) {
		pitch = parsePitchRaw(pitchEl);
	}

	// Duration
	const durationVal = getElementInt(noteEl, 'duration') || 0;
	const typeText = getElementText(noteEl, 'type');
	const dotCount = getElements(noteEl, 'dot').length;

	// Whole-measure rest detection. Two forms in the wild:
	//  (a) <rest measure="yes"> — explicit.
	//  (b) a `type="whole"` rest whose <duration> is NOT a whole note (e.g. 72 ticks
	//      in 3/4 at divisions=24) — the conventional "centred whole rest = whole
	//      bar" notation. In both cases the rest fills the measure, so flag it and
	//      let encoders emit <mRest>/R instead of rounding the bare duration to a
	//      power-of-two division (which over/under-fills non-2^n meters).
	const isMeasureRest = !!restEl && (
		getAttribute(restEl, 'measure') === 'yes' ||
		(typeText === 'whole' && durationVal > 0 && durationVal !== divisions * 4)
	);

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

	// Fingering — a note may carry several <fingering> (one per chord member).
	let fingerings: number[] | undefined;
	const technicalEl = noteEl.getElementsByTagName('technical')[0];
	if (technicalEl) {
		const fingeringEls = getElements(technicalEl, 'fingering');
		const parsed = fingeringEls
			.map(el => parseInt(el.textContent?.trim() || '', 10))
			.filter(n => Number.isFinite(n));
		if (parsed.length > 0) fingerings = parsed;
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
		isMeasureRest,
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
		fingerings,
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

	// Navigation jumps live on the <sound> child of <direction> (a sibling of
	// <direction-type>). Parse it first, before the no-direction-type early return,
	// so a sound-only direction still contributes its jump semantics.
	const soundEl = dirEl.getElementsByTagName('sound')[0];
	if (soundEl) {
		const sound: NonNullable<MusicXmlDirection['sound']> = {};
		if (getAttribute(soundEl, 'dacapo') === 'yes') sound.dacapo = true;
		if (getAttribute(soundEl, 'fine') === 'yes') sound.fine = true;
		const dalsegno = getAttribute(soundEl, 'dalsegno');
		if (dalsegno) sound.dalsegno = dalsegno;
		const segno = getAttribute(soundEl, 'segno');
		if (segno) sound.segno = segno;
		const coda = getAttribute(soundEl, 'coda');
		if (coda) sound.coda = coda;
		const tocoda = getAttribute(soundEl, 'tocoda');
		if (tocoda) sound.tocoda = tocoda;
		if (Object.keys(sound).length > 0) result.sound = sound;
	}

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
			const times = getAttributeNumber(repeatEl, 'times');
			result.repeat = times !== undefined ? { direction, times } : { direction };
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

		// Staff layout: recover the raw [staves] string stashed at encode time.
		const miscFields = getElements(identificationEl, 'miscellaneous-field');
		for (const field of miscFields) {
			if (getAttribute(field, 'name') === 'lilylet-staves') {
				const code = field.textContent?.trim();
				if (code) metadata.staves = code;
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
				marks.push({ markType: 'slur', start: true, number: slur.number });
				spannerTracker.startSlur(slur.number);
			} else if (slur.type === 'stop') {
				// Carry the MusicXML number so the encoder can pair cross-voice slurs
				// (start in one voice, stop in another — common in piano scores).
				spannerTracker.stopSlur(slur.number);
				marks.push({ markType: 'slur', start: false, number: slur.number });
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

// Common tempo words that should be converted to \tempo
const TEMPO_WORDS = new Set([
	// Very slow
	'largo', 'larghetto', 'grave', 'lento', 'adagio',
	// Slow
	'andante', 'andantino',
	// Moderate
	'moderato', 'allegretto',
	// Fast
	'allegro', 'vivace', 'presto', 'prestissimo',
	// Other tempo indications
	'tempo', 'a tempo', 'tempo i', 'tempo primo',
	// With modifiers (partial matches)
]);

/**
 * Check if text is a tempo word
 */
const isTempoWord = (text: string): boolean => {
	const lower = text.toLowerCase().trim();
	// Check exact match
	if (TEMPO_WORDS.has(lower)) return true;
	// Check if starts with tempo word (e.g., "Allegro moderato", "Andante con moto")
	for (const word of TEMPO_WORDS) {
		if (lower.startsWith(word)) return true;
	}
	return false;
};

/**
 * Convert direction to context change (tempo, ottava)
 */
const directionToContextChange = (
	direction: MusicXmlDirection,
	ottavaTracker: { current: number }
): ContextChange | undefined => {
	// Metronome → Tempo (may combine with words)
	if (direction.metronome) {
		const { beatUnit, beatUnitDot, perMinute } = direction.metronome;
		const division = TYPE_TO_DIVISION[beatUnit] || 4;

		// Check if there's accompanying tempo text
		let tempoText: string | undefined;
		if (direction.words && direction.words.length > 0) {
			const text = direction.words[0].text.trim();
			if (isTempoWord(text)) {
				tempoText = text;
			}
		}

		return {
			type: 'context',
			tempo: {
				text: tempoText,
				beat: {
					division,
					dots: beatUnitDot ? 1 : 0,
				},
				bpm: perMinute,
			},
		};
	}

	// Words alone that are tempo indications → Tempo (text only)
	if (direction.words && direction.words.length > 0 && !direction.metronome) {
		const text = direction.words[0].text.trim();
		if (isTempoWord(text)) {
			return {
				type: 'context',
				tempo: {
					text,
				},
			};
		}
	}

	// Octave shift → Ottava
	if (direction.octaveShift) {
		const { type, size = 8 } = direction.octaveShift;
		let ottava: number;
		if (type === 'stop') {
			ottava = 0;
			ottavaTracker.current = 0;
		} else if (type === 'down') {
			// 8va = 1, 15ma = 2 (type="down" means written notes sound higher)
			ottava = size === 15 ? 2 : 1;
			ottavaTracker.current = ottava;
		} else if (type === 'up') {
			// 8vb = -1, 15mb = -2 (type="up" means written notes sound lower)
			ottava = size === 15 ? -2 : -1;
			ottavaTracker.current = ottava;
		} else {
			return undefined;
		}
		return {
			type: 'context',
			ottava,
		};
	}

	return undefined;
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

	// Words (text directions: "dolce", "espr.", "cresc.", "con forza", ...).
	// Tempo words ("Allegro", "a tempo", ...) are consumed separately as a tempo
	// ContextChange by directionToContextChange, so skip those here to avoid
	// double-emitting; everything else becomes a markup mark → MEI <dir>. Metronome
	// directions are tempo too, never markup. Navigation text ("D.C. al Fine",
	// "To Coda", "Fine", "D.S. al Coda") is NOT a tempo word, so it flows here as a
	// markup glyph — the jump SEMANTICS are captured separately as measure-layout.
	let emittedWords = false;
	if (direction.words && direction.words.length > 0 && !direction.metronome) {
		const text = direction.words.map(w => w.text).join('').trim();
		if (text && !isTempoWord(text)) {
			const placement = direction.placement === 'above' ? Placement.above
				: direction.placement === 'below' ? Placement.below
				: undefined;
			marks.push({ markType: 'markup', content: text, placement });
			emittedWords = true;
		}
	}

	// A <sound> navigation with NO visible <words> (e.g. a bare <sound tocoda=>):
	// synthesize the conventional glyph text so the score still shows the marking.
	// Segno/coda GLYPHS (the symbols, via <direction-type><segno|coda>) are already
	// emitted above as NavigationMark; only the textual D.C./D.S./Fine/To-Coda need
	// synthesizing, and only when the engraver left them implicit.
	if (!emittedWords && direction.sound && !direction.coda && !direction.segno) {
		const s = direction.sound;
		const label = s.dacapo ? (s.fine ? 'D.C. al Fine' : 'D.C.')
			: s.dalsegno ? (s.fine ? 'D.S. al Fine' : 'D.S. al Coda')
			: s.tocoda ? 'To Coda'
			: s.fine ? 'Fine'
			: undefined;
		if (label) {
			const placement = direction.placement === 'above' ? Placement.above
				: direction.placement === 'below' ? Placement.below
				: undefined;
			marks.push({ markType: 'markup', content: label, placement });
		}
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
 * Decompose a tick gap (from <forward>) into invisible spacer rests.
 *
 * lilylet's doc model is a flat per-voice event sequence with no absolute tick
 * anchor (currentPosition is unused for placement), so a <forward> that skips
 * time inside a voice must be materialised as filler or the following notes slide
 * earlier and the bar decodes short. Invisible rests (`s` / MEI <space>) are the
 * right carrier. The gap may not be a single note value (e.g. 1.5 quarters), so
 * emit a greedy sequence of power-of-two (optionally dotted) spacers.
 */
const forwardGapToRests = (gapTicks: number, divisions: number): RestEvent[] => {
	const rests: RestEvent[] = [];
	let remaining = gapTicks;
	const quarterTicks = divisions; // ticks per quarter note
	// Largest representable spacer first; division 1=whole..128. dotted adds half.
	const candidates: { division: number; dots: number; q: number }[] = [];
	for (const division of [1, 2, 4, 8, 16, 32, 64, 128]) {
		const baseQ = 4 / division;           // quarter notes for this value
		candidates.push({ division, dots: 0, q: baseQ });
		candidates.push({ division, dots: 1, q: baseQ * 1.5 });
	}
	candidates.sort((a, b) => b.q - a.q);
	let guard = 0;
	while (remaining > 0.0001 && guard++ < 64) {
		const c = candidates.find(c => c.q * quarterTicks <= remaining + 0.0001);
		if (!c) break;
		rests.push({ type: 'rest', duration: { division: c.division, dots: c.dots }, invisible: true });
		remaining -= c.q * quarterTicks;
	}
	return rests;
};

/**
 * Total time a TupletEvent advances the voice, in voiceTracker duration units.
 * Sum the inner note/rest values then apply the tuplet ratio (triplet etc.).
 */
const tupletAdvanceDuration = (tupletEvent: TupletEvent, divisions: number): number => {
	let total = 0;
	for (const evt of tupletEvent.events) {
		const d = (evt as NoteEvent | RestEvent).duration;
		if (d) total += (4 / d.division) * divisions;
	}
	return total * tupletEvent.ratio.numerator / tupletEvent.ratio.denominator;
};

/**
 * Convert a MusicXML measure to Lilylet events, grouped by voice
 */
const convertMeasure = (
	measureEl: Element,
	voiceTracker: VoiceTracker,
	spannerTracker: SpannerTracker,
	ottavaTracker: { current: number },
	tupletTracker: TupletTracker
): MeasureConversionResult => {
	let key: KeySignature | undefined;
	let timeSig: Fraction | undefined;
	let barline: BarlineEvent | undefined;
	const harmonies: HarmonyEvent[] = [];
	const clefs: Map<number, ContextChange> = new Map();

	// Pending marks from directions (to attach to next note), per voice
	const pendingMarks: Map<number, Mark[]> = new Map();
	// Accumulated <forward> ticks waiting for the next note, whose <voice> tells us
	// which voice the gap belongs to. Flushed as invisible rests before that note,
	// or onto currentVoice at a <backup>/measure end (a trailing gap in this voice).
	let pendingForward = 0;
	// Pending context changes (tempo, ottava) to insert before next note. Each may
	// carry a target staff: an ottava (<octave-shift>) start and its stop both name
	// the same <staff>, but in piano scores the stop direction often follows a
	// <backup> so the *next note* is on the other staff. Routing the change to a
	// note on its own staff keeps the 8va span's start and end in the same MEI
	// layer (otherwise the encoder can't pair them and drops the span).
	const pendingContextChanges: { ctx: ContextChange; staff?: number }[] = [];
	let currentVoice = 1;  // Track current voice for directions
	// Mid-measure clef support: a staff can change clef partway through a measure
	// (common in scale/arpeggio études where the LH crosses up). Such a clef arrives
	// in an <attributes> block AFTER notes on that staff. We must attach it inline at
	// that point on the staff's currently-active voice, not collapse it into the
	// measure-start `clefs` map (which keeps only one clef per staff and emits it at
	// the bar start). Track the last voice that added a note on each staff, and which
	// staves already have notes this measure.
	const lastVoiceOnStaff: Map<number, number> = new Map();
	const staffHasNotes: Set<number> = new Set();

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
						const staff = clefEntry.staff;
						if (staffHasNotes.has(staff)) {
							// Mid-measure clef change: this staff already has notes in this
							// measure, so the clef takes effect HERE, not at the bar start.
							// Append it inline on the staff's currently-active voice via
							// addEvent (which inserts a staff-switch context if that voice is
							// currently positioned on another staff — e.g. a cross-staff
							// voice — so the clef binds to `staff`, not the voice's current
							// staff). Zero duration: a clef does not advance time.
							const vNum = lastVoiceOnStaff.get(staff);
							if (vNum !== undefined) {
								// Tag the clef context with its staff explicitly. In a
								// cross-staff voice (where notes interleave staves) a bare
								// clef is ambiguous and is dropped/misplaced by the serializer;
								// the explicit staff makes it self-describing (serializer emits
								// `\staff "N" \clef ...`). addEvent still inserts a leading
								// staff switch when the voice is currently on another staff.
								voiceTracker.addEvent(vNum, { type: 'context', staff, clef } as ContextChange, 0, staff);
							} else {
								clefs.set(staff, { type: 'context', clef });
							}
						} else {
							clefs.set(staff, { type: 'context', clef });
						}
					}
				}
			}
		} else if (tagName === 'note') {
			const note = parseNote(child, voiceTracker.getDivisions());
			const voiceNum = note.voice;
			const staffNum = note.staff || 1;
			currentVoice = voiceNum;
			// Record that this staff now has notes this measure and which voice is
			// active on it, so a subsequent mid-measure <clef> attaches inline here.
			staffHasNotes.add(staffNum);
			lastVoiceOnStaff.set(staffNum, voiceNum);

			// Ensure voice exists with correct staff tracking (needed for cross-staff tuplets
			// where notes go to tupletTracker but voice must be initialized for staff detection)
			voiceTracker.getOrCreateVoice(voiceNum, staffNum);

			// Flush an accumulated <forward> gap as invisible rests into THIS note's
			// voice (the forward had no voice of its own; it belongs to the voice that
			// follows). Skip while inside a tuplet — a forward there is unusual and the
			// tuplet tracker owns timing.
			if (pendingForward > 0 && !tupletTracker.isActive(voiceNum)) {
				for (const r of forwardGapToRests(pendingForward, voiceTracker.getDivisions())) {
					voiceTracker.addEvent(voiceNum, r, 0, staffNum);
				}
			}
			pendingForward = 0;

			// Check for tuplet start BEFORE processing the note
			const tupletNotation = note.notations?.tuplet;
			if (tupletNotation?.type === 'start') {
				tupletTracker.startTuplet(tupletNotation.number, voiceNum, staffNum);
			}

			// Add any pending context changes before the note (tempo, ottava).
			// A staff-tagged change (ottava) only flushes onto a note on the SAME
			// staff so its 8va span stays in one layer; others (tempo) flush anywhere.
			if (pendingContextChanges.length > 0) {
				const remaining: { ctx: ContextChange; staff?: number }[] = [];
				for (const pc of pendingContextChanges) {
					if (pc.staff === undefined || pc.staff === staffNum) {
						voiceTracker.addEvent(voiceNum, pc.ctx, 0, staffNum);
					} else {
						remaining.push(pc);  // wait for a note on the matching staff
					}
				}
				pendingContextChanges.length = 0;
				pendingContextChanges.push(...remaining);
			}

			// Get pending marks for this voice. Rests can't hold marks (RestEvent has
			// no `marks` field), so do NOT consume them on a rest — leave them queued
			// for the next real note or the end-of-measure flush. Otherwise a pedal/
			// hairpin stop that lands just before a rest (common in piano scores:
			// `<pedal stop/>` followed by rests filling the voice) is silently dropped.
			const marks: Mark[] = note.isRest ? [] : (pendingMarks.get(voiceNum) || []);
			if (!note.isRest) pendingMarks.delete(voiceNum);

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

				// Whole-measure rest: mark it so encoders emit <mRest>/R and downstream
				// duration math uses the measure length, not the power-of-two rounding
				// of the bare <duration> (which over/under-fills non-2^n meters like 3/4).
				if (note.isMeasureRest) {
					restEvent.fullMeasure = true;
				}

				// A rest can host a fermata (grand pause / held silence). Convert it
				// so the encoder can emit <fermata startid="#rest">; without this the
				// 3-of-4 fermatas that sit on rests in typical piano scores are lost.
				if (note.notations?.fermata) {
					restEvent.marks = [{ markType: 'ornament', type: 'fermata' as any }];
				}

				// Grace notes don't advance time
				const advanceDuration = note.isGrace ? 0 : note.duration.divisions;

				// Check if we're in a tuplet
				if (tupletTracker.isActive(voiceNum)) {
					tupletTracker.addEvent(restEvent, voiceNum);
				} else {
					voiceTracker.addEvent(voiceNum, restEvent, advanceDuration, staffNum);
				}
			} else if (note.pitch) {
				// Note or chord - convert MusicXmlPitch to Lilylet Pitch
				const lilyletPitch = musicXmlPitchToLilylet(note.pitch);

				// Get marks from notations
				const notationMarks = notationsToMarks(note.notations, spannerTracker, [lilyletPitch]);
				marks.push(...notationMarks);

				// Add fingerings (one per chord member; MEI emits a <fing> each)
				if (note.fingerings) {
					for (const finger of note.fingerings) {
						if (finger >= 0 && finger <= 9) marks.push({ markType: 'fingering', finger });
					}
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

				// Check if we're in a tuplet
				if (tupletTracker.isActive(voiceNum)) {
					tupletTracker.addEvent(noteEvent, voiceNum);
				} else {
					voiceTracker.addEvent(voiceNum, noteEvent, advanceDuration, staffNum);
				}
			}

			// Check for tuplet stop AFTER processing the note
			if (tupletNotation?.type === 'stop') {
				const tupletEvent = tupletTracker.stopTuplet(tupletNotation.number);
				if (tupletEvent) {
					const totalDuration = tupletAdvanceDuration(tupletEvent, voiceTracker.getDivisions());
					voiceTracker.addEvent(voiceNum, tupletEvent, totalDuration, staffNum);
				}
			}
		} else if (tagName === 'direction') {
			const direction = parseDirection(child);

			// Handle context changes (tempo, ottava)
			const contextChange = directionToContextChange(direction, ottavaTracker);
			if (contextChange) {
				// Tag ottava changes with their staff so they reach the right layer.
				const staff = contextChange.ottava !== undefined ? direction.staff : undefined;
				pendingContextChanges.push({ ctx: contextChange, staff });
			}

			// Handle marks (dynamics, hairpins, etc.)
			const marks = directionToMarks(direction, spannerTracker);
			if (marks.length > 0) {
				// Store marks to attach to next note in current voice
				const existing = pendingMarks.get(currentVoice) || [];
				pendingMarks.set(currentVoice, [...existing, ...marks]);
			}
		} else if (tagName === 'backup') {
			// A <forward> with no note after it (before this backup) is cursor
			// positioning, not a content gap — drop it rather than materialise filler
			// (the common `backup N / forward N` measure-end idiom would otherwise
			// double the bar). Only note→forward→note gaps become invisible rests.
			pendingForward = 0;
			const duration = getElementInt(child, 'duration') || 0;
			voiceTracker.backup(duration);
		} else if (tagName === 'forward') {
			const duration = getElementInt(child, 'duration') || 0;
			voiceTracker.forward(duration);
			pendingForward += duration;  // materialised as invisible rests only if a note follows in-voice
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

	// A <forward> at the very end of the measure with no following note is cursor
	// positioning (e.g. the `backup N / forward N` idiom), not a content gap — drop
	// it. Only forwards consumed by a following note become invisible spacer rests.
	pendingForward = 0;

	// Force-close any tuplet still open at the bar line. A tuplet is a within-measure
	// time modification and cannot span a bar; a source file missing its
	// <tuplet type="stop"> (corpus reality) would otherwise keep the tuplet open for
	// the rest of the piece, diverting every following note in that voice into the
	// zombie tuplet — the multi-voice block-drop bug (库劳 Op.20 m15→end empty).
	// Flush each leftover tuplet onto its owning voice so the damage is bounded to
	// this measure. Done before the pendingMarks flush so trailing marks still find
	// the (now-emitted) tuplet's notes as the voice's last events.
	for (const { event, voice, staff } of tupletTracker.flushAll()) {
		const totalDuration = tupletAdvanceDuration(event, voiceTracker.getDivisions());
		voiceTracker.addEvent(voice, event, totalDuration, staff);
	}

	// Flush leftover pending marks. Post-positioned directions — hairpin/pedal
	// stops, and any direction after the last note of its voice (common after a
	// <backup> in piano scores) — never reached a following note in the loop above.
	// They belong on the note they trail, so attach them to the last NoteEvent of
	// the voice. pendingMarks is per-measure, so without this they would be lost
	// at the next measure (the pedal/hairpin "stop" loss). Rests carry no marks, so
	// search backward for the last actual note; fall back across voices if needed.
	if (pendingMarks.size > 0) {
		const allVoices = voiceTracker.getVoices();
		const findLastNote = (voiceNum: number): NoteEvent | undefined => {
			const vs = allVoices.get(voiceNum);
			if (!vs) return undefined;
			for (let i = vs.events.length - 1; i >= 0; i--) {
				const ev = vs.events[i];
				if (ev.type === 'note') return ev as NoteEvent;
			}
			return undefined;
		};
		for (const [voiceNum, marks] of pendingMarks) {
			if (marks.length === 0) continue;
			let target = findLastNote(voiceNum);
			// Voice had no note (e.g. direction-only or rest-only): attach to the
			// last note of any voice so the marking is not silently dropped.
			if (!target) {
				for (const vn of allVoices.keys()) {
					target = findLastNote(vn);
					if (target) break;
				}
			}
			if (target) target.marks = [...(target.marks || []), ...marks];
		}
		pendingMarks.clear();
	}

	// Flush leftover staff-tagged context changes (ottava) whose matching-staff note
	// never appeared this measure: append to a voice on the target staff so the span
	// continues into / closes in the right layer rather than being dropped.
	if (pendingContextChanges.length > 0) {
		const voices = voiceTracker.getVoices();
		for (const pc of pendingContextChanges) {
			let voiceNum: number | undefined;
			for (const [vn, vs] of voices) {
				if (vs.staff === pc.staff) { voiceNum = vn; break; }
			}
			if (voiceNum === undefined) voiceNum = voices.keys().next().value;
			if (voiceNum !== undefined) voiceTracker.addEvent(voiceNum, pc.ctx, 0, pc.staff);
		}
		pendingContextChanges.length = 0;
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
	const ottavaTracker = { current: 0 };
	const tupletTracker = new TupletTracker();

	let lastKey: KeySignature | undefined;
	let lastTimeSig: Fraction | undefined;
	let isFirstMeasure = true;
	let lastVoiceStaff = 1;  // Track last known primary voice staff for empty measure fallback
	const lastClefs: Map<number, ContextChange> = new Map();  // Track last clef per staff
	// Initial clef per staff declared in the FIRST <attributes> block. A staff whose
	// first voice does not appear until a later measure (e.g. an accompaniment staff
	// silent for the opening bars) would otherwise lose its initial clef — it is only
	// declared in measure 1's attributes, where that staff has no voice to attach it
	// to. We hold these and flush each onto the staff's FIRST appearing voice.
	const pendingInitialClefs: Map<number, ContextChange> = new Map();

	const measureEls = getDirectChildren(partEl, 'measure');

	for (const measureEl of measureEls) {
		voiceTracker.reset();
		const { voiceMap, key, timeSig, barline, harmonies, clefs } = convertMeasure(measureEl, voiceTracker, spannerTracker, ottavaTracker, tupletTracker);

		// Update running key/time
		if (key) lastKey = key;
		if (timeSig) lastTimeSig = timeSig;

		// Build voices from voice map, sorted by voice number
		const voiceNumbers = Array.from(voiceMap.keys()).sort((a, b) => a - b);
		const voices: Voice[] = [];

		// Track which staves have had clef added (for this measure)
		const staffsWithClef = new Set<number>();

		for (const voiceNum of voiceNumbers) {
			const voiceData = voiceMap.get(voiceNum)!;
			const events: Event[] = [];

			// Add clef at start of first voice for each staff
			// For first measure: always add initial clef
			// For subsequent measures: add clef if there's a clef change
			if (!staffsWithClef.has(voiceData.staff)) {
				const clef = clefs.get(voiceData.staff);
				if (clef) {
					// Check if this is a clef change (not first measure) or initial clef (first measure)
					if (isFirstMeasure) {
						events.push(clef);
						lastClefs.set(voiceData.staff, clef);
					} else {
						// Only add if it's different from the last clef for this staff
						const lastClef = lastClefs.get(voiceData.staff);
						const isSameClef = lastClef &&
							(lastClef as ContextChange).clef === (clef as ContextChange).clef;
						if (!isSameClef) {
							events.push(clef);
							lastClefs.set(voiceData.staff, clef);
						}
					}
					pendingInitialClefs.delete(voiceData.staff);
				} else if (pendingInitialClefs.has(voiceData.staff)) {
					// This staff's clef was declared in an earlier measure where the staff
					// had no voice to carry it (its first appearance is delayed, or it is
					// an intermittently-empty cross-staff passage). This measure declares
					// no clef of its own — emit the carried-forward pending clef if it
					// differs from the clef last in effect for this staff.
					const pending = pendingInitialClefs.get(voiceData.staff)!;
					const lastClef = lastClefs.get(voiceData.staff);
					const isSameClef = lastClef &&
						(lastClef as ContextChange).clef === (pending as ContextChange).clef;
					if (!isSameClef) {
						events.push(pending);
						lastClefs.set(voiceData.staff, pending);
					}
					pendingInitialClefs.delete(voiceData.staff);
				}
				staffsWithClef.add(voiceData.staff);
			}

			// Add voice events
			events.push(...voiceData.events);

			// A mid-measure clef change was appended inline to this voice's events (it
			// does not pass through the measure-start `clefs` map). Scan for the LAST
			// clef per staff in this voice and update lastClefs, so the next measure's
			// dedup compares against the clef actually in effect — otherwise a later
			// measure restating the pre-change clef would be wrongly suppressed.
			{
				let scanStaff = voiceData.staff;
				for (const ev of voiceData.events) {
					if (ev.type === 'context') {
						const c = ev as ContextChange;
						if (c.staff != null) scanStaff = c.staff;
						if (c.clef) lastClefs.set(scanStaff, { type: 'context', clef: c.clef });
					}
				}
			}

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
			voices.push({ staff: lastVoiceStaff, events: [] });
		} else {
			lastVoiceStaff = voices[0].staff || 1;
		}

		// Carry forward any clef declared this measure for a staff that had NO voice to
		// attach it to (an intermittently-empty staff — e.g. cross-staff passages where
		// the LH is written entirely on the upper staff for several bars). Remember it
		// as pending so it is emitted when that staff next reappears; otherwise the clef
		// (and any change it represents) is lost when this measure's `clefs` map is
		// discarded. Generalizes the first-measure seeding above to every measure.
		for (const [staff, clef] of clefs) {
			if (!staffsWithClef.has(staff)) pendingInitialClefs.set(staff, clef);
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
/**
 * Decode raw MusicXML bytes (or a string) into a clean UTF-8/UTF-16-correct
 * JS string. MuseScore/Finale/Sibelius frequently export `.xml` as UTF-16 LE
 * with a BOM; reading those as UTF-8 yields mojibake and a failed parse.
 *
 * Detection order: byte-order mark → declared `encoding="..."` in the XML
 * prolog → default UTF-8. A leading BOM is always stripped (xmldom chokes on a
 * U+FEFF before `<?xml`).
 */
export const readXmlString = (input: string | Uint8Array): string => {
	if (typeof input === 'string')
		return input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;

	const bytes = input;
	if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
		return new TextDecoder('utf-16le').decode(bytes.subarray(2));
	if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
		return new TextDecoder('utf-16be').decode(bytes.subarray(2));
	if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
		return new TextDecoder('utf-8').decode(bytes.subarray(3));

	// No BOM: peek the prolog (as latin1 so every byte maps 1:1) for a declared encoding.
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
	const enc = /encoding\s*=\s*['"]([^'"]+)['"]/i.exec(head)?.[1]?.toLowerCase();
	if (enc && /utf-?16/.test(enc))
		return new TextDecoder('utf-16le').decode(bytes); // BOM-less UTF-16 → assume LE (Windows)
	return new TextDecoder('utf-8').decode(bytes);
};

export const decode = (input: string | Uint8Array): LilyletDoc => {
	const xmlString = readXmlString(input);
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

	// Parse <part-list> to get part names
	const partNames: Map<string, string> = new Map();
	const partListEl = doc.getElementsByTagName('part-list')[0];
	if (partListEl) {
		const scorePartEls = getElements(partListEl, 'score-part');
		for (const sp of scorePartEls) {
			const id = getAttribute(sp, 'id');
			const name = getElementText(sp, 'part-name');
			if (id && name) {
				partNames.set(id, name);
			}
		}
	}

	// Get parts
	const partEls = getDirectChildren(root, 'part');
	if (partEls.length === 0) {
		throw new Error('No parts found in MusicXML');
	}

	// Convert all parts
	const allPartResults: { measures: Measure[]; name?: string; partId?: string }[] = [];
	for (const partEl of partEls) {
		const partId = getAttribute(partEl, 'id') || undefined;
		const { measures } = convertPart(partEl);
		const name = partId ? partNames.get(partId) : undefined;
		allPartResults.push({ measures, name, partId });
	}

	// Merge parts: combine into multi-part measures
	const numMeasures = Math.max(...allPartResults.map(p => p.measures.length));
	const mergedMeasures: Measure[] = [];

	for (let mi = 0; mi < numMeasures; mi++) {
		const parts: Part[] = [];

		for (const partResult of allPartResults) {
			const sourceMeasure = partResult.measures[mi];
			if (sourceMeasure && sourceMeasure.parts.length > 0) {
				const part = sourceMeasure.parts[0];
				if (partResult.name) {
					part.name = partResult.name;
				}
				parts.push(part);
			} else {
				// Empty part placeholder
				parts.push({ voices: [{ staff: 1, events: [] }] });
			}
		}

		// Use key/timeSig from the first part's measure (they should be consistent)
		const firstPartMeasure = allPartResults[0].measures[mi];
		const measure: Measure = { parts };
		if (firstPartMeasure?.key) measure.key = firstPartMeasure.key;
		if (firstPartMeasure?.timeSig) measure.timeSig = firstPartMeasure.timeSig;

		mergedMeasures.push(measure);
	}

	const result: LilyletDoc = {
		measures: mergedMeasures,
	};

	// Derive the performance order (repeats / voltas / D.C. / D.S. / Coda / Fine)
	// from the first part's barline + <sound> navigation markup → measure-layout
	// string. The MEI encoder turns this into an <expansion> that verovio unfolds
	// for MIDI. Repeat markup is part-global; the first part carries it. Never
	// throws (returns undefined when there is nothing to unfold).
	const measureLayout = measureLayoutFromPart(partEls[0]);
	if (measureLayout) metadata.measureLayout = measureLayout;

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
	const buf = await fs.readFile(filePath); // raw bytes; readXmlString sniffs the encoding
	return decode(buf);
};

export default {
	decode,
	decodeFile,
};
