/**
 * The tenor clef is a C clef on the 4th line: middle C sits on that line.
 *
 * Before the fix lilylet's clef model had only treble / bass / alto. The grammar
 * accepts any \clef string, so "tenor" parsed, but each layer then did its own
 * wrong thing: the MEI encoder fell back to a treble clef (middle C drawn on a
 * ledger line below the staff), the MusicXML encoder dropped the <clef>, and the
 * MusicXML and ABC decoders turned every C clef into alto.
 *
 * Checked against what Verovio draws, not just the attributes.
 *
 * Usage: npx tsx tests/unit/tenorClef.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
	parseCode, serializeLilyletDoc, meiEncoder, musicXmlEncoder, musicXmlDecoder,
	lilypondEncoder, lilypondDecoder, abcDecoder,
} from '../../source/lilylet';
import { ContextChange, LilyletDoc } from '../../source/lilylet/types';

const CASE = fs.readFileSync(path.join(import.meta.dirname, '../assets/unit-cases/clefs-tenor.lyl'), 'utf-8');

let passed = 0;
let failed = 0;
function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const attr = (tag: string, name: string): string | undefined =>
	tag.match(new RegExp(`\\s${name.replace(/\./g, '\\.')}="([^"]*)"`))?.[1];

const clefsOf = (doc: LilyletDoc): string[] => {
	const out: string[] = [];
	for (const measure of doc.measures)
		for (const part of measure.parts)
			for (const voice of part.voices)
				for (const event of voice.events)
					if (event.type === 'context' && (event as ContextChange).clef) out.push((event as ContextChange).clef as string);
	return out;
};

const main = async (): Promise<void> => {
	console.log('\n1. MEI: the tenor clef is C on line 4');
	const mei = meiEncoder.encode(parseCode(CASE));
	{
		const sd = (mei.match(/<staffDef\b[^>]*>/) || [''])[0];
		assert(attr(sd, 'clef.shape') === 'C' && attr(sd, 'clef.line') === '4',
			`staffDef clef.shape="C" clef.line="4" (got ${attr(sd, 'clef.shape')}${attr(sd, 'clef.line')})`);
		const inline = [...mei.matchAll(/<clef\b[^>]*>/g)].map(m => `${attr(m[0], 'shape')}${attr(m[0], 'line')}`);
		assert(JSON.stringify(inline) === JSON.stringify(['G2', 'C4']), `inline clefs G2, C4 (got ${inline.join(', ')})`);
		const octs = [...mei.matchAll(/<note\b[^>]*>/g)].map(m => `${attr(m[0], 'pname')}${attr(m[0], 'oct')}`);
		assert(octs[0] === 'c4' && octs[2] === 'c4' && octs[3] === 'c4', `middle C stays c4 (got ${octs.join(' ')})`);
	}

	console.log('\n2. Verovio draws a C clef on line 4 with middle C on line 4');
	{
		// @ts-ignore
		const { default: createVerovioModule } = await import('verovio/wasm');
		// @ts-ignore
		const { VerovioToolkit } = await import('verovio/esm');
		const vrv = new VerovioToolkit(await createVerovioModule());
		vrv.setOptions({ svgViewBox: false, breaks: 'none' });
		vrv.loadData(mei);
		const svg: string = vrv.renderToSVG(1);
		const lines = [...svg.slice(svg.indexOf('class="staff"')).matchAll(/<path d="M\d+ (\d+) L/g)].slice(0, 5).map(m => +m[1]);
		// staff line number (1 = bottom) of a y coordinate
		const lineOf = (y: number): number => (lines[4] - y) / ((lines[4] - lines[0]) / 4) + 1;
		const clefs = [...svg.matchAll(/class="clef"[^>]*>\s*<use xlink:href="#(E[0-9A-F]{3})[^"]*" transform="translate\(\d+, (\d+)\)/g)]
			.map(m => ({ glyph: m[1], line: lineOf(+m[2]) }));
		const heads = [...svg.matchAll(/class="notehead">\s*<use[^>]*translate\(\d+, (\d+)\)/g)].map(m => lineOf(+m[1]));
		// SMuFL: E05C cClef (full size), E07B cClefChange (mid-staff); E050 gClef.
		const isC = (g: string) => g === 'E05C' || g === 'E07B';
		assert(clefs.length === 3, `3 clefs drawn (got ${clefs.length})`);
		assert(isC(clefs[0]?.glyph) && Math.abs(clefs[0].line - 4) < 1e-6, `initial clef: C glyph on line 4 (got ${clefs[0]?.glyph} on line ${clefs[0]?.line})`);
		assert(isC(clefs[2]?.glyph) && Math.abs(clefs[2].line - 4) < 1e-6, `clef change: C glyph on line 4 (got ${clefs[2]?.glyph} on line ${clefs[2]?.line})`);
		assert(Math.abs(heads[0] - 4) < 1e-6 && Math.abs(heads[3] - 4) < 1e-6, `middle C noteheads on line 4 under the tenor clef (got ${heads[0]}, ${heads[3]})`);
		assert(Math.abs(heads[2] - 0) < 1e-6, `control: middle C under the treble clef sits on the first ledger line below (got line ${heads[2]})`);
	}

	console.log('\n3. MusicXML: encoded as C/4, read back as tenor; C/3 still alto');
	{
		const xml = musicXmlEncoder.encode(parseCode(CASE));
		const clef = (xml.match(/<clef>[\s\S]*?<\/clef>/) || [''])[0];
		assert(/<sign>C<\/sign>/.test(clef) && /<line>4<\/line>/.test(clef), `<clef><sign>C</sign><line>4</line> (got ${clef.replace(/\s+/g, ' ') || 'no <clef>'})`);
		const back = clefsOf(musicXmlDecoder.decode(xml));
		assert(back[0] === 'tenor', `decoded back as tenor (got ${back.join(', ')})`);
		const alto = clefsOf(musicXmlDecoder.decode(musicXmlEncoder.encode(parseCode(`\\clef "alto" c1 |\n`))));
		assert(alto[0] === 'alto', `C on line 3 still decodes as alto (got ${alto[0]})`);
	}

	console.log('\n4. ABC: clef=tenor is tenor, not alto');
	{
		const doc = abcDecoder.decode(`X:1\n%%score (1)\nL:1/4\nM:4/4\nV:1 clef=tenor\nK:C\n[V:1] c c c c |\n`);
		assert(clefsOf(doc)[0] === 'tenor', `clef=tenor → tenor (got ${clefsOf(doc)[0]})`);
		const alto = abcDecoder.decode(`X:1\n%%score (1)\nL:1/4\nM:4/4\nV:1 clef=alto\nK:C\n[V:1] c c c c |\n`);
		assert(clefsOf(alto)[0] === 'alto', `clef=alto → alto (got ${clefsOf(alto)[0]})`);
	}

	console.log('\n5. LilyPond and .lyl: "tenor" written and read back');
	{
		const doc = parseCode(CASE);
		assert(serializeLilyletDoc(doc).includes('\\clef "tenor"'), '.lyl serializer writes \\clef "tenor"');
		const ly = lilypondEncoder.encode(doc);
		assert(ly.includes('\\clef "tenor"'), 'LilyPond encoder writes \\clef "tenor"');
		const back = clefsOf(lilypondDecoder.decode(`\\score { \\new Staff { \\clef tenor c'4 c'4 c'4 c'4 } }`));
		assert(back[0] === 'tenor', `LilyPond \\clef tenor decodes to tenor (got ${back[0] ?? 'NO CLEF EVENT'})`);
		const back8 = clefsOf(lilypondDecoder.decode(`\\score { \\new Staff { \\clef "tenor_8" c'4 c'4 c'4 c'4 } }`));
		assert(back8[0] === 'tenor_8', `LilyPond \\clef "tenor_8" keeps its suffix (got ${back8[0] ?? 'NO CLEF EVENT'})`);
		const mei8 = meiEncoder.encode(parseCode(`\\clef "tenor_8" c1 |\n`));
		const sd8 = (mei8.match(/<staffDef\b[^>]*>/) || [''])[0];
		assert(attr(sd8, 'clef.shape') === 'C' && attr(sd8, 'clef.line') === '4' && attr(sd8, 'clef.dis') === '8',
			`tenor_8 → C4 with clef.dis="8" (got ${attr(sd8, 'clef.shape')}${attr(sd8, 'clef.line')} dis=${attr(sd8, 'clef.dis')})`);
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
};

main();
