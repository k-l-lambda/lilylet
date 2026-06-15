/**
 * Regression test: clefs can be transposed by arbitrary diatonic intervals.
 *
 * LilyPond clef suffix "_N"/"^N" transposes the clef by the diatonic interval
 * number N ("_" down, "^" up): "treble_8" = octave down, "treble_5" = fifth
 * down, "treble^3" = third up. MEI's clef.dis only covers octave displacement
 * (8|15|22), so all clef transposition is encoded via att.transposition
 * (trans.diat / trans.semi) on <staffDef>, written→sounding.
 *
 * Bug before fix: the encoder's resolveClef regex only matched _8/_15 and mapped
 * them to clef.dis; any other amount (fifth, third) was silently dropped.
 *
 * Usage: npx tsx tests/unit/clefTranspose.test.ts
 */

import { parseCode } from '../../source/lilylet/parser';
import { encode } from '../../source/lilylet/meiEncoder';


let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
}

// Encode a single-clef snippet and return the first <staffDef …> line.
function staffDefFor(clef: string): string {
	const doc = parseCode(`\\clef "${clef}" c4 d e f |`);
	const mei = encode(doc);
	return mei.split('\n').find(l => /<staffDef/.test(l)) || '';
}

// Each case: clef string → expected trans.diat / trans.semi (written→sounding).
const CASES: { clef: string; diat: number; semi: number }[] = [
	{ clef: 'treble_8',  diat: -7,  semi: -12 },	// octave down
	{ clef: 'treble_15', diat: -14, semi: -24 },	// two octaves down
	{ clef: 'treble_5',  diat: -4,  semi: -7 },	// fifth down
	{ clef: 'treble^3',  diat: 2,   semi: 4 },	// third up
	{ clef: 'treble^2',  diat: 1,   semi: 2 },	// second up
	{ clef: 'bass_8',    diat: -7,  semi: -12 },	// octave down, bass clef
];

console.log('\nClef arbitrary transposition → MEI att.transposition');

for (const c of CASES) {
	const sd = staffDefFor(c.clef);
	assert(sd.includes(`trans.diat="${c.diat}"`),
		`"${c.clef}" → trans.diat="${c.diat}" (got: ${sd.match(/trans\.diat="[^"]*"/)?.[0] ?? 'none'})`);
	assert(sd.includes(`trans.semi="${c.semi}"`),
		`"${c.clef}" → trans.semi="${c.semi}" (got: ${sd.match(/trans\.semi="[^"]*"/)?.[0] ?? 'none'})`);
}

// A plain clef must NOT emit any transposition attributes.
console.log('\nPlain clef has no transposition');
{
	const sd = staffDefFor('treble');
	assert(!sd.includes('trans.diat') && !sd.includes('trans.semi'),
		`"treble" → no trans.* attributes (got: ${sd.trim()})`);
}

// Correct clef shape/line must still be emitted alongside the transposition.
console.log('\nShape/line preserved with transposition');
{
	const sd = staffDefFor('bass_8');
	assert(sd.includes('clef.shape="F"') && sd.includes('clef.line="4"'),
		`"bass_8" keeps clef.shape="F" clef.line="4"`);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
