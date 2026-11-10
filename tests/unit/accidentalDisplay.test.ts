/**
 * Accidental display in the MEI encoder: repeats within a bar, tie continuations, courtesy
 * naturals after a previous bar, and the double sharp's gestural value. Found while
 * transcribing Open Music Theory 2e (openmusictheory-lilylet scripts/v2/images/repro.ts,
 * scripts/v2/scores/repro.ts).
 *
 * Usage: npx tsx tests/unit/accidentalDisplay.test.ts
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
const noteTags = (m: string) => m.match(/<note\b[^>]*>/g) || [];

console.log('\nAccidental display\n' + '─'.repeat(40));

test('an accidental already shown earlier in the bar is not drawn again', () => {
	const tags = noteTags(mei(String.raw`\key c \major \time 4/4 bf'4 a bf c | %1`));
	const shown = tags.filter(t => /\baccid="f"/.test(t)).length;
	assert(shown === 1, `accid="f" drawn on ${shown} notes (expected 1; the second B♭ should carry accid.ges only)`);
	assert(/accid\.ges="f"/.test(tags[2] ?? ''), 'the second B♭ lost its sounding flat');
});

test('a tie continuation into the next bar does not redraw the accidental', () => {
	const tags = noteTags(mei(String.raw`\time 3/4 ef'2.~ | %1
\time 3/4 ef'8 d c4 r | %2`));
	const end = tags.find(t => /tie="t"/.test(t)) ?? '';
	assert(!!end, 'no tie end');
	assert(!/\baccid="f"/.test(end), `tie end draws the flat: ${end}`);
	assert(/accid\.ges="f"/.test(end), 'tie end lost its sounding flat');
});

test('a courtesy ! cancelling an accidental from the previous bar draws the natural', () => {
	const tags = noteTags(mei(String.raw`\time 4/4 as'1 | %1
\time 4/4 a'!1 | %2`));
	assert(/\baccid="n"/.test(tags[1] ?? ''), `bar 2: ${tags[1]}`);
});

// MEI data.ACCIDENTAL.GESTURAL has "ss" for a double sharp; "x" is a written-only value,
// and Verovio warns that it is unsupported.
test('a double sharp is written accid.ges="ss", never "x"', () => {
	const m = mei(String.raw`\key gs \minor fss'4 | %1`);
	assert(!/accid\.ges="x"/.test(m), `got ${(m.match(/accid(\.ges)?="[^"]*"/g) || []).join(' ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
