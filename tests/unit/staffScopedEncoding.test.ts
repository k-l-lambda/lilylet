/**
 * Things that belong to a staff or span staves/bars: per-staff key signatures, cross-staff
 * notes in a later part, slurs between staves of one voice, and where a slur over a barline
 * is encoded. Found while transcribing Open Music Theory 2e
 * (openmusictheory-lilylet scripts/v2/images/repro.ts, scripts/v2/scores/repro.ts).
 *
 * Usage: npx tsx tests/unit/staffScopedEncoding.test.ts
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
const measures = (m: string) => m.match(/<measure\b[\s\S]*?<\/measure>/g) || [];

console.log('\nStaff-scoped encoding\n' + '─'.repeat(40));

// A transposing instrument (or bitonal writing) needs its own key signature. Today the key
// goes on <scoreDef> only, so every staff shows the first part's key.
test('each staff gets its own key signature', () => {
	// One part, two staves: `\\` separates voices, and `\staff` picks the staff.
	// (`\\\\` would separate parts, which is a different case - see the next test.)
	const m = mei(String.raw`[staves "{-}"]
\staff "1" \key c \major \time 4/4 c'1 \\
\staff "2" \key a \major \time 4/4 a1 | %1`);
	const staff2 = (m.match(/<staffDef\b[^>]*\bn="2"[^>]*>(?:[\s\S]*?<\/staffDef>)?/) || [''])[0];
	assert(/key\.sig="3s"|<keySig\b[^>]*sig="3s"/.test(staff2), `staff 2 has no A major key: ${staff2.slice(0, 160)}`);
});

// In part 2 of a score, `\staff "2"` means that part's second staff, which is staff 3
// of the whole score.
test('cross-staff \\staff "2" in the second part lands on that part\'s second staff', () => {
	const m = mei(String.raw`[staves "<voice> {pr-pl}"]
\time 4/4 c'1 \\\\
\time 4/4 \staff "1" e'4 \staff "2" g,4 c2 \\ \staff "2" \clef "bass" c,1 | %1`);
	assert(/<note\b[^>]*\bstaff="3"/.test(m), 'the cross-staff G is not on staff 3');
});

test('a slur between staves of one voice is kept', () => {
	const m = mei(String.raw`[staves "{-}"]
\time 4/4 \staff "1" c'4( d e f | %1
\time 4/4 \staff "1" e'4 \staff "2" c,2. | %2
\time 4/4 \staff "2" c4) r r2 | %3`);
	assert((m.match(/<slur\b/g) || []).length === 1, `expected 1 <slur>, got ${(m.match(/<slur\b/g) || []).length}`);
});

// A spanner is encoded in the measure where it starts; Verovio warns otherwise.
test('a slur across a barline is encoded in its start measure', () => {
	const ms = measures(mei(String.raw`c2( d | %1

e2) f | %2`));
	assert(/<slur\b/.test(ms[0] ?? ''), `the slur is in measure ${ms.findIndex(x => /<slur\b/.test(x)) + 1}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
