/**
 * Spanners and voice state inside \tuplet { … }. Each of these is dropped or lost by the
 * MEI encoder today, though the same input outside a tuplet works. Found while
 * transcribing Open Music Theory 2e (openmusictheory-lilylet scripts/v2/images/repro.ts).
 *
 * Usage: npx tsx tests/unit/tupletContents.test.ts
 */

import { parseCode, meiEncoder } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try { fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const mei = (code: string) => meiEncoder.encode(parseCode(code));
const count = (s: string, re: RegExp) => (s.match(re) || []).length;

console.log('\n\\tuplet contents\n' + '─'.repeat(40));

test('a slur wholly inside a \\tuplet is kept', () => {
	const m = mei(String.raw`\time 2/4 \tuplet 3/2 { c'8([ e g)] } c4 | %1`);
	assert(count(m, /<slur\b/g) === 1, `expected 1 <slur>, got ${count(m, /<slur\b/g)}`);
});

test('a hairpin starting inside a \\tuplet is kept', () => {
	const m = mei(String.raw`\time 2/4 \tuplet 3/2 { b'2 c4\< } | %1
\time 2/4 d2\! | %2`);
	assert(/<hairpin\b[^>]*form="cres"/.test(m), 'no crescendo <hairpin>');
});

test('a tie from the last note of a \\tuplet reaches the next note', () => {
	const m = mei(String.raw`\time 2/2 \tuplet 3/2 { c''4 c8~ } c4 r2 | %1`);
	assert(/tie="i"/.test(m) && /tie="t"/.test(m), `tie attributes: ${(m.match(/tie="\w"/g) || []).join(' ') || 'none'}`);
});

test('a \\staff switch inside a \\tuplet moves the following notes', () => {
	const m = mei(String.raw`[staves "{-}"]
\time 2/4 \staff "1" \tuplet 3/2 { c''8[ c \staff "2" c,] } r4 \\ \staff "2" \clef "bass" s2 | %1`);
	assert(/<note\b[^>]*\bstaff="2"/.test(m), 'the third tuplet note is not cross-staff to staff 2');
});

test('\\stemUp reaches the notes inside a following \\tuplet', () => {
	const m = mei(String.raw`\time 4/4 \stemUp b'4 b \tuplet 3/2 { b4 b b } | %1`);
	assert(count(m, /stem\.dir="up"/g) === 5, `stem.dir="up" on ${count(m, /stem\.dir="up"/g)} of 5 notes`);
});

// Not just an encoder gap: the grammar drops every non-note/rest/context event inside
// `\tuplet { … }` (see `tuplet_event` in lilylet.jison), and `TupletEvent.events` is typed
// `(NoteEvent | RestEvent | ContextChange)[]`, so it cannot hold a nested tuplet at all.
// Implementing this means widening the type, not just the encoder.
test('a \\tuplet nested in a \\tuplet is encoded', () => {
	const m = mei(String.raw`\time 2/4 \tuplet 3/2 { c'8 \tuplet 3/2 { d16 e f } g8 } r4 | %1`);
	assert(/pname="e"/.test(m), 'the nested tuplet\'s notes are missing');
	assert(count(m, /<tuplet\b/g) === 2, `expected 2 <tuplet>, got ${count(m, /<tuplet\b/g)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
