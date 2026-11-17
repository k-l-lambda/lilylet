/**
 * Two-note tremolos (`\repeat tremolo N { a b }`) and the single-note form, checked
 * against LilyPond 2.22.1's semantics and against Verovio.
 *
 * LilyPond: `\repeat tremolo N { c16 d16 }` lasts N × 2 sixteenths. Both notes are
 * WRITTEN at that total length (N=4 → two half notes) and each takes half of it in time.
 * Verified by engraving: tremolo 2/4/8 of sixteenths draws quarter/half/whole heads;
 * tremolo 3 draws dotted quarters (total 3/8). A dotted member (`c16.`) scales the total
 * by 3/2. `\repeat tremolo 8 c16` (one note) is the single-note tremolo `c2:16`.
 * A note after the tremolo with no duration inherits the members' duration (16).
 *
 * MEI <fTrem>: each child carries the written (total) duration; Verovio's timemap then
 * gives the fTrem exactly that length.
 *
 * Usage: npx tsx tests/unit/tremolo.test.ts
 */

// @ts-ignore
import createVerovioModule from 'verovio/wasm';
// @ts-ignore
import { VerovioToolkit } from 'verovio/esm';
import {
	parseCode, meiEncoder, serializeLilyletDoc, musicXmlEncoder, musicXmlDecoder,
	lilypondEncoder, lilypondDecoder, measureOnsets, getParseWarnings,
} from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = async (name: string, fn: () => void | Promise<void>) => {
	try { await fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

const fTrem = (code: string) => {
	const mei = meiEncoder.encode(parseCode(code));
	return (mei.match(/<fTrem[\s\S]*?<\/fTrem>/) || [''])[0];
};
const childDurs = (ft: string) => (ft.match(/<(?:note|chord)\b[^>]*\bdur="[^"]*"[^>]*>/g) || [])
	.map(t => (t.match(/\bdur="([^"]*)"/) || [])[1] + '.'.repeat(Number((t.match(/\bdots="(\d)"/) || [, '0'])[1])));
/** Top-level musical events of bar `m`, voice 1. */
const events = (doc: any, m = 0): any[] => doc.measures[m].parts[0].voices[0].events
	.filter((e: any) => e.type !== 'context' && e.type !== 'pitchReset');
const whole = (d: any) => { let w = 1 / d.division, dot = w; for (let i = 0; i < (d.dots || 0); i++) { dot /= 2; w += dot; } return w; };

const main = async () => {
	const tk: any = new VerovioToolkit(await createVerovioModule());
	tk.setOptions({ header: 'none', footer: 'none' });
	/** qstamps of every note-on in the Verovio timemap. */
	const qstamps = (code: string): number[] => {
		tk.loadData(meiEncoder.encode(parseCode(code)));
		const raw = tk.renderToTimemap();
		const tm = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return tm.filter((e: any) => e.on && e.on.length).map((e: any) => e.qstamp);
	};

	console.log('\nTwo-note tremolo → MEI\n' + '─'.repeat(40));

	await test('tremolo 4 of sixteenths: both fTrem children are half notes', () => {
		const d = childDurs(fTrem(String.raw`\time 2/4 \repeat tremolo 4 { c'16 d'16 } | %1`));
		assert(JSON.stringify(d) === '["2","2"]', `children ${JSON.stringify(d)}`);
	});
	await test('tremolo 2 → quarters, tremolo 8 → wholes', () => {
		const q = childDurs(fTrem(String.raw`\time 2/4 \repeat tremolo 2 { c'16 d'16 } r4 | %1`));
		const w = childDurs(fTrem(String.raw`\time 4/4 \repeat tremolo 8 { c'16 d'16 } | %1`));
		assert(JSON.stringify(q) === '["4","4"]', `tremolo 2: ${JSON.stringify(q)}`);
		assert(JSON.stringify(w) === '["1","1"]', `tremolo 8: ${JSON.stringify(w)}`);
	});
	await test('tremolo 3 of sixteenths (3/8) → dotted quarters, never dur="5"', () => {
		const ft = fTrem(String.raw`\time 3/8 \repeat tremolo 3 { c'16 d'16 } | %1`);
		assert(!/dur="5"/.test(ft), `invalid dur: ${ft.replace(/\s+/g, ' ')}`);
		assert(JSON.stringify(childDurs(ft)) === '["4.","4."]', `children ${JSON.stringify(childDurs(ft))}`);
	});
	await test('chord tremolo: each chord carries the written duration', () => {
		const d = childDurs(fTrem(String.raw`\time 2/4 \repeat tremolo 4 { <c' g'>16 <d' a'>16 } | %1`));
		assert(JSON.stringify(d) === '["2","2"]', `chords ${JSON.stringify(d)}`);
	});
	await test('stroke count: 16ths → beams="2", 32nds → beams="3"', () => {
		assert(/beams="2"/.test(fTrem(String.raw`\repeat tremolo 4 { c'16 d'16 } | %1`)), '16ths');
		assert(/beams="3"/.test(fTrem(String.raw`\repeat tremolo 8 { c'32 d'32 } | %1`)), '32nds');
	});
	await test('Verovio: a 2/4 bar of tremolo 4 lasts two quarters', () => {
		const q = qstamps(String.raw`\time 2/4 \repeat tremolo 4 { c'16 d'16 } | %1
\time 2/4 c'2 | %2`);
		assert(JSON.stringify(q) === '[0,1,2]', `qstamps ${JSON.stringify(q)}`);
	});
	await test('Verovio: a 3/8 bar of tremolo 3 lasts a dotted quarter', () => {
		const q = qstamps(String.raw`\time 3/8 \repeat tremolo 3 { c'16 d'16 } | %1
\time 3/8 c'4. | %2`);
		assert(JSON.stringify(q) === '[0,0.75,1.5]', `qstamps ${JSON.stringify(q)}`);
	});

	console.log('\nOnsets\n' + '─'.repeat(40));

	await test('measureOnsets: tremolo 4 fills a 2/4 bar, each note half of it', () => {
		const r: any = measureOnsets(parseCode(String.raw`\time 2/4 \repeat tremolo 4 { c'16 d'16 } | %1`));
		const notes = r[0].notes.map((n: any) => [n.onset, n.durationDiv]);
		const half = r[0].measureDivisions / 2;
		assert(JSON.stringify(notes) === JSON.stringify([[0, half], [half, half]]), `notes ${JSON.stringify(notes)} (bar ${r[0].measureDivisions})`);
	});

	console.log('\nLanguage (parser)\n' + '─'.repeat(40));

	await test('\\repeat tremolo 8 c16 is the single-note tremolo c2:16', () => {
		for (const code of [String.raw`\repeat tremolo 8 c'16 | %1`, String.raw`\repeat tremolo 8 { c'16 } | %1`]) {
			const ev = events(parseCode(code));
			assert(ev.length === 1 && ev[0].type === 'note', `${code}: ${ev.map(e => e.type).join(',')}`);
			assert(ev[0].duration.division === 2 && ev[0].tremolo === 16, `${code}: ${JSON.stringify(ev[0].duration)} tremolo=${ev[0].tremolo}`);
		}
	});
	await test('the duration after a single-note tremolo is the member duration', () => {
		const ev = events(parseCode(String.raw`\repeat tremolo 4 c'16 d | %1`));
		assert(ev[1]?.duration?.division === 16, `next note ${JSON.stringify(ev[1]?.duration)}`);
	});
	await test('dotted members keep their dot (total 3/8)', () => {
		const t = events(parseCode(String.raw`\time 3/8 \repeat tremolo 2 { c'16. d16. } | %1`))[0];
		assert(t?.type === 'tremolo' && t.dots === 1, `tremolo ${JSON.stringify(t)}`);
		assert(JSON.stringify(childDurs(fTrem(String.raw`\time 3/8 \repeat tremolo 2 { c'16. d16. } | %1`))) === '["4.","4."]', 'MEI not dotted quarters');
	});
	await test('members of different durations are reported', () => {
		parseCode(String.raw`\repeat tremolo 4 { c'16 d8 } | %1`);
		const w = getParseWarnings();
		assert(w.some((x: any) => x.type === 'tremolo-durations'), `warnings ${JSON.stringify(w)}`);
	});
	await test('\\partial counts a tremolo by its full length', () => {
		parseCode(String.raw`\partial 2 \repeat tremolo 4 { c'16 d'16 } | %1
c'1 | %2`);
		assert(!getParseWarnings().some((x: any) => x.type === 'partial-mismatch'), 'a correct \\partial 2 was flagged');
		parseCode(String.raw`\partial 4 \repeat tremolo 4 { c'16 d'16 } | %1
c'1 | %2`);
		assert(getParseWarnings().some((x: any) => x.type === 'partial-mismatch'), 'a wrong \\partial 4 went unnoticed');
	});

	console.log('\nSingle-note tremolo (c4:32)\n' + '─'.repeat(40));

	await test('c4:32 is NoteEvent.tremolo, and survives the serializer and LilyPond output', () => {
		const doc = parseCode(String.raw`c'4:32 d | %1`);
		const n = events(doc)[0];
		assert(n.tremolo === 32 && !(n.marks || []).some((m: any) => 'tremolo' in m), `ast ${JSON.stringify(n)}`);
		assert(/c'4:32/.test(serializeLilyletDoc(doc)), `lyl ${serializeLilyletDoc(doc).trim()}`);
		assert(/c'4:32/.test(lilypondEncoder.encode(doc)), 'LilyPond output lost :32');
	});
	await test('a decoded single-note tremolo reaches the MEI as stem.mod', () => {
		const back = musicXmlDecoder.decode(musicXmlEncoder.encode(parseCode(String.raw`c'4:32 r2. | %1`)));
		assert(/stem\.mod="3slash"/.test(meiEncoder.encode(back)), 'no stem.mod="3slash"');
	});

	console.log('\nLilylet serializer\n' + '─'.repeat(40));

	await test('a note after a tremolo keeps its own duration through a round trip', () => {
		const lyl = serializeLilyletDoc(parseCode(String.raw`c'4 \repeat tremolo 4 { c16 d16 } e4 f | %1`));
		const ev = events(parseCode(lyl));
		assert(ev[2]?.duration?.division === 4 && ev[3]?.duration?.division === 4, `${lyl.trim()} → ${ev.slice(2).map(e => e.duration?.division).join(',')}`);
	});
	await test('dotted members round-trip', () => {
		const lyl = serializeLilyletDoc(parseCode(String.raw`\repeat tremolo 2 { c'16. d16. } | %1`));
		const t = events(parseCode(lyl))[0];
		assert(t?.dots === 1, `${lyl.trim()}`);
	});

	console.log('\nLilyPond encoder / decoder\n' + '─'.repeat(40));

	await test('LilyPond output keeps post-events and dots inside the tremolo', () => {
		const ly = lilypondEncoder.encode(parseCode(String.raw`\repeat tremolo 4 { b16\sustainOn b' } \repeat tremolo 2 { c'16. d16. } | %1`));
		assert(/\\sustainOn/.test(ly), 'sustainOn lost');
		assert(/16\.\s/.test(ly), 'dot lost');
	});
	await test('LilyPond output writes the duration of a note after a tremolo', () => {
		const ly = lilypondEncoder.encode(parseCode(String.raw`c'4 \repeat tremolo 4 { c16 d16 } e4 f | %1`));
		assert(/}\s+e4\s/.test(ly), `LilyPond would read e as a 16th: ${(ly.match(/\\repeat[^|]*/) || [''])[0]}`);
	});
	await test('LilyPond decode keeps chord members, dots and the single-note form', () => {
		const ly = String.raw`\version "2.22.0" \score { \new Staff { \time 4/4 \repeat tremolo 4 { <c' g'>16 <d' a'>16 } \repeat tremolo 2 { c'16. d'16. } \repeat tremolo 4 c'16 r8 } }`;
		const ev = events(lilypondDecoder.decode(ly));
		const t = ev.find(e => e.type === 'tremolo');
		assert(t?.pitchA?.length === 2 && t?.pitchB?.length === 2, `chord tremolo ${JSON.stringify(t)}`);
		assert(ev.filter(e => e.type === 'tremolo')[1]?.dots === 1, 'dotted members');
		const single = ev.find(e => e.type === 'note' && e.tremolo);
		assert(single?.tremolo === 16 && single.duration.division === 4, `single-note form ${JSON.stringify(single)}`);
	});

	console.log('\nMusicXML\n' + '─'.repeat(40));

	await test('encoder writes a two-note tremolo as tremolo start/stop on two half notes', () => {
		const xml = musicXmlEncoder.encode(parseCode(String.raw`\time 2/4 \repeat tremolo 4 { c'16 d'16 } | %1`));
		const notes = xml.match(/<note>[\s\S]*?<\/note>/g) || [];
		assert(notes.length === 2, `${notes.length} notes`);
		assert(notes.every(n => /<type>half<\/type>/.test(n)), 'members not written as halves');
		assert(/<tremolo type="start">2<\/tremolo>/.test(notes[0]) && /<tremolo type="stop">2<\/tremolo>/.test(notes[1]), 'no tremolo start/stop');
	});
	await test('encoder writes a single-note tremolo as <tremolo type="single">', () => {
		const xml = musicXmlEncoder.encode(parseCode(String.raw`c'4:32 | %1`));
		assert(/<tremolo type="single">3<\/tremolo>/.test(xml), 'no single tremolo');
	});
	await test('MusicXML round trip restores the tremolo (plain, chord, dotted, single)', () => {
		const doc = parseCode(String.raw`\time 4/4 \repeat tremolo 4 { c'16 d'16 } \repeat tremolo 4 { <c' g'>16 <d' a'>16 } | %1
\time 3/8 \repeat tremolo 2 { c'16. d16. } | %2
\time 4/4 c'4:32 r2. | %3`);
		const back: any = musicXmlDecoder.decode(musicXmlEncoder.encode(doc));
		const t = events(back, 0).filter(e => e.type === 'tremolo');
		assert(t.length === 2, `bar 1: ${events(back, 0).map(e => e.type).join(',')}`);
		assert(t[0].count === 4 && t[0].division === 16, `plain ${JSON.stringify(t[0])}`);
		assert(t[1].pitchA.length === 2 && t[1].pitchB.length === 2, `chord ${JSON.stringify(t[1])}`);
		const d = events(back, 1)[0];
		assert(d?.type === 'tremolo' && Math.abs(2 * d.count * whole({ division: d.division, dots: d.dots }) - 3 / 8) < 1e-9, `dotted ${JSON.stringify(d)}`);
		const s = events(back, 2)[0];
		assert(s?.type === 'note' && s.tremolo === 32, `single ${JSON.stringify(s)}`);
	});
	await test('decoder reads a MuseScore-style tremolo (half notes, 2:1 time-modification)', () => {
		const note = (step: string, type: string) =>
			`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>` +
			`<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>` +
			`<notations><ornaments><tremolo type="${type}">2</tremolo></ornaments></notations></note>`;
		const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>` +
			`<part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type></time>` +
			`<clef><sign>G</sign><line>2</line></clef></attributes>${note('A', 'start')}${note('F', 'stop')}</measure></part></score-partwise>`;
		const ev = events(musicXmlDecoder.decode(xml));
		assert(ev.length === 1 && ev[0].type === 'tremolo', `events ${ev.map(e => e.type).join(',')}`);
		assert(ev[0].count === 4 && ev[0].division === 16, `tremolo ${JSON.stringify(ev[0])}`);
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
};

main();
