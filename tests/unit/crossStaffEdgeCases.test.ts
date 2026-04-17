// tests/unit/crossStaffEdgeCases.test.ts
//
// Adversarial edge cases for cross-staff carry-over fixes (written by GPT review).
// Run with:
//   npx tsx tests/unit/crossStaffEdgeCases.test.ts

import { decode } from '../../source/lilylet/lilypondDecoder.js';
import { serializeLilyletDoc } from '../../source/lilylet/serializer.js';
import type { LilyletDoc } from '../../source/lilylet/types.js';

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

function note(phonet: string, division = 4, octave = 0): any {
	return { type: 'note', pitches: [{ phonet, octave }], duration: { division, dots: 0 } };
}

function rest(division = 4): any {
	return { type: 'rest', duration: { division, dots: 0 } };
}

function mkDoc(events: any[], staff = 1): LilyletDoc {
	return {
		measures: [{
			parts: [{
				voices: [{ staff, events } as any]
			} as any]
		} as any]
	} as LilyletDoc;
}

function getMeasureVoice(doc: LilyletDoc, measureIndex: number): any {
	return doc.measures?.[measureIndex]?.parts?.[0]?.voices?.[0];
}

function staffContexts(events: any[]): any[] {
	return events.filter((e: any) => e.type === 'context' && e.staff != null);
}

function noteStaffs(voice: any): number[] {
	let activeStaff = voice.staff;
	const out: number[] = [];
	for (const e of voice.events) {
		if (e.type === 'context' && e.staff != null) activeStaff = e.staff;
		else if (e.type === 'note') out.push(e.staff ?? activeStaff);
	}
	return out;
}

function summarizeLeadTypesBeforeFirstStaffCtx(voice: any): string[] {
	const idx = voice.events.findIndex((e: any) => e.type === 'context' && e.staff != null);
	if (idx < 0) return [];
	return voice.events.slice(0, idx).map((e: any) => e.type);
}

const LY_BOILERPLATE = `
\\version "2.22.0" \\language "english" \\header { tagline = ##f }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

/** Wrap a relative music expression in a minimal full LilyPond score. */
function makeLy(relativeMusic: string): string {
	return LY_BOILERPLATE + `
\\score { \\new Staff = "1_1" << \\new Voice {
  \\relative c' { ${relativeMusic} }
} >> \\layout {} }
`;
}

console.log('crossStaffEdgeCases.test.ts\n');

// Warm-up
{
	const w = console.warn, a = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch {}
	console.warn = w; console.assert = a;
}


// ─── C1-A: music before reset — carry-over NOT suppressed ────────────────────

{
	const LY = `\\time 2/4 c4 \\change Staff = "2" d4 | e4 \\change Staff = "1" f4`;
	const doc = await decode(makeLy(LY));
	const m2voice = getMeasureVoice(doc, 1);

	assert(m2voice !== undefined, 'C1-A: decoded second measure voice exists');

	const ctxs = staffContexts(m2voice.events);
	assert(ctxs.length >= 2, 'C1-A: second measure has carry-over and explicit reset contexts');

	const firstTwo = ctxs.slice(0, 2).map((e: any) => e.staff);
	assert(
		JSON.stringify(firstTwo) === JSON.stringify([2, 1]),
		'C1-A: measure 2 starts with carry-over staff 2, then reset to staff 1'
	);

	const staffs = noteStaffs(m2voice);
	assert(
		JSON.stringify(staffs) === JSON.stringify([2, 1]),
		'C1-A: e4 on staff 2 (carry-over), f4 on staff 1 (after reset)'
	);
}


// ─── C1-B: non-musical context before reset — carry-over suppressed ──────────
// Strengthened: verifies explicit reset still present and all notes on staff 1.

{
	const LY = `\\time 4/4 c4 \\change Staff = "2" d e f | \\time 3/4 \\change Staff = "1" g a b`;
	const doc = await decode(makeLy(LY));
	const m2voice = getMeasureVoice(doc, 1);

	assert(m2voice !== undefined, 'C1-B: decoded second measure voice exists');

	const ctxs = staffContexts(m2voice.events);
	assert(ctxs.length >= 1, 'C1-B: second measure still has explicit reset to staff 1');
	assert(
		ctxs[0].staff === 1,
		'C1-B: first staff context in m2 is reset to 1, not ghost carry-over staff 2'
	);

	const staffs = noteStaffs(m2voice);
	assert(
		staffs.length >= 3 && staffs.every(s => s === 1),
		'C1-B: all notes in m2 are on staff 1 after immediate reset'
	);
}


// ─── C1-C: grace before reset — discovery + carry-over kept ──────────────────
// Discovery assertion: prove grace is decoded as a pre-reset musical event.

{
	const LY = `c4 \\change Staff = "2" d e f | \\grace g8 \\change Staff = "1" a b c`;
	const doc = await decode(makeLy(LY));
	const m2voice = getMeasureVoice(doc, 1);

	assert(m2voice !== undefined, 'C1-C: decoded second measure voice exists');

	// Discovery: find events between carry-over (context{staff:2}) and reset (context{staff:1})
	const allCtxs = staffContexts(m2voice.events);
	const carryIdx = m2voice.events.findIndex((e: any) => e.type === 'context' && e.staff === 2);
	const resetIdx = m2voice.events.findIndex((e: any) => e.type === 'context' && e.staff === 1);
	const betweenTypes = carryIdx >= 0 && resetIdx > carryIdx
		? m2voice.events.slice(carryIdx + 1, resetIdx).map((e: any) => e.type)
		: [];
	assert(betweenTypes.length > 0,
		`C1-C discovery: events between carry-over and reset (${betweenTypes.join(', ')})`);
	const hasMusicalBetween = betweenTypes.some(t => /grace/i.test(t) || t === 'note' || t === 'tuplet');
	assert(hasMusicalBetween,
		`C1-C discovery: musical event between carry-over and reset (${betweenTypes.join(', ')})`);

	const ctxs = allCtxs;
	assert(
		ctxs.length >= 2 && ctxs[0].staff === 2,
		'C1-C: carry-over staff 2 is kept when musical event precedes explicit reset'
	);

	const m2lyl = serializeLilyletDoc(mkDoc(m2voice.events, m2voice.staff ?? 1));
	assert(/\\staff "2"/.test(m2lyl),
		'C1-C: serialized m2 contains \\staff "2" before the reset sequence');
}


// ─── C2-A: leading { staff:1, clef:"bass" } — clef NOT dropped ───────────────

{
	const doc = mkDoc([
		{ type: 'context', staff: 1, clef: 'bass' } as any,
		note('c'),
	], 1);
	const lyl = serializeLilyletDoc(doc);

	assert(/\\clef\s+"?bass"?/.test(lyl),
		'C2-A: same-staff compound context preserves clef');
	assert(/[a-g]/.test(lyl),
		'C2-A: note still serializes after same-staff compound context');
}


// ─── C2-A2: leading { staff:2, clef:"bass" } — both emitted, staff before clef

{
	const doc = mkDoc([
		{ type: 'context', staff: 2, clef: 'bass' } as any,
		note('c'),
	], 1);
	const lyl = serializeLilyletDoc(doc);

	const iStaff = lyl.indexOf('\\staff "2"');
	const iClef = lyl.search(/\\clef\s+"?bass"?/);

	assert(iStaff >= 0, 'C2-A2: different-staff compound emits \\staff "2"');
	assert(iClef >= 0, 'C2-A2: different-staff compound preserves clef');
	assert(iStaff < iClef, 'C2-A2: \\staff "2" precedes \\clef in compound context');
}


// ─── C2-B: [staff:2, clef, staff:1, note] — correct order throughout ─────────

{
	const doc = mkDoc([
		{ type: 'context', staff: 2 } as any,
		{ type: 'context', clef: 'bass' } as any,
		{ type: 'context', staff: 1 } as any,
		note('c'),
	], 1);
	const lyl = serializeLilyletDoc(doc);

	const i2 = lyl.indexOf('\\staff "2"');
	const ic = lyl.search(/\\clef\s+"?bass"?/);
	const i1 = lyl.indexOf('\\staff "1"');
	// Find note after last \staff directive (to avoid matching letters in "bass"/"clef")
	const inote = lyl.indexOf('c', i1 + 1);

	assert(i2 >= 0, 'C2-B: emits \\staff "2"');
	assert(ic >= 0, 'C2-B: emits \\clef bass');
	assert(i1 >= 0, 'C2-B: emits \\staff "1"');
	assert(
		i2 >= 0 && ic >= 0 && i1 >= 0 && inote >= 0 && i2 < ic && ic < i1 && i1 < inote,
		'C2-B: order is \\staff "2" → clef → \\staff "1" → note'
	);
}


// ─── C2-C: [pitchReset, staff:2, staff:1, rest] — no ghost, rest survives ────

{
	const doc = mkDoc([
		{ type: 'pitchReset' } as any,
		{ type: 'context', staff: 2 } as any,
		{ type: 'context', staff: 1 } as any,
		rest(4),
	], 1);
	const lyl = serializeLilyletDoc(doc);

	assert(!/\\staff "2"/.test(lyl),
		'C2-C: collapsed leading staff 2 does not appear as ghost');
	assert(/\br/.test(lyl),
		'C2-C: rest still serializes after collapsing leading staff events');
}


// ─── C2-D: unknown leading event stops scan — only if markup is supported ────

{
	const markupEvent: any = { type: 'markup', content: 'hi', placement: 'above' };
	const probeLyl = serializeLilyletDoc(mkDoc([markupEvent, note('c')], 1));

	if (!/\\markup/.test(probeLyl)) {
		console.log('  - SKIP C2-D: serializer does not emit \\markup for this event shape');
	} else {
		const doc = mkDoc([
			markupEvent,
			{ type: 'context', staff: 2 } as any,
			note('c'),
		], 1);
		const lyl = serializeLilyletDoc(doc);

		const iMarkup = lyl.indexOf('\\markup');
		const iStaff2 = lyl.indexOf('\\staff "2"');

		assert(iMarkup >= 0, 'C2-D: markup serializes');
		assert(iStaff2 >= 0, 'C2-D: \\staff "2" serializes after markup');
		assert(iMarkup < iStaff2,
			'C2-D: markup precedes \\staff "2" — scan stopped by unknown event, staff not absorbed');
	}
}


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
