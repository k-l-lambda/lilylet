/**
 * The suffix grammar in source/lilylet/clefTransposition.ts, which is the single
 * place that converts between a transposing-clef suffix and a semitone count.
 *
 * Three properties matter and are asserted separately:
 *
 *   1. BACKWARD COMPATIBILITY — every suffix that existed before the `m` form was
 *      added keeps its original meaning, so documents already in circulation are
 *      read exactly as they were written.
 *   2. EXACTNESS — semitones → suffix → semitones is the identity wherever a
 *      suffix exists, and returns undefined rather than an approximation where one
 *      does not. The old code approximated and silently shifted sounding pitch.
 *   3. VALIDITY — `m` is accepted only on intervals that have a minor form, and a
 *      malformed suffix declares no shift instead of being mis-read.
 *
 * Usage: npx tsx tests/unit/clefTransposition.test.ts
 */

import {
	clefBaseName,
	clefSuffixSemitones,
	clefSuffixTransposition,
	parseClefSuffix,
	semitonesToClefSuffix,
	withClefTransposition,
} from '../../source/lilylet/clefTransposition';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}


// ── 1. Backward compatibility ─────────────────────────────────────────────────
// These are the only suffix forms that could appear in a document written before
// `m` existed. Each must still mean what it meant then — a plain number is the
// MAJOR/PERFECT interval, never the minor one.
console.log('\nPre-existing suffixes keep their original meaning');
{
	const legacy: Array<[string, number]> = [
		['treble', 0],			// no suffix
		['bass', 0],
		['alto', 0],
		['treble_8', -12],		// octave down
		['treble^8', 12],		// octave up
		['bass_8', -12],
		['treble_15', -24],		// two octaves down
		['treble_2', -2],		// major second
		['treble_3', -4],		// MAJOR third (not the minor -3)
		['treble_4', -5],		// perfect fourth
		['treble_5', -7],		// perfect fifth
		['treble_6', -9],		// major sixth
		['treble_7', -11],		// major seventh
		['treble^2', 2],
		['treble^3', 4],
		['treble_9', -14],		// compound: major ninth
	];
	for (const [clef, expected] of legacy) {
		assert(clefSuffixSemitones(clef) === expected,
			`"${clef}" → ${expected} semitones (got ${clefSuffixSemitones(clef)})`);
	}

	// The base name is recovered independently of the suffix, so clef-shape lookup
	// keeps working for every form.
	assert(clefBaseName('treble_8') === 'treble', 'base of treble_8 is treble');
	assert(clefBaseName('bass^15') === 'bass', 'base of bass^15 is bass');
	assert(clefBaseName('treble_m3') === 'treble', 'base of treble_m3 is treble');
	assert(clefBaseName('alto') === 'alto', 'a plain clef is its own base');
}


// ── 2. The minor form, and why it exists ──────────────────────────────────────
// A plain diatonic number cannot express a minor interval, so 1 / 3 / 8 / 10
// semitones had no suffix and were rounded to the neighbouring major interval.
console.log('\nThe `m` form reaches the minor intervals');
{
	const minorCases: Array<[string, number, string]> = [
		['treble_m2', -1, 'minor second'],
		['treble_m3', -3, 'minor third — the A clarinet'],
		['treble_m6', -8, 'minor sixth'],
		['treble_m7', -10, 'minor seventh'],
		['treble^m2', 1, 'minor second up'],
		['treble^m3', 3, 'minor third up'],
		['treble_m9', -13, 'compound: minor ninth'],
		['treble_m10', -15, 'compound: minor tenth'],
	];
	for (const [clef, expected, label] of minorCases) {
		assert(clefSuffixSemitones(clef) === expected,
			`"${clef}" → ${expected} (${label}) — got ${clefSuffixSemitones(clef)}`);
	}

	// Each minor interval is exactly one semitone narrower than its major form,
	// and the two are distinct suffixes. -8 and -9 used to collide on _6.
	const pairs: Array<[string, string]> = [
		['treble_m2', 'treble_2'], ['treble_m3', 'treble_3'],
		['treble_m6', 'treble_6'], ['treble_m7', 'treble_7'],
	];
	for (const [minor, major] of pairs) {
		assert(clefSuffixSemitones(minor) === clefSuffixSemitones(major) + 1,
			`${minor} is one semitone narrower than ${major}`);
	}

	// MEI needs diat and semi separately; a minor interval is precisely the case
	// where they differ, which is the information the number alone cannot carry.
	assert(JSON.stringify(clefSuffixTransposition('treble_m3')) === JSON.stringify({ diat: -2, semi: -3 }),
		'treble_m3 → {diat:-2, semi:-3} for MEI att.transposition');
	assert(JSON.stringify(clefSuffixTransposition('treble_3')) === JSON.stringify({ diat: -2, semi: -4 }),
		'treble_3 → {diat:-2, semi:-4}: same diat, different semi');
	assert(JSON.stringify(clefSuffixTransposition('treble_8')) === JSON.stringify({ diat: -7, semi: -12 }),
		'treble_8 → {diat:-7, semi:-12}');
	assert(clefSuffixTransposition('treble') === undefined,
		'a plain clef declares no transposition at all');
}


// ── 3. Validity: `m` only where a minor form exists ───────────────────────────
// Unison, fourth, fifth and octave are PERFECT intervals with no minor form, so
// `_m4` is not a narrower fourth — it is malformed. Such a suffix must declare no
// shift rather than being silently interpreted, since a wrong shift is a wrong
// sounding pitch.
console.log('\nMalformed suffixes are rejected, not mis-read');
{
	for (const bogus of ['treble_m1', 'treble_m4', 'treble_m5', 'treble_m8', 'treble_m11', 'treble_m12', 'treble^m4']) {
		assert(parseClefSuffix(bogus) === undefined, `${bogus} does not parse`);
		assert(clefSuffixSemitones(bogus) === 0, `${bogus} declares no shift`);
		assert(clefSuffixTransposition(bogus) === undefined, `${bogus} yields no MEI transposition`);
	}

	// Shapes that are not a suffix at all.
	for (const notSuffix of ['treble', 'treble_0', 'treble_08', 'treble_', 'treble_x3', 'treble-8', '']) {
		assert(clefSuffixSemitones(notSuffix) === 0,
			`${JSON.stringify(notSuffix)} declares no shift`);
	}

	// Interval numbers that DO have a minor form parse with m.
	for (const good of ['treble_m2', 'treble_m3', 'treble_m6', 'treble_m7', 'treble_m9', 'treble_m13', 'treble_m14']) {
		assert(parseClefSuffix(good) !== undefined, `${good} parses`);
	}
}


// ── 4. Exactness of semitones → suffix ────────────────────────────────────────
// The producing direction must never approximate. Everything within two octaves
// round-trips exactly, except the tritone, which is neither major/perfect nor
// minor and therefore has no suffix — reported as undefined so the caller can drop
// the transposition instead of emitting a wrong one.
console.log('\nsemitones → suffix is exact, or absent');
{
	const TRITONES = new Set([6, -6, 18, -18]);
	let exact = 0;
	let absent = 0;
	let wrong = 0;

	for (let semi = -24; semi <= 24; semi++) {
		if (semi === 0) continue;
		const suffix = semitonesToClefSuffix(semi);
		if (suffix === undefined) {
			absent++;
			if (!TRITONES.has(semi)) {
				console.error(`  ✗ FAIL: ${semi} semitones has no suffix but is not a tritone`);
				failed++;
			}
			continue;
		}
		const back = clefSuffixSemitones('treble' + suffix);
		if (back === semi) exact++;
		else { wrong++; console.error(`  ✗ FAIL: ${semi} → ${suffix} → ${back}`); failed++; }
	}

	assert(wrong === 0, `every representable shift round-trips exactly (${exact} values)`);
	assert(absent === TRITONES.size,
		`only the tritones are unrepresentable (${absent} of 48 values)`);
	assert(semitonesToClefSuffix(6) === undefined && semitonesToClefSuffix(-6) === undefined,
		'the tritone yields undefined rather than a rounded suffix');

	// The specific values the ABC corpora declare, including every minor one.
	const corpus: Array<[number, string]> = [
		[2, '^2'], [-2, '_2'], [-3, '_m3'], [-5, '_4'], [-7, '_5'],
		[-8, '_m6'], [-9, '_6'], [-10, '_m7'], [-12, '_8'], [-14, '_9'],
	];
	for (const [semi, expected] of corpus) {
		assert(semitonesToClefSuffix(semi) === expected,
			`${semi} → "${expected}" (got ${semitonesToClefSuffix(semi)})`);
	}

	// withClefTransposition composes base + suffix, and passes the gap through.
	assert(withClefTransposition('treble', -3) === 'treble_m3', 'withClefTransposition builds treble_m3');
	assert(withClefTransposition('bass', -12) === 'bass_8', 'withClefTransposition builds bass_8');
	assert(withClefTransposition('treble', 0) === 'treble', 'a zero shift leaves the clef untouched');
	assert(withClefTransposition('treble', 6) === undefined, 'an unrepresentable shift returns undefined');
	assert(withClefTransposition('treble', 1.5) === undefined, 'a non-integer shift returns undefined');
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
