/**
 * MusicXML decoder gaps, seen on MuseScore 4.6 exports of Open Music Theory 2e worksheets
 * (openmusictheory-lilylet scripts/v2/scores/repro.ts; worked around there in postprocess.ts).
 *
 * Usage: npx tsx tests/unit/musicXmlDecoderGaps.test.ts
 */

import { musicXmlDecoder, serializeLilyletDoc } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try { fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

// ── MusicXML builders (divisions = 6: quarter = 6, eighth = 3) ───────────────────
const xml = (attrs: string, body: string) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list>` +
	`<score-part id="P1"><part-name>P</part-name></score-part></part-list>` +
	`<part id="P1"><measure number="1"><attributes><divisions>6</divisions>${attrs}</attributes>${body}</measure></part></score-partwise>`;
const time = (b: number, t: number, sym = '') =>
	`<time${sym}><beats>${b}</beats><beat-type>${t}</beat-type></time><clef><sign>G</sign><line>2</line></clef>`;
const n = (step: string, o: number, dur: number, type: string, extra = '', pre = '') =>
	`<note>${pre}<pitch><step>${step}</step><octave>${o}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const tm = `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`;

const decode = (x: string) => musicXmlDecoder.decode(x);
const events = (x: string): any[] => decode(x).measures[0].parts[0].voices[0].events as any[];
const ser = (x: string) => serializeLilyletDoc(decode(x)).trim();

console.log('\nMusicXML decoder gaps\n' + '─'.repeat(40));

test('<unpitched> notes are kept, at their display position', () => {
	const ev = events(xml(`<time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef>`,
		`<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>6</duration><voice>1</voice><type>quarter</type></note>`.repeat(2)));
	assert(ev.filter(e => e.type === 'note').length === 2, `notes: ${ev.map(e => e.type).join(' ')}`);
	// The display octave uses MusicXML's numbering, like <octave>: the -4 shift to
	// lilylet's octave happens once, downstream. (It was applied twice at first.)
	assert(ev.filter(e => e.type === 'note').every((e: any) => e.pitches[0].octave === 1),
		`octaves: ${ev.filter(e => e.type === 'note').map((e: any) => e.pitches[0].octave).join(' ')} (want 1 = written C5)`);
});

test('<chord/> notes inside a tuplet stay chords inside the tuplet', () => {
	const out = ser(xml(time(2, 4),
		n('F', 4, 2, 'eighth', tm + `<notations><tuplet type="start"/></notations>`) + n('A', 4, 2, 'eighth', tm, '<chord/>') +
		n('G', 4, 2, 'eighth', tm) + n('B', 4, 2, 'eighth', tm, '<chord/>') +
		n('A', 4, 2, 'eighth', tm + `<notations><tuplet type="stop"/></notations>`) + n('C', 5, 2, 'eighth', tm, '<chord/>') +
		n('C', 5, 6, 'quarter')));
	assert(/\\tuplet 3\/2 \{\s*<f a>8\s*<g b>\s*<a c'?>\s*\}/.test(out), `got: ${out}`);
});

test('a zero-net <backup>/<forward> around a direction adds no spacer rests', () => {
	const out = ser(xml(time(2, 4), n('C', 4, 6, 'quarter') +
		`<backup><duration>3</duration></backup><direction><direction-type><words>x</words></direction-type></direction><forward><duration>3</duration></forward>` +
		n('D', 4, 6, 'quarter')));
	assert(!/(^|\s)s\d/.test(out), `got: ${out}`);
});

test('<time symbol="cut"> keeps the cut-time glyph', () => {
	const out = ser(xml(time(2, 2, ` symbol="cut"`), n('C', 5, 24, 'whole')));
	assert(!/numericTimeSignature/.test(out), `got: ${out}`);
});

test('<time symbol="common"> keeps the common-time glyph', () => {
	const out = ser(xml(time(4, 4, ` symbol="common"`), n('C', 5, 24, 'whole')));
	assert(!/numericTimeSignature/.test(out), `got: ${out}`);
});

test('a Roman-numeral <harmony> (<numeral>, no <root>) is kept', () => {
	const ev = events(xml(time(2, 4), `<harmony><numeral><numeral-root text="V">5</numeral-root></numeral><kind>major</kind></harmony>` + n('C', 4, 12, 'half')));
	const h = ev.find(e => e.type === 'harmony');
	assert(!!h, `events: ${ev.map(e => e.type).join(' ')}`);
	assert(JSON.stringify(h).includes('V'), `harmony: ${JSON.stringify(h)}`);
});

// `\chords "…"` binds to the PRECEDING note, so each harmony event must follow its own note.
test('each <harmony> attaches to its own note, not after all of them', () => {
	const ev = events(xml(time(2, 4),
		`<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>` + n('C', 4, 6, 'quarter') +
		`<harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>` + n('D', 4, 6, 'quarter')));
	const seq = ev.filter(e => e.type === 'note' || e.type === 'harmony').map(e => e.type).join(',');
	assert(seq === 'note,harmony,note,harmony', `order: ${seq}`);
});

test('a <direction> before a <rest> stays on the rest', () => {
	const ev = events(xml(time(2, 4), `<direction><direction-type><words>X</words></direction-type></direction>` +
		`<note><rest/><duration>6</duration><voice>1</voice><type>quarter</type></note>` + n('C', 5, 6, 'quarter')));
	const note = ev.find(e => e.type === 'note');
	assert(!JSON.stringify(note?.marks || []).includes('"X"'), `the text moved onto the following note: ${JSON.stringify(note?.marks)}`);
	// ...and it is not merely dropped: it stays on the rest, and the serialized
	// text reads back with the text still on the rest (no `-`, which is tenuto).
	const rest = ev.find(e => e.type === 'rest');
	assert(JSON.stringify(rest?.marks || []).includes('"X"'), `the text is missing from the rest: ${JSON.stringify(rest?.marks)}`);
	const lyl = ser(xml(time(2, 4), `<direction><direction-type><words>X</words></direction-type></direction>` +
		`<note><rest/><duration>12</duration><voice>1</voice><type>half</type></note>`));
	assert(/r2\^?\\markup "X"/.test(lyl) || /r2[^ ]*\\markup "X"/.test(lyl), `serialized: ${lyl}`);
});

test('a <type>breve</type> note is 8 quarters long', () => {
	const ev = events(xml(time(4, 2), n('C', 5, 48, 'breve')));
	const note = ev.find(e => e.type === 'note');
	const d = note?.duration;
	let q = 4 / d.division;
	for (let i = 0, dot = q; i < (d.dots || 0); i++) { dot /= 2; q += dot; }
	assert(q === 8, `duration ${JSON.stringify(d)} = ${q} quarters`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
