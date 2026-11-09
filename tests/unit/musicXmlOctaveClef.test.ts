/**
 * MusicXML octave clefs written by other software: <clef-octave-change> with no <transpose>.
 *
 * MuseScore, music21, Finale and others write an octave clef (G8vb for tenor voice and
 * guitar, F8vb, G15mb, G8va) as <clef-octave-change> alone. The <pitch> of every note
 * under it is then the SOUNDING pitch: a tenor's D3 is <octave>3</octave>, drawn on the
 * 4th line. lilylet's own encoder writes these clefs differently, as written pitch plus
 * <transpose><octave-change>, and the MusicXML round trip (musicxml-roundtrip.ts,
 * clefTranslation.test.ts case 3) only ever tests that shape. So the external shape
 * goes through a decoder branch that nothing exercises.
 *
 * In lilylet a "treble_8" clef means written→sounding -12. The .lyl pitch under it is the
 * WRITTEN pitch, and MEI then folds the octave into @oct, so @oct is the sounding octave
 * (tests/assets/unit-cases/clefs-octave-shift.lyl: `\clef "treble_8" c4` → oct="3").
 * Decoding the external shape must therefore move each pitch back by the clef's own
 * shift. Otherwise the note is lowered twice and sounds and draws an octave too low.
 * Found in OMT 2e's Fux solutions (MuseScore 4.6.5 export; see openmusictheory-lilylet
 * scripts/v2/scores/repro.ts).
 *
 * Assertions are end to end and independent of how the .lyl spells it: the MEI
 * @oct after decode must equal the octave stated in the MusicXML. The serialized .lyl
 * must also read back to the same MEI, so the text form carries the right pitch.
 *
 * Usage: npx tsx tests/unit/musicXmlOctaveClef.test.ts
 */

import { musicXmlDecoder, musicXmlEncoder, meiEncoder, serializeLilyletDoc, parseCode } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

// ── MusicXML builders ─────────────────────────────────────────────────────────

type Pitch = [step: string, octave: number];
type Clef = { sign: 'G' | 'F' | 'C'; line: number; octaveChange?: number };
type Transpose = { diatonic: number; chromatic: number; octaveChange: number };

const clefXml = (c: Clef, number?: number): string =>
	`<clef${number ? ` number="${number}"` : ''}><sign>${c.sign}</sign><line>${c.line}</line>` +
	(c.octaveChange ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>` : '') + `</clef>`;

// Staff 2 gets voice 5, as MuseScore and Finale number it (voices 1–4 per staff).
const noteXml = (p: Pitch | Pitch[], staff?: number): string => {
	const chord = Array.isArray(p[0]) ? (p as Pitch[]) : [p as Pitch];
	const voice = staff && staff > 1 ? 1 + 4 * (staff - 1) : 1;
	return chord.map(([step, octave], i) =>
		`<note>${i ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
		`<duration>1</duration><voice>${voice}</voice><type>quarter</type>${staff ? `<staff>${staff}</staff>` : ''}</note>`).join('');
};

/** One part, one staff, 4/4, each measure = [optional clef, four quarter notes or chords]. */
const singleStaff = (measures: { clef?: Clef; transpose?: Transpose; notes: (Pitch | Pitch[])[] }[]): string =>
	`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>` +
	`<part id="P1">` + measures.map((m, i) => {
		const attrs = (i === 0 ? '<divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' : '') +
			(m.transpose ? `<transpose><diatonic>${m.transpose.diatonic}</diatonic><chromatic>${m.transpose.chromatic}</chromatic><octave-change>${m.transpose.octaveChange}</octave-change></transpose>` : '') +
			(m.clef ? clefXml(m.clef) : '');
		return `<measure number="${i + 1}">${attrs ? `<attributes>${attrs}</attributes>` : ''}${m.notes.map(n => noteXml(n)).join('')}</measure>`;
	}).join('') + `</part></score-partwise>`;

// ── MEI readers ───────────────────────────────────────────────────────────────

/** Per measure, per staff n: the notes as "c3" strings in document order. */
const meiNotes = (mei: string): Record<string, string[]>[] =>
	[...mei.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map(m => {
		const staves: Record<string, string[]> = {};
		for (const s of m[0].matchAll(/<staff\b[^>]*\bn="(\d+)"[^>]*>([\s\S]*?)<\/staff>/g)) {
			staves[s[1]] = [...s[2].matchAll(/<note\b[^>]*>/g)].map(n => {
				const pname = (n[0].match(/\bpname="([a-g])"/) || [])[1];
				const oct = (n[0].match(/\boct="(-?\d+)"/) || [])[1];
				return `${pname}${oct}`;
			});
		}
		return staves;
	});

/** The clef.dis / dis.place a staff starts with, from its staffDef, e.g. "8 below". */
const meiClefDis = (mei: string, staffN = 1): string => {
	const def = (mei.match(new RegExp(`<staffDef\\b[^>]*\\bn="${staffN}"[^>]*>`)) || [''])[0];
	const dis = (def.match(/\bclef\.dis="(\d+)"/) || [])[1];
	const place = (def.match(/\bclef\.dis\.place="(\w+)"/) || [])[1];
	return dis ? `${dis} ${place}` : 'none';
};

const expected = (pitches: (Pitch | Pitch[])[]): string[] =>
	pitches.flatMap(p => (Array.isArray(p[0]) ? (p as Pitch[]) : [p as Pitch]).map(([s, o]) => `${s.toLowerCase()}${o}`));

/** Decode → MEI, plus decode → .lyl text → parse → MEI. Both must agree. */
const run = (xml: string) => {
	const doc = musicXmlDecoder.decode(xml);
	const lyl = serializeLilyletDoc(doc);
	return { lyl, mei: meiEncoder.encode(doc), meiFromText: meiEncoder.encode(parseCode(lyl)) };
};

const check = (label: string, xml: string, want: string[][], dis: string, staffN = '1') => {
	const { lyl, mei, meiFromText } = run(xml);
	const got = meiNotes(mei).map(m => m[staffN] ?? []);
	const gotText = meiNotes(meiFromText).map(m => m[staffN] ?? []);
	assert(meiClefDis(mei, Number(staffN)) === dis, `${label}: clef drawn with dis "${dis}" (got "${meiClefDis(mei, Number(staffN))}")`);
	assert(JSON.stringify(got) === JSON.stringify(want),
		`${label}: MEI octaves equal the MusicXML octaves ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
	assert(JSON.stringify(gotText) === JSON.stringify(want),
		`${label}: the serialized .lyl reads back to the same pitches (got ${JSON.stringify(gotText)}; lyl: ${lyl.replace(/\s+/g, ' ').trim().slice(0, 120)})`);
};

// ── Case 1: the MuseScore tenor clef ──────────────────────────────────────────
console.log('\nCase 1 — G8vb (tenor voice / guitar), <clef-octave-change>-1, no <transpose>');
{
	const notes: Pitch[] = [['C', 3], ['D', 3], ['E', 3], ['F', 3]];
	check('treble 8vb', singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: -1 }, notes }]), [expected(notes)], '8 below');

	const { lyl } = run(singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: -1 }, notes }]));
	// Under treble_8 the written pitch is an octave above the sounding one: sounding C3 is
	// written C4, which is `c` in relative mode (a line starts at middle C), not `c,`.
	assert(/\\clef "treble_8"/.test(lyl), `clef serialized as "treble_8" (lyl: ${lyl.replace(/\s+/g, ' ').trim().slice(0, 80)})`);
	assert(/\\clef "treble_8" c4/.test(lyl), `the first note is written \`c4\` (written C4 = sounding C3), not \`c,4\` (lyl: ${lyl.replace(/\s+/g, ' ').trim().slice(0, 80)})`);
}

// ── Case 2: other external octave clefs ───────────────────────────────────────
console.log('\nCase 2 — F8vb, G15mb and G8va without <transpose>');
{
	const bass: Pitch[] = [['C', 2], ['G', 2], ['C', 3], ['E', 2]];
	check('bass 8vb', singleStaff([{ clef: { sign: 'F', line: 4, octaveChange: -1 }, notes: bass }]), [expected(bass)], '8 below');

	const deep: Pitch[] = [['C', 2], ['E', 2], ['G', 2], ['C', 3]];
	check('treble 15mb', singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: -2 }, notes: deep }]), [expected(deep)], '15 below');

	const piccolo: Pitch[] = [['C', 6], ['D', 6], ['E', 6], ['G', 6]];
	check('treble 8va', singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: 1 }, notes: piccolo }]), [expected(piccolo)], '8 above');
}

// ── Case 3: chords and clef changes inside the piece ──────────────────────────
console.log('\nCase 3 — chords, and a change into and out of G8vb');
{
	const chords: Pitch[][] = [[['C', 3], ['E', 3], ['G', 3]], [['D', 3], ['F', 3], ['A', 3]], [['E', 3], ['G', 3], ['B', 3]], [['C', 3], ['C', 4]]];
	check('chords under treble 8vb', singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: -1 }, notes: chords }]), [expected(chords)], '8 below');

	// Plain treble → G8vb from bar 2 → plain treble again in bar 3: only bar 2 shifts back.
	const m1: Pitch[] = [['C', 4], ['D', 4], ['E', 4], ['F', 4]];
	const m2: Pitch[] = [['D', 3], ['E', 3], ['F', 3], ['G', 3]];
	const m3: Pitch[] = [['G', 4], ['A', 4], ['B', 4], ['C', 5]];
	check('clef change in and out of 8vb',
		singleStaff([{ clef: { sign: 'G', line: 2 }, notes: m1 }, { clef: { sign: 'G', line: 2, octaveChange: -1 }, notes: m2 }, { clef: { sign: 'G', line: 2 }, notes: m3 }]),
		[expected(m1), expected(m2), expected(m3)], 'none');
}

// ── Case 4: two-staff part, octave clef on one staff only ─────────────────────
console.log('\nCase 4 — two staves, G8vb on staff 2 only');
{
	const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>` +
		`<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
		clefXml({ sign: 'G', line: 2 }, 1) + clefXml({ sign: 'G', line: 2, octaveChange: -1 }, 2) + `</attributes>` +
		[['A', 4], ['A', 4], ['G', 4], ['A', 4]].map(p => noteXml(p as Pitch, 1)).join('') +
		`<backup><duration>4</duration></backup>` +
		[['D', 3], ['F', 3], ['E', 3], ['D', 3]].map(p => noteXml(p as Pitch, 2)).join('') +
		`</measure></part></score-partwise>`;
	check('staff 1 (plain treble) untouched', xml, [['a4', 'a4', 'g4', 'a4']], 'none', '1');
	check('staff 2 (treble 8vb)', xml, [['d3', 'f3', 'e3', 'd3']], '8 below', '2');
}

// ── Case 5: the shape lilylet writes itself must not regress ──────────────────
console.log('\nCase 5 — lilylet\'s own shape: written pitch + <transpose> (must stay as is)');
{
	// What musicXmlEncoder emits for `\clef "treble_8" c'4 d e f`: written C5…, <transpose> -1 octave.
	const written: Pitch[] = [['C', 5], ['D', 5], ['E', 5], ['F', 5]];
	const xml = singleStaff([{ clef: { sign: 'G', line: 2, octaveChange: -1 }, transpose: { diatonic: 0, chromatic: 0, octaveChange: -1 }, notes: written }]);
	check('treble_8 with <transpose>', xml, [['c4', 'd4', 'e4', 'f4']], '8 below');
}

// ── Case 6: a clef change inside a measure, into G8vb ─────────────────────────
console.log('\nCase 6 — mid-measure change into G8vb (external shape)');
{
	// Two quarters under plain treble, then <clef-octave-change>-1 mid-bar: only the last two shift.
	const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>` +
		`<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${clefXml({ sign: 'G', line: 2 })}</attributes>` +
		noteXml(['C', 4]) + noteXml(['D', 4]) +
		`<attributes>${clefXml({ sign: 'G', line: 2, octaveChange: -1 })}</attributes>` +
		noteXml(['E', 3]) + noteXml(['F', 3]) +
		`</measure></part></score-partwise>`;
	check('mid-measure into 8vb', xml, [['c4', 'd4', 'e3', 'f3']], 'none');
}

// ── Case 7: lilylet's own MusicXML output, read by an independent importer ────
// The encoder used to write an octave clef as <clef-octave-change> PLUS a <transpose>
// of the same octave over the written pitch. An octave clef already displaces the drawn
// notes, so readers count the octave twice: Verovio drew `\clef "treble_8" c4` (sounding
// C3) in the 3rd space, C5's place, instead of a ledger line below the staff. Encode as
// the external tools do: <clef-octave-change> alone over the SOUNDING pitch.
console.log('\nCase 7 — lilylet → MusicXML → Verovio, and → MusicXML → lilylet');
{
	// @ts-ignore
	const { default: createVerovioModule } = await import('verovio/wasm');
	// @ts-ignore
	const { VerovioToolkit } = await import('verovio/esm');
	const vrv = new VerovioToolkit(await createVerovioModule());
	vrv.setOptions({ svgViewBox: false, breaks: 'none' });
	/** Noteheads in staff steps above the bottom line, and MIDI note-ons, for a MusicXML string. */
	const drawXml = (xml: string): { steps: number[]; midi: number[] } => {
		vrv.loadData(xml);
		const svg: string = vrv.renderToSVG(1);
		const lines = [...svg.slice(svg.indexOf('class="staff"')).matchAll(/<path d="M\d+ (\d+) L/g)].slice(0, 5).map(m => +m[1]);
		const half = (lines[4] - lines[0]) / 8;
		const steps = [...svg.matchAll(/class="notehead"[^>]*>\s*<use[^>]*?translate\(\d+, (\d+)\)/g)].map(m => Math.round((lines[4] - +m[1]) / half));
		const d = Buffer.from(vrv.renderToMIDI(), 'base64');
		const midi: number[] = [];
		for (let i = 0; i < d.length - 2; i++)
			if ((d[i] & 0xf0) === 0x90 && d[i + 1] < 128 && d[i + 2] > 0) { midi.push(d[i + 1]); i += 2; }
		return { steps, midi };
	};

	const shapes: [label: string, octaveClef: string, plainClef: string, shift: number][] = [
		['treble_8', `\\clef "treble_8" c4 d e f`, `\\clef "treble" c4 d e f`, -12],
		['bass_8', `\\clef "bass_8" c,4 d e f`, `\\clef "bass" c,4 d e f`, -12],
		['treble^8', `\\clef "treble^8" c'4 d e f`, `\\clef "treble" c'4 d e f`, 12],
		['treble_15', `\\clef "treble_15" c4 d e f`, `\\clef "treble" c4 d e f`, -24],
	];
	for (const [label, octaveSrc, plainSrc, shift] of shapes) {
		const src = `\\time 4/4 ${octaveSrc} |\n`;
		const xml = musicXmlEncoder.encode(parseCode(src));
		assert(/<clef-octave-change>/.test(xml) && !/<transpose>/.test(xml),
			`${label}: written as <clef-octave-change> alone, no <transpose>`);
		const got = drawXml(xml);
		const ref = drawXml(musicXmlEncoder.encode(parseCode(`\\time 4/4 ${plainSrc} |\n`)));
		assert(JSON.stringify(got.steps) === JSON.stringify(ref.steps),
			`${label}: Verovio draws the noteheads where the plain clef puts them (got ${got.steps}, plain ${ref.steps})`);
		assert(got.midi.length === 4 && got.midi.every((n, i) => n === ref.midi[i] + shift),
			`${label}: Verovio sounds the plain clef's notes ${shift > 0 ? '+' : ''}${shift} (got ${got.midi}, plain ${ref.midi})`);
		// and back: lilylet → MusicXML → lilylet keeps the MEI pitches
		const want = meiNotes(meiEncoder.encode(parseCode(src))).map(m => m['1']);
		const back = meiNotes(meiEncoder.encode(musicXmlDecoder.decode(xml))).map(m => m['1']);
		assert(JSON.stringify(back) === JSON.stringify(want), `${label}: MusicXML round trip keeps the pitches ${JSON.stringify(want)} (got ${JSON.stringify(back)})`);
	}

	// A non-octave transposition has no clef form: it stays <transpose> over the written pitch.
	{
		const src = `\\time 4/4 \\clef "treble_m3" c'4 d e f |\n`;
		const xml = musicXmlEncoder.encode(parseCode(src));
		assert(/<transpose>/.test(xml) && !/<clef-octave-change>/.test(xml), 'treble_m3: still <transpose>, no <clef-octave-change>');
		const want = meiNotes(meiEncoder.encode(parseCode(src))).map(m => m['1']);
		const back = meiNotes(meiEncoder.encode(musicXmlDecoder.decode(xml))).map(m => m['1']);
		assert(JSON.stringify(back) === JSON.stringify(want), `treble_m3: round trip keeps the pitches (got ${JSON.stringify(back)})`);
	}
}

// ── Case 8: every clef reaches the MusicXML, not just the first ───────────────
// The encoder wrote one <clef> per part, taken from the first voice of the first measure:
// a later clef change, a mid-measure one and the second staff's clef were all dropped, so
// the decoder read every staff as treble. The octave clefs above depend on this.
console.log('\nCase 8 — clef changes and per-staff clefs survive lilylet → MusicXML → lilylet');
{
	const clefsOf = (doc: any): string[] =>
		doc.measures.flatMap((m: any, mi: number) => m.parts.flatMap((p: any) => p.voices.flatMap((v: any) => {
			let staff = v.staff;
			return v.events.flatMap((e: any) => {
				if (e.type === 'context' && e.staff) staff = e.staff;
				return e.type === 'context' && e.clef ? [`m${mi + 1}:${e.clef}@${e.staff ?? staff}`] : [];
			});
		})));
	const round = (src: string) => {
		const doc = parseCode(src);
		const back = musicXmlDecoder.decode(musicXmlEncoder.encode(doc));
		return { want: meiNotes(meiEncoder.encode(doc)), got: meiNotes(meiEncoder.encode(back)), clefs: clefsOf(back) };
	};

	const between = round(`\\time 4/4 \\clef "treble" c'4 d e f | \\clef "bass" c,4 d e f | \\clef "treble_8" c4 d e f |\n`);
	assert(['m1:treble@1', 'm2:bass@1', 'm3:treble_8@1'].every(c => between.clefs.includes(c)), `clef changes between measures read back (got ${between.clefs})`);
	assert(JSON.stringify(between.got) === JSON.stringify(between.want), 'and the pitches are unchanged');

	const inside = round(`\\time 4/4 \\clef "treble" c'4 d \\clef "treble_8" e f |\n`);
	assert(inside.clefs.includes('m1:treble_8@1'), `a mid-measure change reads back (got ${inside.clefs})`);
	assert(JSON.stringify(inside.got) === JSON.stringify(inside.want), `and the pitches are unchanged (want ${JSON.stringify(inside.want)}, got ${JSON.stringify(inside.got)})`);

	const grand = round(`[staves "{-}"]\n\\staff "1" \\time 4/4 \\clef "treble" c'1 \\\\\n\\staff "2" \\clef "bass_8" c,1 |\n\\staff "1" c'1 \\\\\n\\staff "2" \\clef "treble" c1 |\n`);
	assert(['m1:treble@1', 'm1:bass_8@2', 'm2:treble@2'].every(c => grand.clefs.includes(c)), `per-staff clefs read back (got ${grand.clefs})`);
	assert(JSON.stringify(grand.got) === JSON.stringify(grand.want), `and the pitches are unchanged (want ${JSON.stringify(grand.want)}, got ${JSON.stringify(grand.got)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
