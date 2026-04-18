/**
 * Unit test: \staff "N" inside \tuplet / \times blocks is preserved in the AST.
 *
 * Regression guard for the bug in grammar.jison.js where tuplet/times event
 * construction filters events to only 'note' | 'rest', silently dropping any
 * 'context' events (including \staff "N") that appear inside the block.
 *
 * Real-world case: Chopin Op.28 No.1 (chopin--chopin-28-1.lyl) — the bass voice
 * uses cross-staff beaming where melody notes are physically in the treble range.
 * Placing \staff "1" inside a \tuplet block to switch staff mid-tuplet has no
 * effect because the parser drops the context event before expandVoice ever sees
 * it.  intelli-piano/spartitoMeasure.ts expandVoice already contains correct
 * handling for context events inside tuplets, but it is unreachable due to this
 * parser bug.
 *
 * Bug location: source/lilylet/grammar.jison.js lines ~344-347
 *   timesEvent:  $$[$0-1].filter(e => e.type === 'note' || e.type === 'rest')
 *   tupletEvent: $$[$0-1].filter(e => e.type === 'note' || e.type === 'rest')
 *
 * Fix: extend the filter to also keep 'context' events:
 *   .filter(e => e.type === 'note' || e.type === 'rest' || e.type === 'context')
 *
 * Usage: npx tsx tests/unit/staffInsideTuplet.test.ts
 */

import { parseCode } from '../../source/lilylet/parser';
import type { Voice } from '../../source/lilylet/types';


// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
		passed++;
	}
	else {
		console.error(`  ✗ FAIL: ${message}`);
		failed++;
	}
}

/**
 * Walk voice events (including inside tuplets), tracking activeStaff from
 * context { staff } events.  Returns [{phonet, staff}] for each note.
 */
function getNoteStaffs(voice: Voice): { phonet: string; staff: number }[] {
	let activeStaff = voice.staff;
	const result: { phonet: string; staff: number }[] = [];

	function walkEvents(events: any[]): void {
		for (const e of events) {
			if (e.type === 'context' && e.staff)
				activeStaff = e.staff;
			else if (e.type === 'note')
				result.push({ phonet: e.pitches[0].phonet, staff: activeStaff });
			else if (e.type === 'tuplet' || e.type === 'times')
				walkEvents(e.events || []);
		}
	}

	walkEvents(voice.events);
	return result;
}

/**
 * Find a tuplet/times event in a voice and return its events array.
 */
function getTupletEvents(voice: Voice): any[] | null {
	for (const e of voice.events) {
		if (e.type === 'tuplet' || e.type === 'times')
			return (e as any).events || [];
	}
	return null;
}


// ─── test 1: \staff "N" inside \tuplet ──────────────────────────────────────

console.log('\nTest 1: \\staff "N" inside \\tuplet 3/2');
console.log('─'.repeat(50));

// A single voice: starts on staff 2, then \staff "1" inside the tuplet
// switches to staff 1 for notes g and c.
//   a (staff=2), g (staff=1), c (staff=1)
const LYL_TUPLET = `
\\staff "2" \\tuplet 3/2 { a16 \\staff "1" g c } |
`;

{
	const doc = parseCode(LYL_TUPLET);
	const voice = doc.measures[0]?.parts[0]?.voices[0] as Voice | undefined;

	assert(!!voice, 'measure 0 voice 0 exists');

	const tupletEvents = getTupletEvents(voice!);
	assert(tupletEvents !== null, 'voice contains a tuplet event');

	// The bug: context event is filtered out — tupletEvents has no 'context'
	const hasContextEvent = tupletEvents?.some(e => e.type === 'context' && e.staff === 1) ?? false;
	assert(hasContextEvent, 'tuplet events array contains context { staff: 1 }');

	const noteStaffs = getNoteStaffs(voice!);
	assert(noteStaffs.length === 3, `3 notes found (got ${noteStaffs.length})`);
	assert(noteStaffs[0]?.phonet === 'a' && noteStaffs[0]?.staff === 2, `note "a" on staff 2 (got staff=${noteStaffs[0]?.staff})`);
	assert(noteStaffs[1]?.phonet === 'g' && noteStaffs[1]?.staff === 1, `note "g" on staff 1 after \\staff "1" (got staff=${noteStaffs[1]?.staff})`);
	assert(noteStaffs[2]?.phonet === 'c' && noteStaffs[2]?.staff === 1, `note "c" on staff 1 (got staff=${noteStaffs[2]?.staff})`);
}


// ─── test 2: \staff "N" inside \times ───────────────────────────────────────

console.log('\nTest 2: \\staff "N" inside \\times 2/3');
console.log('─'.repeat(50));

const LYL_TIMES = `
\\staff "2" \\times 2/3 { a16 \\staff "1" g c } |
`;

{
	const doc = parseCode(LYL_TIMES);
	const voice = doc.measures[0]?.parts[0]?.voices[0] as Voice | undefined;

	assert(!!voice, 'measure 0 voice 0 exists');

	const tupletEvents = getTupletEvents(voice!);
	assert(tupletEvents !== null, 'voice contains a times event');

	const hasContextEvent = tupletEvents?.some(e => e.type === 'context' && e.staff === 1) ?? false;
	assert(hasContextEvent, 'times events array contains context { staff: 1 }');

	const noteStaffs = getNoteStaffs(voice!);
	assert(noteStaffs.length === 3, `3 notes found (got ${noteStaffs.length})`);
	assert(noteStaffs[1]?.phonet === 'g' && noteStaffs[1]?.staff === 1, `note "g" on staff 1 after \\staff "1" (got staff=${noteStaffs[1]?.staff})`);
}


// ─── test 3: \staff "N" at voice level before tuplet (should already work) ──

console.log('\nTest 3: \\staff "N" at voice level before \\tuplet (baseline)');
console.log('─'.repeat(50));

// \staff "1" at voice level — should already work
const LYL_VOICE_LEVEL = `
\\staff "2" \\staff "1" \\tuplet 3/2 { a16 g c } |
`;

{
	const doc = parseCode(LYL_VOICE_LEVEL);
	const voice = doc.measures[0]?.parts[0]?.voices[0] as Voice | undefined;

	assert(!!voice, 'measure 0 voice 0 exists');

	// Voice-level context events are NOT inside the tuplet
	const hasVoiceLevelContext = voice!.events.some(
		e => e.type === 'context' && (e as any).staff === 1
	);
	assert(hasVoiceLevelContext, 'voice has a context { staff: 1 } event at voice level');

	const noteStaffs = getNoteStaffs(voice!);
	assert(noteStaffs.length === 3, `3 notes found`);
	assert(noteStaffs[0]?.staff === 1, `all notes on staff 1 (got ${noteStaffs[0]?.staff})`);
}


// ─── summary ────────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
