/**
 * Unit tests for \partial syntax — duration check and warning emission.
 */

import { parseCode, getParseWarnings } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try {
		fn();
		console.log(`  ✓ ${name}`);
		passed++;
	} catch (e) {
		console.log(`  ✗ ${name}: ${e}`);
		failed++;
	}
};

const assert = (cond: boolean, msg: string) => {
	if (!cond) throw new Error(msg);
};

console.log('\n\\partial warning tests\n' + '─'.repeat(40));

// ── 1. Correct usage: \partial 8 with one eighth note ─────────────────────
parseCode('\\staff "1" \\time 2/4 \\partial 8 b8 | %1\n\\staff "1" \\time 2/4 c4 c | %2');
test('no warning when partial matches voice duration (eighth)', () => {
	const w = getParseWarnings();
	assert(w.length === 0, `expected 0 warnings, got ${w.length}: ${JSON.stringify(w)}`);
});

// ── 2. Mismatch: \partial 8 but voice has a quarter note (480 ≠ 240) ──────
parseCode('\\staff "1" \\time 2/4 \\partial 8 c4 | %1\n\\staff "1" \\time 2/4 c4 c | %2');
test('warning when partial declares 8 but voice has quarter note', () => {
	const w = getParseWarnings();
	assert(w.length === 1, `expected 1 warning, got ${w.length}`);
	assert(w[0].type === 'partial-mismatch', 'wrong type');
	assert(w[0].declared === 240, `declared=${w[0].declared}`);
	assert(w[0].actual === 480, `actual=${w[0].actual}`);
});

// ── 3. Dotted partial: \partial 4. with c4 c8 (720 ticks each) ───────────
parseCode('\\staff "1" \\time 3/4 \\partial 4. c4 c8 | %1\n\\staff "1" \\time 3/4 c4 c c | %2');
test('no warning for dotted \partial 4. with matching 720-tick voice', () => {
	const w = getParseWarnings();
	assert(w.length === 0, `expected 0 warnings, got ${w.length}`);
});

// ── 4. Partial stored as context event and measure.partial set ────────────
const doc = parseCode('\\staff "1" \\time 2/4 \\partial 8 b8 | %1\n\\staff "1" \\time 2/4 c4 c | %2');
test('\\partial creates context event with partial duration', () => {
	const voice = doc.measures[0].parts[0].voices[0];
	const partialCtx = voice.events.find(e => (e as any).type === 'context' && (e as any).partial);
	assert(!!partialCtx, 'no partial context event found');
	assert((partialCtx as any).partial.division === 8, 'wrong division');
	assert(((partialCtx as any).partial.dots || 0) === 0, 'wrong dots');
});

test('measure.partial is true when \\partial is declared', () => {
	assert(doc.measures[0].partial === true, 'measure.partial not true');
	assert(!doc.measures[1].partial, 'second measure should not be partial');
});

// ── 5. No warning for spacer-only voice ───────────────────────────────────
parseCode('\\staff "1" \\time 2/4 \\partial 8 b8 \\\\\n\\staff "1" s8 | %1\n\\staff "1" \\time 2/4 c4 c | %2');
test('no warning for spacer-only voice even if it has different ticks', () => {
	const w = getParseWarnings();
	assert(w.length === 0, `expected 0 warnings, got ${w.length}`);
});


console.log('\n' + '─'.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
