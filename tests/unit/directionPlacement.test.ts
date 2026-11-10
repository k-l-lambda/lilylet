/**
 * Placement of dynamics and navigation marks in the MEI. `^`/`_` on a dynamic is ignored,
 * and \segno / \coda come out as <dir> elements without place (or staff), so Verovio draws
 * them below the staff or not at all. Found while transcribing Open Music Theory 2e
 * (openmusictheory-lilylet scripts/v2/images/repro.ts).
 *
 * Usage: npx tsx tests/unit/directionPlacement.test.ts
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

const SEGNO = '\u{1D10B}';
const CODA = '\u{1D10C}';
/** The element that carries a navigation mark: a <dir> with its glyph, or a <repeatMark>. */
const navElement = (m: string, glyph: string, func: string) =>
	(m.match(new RegExp(`<dir\\b[^>]*>[^<]*${glyph}`, 'u')) || m.match(new RegExp(`<repeatMark\\b[^>]*func="${func}"[^>]*>`)) || [''])[0];

console.log('\nDirection placement\n' + '─'.repeat(40));

test('^ puts a dynamic above the staff', () => {
	assert(/<dynam\b[^>]*place="above"/.test(mei(String.raw`\time 4/4 c'1^\p | %1`)), 'no <dynam place="above">');
});

test('_ puts a dynamic below the staff', () => {
	assert(/<dynam\b[^>]*place="below"/.test(mei(String.raw`\time 4/4 c'1_\p | %1`)), 'no <dynam place="below">');
});

test('\\segno is placed above its staff', () => {
	const el = navElement(mei(String.raw`\time 4/4 a'1\segno | %1`), SEGNO, 'segno');
	assert(!!el, 'no segno in the MEI');
	assert(/place="above"/.test(el) && /\bstaff="\d+"/.test(el), `segno element: ${el}`);
});

test('\\coda is placed above its staff', () => {
	const el = navElement(mei(String.raw`\time 4/4 a'1\coda | %1`), CODA, 'coda');
	assert(!!el, 'no coda in the MEI');
	assert(/place="above"/.test(el) && /\bstaff="\d+"/.test(el), `coda element: ${el}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
