/**
 * Unit test: \change Staff handling in the LilyPond decoder.
 *
 * Regression guard for the bug where \change Staff commands are ignored during
 * .ly → JSON decoding, causing notes that should be on staff 2 (bass) to remain
 * on staff 1 (treble) in the lilylet output.
 *
 * Background: BWV-787 m1 fails because the decoder ignores all \change Staff
 * commands (lilypondDecoder.ts: "Ignore \change Staff commands - staff is fixed
 * per track"). Notes that cross staves get wrong tick assignments when
 * regulateLilylet matches them against spartito events.
 *
 * Usage: npx tsx tests/unit/crossStaffDecoder.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import type { NoteEvent, RestEvent, Voice } from '../../source/lilylet/types';


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

function getNoteStaffs(voice: Voice): number[] {
	return voice.events
		.filter(e => e.type === 'note')
		.map(e => (e as NoteEvent).staff ?? voice.staff);
}

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
#(set-global-staff-size 20)
\\paper { paper-width = 210\\mm paper-height = 297\\mm ragged-last = ##t }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;


// ─── Warm-up parser ──────────────────────────────────────────────────────────

{
	const warn = console.warn, assert2 = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch { /* ignore */ }
	console.warn = warn; console.assert = assert2;
}


// ─── Test input: two-staff piano, voice crosses from staff 1 to staff 2 ────

// Voice 1: c c (both on staff 1 / treble)
// Voice 2: g (starts on staff 2 / bass via \change Staff = "2")
//          then g (returns to staff 1 via \change Staff = "1")
// Expected after decode:
//   voice 2 events: g is on staff 2, second g is on staff 1

const LY_CROSS_STAFF = LY_BOILERPLATE + `
\\score {
  \\new Staff = "1_1" <<
    \\new Voice {
      \\relative c' { \\clef treble \\time 4/4 c2 c } |  % 1
    }
    \\new Voice {
      \\relative c' { \\change Staff = "2" \\clef bass g2 \\change Staff = "1" \\stemDown g } |  % 1
    }
  >>
  \\layout { }
}
`;


// ─── Test 1: decoder captures \change Staff as context events in JSON ────────

console.log('\nTest 1: \\change Staff produces context { staff } events in decoded JSON');

await (async () => {
	const doc = await decode(LY_CROSS_STAFF);

	// Find the voice with cross-staff content (the one with \change Staff)
	let crossVoice: Voice | undefined;
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				const staffContexts = voice.events.filter(
					e => e.type === 'context' && (e as any).staff !== undefined
				);
				if (staffContexts.length > 0) {
					crossVoice = voice;
					break;
				}
			}
		}
	}

	assert(crossVoice !== undefined, 'Found a voice containing context { staff } events');

	if (crossVoice) {
		const staffContexts = crossVoice.events.filter(
			e => e.type === 'context' && (e as any).staff !== undefined
		);
		assert(staffContexts.length >= 2,
			`Voice has ≥2 context staff events (got ${staffContexts.length}) — one for \change Staff = "2", one for \change Staff = "1"`);
	}
})();


// ─── Test 2: notes after \change Staff = "2" are on staff 2 in the JSON ────

console.log('\nTest 2: note following \\change Staff = "2" has staff=2 in decoded JSON');

await (async () => {
	const doc = await decode(LY_CROSS_STAFF);

	let crossVoice: Voice | undefined;
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				const hasStaffContext = voice.events.some(
					e => e.type === 'context' && (e as any).staff === 2
				);
				if (hasStaffContext) { crossVoice = voice; break; }
			}
		}
	}

	if (!crossVoice) {
		assert(false, 'Could not find cross-staff voice — context events missing from decoder output');
		return;
	}

	// Walk voice events: track activeStaff, verify notes are on correct staff
	let activeStaff = crossVoice.staff;
	const noteStaffs: number[] = [];
	for (const event of crossVoice.events) {
		if (event.type === 'context' && (event as any).staff) {
			activeStaff = (event as any).staff;
		}
		if (event.type === 'note') {
			noteStaffs.push((event as NoteEvent).staff ?? activeStaff);
		}
	}

	assert(noteStaffs.length === 2, `Voice has 2 note events (got ${noteStaffs.length})`);
	assert(noteStaffs[0] === 2,
		`First note (after \\change Staff = "2") is on staff 2 (got staff ${noteStaffs[0]})`);
	assert(noteStaffs[1] === 1,
		`Second note (after \\change Staff = "1") is on staff 1 (got staff ${noteStaffs[1]})`);
})();


// ─── Test 3: serialized .lyl emits \staff "2" before the cross-staff note ───

console.log('\nTest 3: .lyl serialization emits \\staff "2" for cross-staff note');

await (async () => {
	const doc = await decode(LY_CROSS_STAFF);
	const lyl = serializeLilyletDoc(doc);

	// The voice that started on staff 1 should switch to \staff "2" mid-line
	assert(/\\staff "2"/.test(lyl),
		`lyl contains \\staff "2" switch: ${lyl.includes('\\staff "2"') ? 'yes' : 'NO'}`);
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
if (failed > 0) {
	console.log(`⚠️  ${failed} test(s) FAILED — \\change Staff is not handled by the decoder.`);
	console.log(`   See lilypondDecoder.ts: "Ignore \\change Staff commands - staff is fixed per track"`);
}
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
