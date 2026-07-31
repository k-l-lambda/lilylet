/**
 * Regression test for immutable AST chromatic transposition.
 *
 * Every sounding MIDI pitch in the transposed AST must equal the original pitch
 * plus the requested semitone offset, including chords and nested tuplets.
 *
 * Usage: npx tsx tests/unit/astTranspose.test.ts
 */

import assert from "node:assert/strict";
import { parseCode } from "../../source/lilylet/parser";
import { measureOnsets } from "../../source/lilylet/onsets";
import { transposeDoc, transposePitch } from "../../source/lilylet/transposition";
import { Accidental, Phonet } from "../../source/lilylet/types";

const code = String.raw`\time 4/4 \key e \major
\clef "treble" cff8 cs8 d8 ds8 e8 f8 fs8 g8 |
\times 2/3 { a8 b8 <c' e' g'>8 } d4\rest |
\repeat tremolo 4 { <c g'>16 <d a'>16 } r2 |
\clef "bass" c,4 <d, fs, a,>4 \key c \minor g,4 r4 |
`;

const flattenMidi = (doc: ReturnType<typeof parseCode>): number[] =>
	measureOnsets(doc).flatMap(measure => measure.notes.flatMap(note => note.midi));

const flattenShape = (doc: ReturnType<typeof parseCode>) =>
	measureOnsets(doc).flatMap(measure => measure.notes.map(note => ({
		onset: note.onset,
		durationDiv: note.durationDiv,
		staff: note.staff,
		voice: note.voice,
		grace: note.grace,
		midiLength: note.midi.length,
	})));

const original = parseCode(code);
const originalSnapshot = JSON.stringify(original);
const originalMidi = flattenMidi(original);
const originalShape = flattenShape(original);

let passed = 0;
let failed = 0;
const check = (condition: boolean, message: string): void => {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
};

for (const semitones of [-13, -1, 0, 1, 5, 12]) {
	console.log(`\nTransposition ${semitones >= 0 ? "+" : ""}${semitones} semitones`);
	const transposed = transposeDoc(original, semitones);
	const actualMidi = flattenMidi(transposed);
	const actualShape = flattenShape(transposed);

	check(actualMidi.length === originalMidi.length, "pitch count is unchanged");
	check(JSON.stringify(actualMidi) === JSON.stringify(originalMidi.map(midi => midi + semitones)),
		"every MIDI pitch has the exact requested offset");
	check(JSON.stringify(actualShape) === JSON.stringify(originalShape),
		"onset, duration, staff, voice, grace, and chord shape are unchanged");
	check(JSON.stringify(original) === originalSnapshot, "source AST is not mutated");

	// The transformed AST is the comparison target. The serializer uses relative
	// octave inference, so its textual roundtrip is covered by the existing
	// serializer suite rather than being conflated with this pitch transform test.
}

assert.throws(() => transposeDoc(original, 0.5), /finite integer/);
assert.throws(() => transposeDoc(original, Number.NaN), /finite integer/);

const flatResult = transposePitch({ phonet: Phonet.d, octave: 0 }, -1);
assert.equal(flatResult.phonet, Phonet.d);
assert.equal(flatResult.accidental, Accidental.flat);

console.log(`\n${"═".repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
