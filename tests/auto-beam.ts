/**
 * Test: Auto-beam on/off/auto modes
 *
 * Verifies that the autoBeam metadata option controls beam generation:
 * - 'off': never auto-beam, even without manual beams
 * - 'on': always auto-beam, even when manual beams exist
 * - 'auto' / undefined: auto-beam only if no manual beam marks in source
 */

import { parseCode, meiEncoder } from "../source/lilylet/index.js";
import type { LilyletDoc } from "../source/lilylet/types.js";

let passed = 0;
let failed = 0;

const assert = (condition: boolean, label: string, detail?: string) => {
	if (condition) {
		console.log(`✅ ${label}`);
		passed++;
	} else {
		console.log(`❌ ${label}`);
		if (detail) console.log(`   ${detail}`);
		failed++;
	}
};

const countBeams = (mei: string): number => (mei.match(/<beam /g) || []).length;

console.log("Auto-Beam Mode Tests\n");
console.log("=".repeat(80));

// --- Test source without manual beams ---
console.log("\n--- Source without manual beams: c8 d e f g a b c ---\n");

{
	// undefined (default) → should auto-beam
	const doc = parseCode("\\clef treble c8 d e f g a b c'");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams > 0, "autoBeam=undefined, no manual beams → auto-beam applied", `beam count: ${beams}`);
}

{
	// 'auto' → should auto-beam (same as undefined)
	const doc = parseCode("\\clef treble c8 d e f g a b c'");
	doc.metadata = { autoBeam: 'auto' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams > 0, "autoBeam='auto', no manual beams → auto-beam applied", `beam count: ${beams}`);
}

{
	// 'on' → should auto-beam
	const doc = parseCode("\\clef treble c8 d e f g a b c'");
	doc.metadata = { autoBeam: 'on' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams > 0, "autoBeam='on', no manual beams → auto-beam applied", `beam count: ${beams}`);
}

{
	// 'off' → should NOT auto-beam
	const doc = parseCode("\\clef treble c8 d e f g a b c'");
	doc.metadata = { autoBeam: 'off' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 0, "autoBeam='off', no manual beams → no beams", `beam count: ${beams}`);
}

// --- Test source WITH manual beams ---
console.log("\n--- Source with manual beams: c8[ d e f] g a b c ---\n");

{
	// undefined → should NOT auto-beam (manual beams detected)
	const doc = parseCode("\\clef treble c8[ d e f] g a b c'");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 1, "autoBeam=undefined, has manual beams → only manual beams (1)", `beam count: ${beams}`);
}

{
	// 'auto' → should NOT auto-beam (manual beams detected)
	const doc = parseCode("\\clef treble c8[ d e f] g a b c'");
	doc.metadata = { autoBeam: 'auto' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 1, "autoBeam='auto', has manual beams → only manual beams (1)", `beam count: ${beams}`);
}

{
	// 'on' → should auto-beam even though manual beams exist
	const doc = parseCode("\\clef treble c8[ d e f] g a b c'");
	doc.metadata = { autoBeam: 'on' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams > 1, "autoBeam='on', has manual beams → auto-beam adds more beams", `beam count: ${beams}`);
}

{
	// 'off' → should NOT auto-beam, but manual beams kept
	const doc = parseCode("\\clef treble c8[ d e f] g a b c'");
	doc.metadata = { autoBeam: 'off' };
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 1, "autoBeam='off', has manual beams → only manual beams (1)", `beam count: ${beams}`);
}

// --- Time signature specific tests ---
console.log("\n--- Time signature grouping ---\n");

{
	// 6/8: groups of 3 eighths
	const doc = parseCode("\\time 6/8 \\clef treble c8 d e f g a");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 2, "6/8: 6 eighths → 2 beam groups (3+3)", `beam count: ${beams}`);
}

{
	// 3/4: groups of 3 eighths
	const doc = parseCode("\\time 3/4 \\clef treble c8 d e f g a");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 2, "3/4: 6 eighths → 2 beam groups (3+3)", `beam count: ${beams}`);
}

{
	// 2/4: groups of 2 eighths
	const doc = parseCode("\\time 2/4 \\clef treble c8 d e f");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 2, "2/4: 4 eighths → 2 beam groups (2+2)", `beam count: ${beams}`);
}

{
	// Rest breaks beam
	const doc = parseCode("\\clef treble c8 d r e f g r a");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 2, "4/4: rests break beams → 2 beam groups", `beam count: ${beams}`);
}

{
	// Single beamable note should NOT create beam
	const doc = parseCode("\\clef treble c4 d8 e4 f4");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams === 0, "Lone eighth among quarters → no beam", `beam count: ${beams}`);
}

{
	// Tuplet auto-beam
	const doc = parseCode("\\clef treble \\times 2/3 { c8 d e } \\times 2/3 { f8 g a } c4 c4");
	const mei = meiEncoder.encode(doc);
	const beams = countBeams(mei);
	assert(beams >= 1, "Tuplet eighths → at least 1 beam group", `beam count: ${beams}`);
}

// --- Idempotency: auto-beam should not double-beam ---
console.log("\n--- Idempotency ---\n");

{
	const doc = parseCode("\\clef treble c8 d e f g a b c'");
	const mei1 = meiEncoder.encode(doc);
	const mei2 = meiEncoder.encode(doc);
	// Note: encode adds beam marks in-place, so second call should still work
	// The beam count may differ because marks accumulate, but MEI output structure should be valid
	const beams1 = countBeams(mei1);
	const beams2 = countBeams(mei2);
	assert(beams1 === beams2, "Double-encode produces same beam count", `first: ${beams1}, second: ${beams2}`);
}

console.log("\n" + "=".repeat(80));
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
