/**
 * Tests for deriving measure-layout from MusicXML repeats/voltas/navigation
 * (musicXmlDecoder → metadata.measureLayout via measureLayoutFromXml).
 *
 * Each tests/assets/musicxml/repeat-*.xml carries one repeat feature family
 * (barline repeat, 1st/2nd-ending volta, D.C. al Fine, D.S. al Coda, D.S. al
 * Fine). We assert the decoder produces a measureLayout string whose expanded
 * performed order matches the hand-verified ground truth (cross-checked against
 * verovio 6.2's own MusicXML→MEI <expansion>). See [[lilylet-measure-layout]].
 *
 * Usage: npx tsx tests/unit/measureLayoutFromXml.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { musicXmlDecoder } from '../../source/lilylet';
import { parseMeasureLayout, expandMeasureLayout } from '../../source/lilylet/measureLayout';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const XML_DIR = path.join(process.cwd(), 'tests/assets/musicxml');

// Hand-verified performed orders (1-based decoded measure indices, incl. pickup).
// Cross-checked against verovio 6.2's expansion, except where verovio itself
// failed to expand (ds-al-fine — our derivation from the source <words> is more
// faithful: source is ground truth, not verovio).
const EXPECTED: Record<string, number[]> = {
	'repeat-barline-forward-backward': [1, 2, 3, 4, 1, 2, 3, 4],
	'repeat-volta': [1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15],
	'repeat-ds-al-coda': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21],
	'repeat-ds-al-fine': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 5, 6, 7, 8],
	'repeat-dc-al-fine': [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8, 10],
};

console.log('\nDecode MusicXML repeats → metadata.measureLayout (performed order):');
for (const name of Object.keys(EXPECTED).sort()) {
	const file = path.join(XML_DIR, `${name}.xml`);
	if (!fs.existsSync(file)) { assert(false, `${name}.xml exists`); continue; }
	const doc = musicXmlDecoder.decode(fs.readFileSync(file, 'utf-8'));
	const layout = doc.metadata?.measureLayout;
	if (!layout) { assert(false, `${name}: measureLayout derived (got undefined)`); continue; }
	const got = expandMeasureLayout(parseMeasureLayout(layout));
	const want = EXPECTED[name];
	const ok = JSON.stringify(got) === JSON.stringify(want);
	assert(ok, `${name}: "${layout}" → ${got.length} measures${ok ? '' : `\n      want: ${want.join(' ')}\n      got : ${got.join(' ')}`}`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
