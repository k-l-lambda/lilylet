/**
 * Regression test: fine rhythms (32nds, dotted 16ths, tuplets) must not drift the onset
 * cursor. Onsets stay within [0,1) of the measure and the notes sum to exactly one bar.
 *
 * Bug (found on a Bach cello sample, 2026-07-01): onset extraction called calculateDuration()
 * at the shared DIVISIONS=4 (MusicXML export) resolution, which ROUNDS its result to an
 * integer. At that resolution a 32nd (0.5) rounds to 1 and a dotted 16th (1.5) rounds to 2, so
 * a bar of eight "dotted-16th + 32nd" pairs accumulated to 24 units instead of 16 — onsets
 * drifted past 1.0 (norm 1.06, 1.13, …). Fixed by computing onsets at RES=480 ticks/quarter,
 * fine enough to represent every note/dot/tuplet value exactly.
 *
 * Usage: npx tsx tests/unit/fineRhythmOnset.test.ts
 */

import { parseCode } from "../../source/lilylet/parser";
import { measureOnsets } from "../../source/lilylet/onsets";

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
}

function firstMeasure (code: string) {
	return measureOnsets(parseCode(code))[0];
}

function checkFillsBar (label: string, code: string): void {
	const m = firstMeasure(code);
	const sum = m.notes.reduce((s, n) => s + n.durationDiv, 0);
	const maxNorm = Math.max(...m.notes.map(n => n.onsetNorm));
	assert(sum === m.measureDivisions,
		`${label}: durations sum to one bar (${sum} == ${m.measureDivisions})`);
	assert(maxNorm < 1.0 + 1e-9,
		`${label}: no onset drift past the barline (max onsetNorm=${maxNorm.toFixed(4)})`);
}

console.log("\nFine rhythms fill exactly one bar (no onset drift)");
// the exact Bach-cello shape that surfaced the bug: 8x (dotted-16th + 32nd) = one 4/4 bar
checkFillsBar("8x (16. + 32) in 4/4",
	`\\time 4/4 b16. fs32 g16. b32 e16. d32 c16. d32 c16. a32 b16. d32 g16. fs32 g16. fs32 |`);
// pure 32nds: 32 of them fill a 4/4 bar
checkFillsBar("32x 32nd in 4/4",
	`\\time 4/4 ${Array(32).fill("c32").join(" ")} |`);
// dotted eighth + 16th, 4 pairs = one 4/4 bar
checkFillsBar("4x (8. + 16) in 4/4",
	`\\time 4/4 c8. c16 c8. c16 c8. c16 c8. c16 |`);
// triplet eighths: two groups of 3 fill a 2/4 bar
checkFillsBar("triplet eighths in 2/4",
	`\\time 2/4 \\tuplet 3/2 { c8 c c } \\tuplet 3/2 { c8 c c } |`);

console.log("\nExact onset positions for the dotted-16th+32nd pattern");
{
	const m = firstMeasure(`\\time 4/4 c16. c32 c16. c32 c16. c32 c16. c32 c16. c32 c16. c32 c16. c32 c16. c32 |`);
	// each pair spans 1/8 of the bar; the 8 pair-starts land on 0, .125, .25, …, .875
	const pairStarts = m.notes.filter((_, i) => i % 2 === 0).map(n => +n.onsetNorm.toFixed(3));
	const expect = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
	assert(JSON.stringify(pairStarts) === JSON.stringify(expect),
		`pair onsets = ${JSON.stringify(expect)} (got ${JSON.stringify(pairStarts)})`);
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
