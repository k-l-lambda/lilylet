/**
 * Hairpins: state across barlines, and what `\!` ends. Found while transcribing Open Music
 * Theory 2e (openmusictheory-lilylet scripts/v2/images/repro.ts, scripts/v2/scores/repro.ts).
 *
 * Usage: npx tsx tests/unit/hairpinSpans.test.ts
 */

import { parseCode, meiEncoder } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try { fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const hairpinMarks = (code: string): string[][] => (parseCode(code).measures[0].parts[0].voices[0].events as any[])
	.filter(e => e.type === 'note').map(e => (e.marks || []).filter((m: any) => m?.markType === 'hairpin').map((m: any) => m.type));

console.log('\nHairpin spans\n' + '─'.repeat(40));

// The encoder keeps a pending hairpin open across the barline and never clears it after
// `\!`, so the next hairpin ends at the wrong note and an extra one appears.
test('a hairpin across a barline closes, and the next one is independent', () => {
	const mei = meiEncoder.encode(parseCode(String.raw`\time 2/8 c'8\< d | %1
\time 2/8 e'8 f\! | %2
\time 2/8 g'8\> a | %3
\time 2/8 b'8 c\! | %4`));
	const pins = mei.match(/<hairpin\b[^>]*>/g) || [];
	assert(pins.length === 2, `expected 2 <hairpin>, got ${pins.length}`);
	assert(/form="cres"/.test(pins[0]) && /form="dim"/.test(pins[1]), `forms: ${pins.map(p => (p.match(/form="(\w+)"/) || [])[1]).join(', ')}`);
});

// The grammar maps every `\!` to crescendoEnd. MEI comes out right, but the AST is wrong
// for consumers that read it (serializers, analysers).
test('\\! after \\> ends a diminuendo in the AST', () => {
	const marks = hairpinMarks(String.raw`c4\> d e\! f | %1`);
	assert(JSON.stringify(marks[2]) === '["diminuendoEnd"]', `third note: ${JSON.stringify(marks[2])}`);
});

test('\\! after \\< still ends a crescendo', () => {
	const marks = hairpinMarks(String.raw`c4\< d e\! f | %1`);
	assert(JSON.stringify(marks[2]) === '["crescendoEnd"]', `third note: ${JSON.stringify(marks[2])}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
