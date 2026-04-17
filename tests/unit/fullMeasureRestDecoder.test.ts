/**
 * Unit test: full-measure rest (R1) detection in the LilyPond decoder.
 *
 * Regression guard for:
 *   - lilypondDecoder: R must decode with fullMeasure=true; r must not
 *   - serializeLilyletDoc: fullMeasure rest must serialize as uppercase R
 *   - parseCode round-trip: R in .lyl must parse back with fullMeasure=true
 *
 * Usage: npx tsx tests/unit/fullMeasureRest.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import { parseCode } from '../../source/lilylet/parser';
import type { RestEvent } from '../../source/lilylet/types';


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

function findRests(doc: ReturnType<typeof parseCode>): RestEvent[] {
	const rests: RestEvent[] = [];
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				for (const event of voice.events) {
					if (event.type === 'rest')
						rests.push(event as RestEvent);
				}
			}
		}
	}
	return rests;
}


// ─── Warm-up parser (required before first decode call) ─────────────────────

{
	const warn = console.warn, assert2 = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch { /* ignore */ }
	console.warn = warn; console.assert = assert2;
}


// ─── Test 1: LilyPond decoder — R1 produces fullMeasure=true ────────────────

console.log('\nTest 1: lilypondDecoder R1 → fullMeasure=true');

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

const LY_WITH_R1 = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\time 4/4 \\clef treble c4 d e f } |  % 1
    }
    \\new Voice {
      \\relative c' { \\time 4/4 R1 } |  % 1
    }
  >>
  \\layout { }
}
`;

const LY_WITH_LOWERCASE_R = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\time 4/4 \\clef treble r1 } |  % 1
    }
  >>
  \\layout { }
}
`;

await (async () => {
	const docR = await decode(LY_WITH_R1);
	const restsR = findRests(docR);
	const fullMeasureRests = restsR.filter(r => r.fullMeasure);
	assert(fullMeasureRests.length === 1, `R1 decoded: found ${fullMeasureRests.length} fullMeasure rest (expected 1)`);
	if (fullMeasureRests.length > 0) {
		assert(fullMeasureRests[0].duration.division === 1, `R1 duration.division === 1 (whole note)`);
		assert(!fullMeasureRests[0].invisible, `R1 is not invisible`);
	}

	const docR_lc = await decode(LY_WITH_LOWERCASE_R);
	const restsLc = findRests(docR_lc);
	assert(restsLc.length === 1, `r1 decoded: found ${restsLc.length} rest (expected 1)`);
	if (restsLc.length > 0) {
		assert(!restsLc[0].fullMeasure, `r1 does NOT have fullMeasure flag`);
	}
})();


// ─── Test 2: serializer — fullMeasure rest serializes as uppercase R ─────────

console.log('\nTest 2: serializer fullMeasure=true → uppercase R in .lyl');

await (async () => {
	const doc = await decode(LY_WITH_R1);
	const lyl = serializeLilyletDoc(doc);

	// Should contain uppercase R1 (whole full-measure rest)
	assert(/\bR1\b/.test(lyl), `lyl contains R1: ${lyl.includes('R1') ? 'yes' : 'NO — got: ' + lyl.slice(0, 200)}`);
	// Should NOT contain standalone r1 (lowercase, a regular rest)
	// Note: "r1" can appear as a sub-string of identifiers, so we check for word-boundary r1
	const hasLowercaseR1 = /\br1\b/.test(lyl);
	assert(!hasLowercaseR1, `lyl does not contain lowercase r1 where R1 is expected`);
})();


// ─── Test 3: round-trip R1 through .lyl parser ───────────────────────────────

console.log('\nTest 3: R1 .lyl round-trip — fullMeasure survives parseCode');

await (async () => {
	const doc = await decode(LY_WITH_R1);
	const lyl = serializeLilyletDoc(doc);
	const docRT = parseCode(lyl);

	const rests = findRests(docRT);
	const fullMeasureRests = rests.filter(r => r.fullMeasure);
	assert(fullMeasureRests.length >= 1, `Round-trip: found ${fullMeasureRests.length} fullMeasure rest (expected ≥1)`);
})();


// ─── Test 4: dotted variants (R2., R4.) also get fullMeasure=true ────────────

console.log('\nTest 4: dotted variants R2. R4. also get fullMeasure=true');

const LY_DOTTED = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\time 3/4 \\clef treble c4 d e } |  % 1
    }
    \\new Voice {
      \\relative c' { \\time 3/4 R2. } |  % 1
    }
  >>
  \\layout { }
}
`;

await (async () => {
	const doc = await decode(LY_DOTTED);
	const rests = findRests(doc);
	const fullMeasureRests = rests.filter(r => r.fullMeasure);
	assert(fullMeasureRests.length === 1, `R2. decoded: found ${fullMeasureRests.length} fullMeasure rest (expected 1)`);
	if (fullMeasureRests.length > 0) {
		assert(fullMeasureRests[0].duration.division === 2, `R2. duration.division === 2`);
		assert(fullMeasureRests[0].duration.dots === 1, `R2. duration.dots === 1`);
	}

	const lyl = serializeLilyletDoc(doc);
	assert(/\bR2\.\s*\|/.test(lyl) || /\bR2\.\s*\\\\/.test(lyl), `lyl contains R2.: ${lyl.includes('R2.') ? 'yes' : 'NO'}`);
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
