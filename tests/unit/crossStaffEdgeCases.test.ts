/**
 * Adversarial tests for GPT review of cross-staff carry-over fixes.
 * Usage: npx tsx tests/unit/crossStaffEdgeCases.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder.js';
import { serializeLilyletDoc } from '../../source/lilylet/serializer.js';
import type { LilyletDoc, NoteEvent, Voice } from '../../source/lilylet/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const LY_BOILERPLATE = `
\\version "2.22.0" \\language "english" \\header { tagline = ##f }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

{
	const w = console.warn, a = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch {}
	console.warn = w; console.assert = a;
}

function noteStaffs(voice: Voice) {
	let s = voice.staff;
	return voice.events.map(e => {
		if (e.type === 'context' && (e as any).staff) s = (e as any).staff;
		return e.type === 'note' ? s : null;
	}).filter(x => x !== null) as number[];
}


// ─── Commit 1: decoder carry-over suppression ────────────────────────────────

// C1-A: music before reset keeps carry-over (over-suppression guard)
console.log('\nC1-A: Music before reset — carry-over must NOT be suppressed');
await (async () => {
	const LY = LY_BOILERPLATE + `
\\score { \\new Staff = "1_1" << \\new Voice {
  \\relative c' { \\time 2/4 c4 \\change Staff = "2" d4 | e4 \\change Staff = "1" f4 }
} >> \\layout {} }
`;
	const doc = await decode(LY);
	const m2voice = doc.measures[1]?.parts[0]?.voices[0];
	assert(m2voice !== undefined, 'C1-A: measure 2 voice found');
	if (m2voice) {
		const staffCtxs = m2voice.events.filter(e => e.type === 'context' && (e as any).staff != null);
		assert(staffCtxs.length >= 2, `C1-A: ≥2 staff ctx in m2 (got ${staffCtxs.length})`);
		assert((staffCtxs[0] as any).staff === 2, `C1-A: first is carry-over staff:2 (got ${(staffCtxs[0] as any).staff})`);
		const staffs = noteStaffs(m2voice);
		assert(staffs[0] === 2, `C1-A: e4 on staff 2 (got ${staffs[0]})`);
		assert(staffs[1] === 1, `C1-A: f4 on staff 1 (got ${staffs[1]})`);
	}
})();

// C1-B: non-musical context before reset suppresses carry-over
console.log('\nC1-B: \\time before reset — carry-over suppressed');
await (async () => {
	const LY = LY_BOILERPLATE + `
\\score { \\new Staff = "1_1" << \\new Voice {
  \\relative c' { \\time 4/4 c4 \\change Staff = "2" d4 e4 f4 | \\time 3/4 \\change Staff = "1" g4 a4 b4 }
} >> \\layout {} }
`;
	const doc = await decode(LY);
	const m2voice = doc.measures[1]?.parts[0]?.voices[0];
	assert(m2voice !== undefined, 'C1-B: measure 2 voice found');
	if (m2voice) {
		const firstStaffCtx = m2voice.events.find(e => e.type === 'context' && (e as any).staff != null);
		assert(!firstStaffCtx || (firstStaffCtx as any).staff !== 2,
			`C1-B: no ghost carry-over staff:2 (got ${(firstStaffCtx as any)?.staff})`);
	}
})();

// C1-C: grace note before reset — grace is a note, so carry-over kept
console.log('\nC1-C: Grace before reset — carry-over kept (grace counts as music)');
await (async () => {
	const LY = LY_BOILERPLATE + `
\\score { \\new Staff = "1_1" << \\new Voice {
  \\relative c' { c4 \\change Staff = "2" d4 e4 f4 | \\grace g8 \\change Staff = "1" a4 b4 c4 }
} >> \\layout {} }
`;
	const doc = await decode(LY);
	const m2voice = doc.measures[1]?.parts[0]?.voices[0];
	assert(m2voice !== undefined, 'C1-C: measure 2 voice found');
	if (m2voice) {
		const staffCtxs = m2voice.events.filter(e => e.type === 'context' && (e as any).staff != null);
		const lyl = serializeLilyletDoc(doc);
		const m2line = lyl.split('|')[1] ?? '';
		// Grace is decoded as a note with grace:true — it IS in musicalTypes
		// carry-over should be kept, so \staff "2" should appear before grace/a
		assert(staffCtxs.some(e => (e as any).staff === 2),
			`C1-C: carry-over staff:2 present in m2 (staffCtxs: ${staffCtxs.map((e: any) => e.staff)})`);
		assert(/\\staff "2"/.test(m2line), `C1-C: \\staff "2" in m2 lyl output (got: ${m2line.trim()})`);
	}
})();


// ─── Commit 2: serializer leading-staff collapse ─────────────────────────────

// C2-A: leading compound { staff:1, clef:"bass" } — scan stops at clef, event NOT skipped
console.log('\nC2-A: Leading { staff:1, clef:"bass" } — clef NOT dropped (scan stops at clef)');
{
	const doc: LilyletDoc = {
		measures: [{
			parts: [{
				voices: [{
					staff: 1,
					events: [
						{ type: 'context', staff: 1, clef: 'bass' } as any,
						{ type: 'note', pitches: [{ phonet: 'c', octave: 0 }], duration: { division: 4, dots: 0 } },
					]
				}]
			}]
		}]
	};
	const lyl = serializeLilyletDoc(doc);
	assert(lyl.includes('\\clef "bass"'), `C2-A: \\clef "bass" not dropped — got: ${lyl.trim()}`);
}

// C2-B: [staff:2, clef:bass(stops scan), staff:1, note] — ordering correct
console.log('\nC2-B: staff:2 absorbed, clef stops scan, staff:1 emitted normally');
{
	const doc: LilyletDoc = {
		measures: [{
			parts: [{
				voices: [{
					staff: 1,
					events: [
						{ type: 'context', staff: 2 } as any,
						{ type: 'context', clef: 'bass' } as any,
						{ type: 'context', staff: 1 } as any,
						{ type: 'note', pitches: [{ phonet: 'c', octave: 0 }], duration: { division: 4, dots: 0 } },
					]
				}]
			}]
		}]
	};
	const lyl = serializeLilyletDoc(doc);
	assert(lyl.includes('\\staff "2"'), `C2-B: \\staff "2" from effectiveInitial`);
	assert(lyl.includes('\\clef "bass"'), `C2-B: \\clef "bass" emitted`);
	assert(lyl.includes('\\staff "1"'), `C2-B: \\staff "1" from context event`);
	const i2 = lyl.indexOf('\\staff "2"'), ic = lyl.indexOf('\\clef'), i1 = lyl.indexOf('\\staff "1"');
	assert(i2 < ic && ic < i1, `C2-B: order staff"2" < clef < staff"1" (${i2},${ic},${i1})`);
}

// C2-C: [pitchReset, staff:2, staff:1, rest] — collapse to 1, no ghost staff:2
console.log('\nC2-C: pitchReset transparent — [pitchReset, staff:2, staff:1, rest] collapses to staff:1');
{
	const doc: LilyletDoc = {
		measures: [{
			parts: [{
				voices: [{
					staff: 1,
					events: [
						{ type: 'pitchReset' } as any,
						{ type: 'context', staff: 2 } as any,
						{ type: 'context', staff: 1 } as any,
						{ type: 'rest', duration: { division: 4, dots: 0 } },
					]
				}]
			}]
		}]
	};
	const lyl = serializeLilyletDoc(doc);
	assert(!/\\staff "2"/.test(lyl), `C2-C: no ghost \\staff "2" — got: ${lyl.trim()}`);
}

// C2-D: unknown event type stops scan — staff:2 processed normally (not absorbed)
console.log('\nC2-D: markup event stops scan — staff:2 NOT absorbed as leading, emitted normally');
{
	const doc: LilyletDoc = {
		measures: [{
			parts: [{
				voices: [{
					staff: 1,
					events: [
						{ type: 'markup', content: 'test', placement: 'above' } as any,
						{ type: 'context', staff: 2 } as any,
						{ type: 'note', pitches: [{ phonet: 'g', octave: 0 }], duration: { division: 4, dots: 0 } },
					]
				}]
			}]
		}]
	};
	const lyl = serializeLilyletDoc(doc);
	assert(lyl.includes('\\staff "2"'), `C2-D: \\staff "2" emitted (scan stopped by markup)`);
}


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
