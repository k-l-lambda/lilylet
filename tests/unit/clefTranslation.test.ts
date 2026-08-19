/**
 * A transposing clef's shift must survive every conversion lilylet offers, not just
 * the .lyl round trip. The suffix means a written→sounding shift, and each target
 * format states that differently:
 *
 *   MEI         att.transposition — trans.diat + trans.semi, a signed pair
 *   MusicXML    <transpose> — diatonic + chromatic + octave-change
 *   LilyPond    \transposition <pitch> — a pitch, NOT the clef suffix
 *
 * The LilyPond case is the one that bites. There a clef suffix is purely
 * NOTATIONAL: it repositions middle C and moves no pitch at all, so a suffix alone
 * would render correctly and play a transposition out of tune. Sounding pitch lives
 * on the separate `\transposition`, which reaches every semitone. The two are
 * orthogonal, so a lilylet clef translates to BOTH — and must never be counted
 * twice when read back.
 *
 * Each of the three defects this pins was a silent loss: the clef came out plain, or
 * vanished entirely, and the pitch error only showed up on playback.
 *
 * Usage: npx tsx tests/unit/clefTranslation.test.ts
 */

import {
	abcDecoder, meiEncoder, musicXmlEncoder, musicXmlDecoder,
	lilypondEncoder, lilypondDecoder, serializeLilyletDoc, parseCode,
	clefShift, isLilyPondClefSuffix, lilyPondTranspositionPitch, semitonesToClefSuffix,
} from '../../source/lilylet';
import { ContextChange, LilyletDoc } from '../../source/lilylet/types';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

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

// One voice whose only variable is its declared transposition.
const docFor = (props: string): LilyletDoc =>
	abcDecoder.decode(`X:1\n%%score (1)\nL:1/4\nM:4/4\nV:1 ${props}\nK:C\n[V:1] c c c c |\n`);

// [ABC V: properties, the shift it declares, the lilylet clef it must produce]
const CASES: Array<[string, number, string]> = [
	['treble', 0, 'treble'],
	['treble-8', -12, 'treble_8'],			// octave: representable everywhere
	['treble transpose=-2', -2, 'treble_2'],	// B-flat instruments (major second)
	['treble transpose=-3', -3, 'treble_m3'],	// A clarinet — MINOR, needs `m`
	['treble transpose=-10', -10, 'treble_m7'],	// common brass — MINOR
	['treble transpose=4', 4, 'treble^3'],		// upward
];


// ── Case 1 ────────────────────────────────────────────────────────────────────
// The .lyl text form is lossless. This is the baseline the other formats are
// measured against: the grammar is `CMD_CLEF STRING`, so an arbitrary suffix
// survives verbatim and no format change was needed to introduce `m`.
console.log('\nCase 1 — .lyl round trip preserves every suffix verbatim');
{
	for (const [props, shift, expected] of CASES) {
		const doc = docFor(props);
		assert(clefsOf(doc)[0] === expected,
			`${props} decodes to ${expected} (got ${clefsOf(doc)[0]})`);
		const reparsed = clefsOf(parseCode(serializeLilyletDoc(doc)))[0];
		assert(reparsed === expected,
			`${expected} survives serialize→parse (got ${reparsed})`);
		assert(clefShift(reparsed) === shift,
			`and still means ${shift} semitones (got ${clefShift(reparsed)})`);
	}
}


// ── Case 2 ────────────────────────────────────────────────────────────────────
// MEI carries the shift as a signed {diat, semi} pair, which is what lets a minor
// interval be exact: a minor third is diat -2 with semi -3, and the two differ.
console.log('\nCase 2 — MEI states the shift as trans.diat + trans.semi');
{
	for (const [props, shift, expected] of CASES) {
		const mei = meiEncoder.encode(docFor(props));
		const staffDef = (mei.match(/<staffDef[^>]*>/) || [''])[0];
		if (shift === 0) {
			assert(!/trans\.semi/.test(staffDef),
				`${expected} declares no transposition (correctly absent)`);
			continue;
		}
		const semi = (staffDef.match(/trans\.semi="(-?\d+)"/) || [, 'missing'])[1];
		assert(semi === String(shift),
			`${expected} → trans.semi=${shift} (got ${semi})`);
	}

	// The pair differs exactly where the diatonic number alone cannot carry the
	// interval — the whole reason `m` had to exist.
	const minorThird = meiEncoder.encode(docFor('treble transpose=-3'));
	assert(/trans\.diat="-2"/.test(minorThird) && /trans\.semi="-3"/.test(minorThird),
		'a minor third is diat=-2 with semi=-3, not diat=-2 semi=-4');
}


// ── Case 3 ────────────────────────────────────────────────────────────────────
// MusicXML used to drop the <clef> element outright for ANY suffixed clef: the
// sign/line table was keyed on the whole clef string, "treble_8" was not a key, and
// the `if (clefInfo)` guard then skipped sign, line and all. So a transposing part
// lost not just its transposition but its clef.
console.log('\nCase 3 — MusicXML emits the clef plus <transpose>, and reads both back');
{
	for (const [props, shift, expected] of CASES) {
		const xml = musicXmlEncoder.encode(docFor(props));

		// The clef itself must be present regardless of any suffix.
		assert(/<clef>[\s\S]*?<sign>/.test(xml),
			`${expected}: the <clef> element is emitted, suffix notwithstanding`);

		if (shift === 0) {
			assert(!/<transpose>/.test(xml), `${expected}: no <transpose> for a plain clef`);
		} else {
			const trans = (xml.match(/<transpose>[\s\S]*?<\/transpose>/) || [''])[0];
			const chromatic = parseInt((trans.match(/<chromatic>(-?\d+)</) || [, 'NaN'])[1], 10);
			const octaveChange = parseInt((trans.match(/<octave-change>(-?\d+)</) || [, '0'])[1], 10);
			assert(chromatic + 12 * octaveChange === shift,
				`${expected}: chromatic+12*octave-change = ${shift} (got ${chromatic}+12*${octaveChange})`);
		}

		// And the whole thing survives the trip back.
		const back = clefsOf(musicXmlDecoder.decode(xml))[0];
		assert(back === expected, `${expected}: round trips through MusicXML (got ${back})`);
		assert(clefShift(back ?? '') === shift, `${expected}: shift intact at ${shift}`);
	}

	// An octave clef declares BOTH the glyph and the sounding shift, which are
	// separate things in MusicXML. Reading them additively would say two octaves, so
	// <transpose> alone is authoritative.
	const octave = musicXmlEncoder.encode(docFor('treble-8'));
	assert(/<clef-octave-change>-1<\/clef-octave-change>/.test(octave),
		'an octave clef still draws its "8" via <clef-octave-change>');
	assert(clefShift(clefsOf(musicXmlDecoder.decode(octave))[0] ?? '') === -12,
		'and reads back as ONE octave, not two');

	// MusicXML holds whole octaves separately, so diatonic must be reduced by 7 per
	// octave alongside chromatic by 12 — reducing only one made an octave read double.
	const ninth = musicXmlEncoder.encode(docFor('treble transpose=-14'));
	const nt = (ninth.match(/<transpose>[\s\S]*?<\/transpose>/) || [''])[0].replace(/\s+/g, '');
	assert(nt.includes('<diatonic>-1</diatonic>') && nt.includes('<chromatic>-2</chromatic>')
		&& nt.includes('<octave-change>-1</octave-change>'),
		`a major ninth down is -1/-2 plus one octave (got ${nt})`);
}


// ── Case 4 ────────────────────────────────────────────────────────────────────
// LilyPond is where the divergence is real. Its clef suffix is notational only, so
// the sounding shift has to go on `\transposition`; and LilyPond has no `m` suffix
// at all, rejecting `\clef "treble_m3"` as an unknown clef type. Emitting the suffix
// alone produced a file that either failed to compile or played out of tune.
console.log('\nCase 4 — LilyPond gets a valid clef plus \\transposition');
{
	for (const [props, shift, expected] of CASES) {
		const ly = lilypondEncoder.encode(docFor(props));
		const clefName = (ly.match(/\\clef "([^"]*)"/) || [, 'NONE'])[1];

		// Never emit a clef LilyPond would reject.
		assert(clefName === 'NONE' || !/_m|\^m/.test(clefName),
			`${expected}: the emitted clef "${clefName}" carries no m suffix`);
		assert(clefShift(clefName) === 0 || isLilyPondClefSuffix(clefName),
			`${expected}: "${clefName}" is a suffix LilyPond accepts`);

		// The clef string is quoted: `_m3` unquoted lexes as `_` then `m3`.
		assert(/\\clef "/.test(ly), `${expected}: the clef is quoted`);

		// The sounding shift is declared, and declared before the clef so a reader
		// tracking it as a standing declaration has it in hand when the clef lands.
		if (shift !== 0) {
			const pitch = lilyPondTranspositionPitch(shift);
			assert(ly.includes(`\\transposition ${pitch}`),
				`${expected}: \\transposition ${pitch} declares the ${shift}-semitone shift`);
			assert(ly.indexOf('\\transposition') < ly.indexOf('\\clef'),
				`${expected}: \\transposition precedes the clef`);
		} else {
			assert(!/\\transposition/.test(ly), `${expected}: no \\transposition for a plain clef`);
		}

		// Round trip: the shift comes back on the clef, from \transposition.
		const back = clefsOf(lilypondDecoder.decode(ly))[0];
		assert(back === expected, `${expected}: round trips through LilyPond (got ${back})`);
	}

	// A suffixed clef in LilyPond INPUT must not lose its clef. The map is keyed on
	// base names, so looking up "treble_8" whole found nothing and the clef event was
	// dropped — silently, taking the transposition with it.
	for (const [name, expectShift] of [['treble_8', -12], ['treble_2', -2], ['bass_8', -12]] as Array<[string, number]>) {
		const doc = lilypondDecoder.decode(`\\score { \\new Staff { \\clef "${name}" c'4 c'4 c'4 c'4 } }`);
		const got = clefsOf(doc)[0];
		assert(got === name, `\\clef "${name}" decodes to ${name} (got ${got ?? 'NO CLEF EVENT'})`);
		assert(clefShift(got ?? '') === expectShift,
			`\\clef "${name}" means ${expectShift} semitones (got ${clefShift(got ?? '')})`);
	}

	// `\transposition` and a clef suffix state different things and must not be
	// added: this file declares ONE octave, not two.
	{
		const doc = lilypondDecoder.decode(`\\score { \\new Staff { \\clef "treble_8" \\transposition c c'4 c'4 } }`);
		const got = clefsOf(doc).pop();
		assert(clefShift(got ?? '') === -12,
			`clef _8 plus \\transposition c is one octave (got ${clefShift(got ?? '')} from ${got})`);
	}

	// The order between them is not fixed in the wild, so a `\transposition` arriving
	// AFTER the clef must still govern it.
	{
		const doc = lilypondDecoder.decode(`\\score { \\new Staff { \\clef "treble" \\transposition a c'4 c'4 } }`);
		const got = clefsOf(doc).pop();
		assert(clefShift(got ?? '') === -3,
			`a late \\transposition a still yields -3 (got ${clefShift(got ?? '')} from ${got})`);
	}
}


// ── Case 5 ────────────────────────────────────────────────────────────────────
// Compound intervals are real: an orchestral part written a major ninth below its
// sounding pitch appears in the corpus as `treble_9`. The `\transposition` table was
// first written for a single octave either side of c', which left -14 with no pitch
// and its sounding shift undeclared — the clef suffix alone would have carried it
// back through lilylet while real LilyPond played it an octave out.
console.log('\nCase 5 — \\transposition covers compound intervals, spelled from c\'');
{
	// c' is the reference (no shift). An octave mark per octave out from there.
	assert(lilyPondTranspositionPitch(0) === "c'", "0 is c' itself");
	assert(lilyPondTranspositionPitch(-12) === 'c', 'an octave down drops the mark');
	assert(lilyPondTranspositionPitch(-24) === 'c,', 'two octaves down takes a comma');
	assert(lilyPondTranspositionPitch(12) === "c''", 'an octave up adds a mark');
	assert(lilyPondTranspositionPitch(-14) === 'bf,', 'a major ninth down is bf, (was undefined)');
	assert(lilyPondTranspositionPitch(-13) === 'b,', 'a minor ninth down is b,');

	// Every shift a clef suffix can express within two octaves must have a pitch,
	// so the encoder never has to emit a clef whose sound it cannot declare.
	for (let semi = -24; semi <= 24; semi++) {
		if (semi === 0) continue;
		if (semitonesToClefSuffix(semi) === undefined) continue;	// the tritones
		assert(lilyPondTranspositionPitch(semi) !== undefined,
			`${semi} has a suffix, so it must have a \\transposition pitch`);
	}

	// Beyond two octaves there is no instrument, and the table says so rather than
	// inventing a spelling.
	assert(lilyPondTranspositionPitch(25) === undefined, 'beyond two octaves is undefined');
	assert(lilyPondTranspositionPitch(1.5) === undefined, 'a non-integer shift is undefined');

	// End to end: the ninth reaches the LilyPond file and comes back.
	const doc = docFor('treble transpose=-14');
	const ly = lilypondEncoder.encode(doc);
	assert(ly.includes('\\transposition bf,'), `a -14 part declares \\transposition bf, (got ${(ly.match(/\\transposition \S+/) || ['none'])[0]})`);
	assert(clefShift(clefsOf(lilypondDecoder.decode(ly))[0] ?? '') === -14,
		'and reads back as -14');
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
