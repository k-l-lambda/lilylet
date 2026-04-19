/**
 * Unit tests for voice.staff parsing edge cases from GPT review of the
 * leadingStaff fix (commit c0763a4, 47fcf61).
 *
 * Cases:
 *   A. non-staff context before \staff "N" in same voice line
 *   B. second voice after \\ with no explicit \staff (fallback)
 *   C. trailing | + newline → spurious empty measure filtered
 *   D. measure with only \bar → filtered as empty
 *
 * Usage: npx tsx tests/unit/voiceStaffParsing.test.ts
 */

import { parseCode } from '../../source/lilylet/parser.js';
import type { Voice } from '../../source/lilylet/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

function voiceStaff(lyl: string, measureIdx = 0, voiceIdx = 0): number {
	const doc = parseCode(lyl);
	return doc.measures[measureIdx]?.parts[0]?.voices[voiceIdx]?.staff ?? -1;
}

function measureCount(lyl: string): number {
	return parseCode(lyl).measures.length;
}


// ─── Case A1: \clef before \staff "2" ────────────────────────────────────────

console.log('\nCase A1: \\clef before \\staff "2" — staff must be 2');
{
	const lyl = `\\clef "bass" \\staff "2" c4 d e f |`;
	assert(voiceStaff(lyl) === 2,
		`\\clef "bass" \\staff "2" c4 → voice.staff=2 (got ${voiceStaff(lyl)})`);
}


// ─── Case A2: \key before \staff "2" ─────────────────────────────────────────

console.log('\nCase A2: \\key before \\staff "2" — staff must be 2');
{
	const lyl = `\\key g \\major \\staff "2" c4 d e f |`;
	assert(voiceStaff(lyl) === 2,
		`\\key g \\major \\staff "2" → voice.staff=2 (got ${voiceStaff(lyl)})`);
}


// ─── Case A3: \time \clef \key before \staff "2" \times ──────────────────────

console.log('\nCase A3: multiple context events before \\staff "2" \\times');
{
	const lyl = `\\time 4/4 \\clef "treble" \\key c \\major \\staff "2" \\times 2/3 { c8 d e } r2. |`;
	const staff = voiceStaff(lyl);
	assert(staff === 2,
		`context chain before \\staff "2" → voice.staff=2 (got ${staff})`);
}


// ─── Case A4: \staff "1" first, cross-staff switch — staff must be 1 ─────────

console.log('\nCase A4: \\staff "1" then \\staff "2" — leading staff is 1');
{
	const lyl = `\\staff "1" c4 d \\staff "2" e f |`;
	assert(voiceStaff(lyl) === 1,
		`\\staff "1" c4 d \\staff "2" e f → voice.staff=1 (got ${voiceStaff(lyl)})`);
}


// ─── Case B1: second voice after \\ with no explicit \staff ──────────────────

console.log('\nCase B1: second voice (no leading \\staff) inherits staff=1 default');
{
	const lyl = `\\staff "1" c4 d e f \\\\ c4 d e f |`;
	const doc = parseCode(lyl);
	const voices = doc.measures[0]?.parts[0]?.voices ?? [];
	assert(voices.length === 2, `two voices parsed (got ${voices.length})`);
	assert(voices[0].staff === 1, `voice 0 staff=1 (got ${voices[0]?.staff})`);
	// voice 1 has no \staff → falls back to currentStaff=1 from part_start
	assert(voices[1].staff === 1, `voice 1 (no \\ staff) defaults to staff=1 (got ${voices[1]?.staff})`);
}


// ─── Case B2: \\ then \staff "2" ─────────────────────────────────────────────

console.log('\nCase B2: second voice starts with \\staff "2"');
{
	const lyl = `\\staff "1" c4 d e f \\\\ \\staff "2" c4 d e f |`;
	const doc = parseCode(lyl);
	const voices = doc.measures[0]?.parts[0]?.voices ?? [];
	assert(voices.length === 2, `two voices parsed (got ${voices.length})`);
	assert(voices[1].staff === 2, `voice 1 \\staff "2" → staff=2 (got ${voices[1]?.staff})`);
}


// ─── Case C: trailing newline after last | — no spurious measure ─────────────

console.log('\nCase C: trailing newline after last | — no spurious empty measure');
{
	// lyl with explicit trailing newline
	const lyl = `\\staff "1" c4 d e f |\n`;
	const count = measureCount(lyl);
	assert(count === 1, `exactly 1 measure (got ${count})`);
}


// ─── Case D: measure with only \bar — filtered as empty ──────────────────────

console.log('\nCase D: measure with only \\bar "|." — filtered as empty');
{
	const lyl = `\\staff "1" c4 d e f | \\bar "|." |`;
	const count = measureCount(lyl);
	// The real measure (c4 d e f) is kept; the barline-only measure is filtered
	assert(count === 1, `barline-only measure filtered, 1 real measure remains (got ${count})`);
}


// ─── Case E: measure with notes then trailing empty measure ──────────────────

console.log('\nCase E: two real measures, no spurious third');
{
	const lyl = `\\staff "1" c4 d e f | g4 a b c |\n`;
	const count = measureCount(lyl);
	assert(count === 2, `exactly 2 measures (got ${count})`);
}


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
