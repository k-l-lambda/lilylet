/**
 * Serializer gaps: a doc that is right in memory comes out wrong as .lyl text, or as text
 * that reads back differently. Found while converting Open Music Theory 2e
 * (openmusictheory-lilylet scripts/v2/scores/repro.ts; worked around there in postprocess.ts).
 *
 * Usage: npx tsx tests/unit/serializerGaps.test.ts
 */

import { parseCode, musicXmlDecoder, serializeLilyletDoc } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try { fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

const xml = (attrs: string, body: string) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list>` +
	`<score-part id="P1"><part-name>P</part-name></score-part></part-list>` +
	`<part id="P1"><measure number="1"><attributes><divisions>6</divisions>${attrs}</attributes>${body}</measure></part></score-partwise>`;
const time = (b: number, t: number) => `<time><beats>${b}</beats><beat-type>${t}</beat-type></time><clef><sign>G</sign><line>2</line></clef>`;
const n = (step: string, o: number, dur: number, type: string, extra = '') =>
	`<note><pitch><step>${step}</step><octave>${o}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;

const quarters = (d: any) => {
	let q = 4 / d.division;
	for (let i = 0, dot = q; i < (d.dots || 0); i++) { dot /= 2; q += dot; }
	if (d.tuplet) q = q * d.tuplet.numerator / d.tuplet.denominator;
	return q;
};
/** Total quarters of the top-level events of voice 1, bar 1 (tuplets by their ratio). */
const barLength = (doc: any) => {
	let total = 0;
	for (const e of doc.measures[0].parts[0].voices[0].events) {
		if (e.type === 'note' || e.type === 'rest') total += quarters(e.duration);
		else if (e.type === 'tuplet') total += e.events.reduce((s: number, x: any) => s + quarters(x.duration), 0) * e.ratio.numerator / e.ratio.denominator;
	}
	return total;
};
const roundTrip = (code: string) => serializeLilyletDoc(parseCode(code)).trim();

console.log('\nSerializer gaps\n' + '─'.repeat(40));

test('<time-modification> without a <tuplet> bracket keeps its ratio', () => {
	// four "quarters" at actual 2 : normal 1 fill one 2/4 bar
	const doc = musicXmlDecoder.decode(xml(time(2, 4),
		n('C', 4, 3, 'quarter', `<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>`).repeat(4)));
	const lyl = serializeLilyletDoc(doc);
	const back = barLength(parseCode(lyl));
	assert(back === 2, `bar reads back as ${back} quarters (expected 2): ${lyl.trim()}`);
});

// `0.5` is not a lilylet duration either: the note reads back as division 0 and the
// trailing `.5` is swallowed, so the note also picks up a fingering mark from the `5`.
test('a breve serializes as a duration that reads back as a breve', () => {
	const lyl = serializeLilyletDoc(musicXmlDecoder.decode(xml(time(4, 2), n('C', 5, 48, 'breve'))));
	const note = (parseCode(lyl).measures[0].parts[0].voices[0].events as any[]).find(e => e.type === 'note');
	assert(!(note?.marks || []).some((m: any) => m?.markType === 'fingering'), `read back with a fingering: ${lyl.trim()}`);
	assert(note && quarters(note.duration) === 8, `read back as ${JSON.stringify(note?.duration)}: ${lyl.trim()}`);
});

test('chord symbols are written', () => {
	const out = roundTrip(String.raw`c4 \chords "C7" d | %1`);
	assert(/\\chords "C7"/.test(out), `got: ${out}`);
});

test('tenuto is written -- and portato -_', () => {
	const out = roundTrip(String.raw`c4-- d-_ | %1`);
	assert(/c4--/.test(out), `tenuto: ${out}`);
	assert(/d-_(?![.])/.test(out), `portato: ${out}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
