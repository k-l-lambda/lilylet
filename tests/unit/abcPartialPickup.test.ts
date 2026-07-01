/**
 * Tests for ABC pickup / short-bar → \partial derivation in abcDecoder.
 *
 * A bar whose played length is shorter than the active time signature (an anacrusis at
 * bar 1, or a truncated final bar) gets a \partial <bar-length> context event. A length
 * that a single \partial token cannot express (e.g. a 5/8 pickup) is left as a plain short
 * bar rather than emitting a wrong duration. Full-measure rests (Z/R) fill the bar and are
 * never treated as short.
 *
 * Usage: npx tsx tests/unit/abcPartialPickup.test.ts
 */

import { abcDecoder } from '../../source/lilylet';
import type { ContextChange } from '../../source/lilylet/types';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

// Collect "\partial" per 1-based measure index as "division.dots" strings.
const partialsByMeasure = (abc: string): Record<number, string> => {
	const doc = abcDecoder.decode(abc);
	const out: Record<number, string> = {};
	doc.measures.forEach((m, mi) => {
		for (const p of m.parts) for (const v of p.voices) for (const e of v.events) {
			const c = e as ContextChange;
			if (c.type === 'context' && c.partial)
				out[mi + 1] = `${c.partial.division}${'.'.repeat(c.partial.dots || 0)}`;
		}
	});
	return out;
};

console.log('\nABC pickup / short-bar → \\partial:');
{
	// 1-beat pickup in 4/4 → \partial 4 on bar 1 only.
	const p = partialsByMeasure('X:1\nL:1/4\nM:4/4\nK:C\nG | c d e f | g a b c | e2 z2 |]\n');
	assert(p[1] === '4', `quarter pickup → m1 \\partial 4 (got ${JSON.stringify(p)})`);
	assert(p[2] === undefined && p[3] === undefined, `full bars carry no \\partial`);

	// eighth pickup → \partial 8.
	const e = partialsByMeasure('X:1\nL:1/8\nM:4/4\nK:C\nG | c2 d2 e2 f2 | g4 z4 |]\n');
	assert(e[1] === '8', `eighth pickup → m1 \\partial 8 (got ${JSON.stringify(e)})`);

	// dotted pickup in 6/8 (3 eighths) → \partial 4. .
	const d = partialsByMeasure('X:1\nL:1/8\nM:6/8\nK:C\nG3 | c2 d2 e2 f2 | g6 |]\n');
	assert(d[1] === '4.', `dotted-quarter pickup → m1 \\partial 4. (got ${JSON.stringify(d)})`);

	// no pickup → no \partial anywhere.
	const n = partialsByMeasure('X:1\nL:1/4\nM:4/4\nK:C\nc d e f | g a b c |]\n');
	assert(Object.keys(n).length === 0, `complete bars → no \\partial (got ${JSON.stringify(n)})`);

	// truncated final bar (2 of 4 beats) → \partial 2 on that bar.
	const f = partialsByMeasure('X:1\nL:1/4\nM:4/4\nK:C\nc d e f | g a |]\n');
	assert(f[2] === '2', `short final bar → \\partial 2 (got ${JSON.stringify(f)})`);

	// full-measure rest fills the bar → no \partial.
	const r = partialsByMeasure('X:1\nL:1/4\nM:4/4\nK:C\nZ | c d e f |]\n');
	assert(r[1] === undefined, `full-measure rest is not short (got ${JSON.stringify(r)})`);

	// 5/8 pickup is not a single \partial token → left short, no \partial emitted.
	const odd = partialsByMeasure('X:1\nL:1/8\nM:4/4\nK:C\nc d e f g | a b c2 d2 e2 |]\n');
	assert(odd[1] === undefined, `inexpressible 5/8 pickup → no wrong \\partial (got ${JSON.stringify(odd)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
