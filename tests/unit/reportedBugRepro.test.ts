/**
 * Reproductions for three defects reported against lilylet 0.1.90 (9af40af).
 * Each case reads a fixture from tests/assets/unit-cases and asserts the CORRECT
 * behaviour, so this suite fails until the defect is fixed.
 *
 *  1. key-signatures-time-carry-roundtrip.lyl
 *     serializeLilyletDoc is not idempotent: the measure head restates the key/time
 *     in force, and the voice's own key/time event is emitted again after it, so
 *     every parse→serialize pass adds one more \key/\time pair per measure.
 *
 *  2. lyrics-single-syllable-wordpos.lyl
 *     lyricWordPosition (meiEncoder.ts:339) returns 'u' for a single-syllable word.
 *     MEI 5 att.syl.log@wordpos is i | m | s | t; a single syllable is 's'.
 *     Verovio warns "Unsupported value 'u'" on stderr only — getLog() stays empty,
 *     so tests/mei.ts cannot catch it; we assert on the MEI directly.
 *
 *  3. clefs-transpose-octave-glyph.lyl
 *     An octave clef suffix (_8, ^8, _15) emits only trans.diat/trans.semi, so
 *     Verovio draws a plain clef with no 8/15. The glyph is clef.dis +
 *     clef.dis.place, but Verovio then reads @oct relative to the displaced clef,
 *     so the octave must move into @oct and trans.* must go. A non-octave suffix
 *     (_m3) has no clef.dis form and keeps att.transposition.
 *
 * Usage: npx tsx tests/unit/reportedBugRepro.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCode, serializeLilyletDoc, meiEncoder } from '../../source/lilylet';

const CASES_DIR = path.join(import.meta.dirname, '../assets/unit-cases');
const readCase = (name: string): string => fs.readFileSync(path.join(CASES_DIR, name), 'utf-8');

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const attr = (tag: string, name: string): string | undefined =>
	tag.match(new RegExp(`\\s${name.replace(/\./g, '\\.')}="([^"]*)"`))?.[1];

const count = (s: string, re: RegExp): number => (s.match(re) || []).length;


// ── 1. serializer idempotency ─────────────────────────────────────────────────
console.log('\n1. key-signatures-time-carry-roundtrip.lyl — serializer is a fixed point');
{
	const src = readCase('key-signatures-time-carry-roundtrip.lyl');
	const pass1 = serializeLilyletDoc(parseCode(src));
	const pass2 = serializeLilyletDoc(parseCode(pass1));
	const pass3 = serializeLilyletDoc(parseCode(pass2));

	assert(pass2 === pass1, 'pass 2 === pass 1');
	assert(pass3 === pass2, 'pass 3 === pass 2');

	// Each measure head restates the key/time in force (by design, commit 8a2cd40 —
	// the doc model also carries them on every measure), but exactly ONCE, and the
	// m3 change survives.
	const measures = pass1.split(/\|\s*%\d+/).map(m => m.trim()).filter(Boolean);
	assert(measures.length === 4, `4 measures serialized (got ${measures.length})`);
	const expect = ['\\key g \\major', '\\key g \\major', '\\key d \\major', '\\key d \\major'];
	const expectTime = ['\\time 3/4', '\\time 3/4', '\\time 2/4', '\\time 2/4'];
	measures.forEach((m, i) => {
		assert(count(m, /\\key\b/g) === 1 && m.includes(expect[i]), `m${i + 1} states ${expect[i]} once (got ${count(m, /\\key\b/g)})`);
		assert(count(m, /\\time\b/g) === 1 && m.includes(expectTime[i]), `m${i + 1} states ${expectTime[i]} once (got ${count(m, /\\time\b/g)})`);
	});
}


// ── 2. MEI wordpos for single-syllable words ──────────────────────────────────
console.log('\n2. lyrics-single-syllable-wordpos.lyl — wordpos ∈ {i, m, s, t}');
{
	const mei = meiEncoder.encode(parseCode(readCase('lyrics-single-syllable-wordpos.lyl')));
	const syls = [...mei.matchAll(/<syl\b[^>]*>([^<]*)<\/syl>/g)].map(m => ({ text: m[1], wordpos: attr(m[0], 'wordpos') }));

	assert(syls.length === 4, `4 syllables encoded (got ${syls.length})`);
	for (const s of syls)
		assert(s.wordpos === undefined || ['i', 'm', 's', 't'].includes(s.wordpos), `"${s.text}" wordpos="${s.wordpos}" is a valid MEI value`);

	const expected: Record<string, string> = { one: 's', two: 'i', three: 't', four: 's' };
	for (const s of syls)
		if (s.text in expected)
			assert(s.wordpos === expected[s.text], `"${s.text}" wordpos="${expected[s.text]}" (got "${s.wordpos}")`);
}


// ── 3. octave-clef glyph (clef.dis) ───────────────────────────────────────────
// Verovio reads @oct RELATIVE to a displaced clef: under clef.dis="8" below, oct=4
// is drawn an octave higher than under a plain clef. So an octave clef must emit
// clef.dis AND fold the octave into @oct, with NO trans.* (trans.semi on top would
// transpose MIDI a second time). Ground truth is what Verovio renders, so the
// fixture is checked against the same music with every clef suffix stripped:
// noteheads must sit on identical staff positions, and MIDI must differ by exactly
// the clef's declared shift.
console.log('\n3. clefs-transpose-octave-glyph.lyl — octave clefs draw the 8 and sound right');
{
	const src = readCase('clefs-transpose-octave-glyph.lyl');
	const plainSrc = src.replace(/\\clef "([a-z]+)[_^]m?\d+"/g, '\\clef "$1"');
	const mei = meiEncoder.encode(parseCode(src));

	// Every clef the fixture declares, in order: staffDef first, then inline <clef>s.
	const clefs = [
		...[...mei.matchAll(/<staffDef\b[^>]*clef\.shape="[^"]*"[^>]*>/g)].slice(0, 1).map(m => ({
			dis: attr(m[0], 'clef.dis'), place: attr(m[0], 'clef.dis.place'), semi: attr(m[0], 'trans.semi'),
		})),
		...[...mei.matchAll(/<clef\b[^>]*>/g)].map(m => ({ dis: attr(m[0], 'dis'), place: attr(m[0], 'dis.place'), semi: undefined })),
	];
	const want = [
		{ clef: 'treble_8', dis: '8', place: 'below' },
		{ clef: 'treble^8', dis: '8', place: 'above' },
		{ clef: 'bass_8', dis: '8', place: 'below' },
		{ clef: 'treble_15', dis: '15', place: 'below' },
		{ clef: 'treble_m3', dis: undefined, place: undefined },
	];
	assert(clefs.length === want.length, `${want.length} clefs encoded (got ${clefs.length})`);
	want.forEach((w, i) => assert(clefs[i]?.dis === w.dis && clefs[i]?.place === w.place,
		`m${i + 1} ${w.clef} → dis="${w.dis}" place="${w.place}" (got "${clefs[i]?.dis}"/"${clefs[i]?.place}")`));
	assert(clefs[0]?.semi === undefined, `octave clef staffDef carries no trans.semi (got "${clefs[0]?.semi}")`);
	assert(/trans\.diat="-2" trans\.semi="-3"/.test(mei), 'treble_m3 keeps trans.diat="-2" trans.semi="-3"');

	await (async () => {
		// @ts-ignore
		const { default: createVerovioModule } = await import('verovio/wasm');
		// @ts-ignore
		const { VerovioToolkit } = await import('verovio/esm');
		const vrv = new VerovioToolkit(await createVerovioModule());
		vrv.setOptions({ svgViewBox: false, breaks: 'none' });
		const render = (m: string): { heads: number[]; midi: number[] } => {
			vrv.loadData(m);
			const svg: string = vrv.renderToSVG(1);
			const heads = [...svg.matchAll(/class="notehead">\s*<use[^>]*translate\(\d+, (\d+)\)/g)].map(x => +x[1]);
			const d = Buffer.from(vrv.renderToMIDI(), 'base64');
			const midi: number[] = [];
			for (let i = 0; i < d.length - 2; i++)
				if ((d[i] & 0xf0) === 0x90 && d[i + 1] < 128 && d[i + 2] > 0) { midi.push(d[i + 1]); i += 2; }
			return { heads, midi };
		};
		const got = render(mei);
		const ref = render(meiEncoder.encode(parseCode(plainSrc)));
		const shifts = [-12, 12, -12, -24, -3];	// per measure, 4 notes each
		assert(got.heads.length === 20 && ref.heads.length === 20, `20 noteheads drawn (got ${got.heads.length}/${ref.heads.length})`);
		shifts.forEach((shift, mi) => {
			const r = [mi * 4, mi * 4 + 4];
			const sameHeads = got.heads.slice(...r).every((y, k) => y === ref.heads[r[0] + k]);
			const midiOk = got.midi.slice(...r).every((n, k) => n === ref.midi[r[0] + k] + shift);
			assert(sameHeads, `m${mi + 1} noteheads on the same staff positions as the plain clef`);
			assert(midiOk, `m${mi + 1} MIDI = plain + ${shift} (got [${got.midi.slice(...r)}] vs plain [${ref.midi.slice(...r)}])`);
		});
	})();
}


console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
