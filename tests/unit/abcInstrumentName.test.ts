/**
 * Tests that ABC voice instrument names (V:n nm="…" snm="…") carrying literal
 * escape sequences are DECODED into the doc model, so the serializer re-encodes
 * them exactly once.
 *
 * ABC quoted strings use literal escapes: `nm="Violin\nsolo"` is the characters
 * V-i-o-l-i-n-\-n-s-o-l-o. The lilylet doc model holds decoded strings (a real
 * newline), and serializer.escapeString re-encodes a real newline back to `\n`.
 * Without decoding at import, the stored backslash gets escaped a second time
 * (`\n` → `\\n`) — the bug this guards against.
 *
 * Usage: npx tsx tests/unit/abcInstrumentName.test.ts
 */

import { abcDecoder } from '../../source/lilylet';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import { parseCode } from '../../source/lilylet/parser';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

// nm carries a literal "\n" (backslash + n) — ABC's line-break convention.
const abc = String.raw`X:1
%%score {(1 2)}
L:1/4
M:4/4
V:1 nm="Violin\nsolo" snm="Vln"
V:2 nm="Cello"
K:C
[V:1] C D E F |
[V:2] C, D, E, F, |
`;

console.log('\nABC instrument name literal-escape decoding:');
{
	const doc = abcDecoder.decode(abc);
	const instr = doc.metadata?.instruments?.['1'];

	// doc model holds a REAL newline, not the two characters backslash+n.
	assert(instr?.name === 'Violin\nsolo',
		`doc model name decoded to a real newline (got ${JSON.stringify(instr?.name)})`);

	// serialize: a real newline re-encodes to exactly one `\n`, never `\\n`.
	const lyl = serializeLilyletDoc(doc);
	const line = lyl.split('\n').find(l => l.includes('instrument-1')) ?? '';
	assert(line.includes('"Violin\\nsolo"') && !line.includes('"Violin\\\\nsolo"'),
		`serialized once as \\n, not double-escaped \\\\n (got ${JSON.stringify(line)})`);

	// round-trip: serialize → reparse yields the same decoded string.
	const re = parseCode(lyl);
	assert(re.metadata?.instruments?.['1']?.name === 'Violin\nsolo',
		`round-trip stable through serialize → reparse`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
