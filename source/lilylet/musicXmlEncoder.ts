/**
 * Lilylet to MusicXML Encoder
 *
 * Converts LilyletDoc to MusicXML format.
 * Produces valid MusicXML 4.0 partwise documents.
 */

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
	TremoloEvent,
	BarlineEvent,
	HarmonyEvent,
	MarkupEvent,
	Pitch,
	Duration,
	Mark,
	KeySignature,
	Clef,
	StemDirection,
	Accidental,
	Phonet,
	ArticulationType,
	OrnamentType,
	DynamicType,
	HairpinType,
	PedalType,
	Tempo,
	Metadata,
	Fraction,
} from "./types";

import {
	DIVISIONS,
	DIVISION_TO_TYPE,
	calculateDuration,
} from "./musicXmlUtils";


// === Constants and Reverse Mappings ===

// Phonet to MusicXML step
const PHONET_TO_STEP: Record<string, string> = {
	c: 'C',
	d: 'D',
	e: 'E',
	f: 'F',
	g: 'G',
	a: 'A',
	b: 'B',
};

// Accidental to MusicXML alter
const ACCIDENTAL_TO_ALTER: Record<string, number> = {
	sharp: 1,
	flat: -1,
	doubleSharp: 2,
	doubleFlat: -2,
	natural: 0,
};

// Key signature to fifths (major keys)
const KEY_TO_FIFTHS: Record<string, number> = {
	'c': 0,
	'g': 1,
	'd': 2,
	'a': 3,
	'e': 4,
	'b': 5,
	'f#': 6, 'fs': 6,
	'c#': 7, 'cs': 7,
	'f': -1,
	'bb': -2, 'bf': -2,
	'eb': -3, 'ef': -3,
	'ab': -4, 'af': -4,
	'db': -5, 'df': -5,
	'gb': -6, 'gf': -6,
	'cb': -7, 'cf': -7,
};

// Clef to MusicXML sign
const CLEF_TO_SIGN: Record<string, { sign: string; line: number }> = {
	treble: { sign: 'G', line: 2 },
	bass: { sign: 'F', line: 4 },
	alto: { sign: 'C', line: 3 },
};

// Articulation to MusicXML element name
const ARTICULATION_TO_XML: Record<string, string> = {
	staccato: 'staccato',
	staccatissimo: 'staccatissimo',
	tenuto: 'tenuto',
	accent: 'accent',
	marcato: 'strong-accent',
	portato: 'detached-legato',
};

// Ornament to MusicXML element name
const ORNAMENT_TO_XML: Record<string, string> = {
	trill: 'trill-mark',
	turn: 'turn',
	mordent: 'mordent',
	prall: 'inverted-mordent',
};

// Dynamic to MusicXML element name
const DYNAMIC_TO_XML: Record<string, string> = {
	ppp: 'ppp',
	pp: 'pp',
	p: 'p',
	mp: 'mp',
	mf: 'mf',
	f: 'f',
	ff: 'ff',
	fff: 'fff',
	sfz: 'sfz',
	rfz: 'rfz',
};

// Barline style to MusicXML
const BARLINE_TO_XML: Record<string, { barStyle: string; repeat?: string }> = {
	'|': { barStyle: 'regular' },
	'||': { barStyle: 'light-light' },
	'|.': { barStyle: 'light-heavy' },
	'.|:': { barStyle: 'heavy-light', repeat: 'forward' },
	':|.': { barStyle: 'light-heavy', repeat: 'backward' },
	':..:': { barStyle: 'light-heavy', repeat: 'backward' },  // Will need special handling
};


// === XML Helper Functions ===

const escapeXml = (text: string): string => {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
};

const indent = (level: number): string => '  '.repeat(level);


// === Encoding Functions ===

/**
 * Encode pitch to MusicXML
 */
const encodePitch = (pitch: Pitch, level: number): string => {
	const step = PHONET_TO_STEP[pitch.phonet] || 'C';
	const octave = pitch.octave + 4;  // Lilylet octave 0 = MusicXML octave 4
	const alter = pitch.accidental ? ACCIDENTAL_TO_ALTER[pitch.accidental] : undefined;

	let xml = `${indent(level)}<pitch>\n`;
	xml += `${indent(level + 1)}<step>${step}</step>\n`;
	if (alter !== undefined && alter !== 0) {
		xml += `${indent(level + 1)}<alter>${alter}</alter>\n`;
	}
	xml += `${indent(level + 1)}<octave>${octave}</octave>\n`;
	xml += `${indent(level)}</pitch>\n`;

	return xml;
};


/**
 * Encode duration elements
 */
const encodeDuration = (duration: Duration, level: number): string => {
	const dur = calculateDuration(duration);
	const type = DIVISION_TO_TYPE[duration.division] || 'quarter';

	let xml = `${indent(level)}<duration>${dur}</duration>\n`;
	xml += `${indent(level)}<type>${type}</type>\n`;

	for (let i = 0; i < duration.dots; i++) {
		xml += `${indent(level)}<dot/>\n`;
	}

	if (duration.tuplet) {
		// MusicXML: actual-notes = notes played (Lilylet denominator)
		//           normal-notes = normal count (Lilylet numerator)
		// e.g., \times 2/3 → actual=3, normal=2
		xml += `${indent(level)}<time-modification>\n`;
		xml += `${indent(level + 1)}<actual-notes>${duration.tuplet.denominator}</actual-notes>\n`;
		xml += `${indent(level + 1)}<normal-notes>${duration.tuplet.numerator}</normal-notes>\n`;
		xml += `${indent(level)}</time-modification>\n`;
	}

	return xml;
};


/**
 * Encode key signature to fifths
 */
const getKeyFifths = (key: KeySignature): number => {
	let keyStr = key.pitch as string;
	if (key.accidental === Accidental.sharp) {
		keyStr += 's';
	} else if (key.accidental === Accidental.flat) {
		keyStr += 'f';
	}

	let fifths = KEY_TO_FIFTHS[keyStr.toLowerCase()] ?? 0;

	// Adjust for minor mode (relative minor is 3 fifths down)
	if (key.mode === 'minor') {
		// Minor keys have same fifths as their relative major
		// e.g., A minor = C major = 0 fifths
	}

	return fifths;
};


/**
 * Encode attributes element (key, time, clef, divisions)
 */
const encodeAttributes = (
	level: number,
	options: {
		divisions?: boolean;
		key?: KeySignature;
		time?: Fraction;
		clef?: Clef;
		staves?: number;
	}
): string => {
	let xml = `${indent(level)}<attributes>\n`;

	if (options.divisions) {
		xml += `${indent(level + 1)}<divisions>${DIVISIONS}</divisions>\n`;
	}

	if (options.key) {
		const fifths = getKeyFifths(options.key);
		xml += `${indent(level + 1)}<key>\n`;
		xml += `${indent(level + 2)}<fifths>${fifths}</fifths>\n`;
		xml += `${indent(level + 2)}<mode>${options.key.mode}</mode>\n`;
		xml += `${indent(level + 1)}</key>\n`;
	}

	if (options.time) {
		xml += `${indent(level + 1)}<time>\n`;
		xml += `${indent(level + 2)}<beats>${options.time.numerator}</beats>\n`;
		xml += `${indent(level + 2)}<beat-type>${options.time.denominator}</beat-type>\n`;
		xml += `${indent(level + 1)}</time>\n`;
	}

	if (options.staves && options.staves > 1) {
		xml += `${indent(level + 1)}<staves>${options.staves}</staves>\n`;
	}

	if (options.clef) {
		const clefInfo = CLEF_TO_SIGN[options.clef];
		if (clefInfo) {
			xml += `${indent(level + 1)}<clef>\n`;
			xml += `${indent(level + 2)}<sign>${clefInfo.sign}</sign>\n`;
			xml += `${indent(level + 2)}<line>${clefInfo.line}</line>\n`;
			xml += `${indent(level + 1)}</clef>\n`;
		}
	}

	xml += `${indent(level)}</attributes>\n`;

	return xml;
};


/**
 * Encode notations (articulations, ornaments, ties, slurs, etc.)
 */
const encodeNotations = (marks: Mark[], level: number): string => {
	const articulations: string[] = [];
	const ornaments: string[] = [];
	const otherNotations: string[] = [];

	for (const mark of marks) {
		switch (mark.markType) {
			case 'articulation':
				const artXml = ARTICULATION_TO_XML[mark.type];
				if (artXml) {
					articulations.push(`<${artXml}/>`);
				}
				break;

			case 'ornament':
				const ornXml = ORNAMENT_TO_XML[mark.type];
				if (ornXml) {
					if (mark.type === 'fermata') {
						otherNotations.push('<fermata/>');
					} else if (mark.type === 'arpeggio') {
						otherNotations.push('<arpeggiate/>');
					} else {
						ornaments.push(`<${ornXml}/>`);
					}
				}
				break;

			case 'tie':
				otherNotations.push(`<tied type="${mark.start ? 'start' : 'stop'}"/>`);
				break;

			case 'slur':
				otherNotations.push(`<slur type="${mark.start ? 'start' : 'stop'}" number="1"/>`);
				break;

			case 'tuplet' as any:
				otherNotations.push(`<tuplet type="${(mark as any).start ? 'start' : 'stop'}"/>`);
				break;

			case 'fingering':
				// Fingering goes in technical
				break;
		}
	}

	if (articulations.length === 0 && ornaments.length === 0 && otherNotations.length === 0) {
		return '';
	}

	let xml = `${indent(level)}<notations>\n`;

	for (const notation of otherNotations) {
		xml += `${indent(level + 1)}${notation}\n`;
	}

	if (articulations.length > 0) {
		xml += `${indent(level + 1)}<articulations>\n`;
		for (const art of articulations) {
			xml += `${indent(level + 2)}${art}\n`;
		}
		xml += `${indent(level + 1)}</articulations>\n`;
	}

	if (ornaments.length > 0) {
		xml += `${indent(level + 1)}<ornaments>\n`;
		for (const orn of ornaments) {
			xml += `${indent(level + 2)}${orn}\n`;
		}
		xml += `${indent(level + 1)}</ornaments>\n`;
	}

	xml += `${indent(level)}</notations>\n`;

	return xml;
};


/**
 * Encode a note event
 */
const encodeNote = (
	event: NoteEvent,
	voice: number,
	staff: number,
	level: number,
	isChord: boolean = false
): string => {
	let xml = `${indent(level)}<note>\n`;

	if (isChord) {
		xml += `${indent(level + 1)}<chord/>\n`;
	}

	if (event.grace) {
		xml += `${indent(level + 1)}<grace/>\n`;
	}

	// Pitch (use first pitch, additional pitches become chord notes)
	const pitch = isChord ? event.pitches[0] : event.pitches[0];
	xml += encodePitch(pitch, level + 1);

	// Duration (not for grace notes)
	if (!event.grace) {
		xml += encodeDuration(event.duration, level + 1);
	} else {
		// Grace notes still need type
		const type = DIVISION_TO_TYPE[event.duration.division] || 'eighth';
		xml += `${indent(level + 1)}<type>${type}</type>\n`;
	}

	// Tie notation in note element
	const hasTieStart = event.marks?.some(m => m.markType === 'tie' && m.start);
	const hasTieStop = event.marks?.some(m => m.markType === 'tie' && !m.start);
	if (hasTieStart) {
		xml += `${indent(level + 1)}<tie type="start"/>\n`;
	}
	if (hasTieStop) {
		xml += `${indent(level + 1)}<tie type="stop"/>\n`;
	}

	// Voice
	xml += `${indent(level + 1)}<voice>${voice}</voice>\n`;

	// Staff (for grand staff)
	if (staff > 0) {
		xml += `${indent(level + 1)}<staff>${staff}</staff>\n`;
	}

	// Stem direction
	if (event.stemDirection && event.stemDirection !== StemDirection.auto) {
		xml += `${indent(level + 1)}<stem>${event.stemDirection}</stem>\n`;
	}

	// Beam marks
	const beamStart = event.marks?.find(m => m.markType === 'beam' && m.start);
	const beamEnd = event.marks?.find(m => m.markType === 'beam' && !m.start);
	if (beamStart) {
		xml += `${indent(level + 1)}<beam number="1">begin</beam>\n`;
	} else if (beamEnd) {
		xml += `${indent(level + 1)}<beam number="1">end</beam>\n`;
	}

	// Notations
	if (event.marks && event.marks.length > 0) {
		xml += encodeNotations(event.marks, level + 1);
	}

	xml += `${indent(level)}</note>\n`;

	return xml;
};


/**
 * Encode a rest event
 */
const encodeRest = (
	event: RestEvent,
	voice: number,
	staff: number,
	level: number
): string => {
	let xml = `${indent(level)}<note>\n`;

	xml += `${indent(level + 1)}<rest`;
	if (event.fullMeasure) {
		xml += ' measure="yes"';
	}
	xml += '/>\n';

	xml += encodeDuration(event.duration, level + 1);

	xml += `${indent(level + 1)}<voice>${voice}</voice>\n`;

	if (staff > 0) {
		xml += `${indent(level + 1)}<staff>${staff}</staff>\n`;
	}

	xml += `${indent(level)}</note>\n`;

	return xml;
};


/**
 * Encode a rest event with tuplet notation start/stop
 */
const encodeRestWithTuplet = (
	event: RestEvent,
	voice: number,
	staff: number,
	level: number,
	isFirst: boolean,
	isLast: boolean
): string => {
	let xml = `${indent(level)}<note>\n`;

	xml += `${indent(level + 1)}<rest`;
	if (event.fullMeasure) {
		xml += ' measure="yes"';
	}
	xml += '/>\n';

	xml += encodeDuration(event.duration, level + 1);

	xml += `${indent(level + 1)}<voice>${voice}</voice>\n`;

	if (staff > 0) {
		xml += `${indent(level + 1)}<staff>${staff}</staff>\n`;
	}

	// Add tuplet notations
	xml += `${indent(level + 1)}<notations>\n`;
	if (isFirst) {
		xml += `${indent(level + 2)}<tuplet type="start"/>\n`;
	}
	if (isLast) {
		xml += `${indent(level + 2)}<tuplet type="stop"/>\n`;
	}
	xml += `${indent(level + 1)}</notations>\n`;

	xml += `${indent(level)}</note>\n`;

	return xml;
};


/**
 * Encode direction element (dynamics, tempo, etc.)
 */
const encodeDirection = (
	marks: Mark[],
	level: number
): string => {
	let xml = '';

	for (const mark of marks) {
		if (mark.markType === 'dynamic') {
			const dynXml = DYNAMIC_TO_XML[mark.type];
			if (dynXml) {
				xml += `${indent(level)}<direction placement="below">\n`;
				xml += `${indent(level + 1)}<direction-type>\n`;
				xml += `${indent(level + 2)}<dynamics>\n`;
				xml += `${indent(level + 3)}<${dynXml}/>\n`;
				xml += `${indent(level + 2)}</dynamics>\n`;
				xml += `${indent(level + 1)}</direction-type>\n`;
				xml += `${indent(level)}</direction>\n`;
			}
		} else if (mark.markType === 'hairpin') {
			let wedgeType = '';
			if (mark.type === HairpinType.crescendoStart) {
				wedgeType = 'crescendo';
			} else if (mark.type === HairpinType.diminuendoStart) {
				wedgeType = 'diminuendo';
			} else if (mark.type === HairpinType.crescendoEnd || mark.type === HairpinType.diminuendoEnd) {
				wedgeType = 'stop';
			}
			if (wedgeType) {
				xml += `${indent(level)}<direction>\n`;
				xml += `${indent(level + 1)}<direction-type>\n`;
				xml += `${indent(level + 2)}<wedge type="${wedgeType}"/>\n`;
				xml += `${indent(level + 1)}</direction-type>\n`;
				xml += `${indent(level)}</direction>\n`;
			}
		} else if (mark.markType === 'pedal') {
			let pedalType = '';
			if (mark.type === PedalType.sustainOn) {
				pedalType = 'start';
			} else if (mark.type === PedalType.sustainOff) {
				pedalType = 'stop';
			}
			if (pedalType) {
				xml += `${indent(level)}<direction>\n`;
				xml += `${indent(level + 1)}<direction-type>\n`;
				xml += `${indent(level + 2)}<pedal type="${pedalType}"/>\n`;
				xml += `${indent(level + 1)}</direction-type>\n`;
				xml += `${indent(level)}</direction>\n`;
			}
		}
	}

	return xml;
};


/**
 * Encode tempo marking
 */
const encodeTempo = (tempo: Tempo, level: number): string => {
	let xml = `${indent(level)}<direction placement="above">\n`;
	xml += `${indent(level + 1)}<direction-type>\n`;

	if (tempo.beat && tempo.bpm) {
		xml += `${indent(level + 2)}<metronome>\n`;
		const beatUnit = DIVISION_TO_TYPE[tempo.beat.division] || 'quarter';
		xml += `${indent(level + 3)}<beat-unit>${beatUnit}</beat-unit>\n`;
		if (tempo.beat.dots) {
			for (let i = 0; i < tempo.beat.dots; i++) {
				xml += `${indent(level + 3)}<beat-unit-dot/>\n`;
			}
		}
		xml += `${indent(level + 3)}<per-minute>${tempo.bpm}</per-minute>\n`;
		xml += `${indent(level + 2)}</metronome>\n`;
	}

	if (tempo.text) {
		xml += `${indent(level + 2)}<words>${escapeXml(tempo.text)}</words>\n`;
	}

	xml += `${indent(level + 1)}</direction-type>\n`;

	if (tempo.bpm) {
		xml += `${indent(level + 1)}<sound tempo="${tempo.bpm}"/>\n`;
	}

	xml += `${indent(level)}</direction>\n`;

	return xml;
};


/**
 * Encode barline
 */
const encodeBarline = (event: BarlineEvent, level: number): string => {
	const barInfo = BARLINE_TO_XML[event.style];
	if (!barInfo || event.style === '|') {
		return '';  // Regular barline, no need to encode
	}

	let xml = `${indent(level)}<barline location="right">\n`;
	xml += `${indent(level + 1)}<bar-style>${barInfo.barStyle}</bar-style>\n`;

	if (barInfo.repeat) {
		xml += `${indent(level + 1)}<repeat direction="${barInfo.repeat}"/>\n`;
	}

	xml += `${indent(level)}</barline>\n`;

	return xml;
};


/**
 * Encode harmony (chord symbol)
 */
const encodeHarmony = (event: HarmonyEvent, level: number): string => {
	// Simple text-based harmony for now
	let xml = `${indent(level)}<harmony>\n`;
	xml += `${indent(level + 1)}<root>\n`;
	xml += `${indent(level + 2)}<root-step>C</root-step>\n`;  // Placeholder
	xml += `${indent(level + 1)}</root>\n`;
	xml += `${indent(level + 1)}<kind text="${escapeXml(event.text)}">major</kind>\n`;
	xml += `${indent(level)}</harmony>\n`;

	return xml;
};


/**
 * Encode a complete measure for a single part
 */
const encodeMeasure = (
	measure: Measure,
	partIndex: number,
	measureNumber: number,
	isFirst: boolean,
	prevKey: KeySignature | undefined,
	prevTime: Fraction | undefined,
	level: number
): string => {
	let xml = `${indent(level)}<measure number="${measureNumber}">\n`;

	const part = measure.parts[partIndex];
	if (!part) {
		xml += `${indent(level)}</measure>\n`;
		return xml;
	}

	// Determine if we need attributes
	const needAttributes = isFirst ||
		(measure.key && JSON.stringify(measure.key) !== JSON.stringify(prevKey)) ||
		(measure.timeSig && JSON.stringify(measure.timeSig) !== JSON.stringify(prevTime));

	// Find max staff number within this part
	let maxStaff = 1;
	for (const voice of part.voices) {
		maxStaff = Math.max(maxStaff, voice.staff || 1);
	}

	// Encode attributes if needed
	if (needAttributes) {
		// Find clef from first voice of this part
		let clef: Clef | undefined;
		for (const voice of part.voices) {
			for (const event of voice.events) {
				if (event.type === 'context' && event.clef) {
					clef = event.clef;
					break;
				}
			}
			if (clef) break;
		}

		xml += encodeAttributes(level + 1, {
			divisions: isFirst,
			key: measure.key || prevKey,
			time: measure.timeSig || prevTime,
			clef: clef,
			staves: maxStaff > 1 ? maxStaff : undefined,
		});
	}

	// Encode voices (voice numbering starts at 1 for each part)
	let voiceNum = 1;
	let currentPosition = 0;

	for (const voice of part.voices) {
		let currentStaff = voice.staff || 1;
		let voicePosition = 0;

		// Backup if needed
		if (currentPosition > 0 && voiceNum > 1) {
			xml += `${indent(level + 1)}<backup>\n`;
			xml += `${indent(level + 2)}<duration>${currentPosition}</duration>\n`;
			xml += `${indent(level + 1)}</backup>\n`;
			voicePosition = 0;
		}

		for (const event of voice.events) {
			switch (event.type) {
				case 'note': {
					// Check for direction marks (dynamics, hairpins, pedals)
					const directionMarks = event.marks?.filter(m =>
						m.markType === 'dynamic' || m.markType === 'hairpin' || m.markType === 'pedal'
					) || [];
					if (directionMarks.length > 0) {
						xml += encodeDirection(directionMarks, level + 1);
					}

					// Encode main note
					xml += encodeNote(event, voiceNum, currentStaff, level + 1);
					const dur = calculateDuration(event.duration);
					voicePosition += dur;

					// Encode chord notes
					for (let i = 1; i < event.pitches.length; i++) {
						const chordEvent: NoteEvent = {
							...event,
							pitches: [event.pitches[i]],
						};
						xml += encodeNote(chordEvent, voiceNum, currentStaff, level + 1, true);
					}
					break;
				}

				case 'rest': {
					xml += encodeRest(event, voiceNum, currentStaff, level + 1);
					const dur = calculateDuration(event.duration);
					voicePosition += dur;
					break;
				}

				case 'context': {
					if (event.tempo) {
						xml += encodeTempo(event.tempo, level + 1);
					}
					if (event.staff) {
						currentStaff = event.staff;
					}
					// Other context changes are handled in attributes
					break;
				}

				case 'tuplet': {
					const tupletEvents = event.events;
					for (let ti = 0; ti < tupletEvents.length; ti++) {
						const subEvent = tupletEvents[ti];
						// Set tuplet ratio on duration so encodeDuration emits <time-modification>
						const originalTuplet = subEvent.duration.tuplet;
						subEvent.duration.tuplet = event.ratio;

						const isFirst = ti === 0;
						const isLast = ti === tupletEvents.length - 1;

						if (subEvent.type === 'note') {
							// Add tuplet notation marks
							const tupletMarks: Mark[] = [];
							if (isFirst) tupletMarks.push({ markType: 'tuplet', start: true } as any);
							if (isLast) tupletMarks.push({ markType: 'tuplet', start: false } as any);

							if (tupletMarks.length > 0) {
								const origMarks = subEvent.marks;
								subEvent.marks = [...(subEvent.marks || []), ...tupletMarks];
								xml += encodeNote(subEvent, voiceNum, currentStaff, level + 1);
								subEvent.marks = origMarks;
							} else {
								xml += encodeNote(subEvent, voiceNum, currentStaff, level + 1);
							}
							const dur = calculateDuration(subEvent.duration);
							voicePosition += dur;
						} else if (subEvent.type === 'rest') {
							if (isFirst || isLast) {
								xml += encodeRestWithTuplet(subEvent, voiceNum, currentStaff, level + 1, isFirst, isLast);
							} else {
								xml += encodeRest(subEvent, voiceNum, currentStaff, level + 1);
							}
							const dur = calculateDuration(subEvent.duration);
							voicePosition += dur;
						}

						// Restore original tuplet value
						subEvent.duration.tuplet = originalTuplet;
					}
					break;
				}

				case 'barline': {
					xml += encodeBarline(event, level + 1);
					break;
				}

				case 'harmony': {
					xml += encodeHarmony(event, level + 1);
					break;
				}
			}
		}

		currentPosition = Math.max(currentPosition, voicePosition);
		voiceNum++;
	}

	xml += `${indent(level)}</measure>\n`;

	return xml;
};


/**
 * Encode metadata to MusicXML elements
 */
const encodeMetadata = (metadata: Metadata, level: number): string => {
	let xml = '';

	if (metadata.title) {
		xml += `${indent(level)}<work>\n`;
		xml += `${indent(level + 1)}<work-title>${escapeXml(metadata.title)}</work-title>\n`;
		xml += `${indent(level)}</work>\n`;
	}

	xml += `${indent(level)}<identification>\n`;

	if (metadata.composer) {
		xml += `${indent(level + 1)}<creator type="composer">${escapeXml(metadata.composer)}</creator>\n`;
	}
	if (metadata.arranger) {
		xml += `${indent(level + 1)}<creator type="arranger">${escapeXml(metadata.arranger)}</creator>\n`;
	}
	if (metadata.lyricist) {
		xml += `${indent(level + 1)}<creator type="lyricist">${escapeXml(metadata.lyricist)}</creator>\n`;
	}

	xml += `${indent(level + 1)}<encoding>\n`;
	xml += `${indent(level + 2)}<software>Lilylet</software>\n`;
	xml += `${indent(level + 2)}<encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>\n`;
	xml += `${indent(level + 1)}</encoding>\n`;

	xml += `${indent(level)}</identification>\n`;

	return xml;
};


/**
 * Encode complete LilyletDoc to MusicXML
 */
export const encode = (doc: LilyletDoc): string => {
	let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
	xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
	xml += '<score-partwise version="4.0">\n';

	// Metadata
	if (doc.metadata) {
		xml += encodeMetadata(doc.metadata, 1);
	}

	// Determine number of parts from first measure
	const numParts = doc.measures.length > 0 ? doc.measures[0].parts.length : 1;

	// Part list
	xml += `${indent(1)}<part-list>\n`;
	for (let pi = 0; pi < numParts; pi++) {
		const partId = `P${pi + 1}`;
		const partName = doc.measures[0]?.parts[pi]?.name
			|| (numParts === 1 ? (doc.metadata?.title ? escapeXml(doc.metadata.title) : 'Music') : `Part ${pi + 1}`);
		xml += `${indent(2)}<score-part id="${partId}">\n`;
		xml += `${indent(3)}<part-name>${escapeXml(partName)}</part-name>\n`;
		xml += `${indent(2)}</score-part>\n`;
	}
	xml += `${indent(1)}</part-list>\n`;

	// Encode each part
	for (let pi = 0; pi < numParts; pi++) {
		const partId = `P${pi + 1}`;
		xml += `${indent(1)}<part id="${partId}">\n`;

		let prevKey: KeySignature | undefined;
		let prevTime: Fraction | undefined;

		for (let i = 0; i < doc.measures.length; i++) {
			const measure = doc.measures[i];
			const isFirst = i === 0;

			xml += encodeMeasure(measure, pi, i + 1, isFirst, prevKey, prevTime, 2);

			if (measure.key) prevKey = measure.key;
			if (measure.timeSig) prevTime = measure.timeSig;
		}

		xml += `${indent(1)}</part>\n`;
	}

	xml += '</score-partwise>\n';

	return xml;
};


export default {
	encode,
};
