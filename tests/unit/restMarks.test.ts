/**
 * Marks on rests and spacers: text, dynamics, and a markup with no note to attach to.
 * Worksheets put prompts on empty answer bars ("E major", "B:"), and all of these are lost
 * today: the parser drops the marks of a rest/spacer, and the MEI encoder ignores rest
 * marks. Found while converting Open Music Theory 2e
 * (openmusictheory-lilylet scripts/v2/scores/repro.ts, scripts/v2/images/repro.ts).
 *
 * Usage: npx tsx tests/unit/restMarks.test.ts
 */

import { parseCode, meiEncoder } from '../../source/lilylet/index.js';

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
	try { fn(); console.log(`  ✓ ${name}`); passed++; }
	catch (e: any) { console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); failed++; }
};
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

console.log('\nMarks on rests and spacers\n' + '─'.repeat(40));

test('the parser keeps markup on a spacer and on a rest', () => {
	const doc = parseCode(String.raw`c1 | %1
s1^\markup "E major" | %2
r1_\markup "B:" | %3`);
	// events[0] is the leading pitchReset, so look for the rest itself.
	const marks = doc.measures.slice(1).map(m => {
		const rest = (m.parts[0].voices[0].events as any[]).find(e => e.type === 'rest');
		return JSON.stringify(rest?.marks || []);
	});
	assert(marks[0].includes('E major'), `spacer marks: ${marks[0]}`);
	assert(marks[1].includes('B:'), `rest marks: ${marks[1]}`);
});

test('markup on a rest reaches the MEI', () => {
	const mei = meiEncoder.encode(parseCode(String.raw`\time 4/4 r1^\markup "B" | %1`));
	assert(/>B</.test(mei), 'the text "B" is not in the MEI');
});

test('markup on a spacer reaches the MEI', () => {
	const mei = meiEncoder.encode(parseCode(String.raw`\time 4/4 s1^\markup "E major" | %1`));
	assert(/>E major</.test(mei), 'the text "E major" is not in the MEI');
});

test('a dynamic on a rest reaches the MEI', () => {
	const mei = meiEncoder.encode(parseCode(String.raw`\time 4/4 r1\p | %1`));
	assert(/<dynam\b[^>]*>p</.test(mei), 'no <dynam>p</dynam>');
});

// lilylet extension, not LilyPond syntax: a bare `\markup` outside a note is a LilyPond
// error ("markup outside of text script or \lyricmode"), so an export has to reattach it
// to the neighbouring note or spacer. The MEI side is implementable as a <dir> with a
// tstamp, which is why this stays as an assertion rather than a comment.
test('a standalone \\markup in a voice with no note is kept', () => {
	const mei = meiEncoder.encode(parseCode(String.raw`s2 \markup "a" s2 | %1`));
	assert(/>a</.test(mei), 'the text "a" is not in the MEI');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
