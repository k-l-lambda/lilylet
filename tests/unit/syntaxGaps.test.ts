/**
 * Expected behaviour of the syntax-gap unit cases in tests/assets/unit-cases/. Each case
 * holds lilylet (LilyPond) syntax that the grammar does not accept yet, or that the lexer
 * misreads. They were found while transcribing Open Music Theory 2e
 * (openmusictheory-lilylet: scripts/v2/images/repro.ts, scripts/v2/scores/repro.ts).
 *
 * Most assertions fail on lilylet 0.1.95; each should pass once its syntax is supported.
 * The `fingering-out-of-range` group passes (fixed: the grammar used to clamp 1-5 and
 * yield a null mark that crashed every consumer). The .lyl files describe what each case
 * expects in their header comments.
 *
 * Usage: npx tsx tests/unit/syntaxGaps.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCode, meiEncoder, serializeLilyletDoc } from '../../source/lilylet/index.js';

// The fixtures live in `unit-cases/` with the rest. They were held in a separate
// `unit-cases-pending/` while the syntax did not parse: every shared suite walks
// `unit-cases/`, so a fixture that fails to parse (or encodes to wrong content)
// breaks `npm test`, the three round-trip suites, `test:mei` and `test:mei-hashes`.
// All of them are implemented now, so they are ordinary cases.
const CASES = path.join(import.meta.dirname, '../assets/unit-cases');

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try {
		fn();
		console.log(`  ✓ ${name}`);
		passed++;
	} catch (e: any) {
		console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
		failed++;
	}
};

const assert = (cond: boolean, msg: string) => {
	if (!cond) throw new Error(msg);
};

const load = (file: string) => fs.readFileSync(path.join(CASES, file), 'utf-8');

/** Top-level events of voice 1 of part 1, measure `m` (0-based). */
const events = (doc: any, m = 0): any[] => doc.measures[m].parts[0].voices[0].events;
const notes = (doc: any, m = 0) => events(doc, m).filter((e: any) => e.type === 'note');
const quarters = (d: any) => {
	let q = 4 / d.division;
	for (let i = 0, dot = q; i < (d.dots || 0); i++) { dot /= 2; q += dot; }
	return q;
};
const measureMei = (mei: string, m: number) => (mei.match(/<measure\b[\s\S]*?<\/measure>/g) || [])[m] ?? '';


console.log('\nSyntax gaps (tests/assets/unit-cases)\n' + '─'.repeat(40));

// ── durations-breve.lyl ───────────────────────────────────────────────────────
test('durations-breve: c\'\\breve is one note of 8 quarters', () => {
	const doc = parseCode(load('durations-breve.lyl'));
	const ev = events(doc, 0).filter((e: any) => e.type === 'note' || e.type === 'rest');
	assert(ev.length === 1, `expected 1 event in bar 1, got ${ev.length} (${ev.map((e: any) => e.type).join(' ')})`);
	assert(quarters(ev[0].duration) === 8, `expected 8 quarters, got ${quarters(ev[0].duration)}`);
});
test('durations-breve: r\\breve and a breve chord are one event each', () => {
	const doc = parseCode(load('durations-breve.lyl'));
	for (const m of [1, 2]) {
		const ev = events(doc, m).filter((e: any) => e.type === 'note' || e.type === 'rest');
		assert(ev.length === 1 && quarters(ev[0].duration) === 8, `bar ${m + 1}: ${ev.length} events`);
	}
});
test('durations-breve: MEI writes dur="breve"', () => {
	const mei = meiEncoder.encode(parseCode(load('durations-breve.lyl')));
	assert(/dur="breve"/.test(mei), 'no dur="breve" in the MEI');
});

// ── rest-full-measure-long-bar.lyl ────────────────────────────────────────────
test('rest-full-measure-long-bar: R\\breve is a full-bar rest of 8 quarters', () => {
	const doc = parseCode(load('rest-full-measure-long-bar.lyl'));
	const ev = events(doc, 1).filter((e: any) => e.type === 'rest');
	assert(ev.length === 1, `expected 1 rest, got ${ev.length}`);
	assert(ev[0].fullMeasure && quarters(ev[0].duration) === 8, `got ${JSON.stringify(ev[0].duration)} fullMeasure=${ev[0].fullMeasure}`);
});
test('rest-full-measure-long-bar: the serializer writes a long full-bar rest that reads back', () => {
	const doc = parseCode(load('rest-full-measure-long-bar.lyl'));
	const back = parseCode(serializeLilyletDoc(doc));
	const r = events(back, 1).find((e: any) => e.type === 'rest');
	assert(r && r.duration.division > 0 && quarters(r.duration) === 8, `read back as ${JSON.stringify(r?.duration)}`);
});

// ── rest-multi-measure.lyl ────────────────────────────────────────────────────
test('rest-multi-measure: R1*4 is four bars of rest', () => {
	const doc = parseCode(load('rest-multi-measure.lyl'));
	const mei = meiEncoder.encode(doc);
	const multi = /<multiRest\b[^>]*\bnum="4"/.test(mei);
	assert(multi || doc.measures.length === 6, `${doc.measures.length} measures, no <multiRest num="4">`);
});

// ── articulations-caesura.lyl ─────────────────────────────────────────────────
test('articulations-caesura: \\caesura adds no notes', () => {
	const doc = parseCode(load('articulations-caesura.lyl'));
	assert(notes(doc, 0).length === 4, `bar 1 has ${notes(doc, 0).length} notes`);
	assert(notes(doc, 1).length === 2, `bar 2 has ${notes(doc, 1).length} notes`);
});
test('articulations-caesura: MEI has a caesura', () => {
	const mei = meiEncoder.encode(parseCode(load('articulations-caesura.lyl')));
	assert(/<caesura\b/.test(mei), 'no <caesura> in the MEI');
});

// ── noteheads-slash-x.lyl ─────────────────────────────────────────────────────
test('noteheads-slash-x: \\xNote and \\improvisationOn add no notes', () => {
	const doc = parseCode(load('noteheads-slash-x.lyl'));
	assert(notes(doc, 0).length === 4 && notes(doc, 1).length === 4, `bars 1-2 have ${notes(doc, 0).length} and ${notes(doc, 1).length} notes`);
});
test('noteheads-slash-x: MEI head.shape x in bar 1, slash in bar 2, none in bar 3', () => {
	const mei = meiEncoder.encode(parseCode(load('noteheads-slash-x.lyl')));
	assert(/head\.shape="x"/.test(measureMei(mei, 0)), 'bar 1: no head.shape="x"');
	assert(/head\.shape="slash"/.test(measureMei(mei, 1)), 'bar 2: no head.shape="slash"');
	assert(!/head\.shape=/.test(measureMei(mei, 2)), 'bar 3: \\improvisationOff did not end the slash heads');
});

// ── markup-command-underscore.lyl ─────────────────────────────────────────────
test('markup-command-underscore: one note per written note', () => {
	const doc = parseCode(load('markup-command-underscore.lyl'));
	const counts = [0, 1, 2].map(m => notes(doc, m).length);
	assert(JSON.stringify(counts) === '[1,2,4]', `notes per bar ${JSON.stringify(counts)}, expected [1,2,4]`);
});
test('markup-command-underscore: every note keeps its command and its markup', () => {
	const doc = parseCode(load('markup-command-underscore.lyl'));
	const want = [['coda'], ['pp', 'p'], ['mf', 'fermata', 'staccato', 'ff']];
	want.forEach((cmds, m) => {
		notes(doc, m).forEach((n: any, i: number) => {
			const marks = (n.marks || []).map((k: any) => JSON.stringify(k));
			assert(marks.some((k: string) => k.includes('"markup"')), `bar ${m + 1} note ${i + 1}: markup lost`);
			assert(marks.some((k: string) => k.includes(`"${cmds[i]}"`)), `bar ${m + 1} note ${i + 1}: \\${cmds[i]} lost (${marks.join(' ')})`);
		});
	});
});

// ── dynamics-fpp.lyl ──────────────────────────────────────────────────────────
test('dynamics-fpp: \\fpp is a dynamic, drawn as "fpp"', () => {
	const doc = parseCode(load('dynamics-fpp.lyl'));
	assert(notes(doc, 0).length === 1, `bar 1 has ${notes(doc, 0).length} notes`);
	const mei = meiEncoder.encode(doc);
	assert(/<dynam\b[^>]*>fpp</.test(mei), 'no <dynam>fpp</dynam>');
});

// ── clefs-soprano-mezzo-baritone.lyl / clefs-percussion.lyl ───────────────────
test('clefs-soprano-mezzo-baritone: C1, C2, F3, C5', () => {
	const mei = meiEncoder.encode(parseCode(load('clefs-soprano-mezzo-baritone.lyl')));
	const clefs = [...mei.matchAll(/(?:clef\.shape="(\w+)"\s+clef\.line="(\d)")|(?:<clef\b[^>]*shape="(\w+)"[^>]*line="(\d)")/g)]
		.map(m => (m[1] ?? m[3]) + (m[2] ?? m[4]));
	assert(JSON.stringify(clefs) === '["C1","C2","C5","F3"]', `clefs ${JSON.stringify(clefs)}`);
});
test('clefs-percussion: clef.shape="perc"', () => {
	const mei = meiEncoder.encode(parseCode(load('clefs-percussion.lyl')));
	assert(/shape="perc"/.test(mei), `no percussion clef (${(mei.match(/clef\.shape="\w+"/) || ['none'])[0]})`);
});

// ── tremolos-post-event.lyl ───────────────────────────────────────────────────
test('tremolos-post-event: parses, and the marks stay on their notes', () => {
	let doc: any;
	try { doc = parseCode(load('tremolos-post-event.lyl')); }
	catch (e: any) { throw new Error(`parse error: ${String(e.message).split('\n')[0]}`); }
	const trem = events(doc, 0).find((e: any) => e.type === 'tremolo');
	assert(!!trem, 'no tremolo event in bar 1');
	assert(JSON.stringify(trem).includes('sustain'), 'the \\sustainOn mark is lost');
});

// ── fingering-out-of-range.lyl ────────────────────────────────────────────────
test('fingering-out-of-range: -0, -6, -9 are fingering marks', () => {
	const doc = parseCode(load('fingering-out-of-range.lyl'));
	const fingers = notes(doc, 0).map((n: any) => (n.marks || []).map((m: any) => (m ? m.finger ?? m.markType : 'NULL')).join(','));
	assert(JSON.stringify(fingers) === '["0","6","9","1"]', `fingerings ${JSON.stringify(fingers)}`);
});
test('fingering-out-of-range: the doc encodes to MEI', () => {
	const mei = meiEncoder.encode(parseCode(load('fingering-out-of-range.lyl')));
	assert(/<fing\b[^>]*>9</.test(mei), 'no <fing>9</fing>');
});
test('fingering-out-of-range: the doc serializes', () => {
	const doc = parseCode(load('fingering-out-of-range.lyl'));
	const lyl = serializeLilyletDoc(doc);
	assert(/-9/.test(lyl), `no -9 in ${lyl.trim()}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
