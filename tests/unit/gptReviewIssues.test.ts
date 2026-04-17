/**
 * Unit tests targeting issues raised in GPT code review of commits:
 *   - fix: serializer cross-staff context handling
 *   - fix: LilyPond decoder \change Staff support
 *
 * Usage: npx tsx tests/unit/gptReviewIssues.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder.js';
import { serializeLilyletDoc } from '../../source/lilylet/serializer.js';
import type { LilyletDoc, Voice } from '../../source/lilylet/types.js';


// ─── helpers ────────────────────────────────────────────────────────────────

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

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

// Warm-up parser
{
	const warn = console.warn, a2 = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch { /* ignore */ }
	console.warn = warn; console.assert = a2;
}

function getVoiceEvents(doc: LilyletDoc) {
	return doc.measures.flatMap(m => m.parts.flatMap(p => p.voices));
}

/** Assert that string A appears before string B in str. */
function assertOrder(str: string, a: string, b: string, label: string): void {
	const ia = str.indexOf(a);
	const ib = str.indexOf(b);
	assert(ia !== -1 && ib !== -1 && ia < ib,
		`${label}: "${a}" (pos ${ia}) appears before "${b}" (pos ${ib})`);
}


// ─── Issue 1a: Compound { staff, clef } on DIFFERENT staff ───────────────────
// Bug: serializer emits \staff "N" then `continue`, dropping the clef.
// Repro: build a LilyletDoc directly with a compound context event.

console.log('\nIssue 1a: Compound context { staff:2, clef:"bass" } — serializer must emit both');

{
	const doc: LilyletDoc = {
		measures: [{
			parts: [{
				voices: [{
					staff: 1,
					events: [
						{ type: 'context', staff: 2, clef: 'bass' } as any,
						{ type: 'note', pitches: [{ phonet: 'g', octave: -1 }], duration: { division: 4, dots: 0 } },
					]
				}]
			}]
		}]
	};
	const lyl = serializeLilyletDoc(doc);
	assert(lyl.includes('\\staff "2"'), `Compound event: emits \\staff "2" — got: ${lyl}`);
	assert(lyl.includes('\\clef "bass"'), `Compound event: emits \\clef "bass" — got: ${lyl}`);
	assertOrder(lyl, '\\staff "2"', '\\clef "bass"', 'Compound diff-staff');
}


// ─── Issue 1b: Compound { staff, clef } on SAME staff ────────────────────────
// Bug: `if (ctx.staff) continue` drops clef when staff unchanged.

console.log('\nIssue 1b: Compound context { staff:1, clef:"bass" } same staff — clef must not be dropped');

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
	// staff:1 is same as voice.staff so no \staff switch needed, but clef MUST appear
	assert(lyl.includes('\\clef "bass"'), `Same-staff compound event: emits \\clef "bass" — got: ${lyl}`);
}


// ─── Issue 2: Rest ordering — \staff "2" must come BEFORE rest in output ─────

console.log('\nIssue 2: \\staff "2" appears before rest, \\staff "1" before return rest (ordering)');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\change Staff = "2" r2 \\change Staff = "1" r2 }
    }
  >>
  \\layout { }
}
`;
	const doc = await decode(LY);
	const lyl = serializeLilyletDoc(doc);

	// Match the full pattern: \staff "2" r... \staff "1" r...
	// (duration may be elided on second rest)
	assert(/\\staff "2"\s+r\d*/.test(lyl), `\\staff "2" immediately before first rest`);
	assert(/\\staff "1"\s+r\d*/.test(lyl), `\\staff "1" immediately before second rest`);
})();


// ─── Issue 3: Non-numeric \change Staff = "RH" — notes still decode correctly ─

console.log('\nIssue 3: \\change Staff = "RH" — notes after ignored change still decode');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\change Staff = "RH" g2 g2 }
    }
  >>
  \\layout { }
}
`;
	const doc = await decode(LY);
	const voices = getVoiceEvents(doc);
	const notes = voices.flatMap(v => v.events.filter(e => e.type === 'note'));
	assert(notes.length === 2, `Notes after ignored \\change Staff still decode — got ${notes.length}`);

	const staffCtx = voices.flatMap(v => v.events.filter(e => e.type === 'context' && (e as any).staff != null));
	assert(staffCtx.length === 0, `Non-numeric name produces 0 staff context events (got ${staffCtx.length})`);
})();


// ─── Issue 4: Adversarial digit-stripping — "1_2", "foo2bar", "1 2" ──────────

console.log('\nIssue 4: Adversarial staff names via digit-stripping regex');

await (async () => {
	// "1_2" is a realistic case (GrandStaff-style staff names in generated .ly files)
	const LY_1_2 = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\change Staff = "1_2" g2 g2 }
    }
  >>
  \\layout { }
}
`;
	const doc = await decode(LY_1_2);
	const voices = getVoiceEvents(doc);
	const staffCtx = voices.flatMap(v => v.events.filter(e => e.type === 'context' && (e as any).staff != null));
	const staffNums = staffCtx.map((e: any) => e.staff);

	// "1_2".replace(/[^0-9]/g) → "12" → parseInt → 12
	// This is the digit-stripping coercion bug.
	// Document actual behavior: if 12 appears, that is the bug.
	if (staffNums.includes(12)) {
		assert(false, `BUG: "1_2" was coerced to staff 12 by digit-stripping (got ${staffNums})`);
	} else if (staffNums.length === 0) {
		// Acceptable if treated as unparseable and dropped
		assert(true, `"1_2" treated as non-numeric, silently dropped (staff events: 0)`);
	} else {
		// Any other result should be explicit
		assert(false, `Unexpected staff numbers from "1_2": ${staffNums}`);
	}
})();


// ─── Issue 5: Multiple successive switches — exact sequence ──────────────────

console.log('\nIssue 5: Multiple successive staff switches — exact event sequence');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' {
        \\change Staff = "2" g4
        \\change Staff = "1" c4
        \\change Staff = "2" g4
        \\change Staff = "1" c4
      }
    }
  >>
  \\layout { }
}
`;
	const doc = await decode(LY);

	// Verify exact decoded event sequence
	const voices = getVoiceEvents(doc);
	const seq: string[] = [];
	for (const v of voices) {
		let activeStaff = v.staff;
		for (const e of v.events) {
			if (e.type === 'context' && (e as any).staff != null) {
				activeStaff = (e as any).staff;
				seq.push(`staff:${activeStaff}`);
			}
			if (e.type === 'note') seq.push(`note`);
		}
	}
	const expected = ['staff:2','note','staff:1','note','staff:2','note','staff:1','note'];
	assert(JSON.stringify(seq) === JSON.stringify(expected),
		`Exact sequence: [${seq.join(',')}] === [${expected.join(',')}]`);

	// Verify serialized output has correct ordering
	const lyl = serializeLilyletDoc(doc);
	// Remove whitespace/newlines for easier regex
	const flat = lyl.replace(/\s+/g, ' ');
	// Should see: staff "2" ... g4 ... staff "1" ... c4 ... staff "2" ... g4 ... staff "1" ... c4
	// Match patterns: \staff "2" g... and \staff "1" c... (duration may be elided)
	assert(/\\staff "2"\s+g\d*/.test(flat), `\\staff "2" immediately before g note`);
	assert(/\\staff "1"\s+c\d*/.test(flat), `\\staff "1" immediately before c note`);
})();


// ─── Issue 5b: Same-staff switch twice in a row ───────────────────────────────

console.log('\nIssue 5b: Same-staff switch twice in a row — no duplicate \\staff emission');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' {
        \\change Staff = "2" g4
        \\change Staff = "2" g4
      }
    }
  >>
  \\layout { }
}
`;
	const doc = await decode(LY);
	const lyl = serializeLilyletDoc(doc);
	const count = (lyl.match(/\\staff "2"/g) || []).length;
	// Ideally emitted only once (serializer dedupes same-staff switch)
	assert(count >= 1, `At least one \\staff "2" emitted (got ${count})`);
	// Document: currently emits it twice (one per context event) or once (deduplicated)
	console.log(`  (info) \\staff "2" count: ${count} — serializer ${count === 1 ? 'deduplicates' : 'does NOT deduplicate'} same-staff repeat`);
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
