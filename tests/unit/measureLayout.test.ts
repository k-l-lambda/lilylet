/**
 * Tests for measure-layout syntax: [measures "…"] header + parseMeasureLayout +
 * expandMeasureLayout + MEI <expansion> emission.
 *
 * Measure-layout encodes PERFORMANCE/repeat order (independent of the notated
 * sequence): N single, A..B range, [ … ] block, N*[ … ]{ alt… } volta, and
 * < main, rest > ABA/da-capo. Two modes: index-wise (i:, default — leaves are
 * 1-based indices) and segment-wise (s: — leaves are segment lengths). Ported
 * from lotus jison/measureLayout.jison + inc/measureLayout.ts.
 *
 * The oracle for each case is the "% Performed order: …" comment carried in the
 * matching tests/assets/unit-cases/measures-*.lyl file (lotus's own convention).
 *
 * Usage: npx tsx tests/unit/measureLayout.test.ts
 */

import { parseCode } from '../../source/lilylet/parser';
import { encode } from '../../source/lilylet/meiEncoder';
import {
	parseMeasureLayout,
	expandMeasureLayout,
	serializeMeasureLayout,
	LayoutType,
} from '../../source/lilylet/measureLayout';
import * as fs from 'fs';
import * as path from 'path';


let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
}

const UNIT_DIR = path.join(process.cwd(), 'tests/assets/unit-cases');

// Parse the "% Performed order: 1 2 | 3 4 …" comment from a .lyl file into a
// flat index array (bar separators "|" are cosmetic).
const oracleFromFile = (file: string): number[] | null => {
	const src = fs.readFileSync(path.join(UNIT_DIR, file), 'utf-8');
	const m = src.match(/Performed order:\s*([0-9 |]+)/);
	if (!m) return null;
	return m[1].split(/[\s|]+/).filter(Boolean).map(Number);
};


// ─── Expander: each measures-*.lyl expands to its documented order ──────────
console.log('\nExpander vs "% Performed order:" oracle (all measures-*.lyl):');
{
	const files = fs.readdirSync(UNIT_DIR).filter(f => /^measures-.*\.lyl$/.test(f)).sort();
	assert(files.length >= 17, `found ${files.length} measures-*.lyl cases (expected ≥17)`);

	for (const file of files) {
		const src = fs.readFileSync(path.join(UNIT_DIR, file), 'utf-8');
		const directive = src.match(/\[measures\s+"([^"]*)"\]/);
		const oracle = oracleFromFile(file);
		if (!directive || !oracle) { assert(false, `${file}: missing [measures] directive or oracle comment`); continue; }

		const expanded = expandMeasureLayout(parseMeasureLayout(directive[1]));
		assert(
			JSON.stringify(expanded) === JSON.stringify(oracle),
			`${file}: "${directive[1]}" → ${expanded.join(' ')}${JSON.stringify(expanded) !== JSON.stringify(oracle) ? `  (oracle ${oracle.join(' ')})` : ''}`,
		);
	}
}

// ─── Mode equivalence: index-wise / segment-wise twins expand identically ───
console.log('\nIndex-wise / segment-wise twins agree:');
{
	const twins: [string, string][] = [
		['1, 2, 3, 4', 's: 4'],
		['2*[1..4]', 's: 2*[4]'],
		['2*[1..4]{[5,6], 7}', 's: 2*[4]{2 1}'],
		['<[1,2,3,4], [5,6,7,8]>', 's: <4 4>'],
		['1, 2, <[2*[3..6]{7, 8}, 9..12], 13..18>', 's: 2 <[2*[4]{1 1} 4] 6>'],
	];
	for (const [iw, sw] of twins) {
		const ei = expandMeasureLayout(parseMeasureLayout(iw));
		const es = expandMeasureLayout(parseMeasureLayout(sw));
		assert(JSON.stringify(ei) === JSON.stringify(es), `"${iw}" ≡ "${sw}" → ${ei.join(' ')}`);
	}
}

// ─── LayoutType variants ────────────────────────────────────────────────────
console.log('\nLayoutType variants on "2*[1..4]{5, 6}":');
{
	const ast = parseMeasureLayout('2*[1..4]{5, 6}');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Full)) === JSON.stringify([1,2,3,4,5,1,2,3,4,6]),
		'Full → 1 2 3 4 5 1 2 3 4 6');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Once)) === JSON.stringify([1,2,3,4,6]),
		'Once → 1 2 3 4 6 (body + last alternate)');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Ordinary)) === JSON.stringify([1,2,3,4,5,6]),
		'Ordinary → 1 2 3 4 5 6 (body once + all alternates)');
}

console.log('\nABA LayoutType on "<[1,2], 3, 4>":');
{
	const ast = parseMeasureLayout('<[1,2], 3, 4>');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Full)) === JSON.stringify([1,2,3,4,1,2]), 'Full → A B A');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Ordinary)) === JSON.stringify([1,2,3,4]), 'Ordinary → A B');
	assert(JSON.stringify(expandMeasureLayout(ast, LayoutType.Once)) === JSON.stringify([3,4,1,2]), 'Once → B A');
}

// ─── Serializer round-trip: serialize→reparse→expand is stable ──────────────
console.log('\nSerializer round-trip (expansion stable through serialize→reparse):');
{
	const cases = ['1, 2, 3, 4', '1..8', '2*[1..4]{[5,6], 7}', '3*[1,2]{3,4,5}',
		'<[1,2,3,4], [5,6,7,8]>', '1, 2, <[2*[3..6]{7, 8}, 9..12], 13..18>'];
	for (const code of cases) {
		const ast = parseMeasureLayout(code);
		const before = expandMeasureLayout(ast);
		const re = serializeMeasureLayout(ast);
		const after = expandMeasureLayout(parseMeasureLayout(re));
		assert(JSON.stringify(before) === JSON.stringify(after), `"${code}" → "${re}" (expansion stable)`);
	}
}

// ─── End-to-end: MEI <expansion plist> matches the expanded order ───────────
// Two valid plist forms (see meiEncoder): a flat measure-level plist (one ref per
// played bar) when there are no voltas, or a SECTION/ENDING segment-level plist
// (a body segment id repeats per pass) when voltas are present — the form verovio
// needs to play voltas while also drawing the house brackets. Either way, the plist
// flattened back to measure ids must equal the oracle performed order.
console.log('\nMEI <expansion> plist length & resolution:');
{
	const files = fs.readdirSync(UNIT_DIR).filter(f => /^measures-.*\.lyl$/.test(f)).sort();
	for (const file of files) {
		const doc = parseCode(fs.readFileSync(path.join(UNIT_DIR, file), 'utf-8'));
		const mei = encode(doc);
		const oracle = oracleFromFile(file)!;
		const measureIds = [...mei.matchAll(/<measure xml:id="([^"]*)"/g)].map(m => m[1]);
		const plistM = mei.match(/<expansion[^>]*plist="([^"]*)"/);
		if (!plistM) { assert(false, `${file}: no <expansion> emitted`); continue; }
		const refs = plistM[1].split(' ').map(s => s.replace(/^#/, ''));

		// Map every segment id (<section>/<ending>) to the measure ids it contains,
		// in document order, by scanning the MEI nesting.
		const segMeasures = new Map<string, string[]>();
		{
			const open: string[] = [];
			const re = /<(section|ending)\b[^>]*xml:id="([^"]*)"|<measure xml:id="([^"]*)"|<\/(section|ending)>/g;
			let m: RegExpExecArray | null;
			while ((m = re.exec(mei))) {
				if (m[2]) { open.push(m[2]); if (!segMeasures.has(m[2])) segMeasures.set(m[2], []); }
				else if (m[3]) { for (const sid of open) segMeasures.get(sid)!.push(m[3]); }
				else if (m[4]) { open.pop(); }
			}
		}
		// Flatten the plist: a measure ref → itself; a segment ref → its measure ids.
		const flat: string[] = [];
		let resolvable = true;
		for (const r of refs) {
			if (measureIds.includes(r)) flat.push(r);
			else if (segMeasures.has(r)) flat.push(...segMeasures.get(r)!);
			else { resolvable = false; break; }
		}
		const expected = oracle.map(idx => measureIds[idx - 1]);
		assert(resolvable && JSON.stringify(flat) === JSON.stringify(expected),
			`${file}: plist (${refs.length} refs) flattens to oracle order (${oracle.length} measures)`);
	}
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
