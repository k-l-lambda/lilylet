/**
 * Regression test: octave-/interval-transposing clefs affect SOUNDING MIDI pitch in onset
 * extraction, and the clef PERSISTS across measures.
 *
 * Bug (found on a Rachmaninoff SATB choral sample, 2026-07-01): the AST onset server computed
 * MIDI pitch from the WRITTEN note, ignoring the clef's written→sounding transposition. A
 * "treble_8" tenor voice (written an octave above sounding) therefore plotted an octave too
 * high, mismatching the actual MIDI by 12 semitones — and the clef, set once in the first
 * measure, must keep applying to every later measure of that voice.
 *
 * Usage: npx tsx tests/unit/clefOnsetTranspose.test.ts
 */

import { parseCode } from "../../source/lilylet/parser";
import { measureOnsets, clefShift } from "../../source/lilylet/onsets";

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

// sounding MIDI pitches present in measure `idx` (1-based), grouped by voice index.
function midiByVoice (doc: any, idx: number): Record<number, number[]> {
	const m = measureOnsets(doc).find(x => x.index === idx)!;
	const byV: Record<number, Set<number>> = {};
	for (const n of m.notes)
		for (const p of n.midi)
			(byV[n.voice] ??= new Set<number>()).add(p);
	const out: Record<number, number[]> = {};
	for (const v of Object.keys(byV))
		out[+v] = [...byV[+v]].sort((a, b) => a - b);
	return out;
}

console.log("\nclefShift() semitone table");
{
	assert(clefShift("treble") === 0, `"treble" → 0`);
	assert(clefShift("treble_8") === -12, `"treble_8" → -12 (octave down)`);
	assert(clefShift("treble^8") === 12, `"treble^8" → +12 (octave up)`);
	assert(clefShift("treble_15") === -24, `"treble_15" → -24 (two octaves down)`);
	assert(clefShift("bass_8") === -12, `"bass_8" → -12`);
	assert(clefShift("treble_5") === -7, `"treble_5" → -7 (fifth down)`);
}

// A single "treble_8" voice: written g' (G4=67) SOUNDS an octave lower (G3=55).
console.log("\nsingle treble_8 voice sounds an octave lower");
{
	const doc = parseCode(`\\clef "treble_8" g'4 g g g |`);
	const by = midiByVoice(doc, 1);
	assert(JSON.stringify(by[0]) === JSON.stringify([55]),
		`written g' under treble_8 → sounding [55] (got ${JSON.stringify(by[0])})`);
}

// The SATB shape that surfaced the bug: 3 voices, tenor on treble_8, clef set in measure 1
// and NOT repeated in measure 2 — it must keep transposing measure 2.
console.log("\nSATB treble_8 tenor + clef persists across measures");
{
	const code =
		`\\time 4/4 \\clef "treble" d'4 d d d \\\\\n` +
		`\\clef "treble" b4 b b b \\\\\n` +
		`\\clef "treble_8" g'4 g g g | %1\n\n` +
		`d'4 d d d \\\\\n` +
		`b4 b b b \\\\\n` +
		`g'4 g g g | %2\n`;
	const doc = parseCode(code);
	const m1 = midiByVoice(doc, 1);
	const m2 = midiByVoice(doc, 2);
	// soprano d'=D5=74 (plain), alto b=B3=59 (plain), tenor g'=G4 written → G3=55 (treble_8)
	assert(JSON.stringify(m1[0]) === JSON.stringify([74]), `m1 soprano (treble) → [74] (got ${JSON.stringify(m1[0])})`);
	assert(JSON.stringify(m1[1]) === JSON.stringify([59]), `m1 alto (treble) → [59] (got ${JSON.stringify(m1[1])})`);
	assert(JSON.stringify(m1[2]) === JSON.stringify([55]), `m1 tenor (treble_8) → [55] (got ${JSON.stringify(m1[2])})`);
	assert(JSON.stringify(m2[2]) === JSON.stringify([55]),
		`m2 tenor STILL transposed (clef persists) → [55] (got ${JSON.stringify(m2[2])})`);
	// guard against the pre-fix behavior (written pitch, no shift → 67)
	assert(!(m2[2] && m2[2].includes(67)), `m2 tenor must NOT be the written G4=67 (pre-fix bug)`);
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
