/**
 * Reproduces the four defects found on the abc→lyl transposing-clef path.
 *
 * An ABC voice declares its written→sounding shift in SEMITONES (`transpose=-3`).
 * abcDecoder folds that into a lilylet clef suffix (`_N`/`^N`), which carries a
 * DIATONIC interval number, and onsets.clefShift turns the suffix back into
 * semitones. Each stage below is asserted separately so a regression names its
 * own stage instead of surfacing as a vague pitch mismatch.
 *
 * Cases 1 and 2 assert CURRENT (defective) behaviour and are marked KNOWN-BUG:
 * they are here to pin the defect and must be inverted when it is fixed, not
 * deleted. Cases 3 and 4 assert correct behaviour that must not regress.
 *
 * Usage: npx tsx tests/unit/abcTransposingClef.test.ts
 */

import { abcDecoder } from '../../source/lilylet';
import { clefShift, measureOnsets } from '../../source/lilylet/onsets';
import { ContextChange, LilyletDoc } from '../../source/lilylet/types';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

// Every clef emitted anywhere in the doc, in document order.
const clefsOf = (doc: LilyletDoc): string[] => {
	const out: string[] = [];
	for (const measure of doc.measures)
		for (const part of measure.parts)
			for (const voice of part.voices)
				for (const event of voice.events)
					if (event.type === 'context' && (event as ContextChange).clef)
						out.push((event as ContextChange).clef as string);
	return out;
};

// Sounding MIDI of every note, via the authoritative onsets walk (applies clefShift).
const soundingMidi = (doc: LilyletDoc): number[] =>
	measureOnsets(doc).flatMap(measure => measure.notes.flatMap(note => note.midi));

// A one-voice tune whose only variable is the V: property string. Two identical
// measures so measure 0 is never the only measure carrying content.
const oneVoice = (props: string): string =>
	`X:1\n%%score (1)\nL:1/4\nM:4/4\nV:1 ${props}\nK:C\n[V:1] c c c c |\n[V:1] c c c c |\n`;


// ── Case 1 ────────────────────────────────────────────────────────────────────
// KNOWN BUG (dominant, 37.3% of transposing voices in the nota-src corpus).
// transposeClefSuffix approximates semitones as round(semi * 7/12) diatonic
// steps. That is exact for perfect/major intervals and loses one semitone
// otherwise, so the sounding pitch is wrong by -1 for -3 / -8 / -10.
console.log('\nCase 1 — semitone→diatonic approximation (KNOWN BUG: off by one)');
{
	// [declared semitones, suffix currently emitted, semitones it round-trips to]
	const cases: Array<[number, string, number]> = [
		[-2, 'treble_2', -2],		// B-flat instruments: exact
		[-3, 'treble_3', -4],		// A clarinet: WRONG by -1
		[-7, 'treble_5', -7],		// F horn: exact
		[-8, 'treble_6', -9],		// WRONG by -1
		[-9, 'treble_6', -9],		// exact — and collides with -8 above
		[-10, 'treble_7', -11],		// E-flat instruments: WRONG by -1
		[-12, 'treble_8', -12],		// octave: exact
		[2, 'treble^2', 2],			// exact
	];

	for (const [semi, expectedClef, roundTrip] of cases) {
		const doc = abcDecoder.decode(oneVoice(`treble transpose=${semi}`));
		const clefs = clefsOf(doc);
		assert(clefs[0] === expectedClef,
			`transpose=${semi} emits ${expectedClef} (got ${clefs[0]})`);
		assert(clefShift(expectedClef) === roundTrip,
			`${expectedClef} round-trips to ${roundTrip} semitones` +
			(roundTrip === semi ? '' : ` — LOSSY, declared ${semi}`));
	}

	// -8 and -9 are distinct instrument transpositions that collapse onto one suffix.
	assert(clefShift('treble_6') === -9,
		'-8 and -9 both map to treble_6, so -8 is unrecoverable');

	// The error reaches sounding pitch: written c' = MIDI 72, A clarinet sounds 69.
	const doc = abcDecoder.decode(oneVoice('treble transpose=-3'));
	const midi = soundingMidi(doc);
	assert(midi.length === 8, `all 8 notes present (got ${midi.length})`);
	assert(midi[0] === 68,
		`written c'=72 with transpose=-3 currently sounds 68 (correct is 69) — got ${midi[0]}`);
	assert(new Set(midi).size === 1, 'the shift is constant across the voice');
}


// ── Case 2 ────────────────────────────────────────────────────────────────────
// KNOWN BUG (0.6% of transposing corpus files, catastrophic per file).
// An `I:` header field is not consumed as a header field, so it degenerates into
// a phantom body measure 0 holding one patch with no voice number. The clef
// emission loop is gated on `mi === 0`, so it only ever fires inside that phantom
// measure — every voice but the first loses its clef, and with it its transposition.
console.log('\nCase 2 — `I:` header field collapses parts and drops clefs (KNOWN BUG)');
{
	const twoVoices = (extraHeader: string): string =>
		`X:1\n%%score (1) (2)\nL:1/4\nM:4/4\nV:1 treble transpose=-2\n${extraHeader}V:2 treble transpose=-7\nK:C\n` +
		`[V:1] c c c c |[V:2] c c c c |\n[V:1] c c c c |[V:2] c c c c |\n`;

	// Baseline: without the I: field both voices keep their own transposing clef.
	{
		const doc = abcDecoder.decode(twoVoices(''));
		const clefs = clefsOf(doc);
		assert(doc.measures[0].parts.length === 2,
			`baseline: 2 parts (got ${doc.measures[0].parts.length})`);
		assert(clefs.join(',') === 'treble_2,treble_5',
			`baseline: both clefs emitted (got ${clefs.join(',') || 'none'})`);
		assert(clefShift(clefs[0]) === -2 && clefShift(clefs[1]) === -7,
			'baseline: both shifts reach onsets (-2, -7)');
	}

	// With `I:percmap` in the header, voice 2's clef and transposition vanish.
	{
		const doc = abcDecoder.decode(twoVoices('I:percmap E B 35 none\n'));
		const clefs = clefsOf(doc);
		assert(doc.measures[0].parts.length === 1,
			`I: field collapses 2 parts into ${doc.measures[0].parts.length} (currently 1)`);
		assert(clefs.length === 1,
			`only ${clefs.length} clef survives (currently 1 of 2)`);
		assert(!clefs.some(c => clefShift(c) === -7),
			"voice 2's transpose=-7 is lost entirely");
	}
}


// ── Case 3 ────────────────────────────────────────────────────────────────────
// KNOWN BUG (mechanism confirmed; 0 occurrences observed in the nota-src corpus
// because orchestral arc-mates declare identical clefs). The clef loop scans for
// the FIRST voice matching (partIndex, staff) and breaks, and Voice carries no
// voice number, so arc-mates sharing a staff all inherit the first voice's clef —
// the WRONG clef, not a missing one.
console.log('\nCase 3 — grouped %%score arc-mates inherit the first clef (KNOWN BUG)');
{
	// Arc ( 1 2 ) puts both voices on ONE staff; they declare different clefs.
	const grouped = `X:1\n%%score ( 1 2 )\nL:1/4\nM:4/4\nV:1 treble\nV:2 bass-8\nK:C\n` +
		`[V:1] c c c c |[V:2] C C C C |\n[V:1] c c c c |[V:2] C C C C |\n`;
	const doc = abcDecoder.decode(grouped);
	const clefs = clefsOf(doc);

	assert(clefs.length === 2, `both voices get a clef event (got ${clefs.length})`);
	assert(clefs[0] === 'treble', `voice 1 keeps treble (got ${clefs[0]})`);
	assert(clefs[1] === 'treble',
		`voice 2 declared bass-8 but currently inherits treble (got ${clefs[1]})`);
	assert(clefShift(clefs[1]) === 0,
		"voice 2's -12 octave shift is lost (inherited clef has shift 0)");

	// Separate staves take the same declarations correctly — the arc is the trigger.
	const separate = `X:1\n%%score (1) (2)\nL:1/4\nM:4/4\nV:1 treble\nV:2 bass-8\nK:C\n` +
		`[V:1] c c c c |[V:2] C C C C |\n[V:1] c c c c |[V:2] C C C C |\n`;
	const sepClefs = clefsOf(abcDecoder.decode(separate));
	assert(sepClefs.join(',') === 'treble,bass_8',
		`separate staves keep both clefs (got ${sepClefs.join(',')})`);
	assert(clefShift(sepClefs[1]) === -12, 'bass_8 sounds an octave lower');
}


// ── Case 4 ────────────────────────────────────────────────────────────────────
// Correct behaviour that must not regress: the ordinary orchestral shape, where
// each arc pairs two voices with IDENTICAL clef declarations. This is 96% of the
// corpus and is exactly what masks Case 3, so it is asserted explicitly.
console.log('\nCase 4 — ordinary orchestral score keeps every transposition (must not regress)');
{
	const score = `X:1
%%score [ ( 1 2 ) | ( 3 4 ) | ( 5 6 ) ] [ ( 7 8 ) ] 9
L:1/4
M:4/4
V:1 treble nm="Flauti" snm="Fl."
V:2 treble
V:3 treble transpose=-2 nm="Clarinetti in B" snm="Cl."
V:4 treble transpose=-2
V:5 bass nm="Fagotti" snm="Fag."
V:6 bass
V:7 treble transpose=-7 nm="Corni in F" snm="Cor."
V:8 treble transpose=-7
V:9 bass transpose=-12 nm="Contrabasso" snm="Cb."
K:C
[V:1] c c c c |[V:2] c c c c |[V:3] c c c c |[V:4] c c c c |[V:5] C C C C |[V:6] C C C C |[V:7] c c c c |[V:8] c c c c |[V:9] C C C C |
[V:1] c c c c |[V:2] c c c c |[V:3] c c c c |[V:4] c c c c |[V:5] C C C C |[V:6] C C C C |[V:7] c c c c |[V:8] c c c c |[V:9] C C C C |
`;
	const doc = abcDecoder.decode(score);
	const clefs = clefsOf(doc);

	// 5 parts: three arc-pairs, one arc-pair, one bare leaf.
	assert(doc.measures[0].parts.length === 5,
		`5 parts decoded (got ${doc.measures[0].parts.length})`);
	assert(clefs.length === 9, `all 9 voices get a clef (got ${clefs.length})`);

	// Exact clefs, in voice order. -2 and -7 and -12 are all perfect/major, so the
	// approximation of Case 1 happens to be lossless here.
	assert(clefs.join(',') === 'treble,treble,treble_2,treble_2,bass,bass,treble_5,treble_5,bass_8',
		`each voice keeps its own clef (got ${clefs.join(',')})`);

	// The shifts survive all the way into sounding pitch.
	const shifts = clefs.map(clefShift);
	assert(JSON.stringify(shifts) === JSON.stringify([0, 0, -2, -2, 0, 0, -7, -7, -12]),
		`shifts reach onsets as declared (got ${JSON.stringify(shifts)})`);

	// Non-zero transpositions are actually applied, not merely recorded on the clef.
	// onsets numbers voices globally 0..8 here (every part holds one staff), so the
	// sounding pitch is checked per voice index rather than per staff.
	const midiByVoice = new Map<number, Set<number>>();
	for (const measure of measureOnsets(doc))
		for (const note of measure.notes) {
			if (!midiByVoice.has(note.voice)) midiByVoice.set(note.voice, new Set());
			for (const m of note.midi) midiByVoice.get(note.voice)!.add(m);
		}
	const soundingOf = (voice: number): number[] => [...(midiByVoice.get(voice) ?? [])];

	// written c' = 72 → B-flat clarinet 70, F horn 65; written C = 60 → contrabass 48.
	const expectedByVoice: Array<[number, number, string]> = [
		[0, 72, 'flute (no transposition)'],
		[2, 70, 'B-flat clarinet (-2)'],
		[4, 60, 'bassoon (no transposition)'],
		[6, 65, 'F horn (-7)'],
		[8, 48, 'contrabass (-12)'],
	];
	for (const [voice, expected, label] of expectedByVoice) {
		const sounding = soundingOf(voice);
		assert(sounding.length === 1 && sounding[0] === expected,
			`${label} sounds ${expected} (got ${sounding.join(',') || 'nothing'})`);
	}

	// The instrument names ride along on the same voices, so a clef fix must not
	// disturb them.
	assert(doc.metadata?.instruments?.['3']?.name === 'Clarinetti in B',
		'instrument name preserved alongside the transposing clef');
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
