/**
 * Unit test: \change Staff state carries over across measure boundaries.
 *
 * Regression guard for the bug where the lyl serializer resets activeStaff
 * to voice.staff at each measure boundary, so a voice that ended on staff 2
 * (via \change Staff = "2") incorrectly starts the next measure on staff 1.
 *
 * Real-world case: BWV-787 %6 ends with \change Staff = "2".
 * In %7, the voice starts on staff 2 (e4 on bass), then switches back
 * with \change Staff = "1". The lyl serializer was outputting \staff "1"
 * at the top of the %7 voice line, wrongly placing the bass e4 on staff 1.
 *
 * Usage: npx tsx tests/unit/crossStaffMultiMeasure.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import { parseCode } from '../../source/lilylet/parser';
import type { NoteEvent, Voice, Measure } from '../../source/lilylet/types';


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

/** Walk voice events, tracking activeStaff via context { staff } events. */
function getNoteStaffs(voice: Voice): { phonet: string; staff: number }[] {
	let activeStaff = voice.staff;
	const result: { phonet: string; staff: number }[] = [];
	for (const e of voice.events) {
		if (e.type === 'context' && (e as any).staff)
			activeStaff = (e as any).staff;
		if (e.type === 'note')
			result.push({ phonet: (e as NoteEvent).pitches[0].phonet, staff: activeStaff });
	}
	return result;
}

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

// Two-measure test case:
//   Measure 1: voice on staff 1 (treble), switches to staff 2 at the end
//   Measure 2: voice continues on staff 2 (carry-over), then switches back to staff 1
//
// Measure 1 notes (staff 1 → staff 2):
//   c4 d4 \change Staff = "2" e4 f4
//   → c,d on staff 1; e,f on staff 2
//
// Measure 2 notes (starts on staff 2, then back to staff 1):
//   g4 \change Staff = "1" a4 b4 c4
//   → g on staff 2; a,b,c on staff 1

const LY_CROSS_MEASURE = LY_BOILERPLATE + `
\\score {
  \\new PianoStaff <<
    \\new Staff = "1" {
      \\relative c' { \\clef treble \\time 4/4
        c1 | c1 |
      }
    }
    \\new Staff = "2" {
      \\relative c { \\clef bass \\time 4/4
        c1 | c1 |
      }
    }
  >>
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\clef treble \\time 4/4
        c4 d4 \\change Staff = "2" e4 f4 |  % 1
        g4 \\change Staff = "1" a4 b4 c4 |  % 2
      }
    }
  >>
  \\layout { }
}
`;


// ─── Warm-up ────────────────────────────────────────────────────────────────

{
	const warn = console.warn, assert2 = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch { /* ignore */ }
	console.warn = warn; console.assert = assert2;
}


// ─── Test 1: decoder captures staff changes across measures ─────────────────

console.log('\nTest 1: decoder — cross-measure \\change Staff captured in JSON');

await (async () => {
	const doc = await decode(LY_CROSS_MEASURE);

	// Find the cross-staff voice (the one that has context { staff } events)
	let crossVoice1: Voice | undefined;  // measure 1
	let crossVoice2: Voice | undefined;  // measure 2

	for (let mi = 0; mi < doc.measures.length; mi++) {
		for (const part of doc.measures[mi].parts) {
			for (const v of part.voices) {
				if (v.events.some(e => e.type === 'context' && (e as any).staff && (e as any).staff !== v.staff)) {
					if (mi === 0) crossVoice1 = v;
					if (mi === 1) crossVoice2 = v;
				}
			}
		}
	}

	assert(crossVoice1 !== undefined, 'Measure 1: cross-staff voice found');
	assert(crossVoice2 !== undefined, 'Measure 2: cross-staff voice found (staff carry-over)');

	if (crossVoice1) {
		const notes1 = getNoteStaffs(crossVoice1);
		assert(notes1.length === 4, `Measure 1: 4 notes (got ${notes1.length})`);
		assert(notes1[0]?.staff === 1 && notes1[1]?.staff === 1,
			`Measure 1: c,d on staff 1 (got ${notes1[0]?.staff},${notes1[1]?.staff})`);
		assert(notes1[2]?.staff === 2 && notes1[3]?.staff === 2,
			`Measure 1: e,f on staff 2 (got ${notes1[2]?.staff},${notes1[3]?.staff})`);
	}

	if (crossVoice2) {
		const notes2 = getNoteStaffs(crossVoice2);
		assert(notes2.length === 4, `Measure 2: 4 notes (got ${notes2.length})`);
		// g should be on staff 2 (carry-over from measure 1's \change Staff = "2")
		assert(notes2[0]?.staff === 2,
			`Measure 2: g on staff 2 (carry-over) (got ${notes2[0]?.staff})`);
		assert(notes2[1]?.staff === 1 && notes2[2]?.staff === 1 && notes2[3]?.staff === 1,
			`Measure 2: a,b,c on staff 1 (got ${notes2[1]?.staff},${notes2[2]?.staff},${notes2[3]?.staff})`);
	}
})();


// ─── Test 2: serialized .lyl preserves staff on g (measure 2 first note) ────

console.log('\nTest 2: serializer — g in measure 2 is on \\staff "2" in .lyl');

await (async () => {
	const doc = await decode(LY_CROSS_MEASURE);
	const lyl = serializeLilyletDoc(doc);

	console.log('  lyl output:\n' + lyl.split('\n').map(l => '    ' + l).join('\n'));

	// In the .lyl for measure 2, the voice line that contains g should start
	// with \staff "2" (or have \staff "2" before g), NOT \staff "1".
	//
	// Correct:   \staff "2" g4 \staff "1" a4 b4 c4
	// Wrong:     \staff "1" g4 \staff "1" a4 b4 c4  (or just \staff "1" g4 a4 b4 c4)

	// Parse back and check
	const docRT = parseCode(lyl);
	let crossVoice2: Voice | undefined;
	for (const part of docRT.measures[1]?.parts ?? []) {
		for (const v of part.voices) {
			if (v.events.some(e => e.type === 'note' && (e as NoteEvent).pitches[0].phonet === 'g')) {
				crossVoice2 = v;
			}
		}
	}

	assert(crossVoice2 !== undefined, 'Measure 2 round-trip: voice with g found');

	if (crossVoice2) {
		const notes2 = getNoteStaffs(crossVoice2);
		const gNote = notes2.find(n => n.phonet === 'g');
		assert(gNote?.staff === 2,
			`Measure 2 round-trip: g is on staff 2 (got ${gNote?.staff})`);
		const aNotes = notes2.filter(n => ['a', 'b', 'c'].includes(n.phonet));
		assert(aNotes.every(n => n.staff === 1),
			`Measure 2 round-trip: a,b,c are on staff 1 (got ${aNotes.map(n => n.staff).join(',')})`);
	}
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
if (failed > 0)
	console.log(`⚠️  ${failed} FAILED — \\change Staff state not carried across measure boundaries`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
