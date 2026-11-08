/**
 * Dynamics beyond the original twelve: every name LilyPond predefines
 * (pppp ppppp ffff fffff sf sff sfp sp spp fz n) plus common ones it does not
 * (sfpp sffz sfzp rf mfp pf).
 *
 * Before: the lexer knew 12 names, and an unknown one was not an error but was
 * silently re-read: `\sfp` → a spacer `s` and a note `f`; `\pppp` → nothing;
 * `\ffff` → `\f` plus a note. `\sf` was stored as sfz, and the MusicXML decoder
 * folded sf/fz/sfp/sfpp into sfz and rf into rfz.
 *
 * Checked through every path: parse, .lyl round trip, MEI text, what Verovio
 * draws (SMuFL dynamic glyphs only, never plain text), MusicXML both ways
 * (<other-dynamics> for names MusicXML lacks), LilyPond (`\name`, or an inline
 * make-dynamic-script for names LilyPond lacks; compiled when lilypond exists),
 * and the ABC / LilyPond decoders.
 *
 * Usage: npx tsx tests/unit/dynamicsExtended.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { parseCode, serializeLilyletDoc, meiEncoder, musicXmlEncoder, musicXmlDecoder, lilypondEncoder, abcDecoder } from '../../source/lilylet';
import { decode as decodeLilypond } from '../../source/lilylet/lilypondDecoder';

const CASES_DIR = path.join(import.meta.dirname, '../assets/unit-cases');

let passed = 0;
let failed = 0;
function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const NEW = ['pppp', 'ppppp', 'ffff', 'fffff', 'sf', 'sff', 'sfp', 'sfpp', 'sffz', 'sfzp', 'sp', 'spp', 'fz', 'rf', 'mfp', 'pf', 'n'];
const LILYPOND_PREDEFINED = new Set(['pppp', 'ppppp', 'ffff', 'fffff', 'sf', 'sff', 'sfp', 'sp', 'spp', 'fz', 'n']);
const MUSICXML_ELEMENTS = new Set(['pppp', 'ppppp', 'ffff', 'fffff', 'sf', 'sfp', 'sfpp', 'sffz', 'sfzp', 'fz', 'rf', 'pf', 'n']);

const dynamicsOf = (doc: any): string[] =>
	doc.measures.flatMap((m: any) => m.parts.flatMap((p: any) => p.voices.flatMap((v: any) =>
		v.events.flatMap((e: any) => (e.marks || []).filter((k: any) => k.markType === 'dynamic').map((k: any) => k.type)))));

const main = async (): Promise<void> => {
	console.log('\n1. Each new name parses as one dynamic on the note, nothing else');
	for (const d of NEW) {
		const doc = parseCode(`c'4\\${d} d e f |\n`);
		const ev = doc.measures[0].parts[0].voices[0].events;
		const notes = ev.filter((e: any) => e.type === 'note');
		const others = ev.filter((e: any) => e.type !== 'note');
		assert(notes.length === 4 && others.length === 0 && JSON.stringify(dynamicsOf(doc)) === JSON.stringify([d]),
			`\\${d} → dynamic ${d} (got ${JSON.stringify(dynamicsOf(doc))}, ${notes.length} notes, ${others.length} other events)`);
	}
	{
		const doc = parseCode(`c'4\\sf d\\sfz |\n`);
		assert(JSON.stringify(dynamicsOf(doc)) === '["sf","sfz"]', `\\sf and \\sfz stay distinct (got ${JSON.stringify(dynamicsOf(doc))})`);
	}

	const src = fs.readFileSync(path.join(CASES_DIR, 'dynamics-extended.lyl'), 'utf-8');
	const doc = parseCode(src);
	const all = dynamicsOf(doc);

	console.log('\n2. dynamics-extended.lyl: .lyl round trip');
	const s1 = serializeLilyletDoc(doc);
	assert(JSON.stringify(dynamicsOf(parseCode(s1))) === JSON.stringify(all) && all.length === NEW.length, `all ${NEW.length} dynamics survive serialize→parse (got ${dynamicsOf(parseCode(s1)).length})`);
	assert(serializeLilyletDoc(parseCode(s1)) === s1, 'serialize is a fixed point');

	console.log('\n3. MEI text and what Verovio draws');
	const mei = meiEncoder.encode(doc);
	const dynam = [...mei.matchAll(/<dynam\b[^>]*>([^<]*)<\/dynam>/g)].map(m => m[1]);
	assert(JSON.stringify(dynam) === JSON.stringify(NEW), `MEI <dynam> texts (got ${JSON.stringify(dynam)})`);
	{
		// @ts-ignore
		const { default: createVerovioModule } = await import('verovio/wasm');
		// @ts-ignore
		const { VerovioToolkit } = await import('verovio/esm');
		const vrv = new VerovioToolkit(await createVerovioModule());
		vrv.loadData(mei);
		const svg: string = vrv.renderToSVG(1);
		const groups = [...svg.matchAll(/<g\b[^>]*class="dynam"[^>]*>([\s\S]*?)<\/g>/g)].map(m => m[1]);
		const allGlyphs = groups.every(g => /#E5[2-4][0-9A-F]/.test(g) && !/<text[^>]*>[^<]*[a-z]/.test(g));
		assert(groups.length === NEW.length && allGlyphs, `Verovio draws ${NEW.length} dynamics, all as SMuFL dynamic glyphs (got ${groups.length})`);
	}

	console.log('\n4. MusicXML: element or <other-dynamics>, and back');
	const xml = musicXmlEncoder.encode(doc);
	for (const d of NEW) {
		const ok = MUSICXML_ELEMENTS.has(d) ? new RegExp(`<dynamics>\\s*<${d}/>`).test(xml) : xml.includes(`<other-dynamics>${d}</other-dynamics>`);
		assert(ok, `${d} → ${MUSICXML_ELEMENTS.has(d) ? `<${d}/>` : '<other-dynamics>'}`);
	}
	const back = musicXmlDecoder.decode(xml);
	assert(JSON.stringify(dynamicsOf(back)) === JSON.stringify(all), `MusicXML decode gives the same dynamics (got ${JSON.stringify(dynamicsOf(back))})`);

	console.log('\n5. LilyPond: \\name, or an inline make-dynamic-script');
	const ly = lilypondEncoder.encode(doc);
	for (const d of NEW) {
		const ok = LILYPOND_PREDEFINED.has(d) ? new RegExp(`\\\\${d}(?![a-z])`).test(ly) : ly.includes(`#(make-dynamic-script "${d}")`);
		assert(ok, `${d} → ${LILYPOND_PREDEFINED.has(d) ? `\\${d}` : 'make-dynamic-script'}`);
	}
	let lilypondBin: string | null = null;
	try { lilypondBin = execFileSync('which', ['lilypond'], { encoding: 'utf-8' }).trim() || null; } catch { /* not installed */ }
	if (lilypondBin) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyl-dyn-'));
		fs.writeFileSync(path.join(dir, 't.ly'), ly);
		let out = '';
		try { out = execFileSync(lilypondBin, ['-dbackend=null', '-l', 'WARN', 't.ly'], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }); }
		catch (e: any) { out = String(e.stderr || e.message); }
		fs.rmSync(dir, { recursive: true, force: true });
		assert(!/error/i.test(out), `lilypond compiles the output with no error${out.trim() ? ` (${out.trim().split('\n')[0].slice(0, 80)})` : ''}`);
	} else console.log('  (lilypond not installed: compile check skipped)');
	{
		// \\sp, \\spp and \\n are not tested here: the lotus parser does not know them
		// ("uninitialized variable is referred: … n") and drops them before lilylet sees them.
		const back = decodeLilypond(`{ c'4\\sfp c'4\\fz c'4\\ffff c'4\\sf c'4\\sff c'4\\ppppp }`);
		assert(JSON.stringify(dynamicsOf(back)) === '["sfp","fz","ffff","sf","sff","ppppp"]', `LilyPond decoder reads sfp fz ffff sf sff ppppp (got ${JSON.stringify(dynamicsOf(back))})`);
	}

	console.log('\n6. ABC decorations');
	{
		const back = abcDecoder.decode(`X:1\nL:1/4\nM:4/4\nK:C\n!sfp!c !fz!d !sf!e !pppp!f |\n`);
		assert(JSON.stringify(dynamicsOf(back)) === '["sfp","fz","sf","pppp"]', `ABC !sfp! !fz! !sf! !pppp! (got ${JSON.stringify(dynamicsOf(back))})`);
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
};

main();
