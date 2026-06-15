/**
 * Tests for staff-layout syntax: [staves "…"] header + parseStaffLayout + MEI encode.
 *
 * Staff-layout uses STAFF as the leaf unit (vs ABC %%score which is voice-leaf):
 * brackets {} <> [] group staves, conjunctions - . , join them. Ported from
 * FindLab starry app/staffLayout/.
 *
 * Usage: npx tsx tests/unit/staffLayout.test.ts
 */

import { parseCode } from '../../source/lilylet/parser';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import {
	parseStaffLayout,
	encodeStaffLayoutMEI,
	StaffGroupType,
	StaffConjunctionType,
} from '../../source/lilylet/staffLayout';
import * as fs from 'fs';
import * as path from 'path';


let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
}

const UNIT_DIR = path.join(import.meta.dirname, '../assets/unit-cases');


// ─── Named layout ────────────────────────────────────────────────────────────
console.log('\nNamed layout: "<[v1-v2].va> {pl-pr} <b>"');
{
	const layout = parseStaffLayout('<[v1-v2].va> {pl-pr} <b>');
	assert(JSON.stringify(layout.staffIds) === JSON.stringify(['v1', 'v2', 'va', 'pl', 'pr', 'b']),
		`staffIds = [v1,v2,va,pl,pr,b] (got ${JSON.stringify(layout.staffIds)})`);
	assert(layout.stavesCount === 6, `stavesCount = 6 (got ${layout.stavesCount})`);
	// conjunctions: v1-v2 solid, v2-va dashed, va-pl blank, pl-pr solid, pr-b blank
	assert(JSON.stringify(layout.conjunctions) === JSON.stringify([
		StaffConjunctionType.Solid, StaffConjunctionType.Dashed, StaffConjunctionType.Blank,
		StaffConjunctionType.Solid, StaffConjunctionType.Blank,
	]), `conjunctions = [Solid,Dashed,Blank,Solid,Blank] (got ${JSON.stringify(layout.conjunctions)})`);

	// Top group: Bracket over [v1 v2] Square + va, a Brace grand {pl pr}, and <b>
	const top = layout.group;
	assert(top.subs?.length === 3, `top group has 3 subs (got ${top.subs?.length})`);
	const [g0, g1, g2] = top.subs!;
	assert(g0.type === StaffGroupType.Bracket, `sub0 is Bracket (got ${g0.type})`);
	assert(g0.subs?.[0].type === StaffGroupType.Square, `sub0.0 is Square (got ${g0.subs?.[0].type})`);
	assert(g1.type === StaffGroupType.Brace && g1.grand === true, `sub1 is Brace + grand`);
	assert(g2.type === StaffGroupType.Bracket && g2.staff === 'b', `sub2 is Bracket wrapping staff b`);
}

// ─── Anonymous layout ─────────────────────────────────────────────────────────
console.log('\nAnonymous layout: "<[-].> {-} <>"');
{
	const layout = parseStaffLayout('<[-].> {-} <>');
	assert(layout.stavesCount === 6, `6 anonymous staves (got ${layout.stavesCount})`);
	assert(JSON.stringify(layout.staffIds) === JSON.stringify(['1', '2', '3', '4', '5', '6']),
		`auto-named 1..6 (got ${JSON.stringify(layout.staffIds)})`);
	assert(JSON.stringify(layout.conjunctions) === JSON.stringify([
		StaffConjunctionType.Solid, StaffConjunctionType.Dashed, StaffConjunctionType.Blank,
		StaffConjunctionType.Solid, StaffConjunctionType.Blank,
	]), `conjunctions preserved for anonymous staves`);
	const [g0, g1, g2] = layout.group.subs!;
	assert(g0.type === StaffGroupType.Bracket, `sub0 Bracket`);
	assert(g1.type === StaffGroupType.Brace && g1.grand === true, `sub1 Brace grand`);
	assert(g2.type === StaffGroupType.Bracket, `sub2 Bracket`);
}

// ─── MEI encode ───────────────────────────────────────────────────────────────
console.log('\nMEI staffGrp encode');
{
	const layout = parseStaffLayout('<[v1-v2].va> {pl-pr} <b>');
	const mei = encodeStaffLayoutMEI(layout);
	assert(mei.includes('symbol="bracket"'), `emits symbol="bracket"`);
	assert(mei.includes('symbol="square"'), `emits symbol="square"`);
	assert(mei.includes('symbol="brace"'), `emits symbol="brace"`);
	// the square group [v1-v2] has solid conjunction → bar.thru="true"
	assert(/symbol="square">[\s\S]*?bar\.thru="true"|bar\.thru="true"[^>]*symbol="square"/.test(mei),
		`square group has bar.thru="true"`);
	assert((mei.match(/<staffDef /g) || []).length === 6, `6 staffDef leaves`);
	assert(/<staffDef n="1">/.test(mei) && /<staffDef n="6">/.test(mei), `staffDef numbered 1..6`);
}

// ─── Round-trip of the example files ──────────────────────────────────────────
console.log('\nExample files parse + round-trip');
for (const f of ['staves-named.lyl', 'staves-anonymous.lyl']) {
	const src = fs.readFileSync(path.join(UNIT_DIR, f), 'utf8');
	const doc: any = parseCode(src);
	assert(typeof doc.metadata?.staves === 'string' && doc.metadata.staves.length > 0,
		`${f}: [staves] parsed into metadata.staves`);
	const out = serializeLilyletDoc(doc);
	const doc2: any = parseCode(out);
	assert(doc.metadata.staves === doc2.metadata?.staves,
		`${f}: metadata.staves round-trips exactly ("${doc.metadata.staves}")`);
	// staff count in layout should match voice count in measure 1
	const layout = parseStaffLayout(doc.metadata.staves);
	const voiceCount = doc.measures[0].parts.reduce((n: number, p: any) => n + p.voices.length, 0);
	assert(layout.stavesCount === voiceCount,
		`${f}: layout staves (${layout.stavesCount}) matches voice count (${voiceCount})`);
}


console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
