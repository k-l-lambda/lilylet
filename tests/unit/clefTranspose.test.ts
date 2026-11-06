/**
 * Regression test: clefs can be transposed by arbitrary diatonic intervals.
 *
 * LilyPond clef suffix "_N"/"^N" transposes the clef by the diatonic interval
 * number N ("_" down, "^" up): "treble_8" = octave down, "treble_5" = fifth
 * down, "treble^3" = third up.
 *
 * MEI states the two shapes differently:
 *   - a whole-octave suffix (_8, _15, ^8) is an octave clef: clef.dis /
 *     clef.dis.place on <staffDef>, which draws the 8/15, with the octave folded
 *     into each note's @oct and NO trans.* (Verovio reads @oct relative to a
 *     displaced clef, so trans.* on top would double-transpose MIDI);
 *   - any other interval has no clef.dis form and is att.transposition
 *     (trans.diat / trans.semi) on <staffDef>, written→sounding.
 *
 * Bug before the first fix: the encoder's resolveClef regex only matched _8/_15
 * and mapped them to clef.dis; any other amount (fifth, third) was silently
 * dropped. Bug before the second: every suffix, octaves included, went to trans.*,
 * so an octave clef lost its 8/15 glyph.
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
	{ clef: 'treble_5',  diat: -4,  semi: -7 },	// fifth down
	{ clef: 'treble^3',  diat: 2,   semi: 4 },	// third up
	{ clef: 'treble^2',  diat: 1,   semi: 2 },	// second up
	{ clef: 'treble_m3', diat: -2,  semi: -3 },	// minor third down
];

// Octave clefs: clef string → expected clef.dis / clef.dis.place, and the octave
// folded into the first note's @oct (the snippet's c4 is written oct 4).
const OCTAVE_CASES: { clef: string; dis: string; place: string; oct: number }[] = [
	{ clef: 'treble_8',  dis: '8',  place: 'below', oct: 3 },
	{ clef: 'treble_15', dis: '15', place: 'below', oct: 2 },
	{ clef: 'treble^8',  dis: '8',  place: 'above', oct: 5 },
	{ clef: 'bass_8',    dis: '8',  place: 'below', oct: 3 },
];

console.log('\nOctave clef → MEI clef.dis, octave folded into @oct, no trans.*');

for (const c of OCTAVE_CASES) {
	const mei = encode(parseCode(`\\clef "${c.clef}" c4 d e f |`));
	const sd = mei.split('\n').find(l => /<staffDef/.test(l)) || '';
	assert(sd.includes(`clef.dis="${c.dis}"`) && sd.includes(`clef.dis.place="${c.place}"`),
		`"${c.clef}" → clef.dis="${c.dis}" clef.dis.place="${c.place}" (got: ${sd.match(/clef\.dis[^ ]*/g)?.join(' ') ?? 'none'})`);
	assert(!sd.includes('trans.'), `"${c.clef}" → no trans.* (got: ${sd.match(/trans\.\w+="[^"]*"/g)?.join(' ') ?? 'none'})`);
	const oct = mei.match(/<note\b[^>]*\boct="(\d+)"/)?.[1];
	assert(oct === String(c.oct), `"${c.clef}" → first note oct="${c.oct}" (got ${oct})`);
}

console.log('\nNon-octave clef transposition → MEI att.transposition');

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
