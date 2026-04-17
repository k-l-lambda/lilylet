/**
 * Regression test: first note of a \times tuplet must NOT escape outside the
 * tuplet block when there are context events (e.g. \tempo, dynamics) between
 * the first and second note.
 *
 * Bug: serializer emitted the first note before the \times 4/6 { } wrapper when
 * that note was followed by a \tempo or dynamic context change inside the tuplet.
 *
 * Minimal reproduction from chopin--chopin-25-11.ly measure 5:
 *   \times 4/6 { f'''16 _\f \tempo ... c16 e a, ds c }
 * incorrectly serialized as:
 *   f'''16(\f[ \tempo ... \times 4/6 { c16 e a, ds c }   ← only 5 notes!
 *
 * Usage: npx tsx tests/unit/timesFirstNoteEscape.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import { parseCode } from '../../source/lilylet/parser';
import type { NoteEvent } from '../../source/lilylet/types';


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

function countNotesInTuplets(lyl: string): number {
	// Count notes that appear inside \times N/M { } blocks
	// A note outside would appear before \times
	const doc = parseCode(lyl);
	let count = 0;
	for (const m of doc.measures) {
		for (const p of m.parts) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e.type === 'times' || e.type === 'tuplet') {
						count += ((e as any).events ?? []).filter((te: any) => te.type === 'note').length;
					}
				}
			}
		}
	}
	return count;
}

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

// Warm-up
{
	const w = console.warn, a = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch {}
	console.warn = w; console.assert = a;
}


// ─── Test 1: \tempo inside tuplet — first note must stay inside ─────────────

console.log('\nTest 1: \\tempo inside \\times tuplet — all 6 notes must be in tuplet');

const LY_TEMPO_IN_TUPLET = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c'' {
        \\time 4/4 \\clef treble
        \\once \\omit TupletNumber \\times 4/6 {
          f'''16 \\tempo "Allegro" 2=69 c16 e16 a,16 ds16 c16
        }
        r2. |  % 1
      }
    }
  >>
  \\layout { }
}
`;

await (async () => {
	const doc = await decode(LY_TEMPO_IN_TUPLET);
	const lyl = serializeLilyletDoc(doc);

	// Count notes inside tuplets in serialized lyl
	const notesInTuplet = countNotesInTuplets(lyl);
	assert(notesInTuplet === 6,
		`All 6 notes inside tuplet (got ${notesInTuplet}) — first note must not escape before \\times`);

	// Also verify no note appears before \times in lyl text
	// The lyl should not start a measure with a note before \times
	const firstMeasureLine = lyl.split('\n').find(l => l.includes('f\'\'\''));
	if (firstMeasureLine) {
		const timesIdx = firstMeasureLine.indexOf('\\times');
		const fIdx = firstMeasureLine.indexOf("f'''");
		assert(timesIdx < fIdx || timesIdx === -1,
			`\\times appears before f''' in serialized line (timesIdx=${timesIdx} fIdx=${fIdx})`);
	}

	console.log(`  lyl: ${lyl.split('\n').find(l => l.includes("f'''") || l.includes('\\times')) ?? '(not found)'}`);
})();


// ─── Test 2: dynamic (_\f) inside tuplet — first note must stay inside ──────

console.log('\nTest 2: dynamic \\f inside \\times tuplet — all 4 notes must be in tuplet');

const LY_DYN_IN_TUPLET = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' {
        \\time 4/4 \\clef treble
        \\times 2/3 { c8\\f d e } \\times 2/3 { f8 g a } r2 |  % 1
      }
    }
  >>
  \\layout { }
}
`;

await (async () => {
	const doc = await decode(LY_DYN_IN_TUPLET);
	const lyl = serializeLilyletDoc(doc);
	const notesInTuplet = countNotesInTuplets(lyl);
	assert(notesInTuplet === 6,
		`All 6 notes (3+3) inside tuplets (got ${notesInTuplet})`);
})();


// ─── Test 3: round-trip — tuplet note count preserved ────────────────────────

console.log('\nTest 3: round-trip note count inside \\times preserved');

await (async () => {
	const doc = await decode(LY_TEMPO_IN_TUPLET);
	const lyl = serializeLilyletDoc(doc);
	const docRT = parseCode(lyl);

	let totalNotes = 0;
	for (const m of docRT.measures) {
		for (const p of m.parts) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e.type === 'times' || e.type === 'tuplet') {
						totalNotes += ((e as any).events ?? []).filter((te: any) => te.type === 'note').length;
					}
					if (e.type === 'note') totalNotes++;  // notes outside tuplets
				}
			}
		}
	}
	assert(totalNotes >= 6,
		`Round-trip: at least 6 notes present (got ${totalNotes})`);
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
if (failed > 0)
	console.log(`⚠️  ${failed} FAILED — first note of \\times tuplet escaping outside`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
