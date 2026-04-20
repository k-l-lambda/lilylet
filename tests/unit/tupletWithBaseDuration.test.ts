/**
 * Unit test: \tuplet N/M D { notes } with base-duration argument must
 * preserve the tuplet wrapper in the decoded doc.
 *
 * Bug: The LilyPond decoder accessed args[1].body to find the tuplet body,
 * but \tuplet 3/2 4 { ... } has args = ["3/2", "4", {body}].
 * args[1] is "4" (the base duration), not the music block, so body was
 * empty and all notes were silently decoded as plain notes outside any tuplet.
 *
 * Real-world case: chopin-28-14.ly — every measure is wrapped in
 *   \tuplet 3/2 4 { | notes }
 * producing 12 eighth notes in the time of 8, but the decoded lyl had
 * no \times wrapper at all.
 *
 * Usage: npx tsx tests/unit/tupletWithBaseDuration.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import type { NoteEvent, TupletEvent, TimesEvent } from '../../source/lilylet/types';

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


// ─── Test 1: \tuplet 3/2 4 { notes } preserves tuplet ─────────────────────
// Chopin 28-14 pattern: \tuplet 3/2 4 wraps 12 eighth notes per measure.
// Without base-duration: \tuplet 3/2 { ef8 bf gf ... } = 12 notes
// With base-duration:    \tuplet 3/2 4 { | ef8 bf gf ... } = same semantics

console.log('\nTest 1: \\tuplet 3/2 4 { notes } — tuplet wrapper preserved');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff {
    \\new Voice {
      \\relative ef, {
        \\time 4/4
        \\tuplet 3/2 4 {
          ef8 [ bf' gf ] cf [ ef, cf' ] d, [ cf' f, ] bf [ d, bf']
        }
      }
    }
  }
  \\layout {}
}
`;
	const doc = await decode(LY);
	assert(doc.measures.length >= 1, `decoded 1 measure (got ${doc.measures.length})`);
	if (!doc.measures[0]) return;

	const voice = doc.measures[0].parts[0]?.voices[0];
	assert(!!voice, 'voice exists');
	if (!voice) return;

	// The voice should have a tuplet event, NOT 12 bare note events
	const tuplets = voice.events.filter(e => e.type === 'tuplet' || e.type === 'times');
	const bareNotes = voice.events.filter(e => e.type === 'note');

	assert(tuplets.length >= 1,
		`voice contains at least 1 tuplet/times event (got ${tuplets.length}) — not bare notes`);
	assert(bareNotes.length === 0,
		`no bare notes at top level (got ${bareNotes.length}) — all should be inside tuplet`);

	if (tuplets.length >= 1) {
		const t = tuplets[0] as TupletEvent | TimesEvent;
		const innerNotes = t.events.filter(e => e.type === 'note');
		assert(innerNotes.length === 12,
			`tuplet contains 12 inner notes (got ${innerNotes.length})`);
		assert(t.ratio.numerator === 2 && t.ratio.denominator === 3,
			`ratio is 2/3 (lilylet: play 12 eighth notes in time of 8) — got ${t.ratio.numerator}/${t.ratio.denominator}`);
	}
})();


// ─── Test 2: \tuplet 3/2 (no base duration) — should still work ────────────

console.log('\nTest 2: \\tuplet 3/2 { notes } without base duration (baseline)');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff {
    \\new Voice {
      \\relative ef, {
        \\time 4/4
        \\tuplet 3/2 {
          ef8 [ bf' gf ] cf [ ef, cf' ] d, [ cf' f, ] bf [ d, bf']
        }
      }
    }
  }
  \\layout {}
}
`;
	const doc = await decode(LY);
	const voice = doc.measures[0]?.parts[0]?.voices[0];
	const tuplets = voice?.events.filter(e => e.type === 'tuplet' || e.type === 'times') ?? [];
	assert(tuplets.length >= 1,
		`\\tuplet 3/2 (no base dur) also produces tuplet event (got ${tuplets.length})`);
})();


// ─── Test 3: serialized lyl contains \tuplet or \times wrapper ─────────────

console.log('\nTest 3: serialized lyl contains tuplet notation');

await (async () => {
	const LY = LY_BOILERPLATE + `
\\score {
  \\new Staff {
    \\new Voice {
      \\relative ef, {
        \\time 4/4
        \\tuplet 3/2 4 {
          ef8 [ bf' gf ] cf [ ef, cf' ] d, [ cf' f, ] bf [ d, bf']
        }
      }
    }
  }
  \\layout {}
}
`;
	const doc = await decode(LY);
	const lyl = serializeLilyletDoc(doc);

	console.log(`  lyl: ${lyl.trim().split('\n').find(l => l.includes('time') || l.includes('tuplet') || l.includes('times')) ?? '(not found)'}`);

	assert(
		lyl.includes('\\tuplet') || lyl.includes('\\times'),
		`serialized lyl contains \\tuplet or \\times notation (got no tuplet wrapper)`
	);
})();


// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
