/**
 * Hiding the time signature and barlines: `\bar ""` (an invisible barline) and
 * `\omit Score.TimeSignature` / `\omit Score.BarLine` with `\undo \omit …`, the
 * LilyPond syntax (`Staff.` is accepted as an alias and written back as `Score.`).
 *
 * MEI: meter.visible="false" on each scoreDef that would draw a hidden time
 * signature (Verovio does not inherit it), and right="invis" on each measure whose
 * closing barline is hidden. Timing follows LilyPond: a change before a measure's
 * first note governs its time signature and the barline before it.
 *
 * Checked against what Verovio draws, not just the attributes.
 *
 * Usage: npx tsx tests/unit/omitGrobs.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCode, serializeLilyletDoc, meiEncoder, lilypondEncoder } from '../../source/lilylet';

const CASES_DIR = path.join(import.meta.dirname, '../assets/unit-cases');
const readCase = (name: string): string => fs.readFileSync(path.join(CASES_DIR, name), 'utf-8');

let passed = 0;
let failed = 0;
function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const attr = (tag: string, name: string): string | undefined =>
	tag.match(new RegExp(`\\s${name.replace(/\./g, '\\.')}="([^"]*)"`))?.[1];
const measureRights = (mei: string): string[] =>
	[...mei.matchAll(/<measure\b[^>]*>/g)].map(m => attr(m[0], 'right') ?? 'single');
const scoreDefMeters = (mei: string): string[] =>
	[...mei.matchAll(/<scoreDef\b[^>]*meter\.count="[^"]*"[^>]*>/g)].map(m => `${attr(m[0], 'meter.count')}/${attr(m[0], 'meter.unit')}${attr(m[0], 'meter.visible') === 'false' ? ':hidden' : ''}`);

// Glyphs drawn per SVG group of a class; a self-closing <g/> counts 0.
const groupMarks = (svg: string, cls: string): number[] => {
	const out: number[] = [];
	const re = new RegExp(`<g\\b[^>]*class="${cls}"[^>]*?(\\/?)>`, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(svg))) {
		if (m[1] === '/') { out.push(0); continue; }
		const end = svg.indexOf('</g>', re.lastIndex);
		out.push((svg.slice(re.lastIndex, end).match(/<use|<path|<rect/g) || []).length);
	}
	return out;
};

const main = async (): Promise<void> => {
	// @ts-ignore
	const { default: createVerovioModule } = await import('verovio/wasm');
	// @ts-ignore
	const { VerovioToolkit } = await import('verovio/esm');
	const vrv = new VerovioToolkit(await createVerovioModule());
	vrv.setOptions({ breaks: 'none' });
	const render = (mei: string): { meters: number[]; bars: number[] } => {
		vrv.loadData(mei);
		const svg: string = vrv.renderToSVG(1);
		return { meters: groupMarks(svg, 'meterSig'), bars: groupMarks(svg, 'barLine') };
	};

	console.log('\n1. Grammar: \\omit / \\undo \\omit, Staff. alias');
	{
		const doc = parseCode(`\\omit Score.TimeSignature \\omit   Staff.BarLine c'4 d e f | \\undo \\omit Staff.TimeSignature \\undo \\omit Score.BarLine g4 a b c |\n`);
		const omits = doc.measures.flatMap(m => m.parts.flatMap(p => p.voices.flatMap(v => v.events.filter((e: any) => e.type === 'context' && e.omit).map((e: any) => e.omit))));
		assert(eq(omits, [{ timeSignature: true }, { barLine: true }, { timeSignature: false }, { barLine: false }]), `four omit events parsed (got ${JSON.stringify(omits)})`);
	}

	console.log('\n2. Serializer: written back, Staff. → Score., \\bar "" kept, fixed point');
	for (const name of ['barline-invisible.lyl', 'time-signatures-omit.lyl', 'barline-omit.lyl', 'time-signatures-free-time.lyl']) {
		const src = readCase(name);
		const s1 = serializeLilyletDoc(parseCode(src));
		const s2 = serializeLilyletDoc(parseCode(s1));
		const count = (s: string, re: RegExp) => (s.match(re) || []).length;
		const same = (re: RegExp) => count(s1, re) === count(src, re);
		assert(same(/\\omit Score\./g) && same(/\\undo \\omit/g) && same(/\\bar ""/g), `${name}: \\omit / \\undo / \\bar "" all preserved`);
		assert(s2 === s1, `${name}: serialize is a fixed point`);
	}
	assert(serializeLilyletDoc(parseCode(`\\omit Staff.BarLine c'4 |\n`)).includes('\\omit Score.BarLine'), 'Staff.BarLine is written back as Score.BarLine');

	console.log('\n3. barline-invisible.lyl — \\bar "" is right="invis"');
	{
		const mei = meiEncoder.encode(parseCode(readCase('barline-invisible.lyl')));
		assert(eq(measureRights(mei), ['invis', 'end']), `measure rights invis,end (got ${measureRights(mei)})`);
		const r = render(mei);
		assert(eq(r.bars.map(n => n > 0), [false, true]), `Verovio draws no barline after m1, an end barline after m2 (marks ${r.bars})`);
	}

	console.log('\n4. time-signatures-omit.lyl — hidden 4/4 and 3/4, then a visible 2/4');
	{
		const mei = meiEncoder.encode(parseCode(readCase('time-signatures-omit.lyl')));
		assert(eq(scoreDefMeters(mei), ['4/4:hidden', '3/4:hidden', '2/4']), `scoreDef meters (got ${scoreDefMeters(mei)})`);
		const r = render(mei);
		assert(eq(r.meters, [0, 0, 2]), `Verovio draws only the 2/4 (glyphs per meterSig ${r.meters})`);
	}

	console.log('\n5. barline-omit.lyl — hidden barlines (even an explicit ||) until the undo');
	{
		const mei = meiEncoder.encode(parseCode(readCase('barline-omit.lyl')));
		// m3's barline is drawn at the start of m4, after m4's leading \undo → visible
		assert(eq(measureRights(mei), ['invis', 'invis', 'single', 'end']), `measure rights (got ${measureRights(mei)})`);
		const r = render(mei);
		assert(r.bars.length === 4 && r.bars[0] === 0 && r.bars[1] === 0 && r.bars[2] > 0 && r.bars[3] > 0, `Verovio: m1, m2 none; m3, m4 drawn (marks ${r.bars})`);
	}

	console.log('\n6. time-signatures-free-time.lyl — no time signature, no barlines, final barline restored');
	{
		const mei = meiEncoder.encode(parseCode(readCase('time-signatures-free-time.lyl')));
		assert(eq(measureRights(mei), ['invis', 'invis', 'end']), `measure rights (got ${measureRights(mei)})`);
		assert(eq(scoreDefMeters(mei), ['4/4:hidden']), `implicit 4/4 hidden (got ${scoreDefMeters(mei)})`);
		const r = render(mei);
		assert(r.meters.every(n => n === 0), `Verovio draws no time signature (glyphs ${r.meters})`);
		assert(eq(r.bars.map(n => n > 0), [false, false, true]), `Verovio: only the final barline (marks ${r.bars})`);
	}

	console.log('\n7. No \\omit: output unchanged (still 4/4 drawn, single barlines)');
	{
		const mei = meiEncoder.encode(parseCode(`\\clef "treble" c'4 d e f | g a b c |\n`));
		assert(!/meter\.visible|right="invis"/.test(mei), 'no meter.visible / right="invis" emitted');
	}

	console.log('\n8. LilyPond encoder: same syntax, \\omit before \\time');
	{
		const ly = lilypondEncoder.encode(parseCode(readCase('time-signatures-omit.lyl')));
		const i = ly.indexOf('\\omit Score.TimeSignature');
		assert(i >= 0 && i < ly.indexOf('\\time 4/4'), '\\omit Score.TimeSignature precedes \\time 4/4');
		assert(ly.includes('\\undo \\omit Score.TimeSignature'), '\\undo \\omit Score.TimeSignature emitted');
		const lyBar = lilypondEncoder.encode(parseCode(readCase('barline-invisible.lyl')));
		assert(lyBar.includes('\\bar ""'), '\\bar "" emitted');
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
};

main();
