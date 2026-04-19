/**
 * Unit test: \change Staff before \times tuplet preserves staff assignment across measures.
 *
 * Regression guard for the bug where a voice-level `\change Staff = "N"` immediately
 * preceding a `\times` tuplet ends up AFTER the tuplet in the flat voice event list,
 * causing the serializer to emit the wrong \staff "N" for the following measure when
 * the carry-over staff equals the track's default staff (carryStaff === trackStaff).
 *
 * Real-world case: rachmaninoff-3-2 measure 42, PartPOneVoiceThree (defined in
 * \context Staff = "2"). The measure ends on staff=2, so carryStaff=2=trackStaff.
 * Measure 42 begins with `\change Staff = "1" \times 2/3 { ... }`. The expected lyl
 * output is `\staff "1" \tuplet 3/2 { ... }`, but the actual output is
 * `\staff "2" \tuplet 3/2 { ... }` because:
 *   1. lotus flat-term-list places \change Staff AFTER the tuplet body notes
 *   2. the carryStaff === trackStaff guard skips all carry-over logic
 *   3. effectiveInitialStaff defaults to trackStaff (=2) since the first
 *      voice event is the tuplet itself (a musical type → scan stops)
 *
 * Usage: npx tsx tests/unit/changeStaffBeforeTuplet.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
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

/** Return the initial staff of a voice (before any events). */
function getInitialStaff(voice: Voice): number {
	return voice.staff || 1;
}


// ─── Minimal reproduction case ───────────────────────────────────────────────
//
// Structure:
//   \context Staff = "2" voice with:
//     measure 1: \change Staff = "2" c1   → ends on staff 2
//     measure 2: \change Staff = "1" \times 2/3 { c8 d e } ...
//
// Expected: lyl measure 2 voice starts with \staff "1"
// Bug:      lyl measure 2 voice starts with \staff "2"

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

const LY_CHANGE_STAFF_BEFORE_TUPLET = LY_BOILERPLATE + `
\\score {
  \\new PianoStaff <<
    \\context Staff = "1" {
      \\time 4/4 c'1 | c'1 |
    }
    \\context Staff = "2" <<
      \\new Voice {
        \\time 4/4
        \\change Staff = "2" c1 |
        \\change Staff = "1" \\times 2/3 { c'8 d' e' }
        \\change Staff = "2" \\times 2/3 { c8 d e }
        \\change Staff = "1" \\times 2/3 { f'8 g' a' }
        \\change Staff = "2" \\times 2/3 { f8 g a } |
      }
    >>
  >>
  \\layout { }
}
`;


console.log('\nTest: \\change Staff = "1" before \\times tuplet (cross-measure carry)');
console.log('─'.repeat(60));

await (async () => {
	// 1. Decode
	const doc = await decode(LY_CHANGE_STAFF_BEFORE_TUPLET);

	assert(doc.measures.length >= 2, `decoded at least 2 measures (got ${doc.measures.length})`);
	if (doc.measures.length < 2) return;

	// 2. Serialize to lyl
	const lyl = serializeLilyletDoc(doc);
	assert(typeof lyl === 'string' && lyl.length > 0, 'serialized to non-empty lyl string');

	// 3. Parse the lyl back
	const parsed = parseCode(lyl);
	assert(parsed.measures.length >= 2, `parsed lyl has at least 2 measures (got ${parsed.measures.length})`);
	if (parsed.measures.length < 2) return;

	// 4. Check measure 1: the cross-staff voice should start on staff 2 (the track default)
	const m1 = parsed.measures[0];
	// Find the voice that has cross-staff content (staff=2 track, but switching to 1)
	let m1CrossVoice: Voice | undefined;
	for (const part of m1.parts) {
		for (const v of part.voices) {
			// The cross-staff voice has staff=2 as initial (ends on staff=2 in m1)
			if ((v.staff === 2) && v.events.some((e: any) => e.type === 'note' || e.type === 'tuplet' || e.type === 'times')) {
				m1CrossVoice = v;
				break;
			}
		}
		if (m1CrossVoice) break;
	}

	assert(!!m1CrossVoice, 'measure 1 has a cross-staff voice (staff=2)');

	// 5. Check measure 2: the cross-staff voice should start on staff 1
	//    because \change Staff = "1" precedes the first \times tuplet
	const m2 = parsed.measures[1];
	let m2CrossVoice: Voice | undefined;
	for (const part of m2.parts) {
		for (const v of part.voices) {
			if ((v.staff === 1 || v.staff === 2) && v.events.some((e: any) => e.type === 'tuplet' || e.type === 'times')) {
				m2CrossVoice = v;
				break;
			}
		}
		if (m2CrossVoice) break;
	}

	assert(!!m2CrossVoice, 'measure 2 has a voice with tuplet content');

	if (m2CrossVoice) {
		const initStaff = getInitialStaff(m2CrossVoice);
		assert(
			initStaff === 1,
			`measure 2 cross-staff voice starts on staff 1 (\\change Staff = "1" before \\times) — got staff=${initStaff}`
		);
	}

	// 6. Cross-check via lyl content: should contain \staff "1" before the first tuplet
	const m2Lines = lyl.split('\n').filter(l => l.includes('%2') || l.includes('\\times'));
	const hasTupletLine = lyl.includes('\\times 2/3') || lyl.includes('\\tuplet 3/2');
	assert(hasTupletLine, 'serialized lyl contains tuplet notation');

	// The specific check: find the voice line for measure 2 with tuplets
	// It should start with \staff "1", not \staff "2"
	const lylLines = lyl.split('\n');
	// Find lines with tuplet content (the cross-staff voice in measure 2)
	const tupletLines = lylLines.filter(l =>
		(l.includes('\\times') || l.includes('\\tuplet')) &&
		l.includes('c\'') || l.includes("d'") || l.includes("e'") || l.includes("f'")
	);
	assert(tupletLines.length > 0, 'found tuplet line with treble-range notes in lyl');
	if (tupletLines.length > 0) {
		const firstTupletLine = tupletLines[0];
		assert(
			firstTupletLine.startsWith('\\staff "1"'),
			`tuplet line starts with \\staff "1" (got: "${firstTupletLine.slice(0, 30)}...")`
		);
	}
})();


// ─── Test 2: rachmaninoff-style — 4-tuplet measure ending on staff=2 ─────────
//
// Closer to the real failure: measure 1 has 4 triplets each alternating
// \change Staff internally, ending on staff=2 (carryStaff=2=trackStaff).
// Measure 2 opens with \change Staff = "1" \times 2/3 {...}.
// Expected lyl measure 2 first voice: \staff "1"
// Bug:      \staff "2"

const LY_RACHMANINOFF_STYLE = LY_BOILERPLATE + `
\\score {
  \\new PianoStaff <<
    \\context Staff = "1" {
      \\time 4/4 c'1 | c'1 |
    }
    \\context Staff = "2" <<
      \\new Voice {
        \\time 4/4
        \\change Staff = "1" \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
        \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
        \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
        \\change Staff = "2" \\times 2/3 { a8 [ \\change Staff = "1" a'8 \\change Staff = "2" a8 ] } |
        \\change Staff = "1" \\times 2/3 { b'8 [ \\change Staff = "2" b8 \\change Staff = "1" b'8 ] }
        \\change Staff = "2" \\times 2/3 { d8 [ \\change Staff = "1" d'8 \\change Staff = "2" d8 ] }
        \\change Staff = "1" \\times 2/3 { f'8 [ \\change Staff = "2" f8 \\change Staff = "1" f'8 ] }
        \\change Staff = "2" \\times 2/3 { g8 [ \\change Staff = "1" g'8 \\change Staff = "2" g8 ] } |
      }
    >>
  >>
  \\layout { }
}
`;

console.log('\nTest 2: rachmaninoff-style (4 tuplets/measure, cross-staff, ending staff=2)');
console.log('─'.repeat(60));

await (async () => {
	const doc = await decode(LY_RACHMANINOFF_STYLE);

	assert(doc.measures.length >= 2, `decoded ≥ 2 measures (got ${doc.measures.length})`);
	if (doc.measures.length < 2) return;

	const lyl = serializeLilyletDoc(doc);
	const parsed = parseCode(lyl);

	assert(parsed.measures.length >= 2, `parsed lyl has ≥ 2 measures (got ${parsed.measures.length})`);
	if (parsed.measures.length < 2) return;

	// In measure 2, the cross-staff voice (in Staff "2") should start on staff=1
	// because \change Staff = "1" precedes the first \times tuplet.
	const m2 = parsed.measures[1];
	let m2CrossVoice: any;
	for (const part of m2.parts) {
		for (const v of part.voices) {
			if (v.events.some((e: any) => e.type === 'tuplet' || e.type === 'times')) {
				m2CrossVoice = v;
				break;
			}
		}
		if (m2CrossVoice) break;
	}

	assert(!!m2CrossVoice, 'measure 2 has a voice with tuplet content');

	if (m2CrossVoice) {
		const initStaff = m2CrossVoice.staff || 1;
		assert(
			initStaff === 1,
			`measure 2 voice starts on staff 1 after 4-tuplet measure ending staff=2 — got staff=${initStaff}`
		);
	}
})();


// ─── Test 3: two-PianoStaff score, cross-staff voice in Piano I ──────────────
//
// Rachmaninoff has two PianoStaffs.  Piano I, Staff "2" has a cross-staff voice
// that plays 4-tuplet patterns across many measures.  Adding a second PianoStaff
// (Piano II) is the structural difference from Test 2 that triggers the regression.
//
// Minimal reproduction: 2 PianoStaffs, cross-staff voice in Piano I runs for 3+
// measures ending staff=2, then one more measure should start on staff=1.

const LY_TWO_PIANOSTAFFS = LY_BOILERPLATE + `
\\score {
  <<
    \\new PianoStaff \\with { instrumentName = "Piano I" } <<
      \\context Staff = "1" { \\time 4/4 c'1 | c'1 | c'1 | c'1 | }
      \\context Staff = "2" <<
        \\new Voice {
          \\change Staff = "1" \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
          \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
          \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
          \\change Staff = "2" \\times 2/3 { a8 [ \\change Staff = "1" a'8 \\change Staff = "2" a8 ] } |
          \\change Staff = "1" \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
          \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
          \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
          \\change Staff = "2" \\times 2/3 { a8 [ \\change Staff = "1" a'8 \\change Staff = "2" a8 ] } |
          \\change Staff = "1" \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
          \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
          \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
          \\change Staff = "2" \\times 2/3 { a8 [ \\change Staff = "1" a'8 \\change Staff = "2" a8 ] } |
          \\change Staff = "1" \\times 2/3 { b'8 [ \\change Staff = "2" b8 \\change Staff = "1" b'8 ] }
          \\change Staff = "2" \\times 2/3 { d8 [ \\change Staff = "1" d'8 \\change Staff = "2" d8 ] }
          \\change Staff = "1" \\times 2/3 { f'8 [ \\change Staff = "2" f8 \\change Staff = "1" f'8 ] }
          \\change Staff = "2" \\times 2/3 { g8 [ \\change Staff = "1" g'8 \\change Staff = "2" g8 ] } |
        }
      >>
    >>
    \\new PianoStaff \\with { instrumentName = "Piano II" } <<
      \\context Staff = "1" { c'1 | c'1 | c'1 | c'1 | }
      \\context Staff = "2" { c,,1 | c,,1 | c,,1 | c,,1 | }
    >>
  >>
  \\layout { }
}
`;

console.log('\nTest 3: two-PianoStaff score — cross-staff voice in Piano I');
console.log('─'.repeat(60));

await (async () => {
	const doc = await decode(LY_TWO_PIANOSTAFFS);
	assert(doc.measures.length >= 4, `decoded ≥ 4 measures (got ${doc.measures.length})`);
	if (doc.measures.length < 4) return;

	const lyl = serializeLilyletDoc(doc);
	const parsed = parseCode(lyl);
	assert(parsed.measures.length >= 4, `parsed lyl has ≥ 4 measures (got ${parsed.measures.length})`);
	if (parsed.measures.length < 4) return;

	// Every measure should have its cross-staff voice start on staff=1
	// (because \change Staff = "1" precedes the first tuplet every time)
	for (let mi = 0; mi < 4; mi++) {
		const m = parsed.measures[mi];
		let crossVoice: any;
		for (const part of m.parts) {
			for (const v of part.voices) {
				if (v.events.some((e: any) => e.type === 'tuplet' || e.type === 'times')) {
					crossVoice = v; break;
				}
			}
			if (crossVoice) break;
		}
		if (!crossVoice) continue;
		const initStaff = crossVoice.staff || 1;
		assert(
			initStaff === 1,
			`measure ${mi} cross-staff voice starts staff=1 in two-PianoStaff score — got staff=${initStaff}`
		);
	}
})();




// ─── Test 4: spacer measure then bare \times (no explicit \change Staff) ─────
//
// Distilled from rachmaninoff-3-2.ly L217-237.  PartPOneVoiceThree:
//
//   measure 1: \change Staff = "2" s4  \change Staff = "1" \times 2/3 {...} s4
//              → ends on staff=1  (carryStaff = 1 after this measure)
//   measure 2: s1                      → spacer whole measure, no staff change
//              → carryStaff stays 1
//   measure 3: \times 2/3 {...}        → bare tuplet, NO leading \change Staff
//              → should inherit carryStaff=1, output \staff "1"
//   Bug:       outputs \staff "2"  (carryStaff mechanism broken)

const LY_SPACER_THEN_BARE_TUPLET = LY_BOILERPLATE + `
\\score {
  \\new PianoStaff \\with { instrumentName = "Piano I" } <<
    \\context Staff = "1" { \\time 4/4 c'1 | c'1 | c'1 | }
    \\context Staff = "2" <<
      \\new Voice {
        \\change Staff = "2" s4
        \\change Staff = "1" \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
        \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
        \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
        s4 |
        s1 |
        \\times 2/3 { c'8 [ \\change Staff = "2" c8 \\change Staff = "1" c'8 ] }
        \\change Staff = "2" \\times 2/3 { e8 [ \\change Staff = "1" e'8 \\change Staff = "2" e8 ] }
        \\change Staff = "1" \\times 2/3 { g'8 [ \\change Staff = "2" g8 \\change Staff = "1" g'8 ] }
        \\change Staff = "2" \\times 2/3 { a8 [ \\change Staff = "1" a'8 \\change Staff = "2" a8 ] } |
      }
    >>
  >>
  \\new PianoStaff \\with { instrumentName = "Piano II" } <<
    \\context Staff = "1" { c'1 | c'1 | c'1 | }
    \\context Staff = "2" { c,,1 | c,,1 | c,,1 | }
  >>
  \\layout { }
}
`;

console.log('\nTest 4: spacer measure then bare \\times (carryStaff=1 should propagate)');
console.log('─'.repeat(60));

await (async () => {
	const doc = await decode(LY_SPACER_THEN_BARE_TUPLET);
	assert(doc.measures.length >= 3, `decoded ≥ 3 measures (got ${doc.measures.length})`);
	if (doc.measures.length < 3) return;

	const lyl = serializeLilyletDoc(doc);
	const parsed = parseCode(lyl);
	assert(parsed.measures.length >= 3, `parsed lyl has ≥ 3 measures (got ${parsed.measures.length})`);
	if (parsed.measures.length < 3) return;

	// measure 2 (0-indexed) = the bare-\times measure.
	// carryStaff from m1 = 1 (last \change Staff = "1"), m2 = s1 (no change).
	// Carry-over of staff=1 should be prepended → voice starts \staff "1".
	const m2 = parsed.measures[2];
	let crossVoice: any;
	for (const part of m2.parts) {
		for (const v of part.voices) {
			if (v.events.some((e: any) => e.type === 'tuplet' || e.type === 'times')) {
				crossVoice = v; break;
			}
		}
		if (crossVoice) break;
	}
	assert(!!crossVoice, 'measure 2 has a voice with tuplet content');
	if (crossVoice) {
		const initStaff = crossVoice.staff || 1;
		assert(
			initStaff === 1,
			`measure 2 (bare \\times after spacer) voice starts staff=1 — got staff=${initStaff}`
		);
	}
})();


// ─── summary ────────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
