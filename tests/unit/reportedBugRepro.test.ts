/**
 * Reproductions for three defects reported against lilylet 0.1.90 (9af40af).
 * Each case reads a fixture from tests/assets/unit-cases and asserts the CORRECT
 * behaviour, so this suite fails until the defect is fixed.
 *
 *  1. key-signatures-time-carry-roundtrip.lyl
 *     serializeLilyletDoc is not idempotent: \key/\time are emitted by both the
 *     per-event path and the per-measure context path (serializer.ts:1026 feeds the
 *     running currentKey/currentTime carry into measureContext), so every
 *     parse→serialize pass adds one more \key/\time pair per measure.
 *
 *  2. lyrics-single-syllable-wordpos.lyl
 *     lyricWordPosition (meiEncoder.ts:339) returns 'u' for a single-syllable word.
 *     MEI 5 att.syl.log@wordpos is i | m | s | t; a single syllable is 's'.
 *     Verovio warns "Unsupported value 'u'" on stderr only — getLog() stays empty,
 *     so tests/mei.ts cannot catch it; we assert on the MEI directly.
 *
 *  3. clefs-transpose-octave-glyph.lyl
 *     An octave clef suffix (_8, ^8, _15) emits only trans.diat/trans.semi, which
 *     is sounding pitch. The "8"/"15" glyph is a separate MEI fact, clef.dis +
 *     clef.dis.place, and is dropped — Verovio draws a plain clef. A non-octave
 *     suffix (_m3) has no clef.dis form and must NOT gain one.
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

	// Source declares key+time twice (m1, m3); a faithful serialization keeps that.
	assert(count(pass1, /\\key\b/g) === count(src, /\\key\b/g),
		`pass 1 keeps ${count(src, /\\key\b/g)} \\key (got ${count(pass1, /\\key\b/g)})`);
	assert(count(pass1, /\\time\b/g) === count(src, /\\time\b/g),
		`pass 1 keeps ${count(src, /\\time\b/g)} \\time (got ${count(pass1, /\\time\b/g)})`);
	assert(pass2 === pass1, 'pass 2 === pass 1');
	assert(pass3 === pass2, 'pass 3 === pass 2');

	// Measures that only carry the previous signature must not restate it.
	const measures = pass1.split(/\|\s*%\d+/).map(m => m.trim()).filter(Boolean);
	assert(measures.length === 4, `4 measures serialized (got ${measures.length})`);
	assert(!/\\key|\\time/.test(measures[1] ?? ''), 'm2 (carried key/time) restates nothing');
	assert(!/\\key|\\time/.test(measures[3] ?? ''), 'm4 (carried key/time) restates nothing');
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


// ── 3. octave-clef glyph (clef.dis) alongside att.transposition ───────────────
console.log('\n3. clefs-transpose-octave-glyph.lyl — octave clefs carry clef.dis');
{
	const mei = meiEncoder.encode(parseCode(readCase('clefs-transpose-octave-glyph.lyl')));

	// [semitone shift] → expected [clef.dis, clef.dis.place], or null for none.
	const DIS: Record<string, [string, string] | null> = {
		'-12': ['8', 'below'], '12': ['8', 'above'], '-24': ['15', 'below'], '-3': null,
	};

	// staffDefs carrying a clef: the sounding shift must stay AND the glyph must appear.
	const staffDefs = [...mei.matchAll(/<staffDef\b[^>]*clef\.shape="[^"]*"[^>]*>/g)].map(m => m[0]);
	assert(staffDefs.length === 5, `5 clef-bearing staffDefs (got ${staffDefs.length})`);
	for (const sd of staffDefs) {
		const semi = attr(sd, 'trans.semi') ?? '0';
		const want = DIS[semi];
		const label = `staffDef ${attr(sd, 'clef.shape')}${attr(sd, 'clef.line')} trans.semi=${semi}`;
		if (want) {
			assert(attr(sd, 'clef.dis') === want[0] && attr(sd, 'clef.dis.place') === want[1],
				`${label} → clef.dis="${want[0]}" clef.dis.place="${want[1]}" (got "${attr(sd, 'clef.dis')}"/"${attr(sd, 'clef.dis.place')}")`);
		} else {
			assert(attr(sd, 'clef.dis') === undefined, `${label} → no clef.dis (minor third has no glyph form)`);
		}
	}

	// Mid-piece <clef> elements (m2..m5) are what Verovio draws inside the staff.
	const inline = [...mei.matchAll(/<clef\b[^>]*>/g)].map(m => [attr(m[0], 'dis'), attr(m[0], 'dis.place')]);
	const want = [['8', 'above'], ['8', 'below'], ['15', 'below'], [undefined, undefined]];
	assert(inline.length === want.length, `${want.length} inline <clef> (got ${inline.length})`);
	want.forEach(([dis, place], i) =>
		assert(inline[i]?.[0] === dis && inline[i]?.[1] === place,
			`inline clef m${i + 2} → dis="${dis}" dis.place="${place}" (got "${inline[i]?.[0]}"/"${inline[i]?.[1]}")`));
}


console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
