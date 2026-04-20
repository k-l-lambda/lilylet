/**
 * Unit test: \afterGrace / \acciaccatura inside \times 2/3 must NOT leak
 * notes outside the tuplet wrapper.
 *
 * Bug: chopin-25-2.ly measure 68 (voice 1) has the pattern:
 *
 *   \times 2/3 { bf8 [ c8 \afterGrace { \acciaccatura { ef8 } df8 ) ] } { c8 } }
 *
 * The decoder collects notes backwards when the Tuplet term fires.
 * The \afterGrace / \acciaccatura emit their notes through a different
 * listener path that bypasses the flat note stream, so bf8 and c8 remain
 * in voice.events outside the tuplet while only df8 ends up wrapped.
 *
 * Expected (measure 68 has 4 × \times 2/3 { 3 eighth notes }, 2/2 time):
 *   total duration = 4 × 480 = 1920 ticks  (exactly 2/2)
 *
 * Actual (bugged):
 *   3 correct tuplets (1440) + bf8(240) + c8(240) + \times 2/3{df8}(160)
 *   = 2080 ticks  →  exceeds 1920 capacity
 *
 * Usage: npx tsx tests/unit/afterGraceInsideTuplet.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import type { TupletEvent, TimesEvent, NoteEvent } from '../../source/lilylet/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

const LY_BOILERPLATE = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }
\\layout { \\context { \\Score autoBeaming = ##f } }
`;

// Warm-up
{ const w = console.warn, a = console.assert;
  console.warn = () => {}; console.assert = () => {};
  try { await decode('{ c }'); } catch {}
  console.warn = w; console.assert = a; }

const TPQN = 480;

function measureDuration(events: any[], mul = 1): number {
	let total = 0;
	for (const e of events) {
		if (e.type === 'note' || e.type === 'rest') {
			if (!e.invisible && !e.grace) {
				const d = e.duration;
				let t = (TPQN * 4) / d.division;
				let dot = t / 2;
				for (let i = 0; i < d.dots; i++) { t += dot; dot /= 2; }
				total += Math.round(t * mul);
			}
		} else if (e.type === 'tuplet' || e.type === 'times') {
			const inner = mul * e.ratio.numerator / e.ratio.denominator;
			total += measureDuration(e.events, inner);
		}
	}
	return total;
}


// ─── Minimal reproduction of Chopin 25-2 m68 ─────────────────────────────────
// 4 × \times 2/3 { 3 eighth notes } in 2/2 time = 4 × 480 = 1920 ticks.
// Last group contains \afterGrace { \acciaccatura { ef8 } df8 } { c8 }.

const LY_AFTER_GRACE_IN_TUPLET = LY_BOILERPLATE + `
\\score {
  \\new Staff {
    \\new Voice {
      \\relative c' {
        \\time 2/2
        \\once \\omit TupletNumber \\times 2/3 { c8 [ c' bf ] }
        \\once \\omit TupletNumber \\times 2/3 { af8 [ g f ] }
        \\once \\omit TupletNumber \\times 2/3 { ef8 [ df c ] }
        \\once \\omit TupletNumber \\times 2/3 {
          bf8 [ c8
          \\afterGrace {
            \\acciaccatura { ef8 }
            df8
          }
          { c8 }
        }
      }
    }
  }
  \\layout {}
}
`;

console.log('\nTest 1: measure duration must equal 2/2 capacity (1920 ticks)');
console.log('─'.repeat(60));

await (async () => {
	const doc = await decode(LY_AFTER_GRACE_IN_TUPLET);
	assert(doc.measures.length >= 1, `decoded 1+ measures (got ${doc.measures.length})`);
	if (!doc.measures[0]) return;

	const voice = doc.measures[0].parts[0]?.voices[0];
	assert(!!voice, 'voice exists');
	if (!voice) return;

	const totalTicks = measureDuration(voice.events);
	const capacity = TPQN * 4 * 2 / 2; // 2/2 = 1920

	assert(totalTicks === capacity,
		`total duration ${totalTicks} ticks === 2/2 capacity ${capacity} ticks`);

	// All 4 groups must be wrapped in tuplets
	const tuplets = voice.events.filter(e => e.type === 'tuplet' || e.type === 'times');
	const bareNotes = voice.events.filter(e => e.type === 'note' && !(e as NoteEvent).grace);

	assert(tuplets.length === 4,
		`4 tuplet wrappers present (got ${tuplets.length})`);
	assert(bareNotes.length === 0,
		`no bare non-grace notes at top level (got ${bareNotes.length})`);

	// Last tuplet must contain 3 notes (bf, c, df — c8 afterGrace = grace, ignored)
	if (tuplets.length === 4) {
		const last = tuplets[3] as TupletEvent | TimesEvent;
		const innerNotes = last.events.filter(e => e.type === 'note' && !(e as NoteEvent).grace);
		assert(innerNotes.length >= 2,
			`last tuplet has ≥2 non-grace notes (bf, c visible; df may be graced) — got ${innerNotes.length}`);
	}
})();


// ─── Test 2: simpler \afterGrace inside tuplet (no acciaccatura) ──────────────

console.log('\nTest 2: simple \\afterGrace (no acciaccatura) inside \\times 2/3');
console.log('─'.repeat(60));

const LY_SIMPLE_AFTER_GRACE = LY_BOILERPLATE + `
\\score {
  \\new Staff {
    \\new Voice {
      \\relative c' {
        \\time 2/2
        \\once \\omit TupletNumber \\times 2/3 { c8 d e }
        \\once \\omit TupletNumber \\times 2/3 { f8 g a }
        \\once \\omit TupletNumber \\times 2/3 { b8 c d }
        \\once \\omit TupletNumber \\times 2/3 {
          e8 f \\afterGrace g8 { f16 }
        }
      }
    }
  }
  \\layout {}
}
`;

await (async () => {
	const doc = await decode(LY_SIMPLE_AFTER_GRACE);
	if (!doc.measures[0]) { assert(false, 'decoded measure'); return; }

	const voice = doc.measures[0].parts[0]?.voices[0];
	if (!voice) { assert(false, 'voice exists'); return; }

	const totalTicks = measureDuration(voice.events);
	const capacity = TPQN * 4 * 2 / 2;
	const bareNotes = voice.events.filter(e => e.type === 'note' && !(e as NoteEvent).grace);

	assert(bareNotes.length === 0,
		`simple \\afterGrace inside tuplet: no bare notes at top level (got ${bareNotes.length})`);
	assert(totalTicks <= capacity,
		`duration ${totalTicks} ≤ capacity ${capacity}`);
})();


// ─── Test 3: serialized lyl tick count (via visualize logic) ─────────────────

console.log('\nTest 3: serialized lyl round-trips to correct measure duration');
console.log('─'.repeat(60));

await (async () => {
	const doc = await decode(LY_AFTER_GRACE_IN_TUPLET);
	const lyl = serializeLilyletDoc(doc);

	console.log('  lyl m1:', lyl.split('\n').find(l => l.includes('%1'))?.trim() ?? '(not found)');

	// lyl should NOT have bare non-grace eighth notes at the measure level
	// (they should all be inside \times or \tuplet wrappers)
	const m1line = lyl.split('|')[0] ?? '';
	const hasBareEighths = /(?<!\\grace\s)\b[a-g][',]*8\b/.test(
		m1line.replace(/\\times[^{]*\{[^}]*\}/g, '').replace(/\\grace\s+\S+/g, '')
	);
	assert(!hasBareEighths,
		`serialized lyl measure 1 has no bare eighth notes outside tuplet wrappers`);
})();


// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
if (failed > 0)
	console.log(`⚠️  ${failed} FAILED — \\afterGrace inside \\times 2/3 causes note leakage`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
