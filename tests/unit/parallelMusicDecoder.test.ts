/**
 * Unit test: \parallelMusic decoding in the LilyPond decoder.
 *
 * \parallelMusic distributes measures round-robin across named variables:
 *   \parallelMusic #'(voiceA voiceB) { m1a | m1b | m2a | m2b | }
 * → voiceA = [m1a, m2a], voiceB = [m1b, m2b]
 * Variables are then referenced in a \score block.
 *
 * Reference: https://lilypond.org/doc/v2.23/Documentation/notation/multiple-voices#writing-music-in-parallel
 *
 * Usage: npx tsx tests/unit/parallelMusicDecoder.test.ts
 */

import { decode } from '../../source/lilylet/lilypondDecoder.js';
import { serializeLilyletDoc } from '../../source/lilylet/serializer.js';
import { parseCode } from '../../source/lilylet/parser.js';
import type { NoteEvent, LilyletDoc } from '../../source/lilylet/types.js';


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

// Warm-up parser
{
	const w = console.warn, a = console.assert;
	console.warn = () => {}; console.assert = () => {};
	try { await decode('{ c }'); } catch {}
	console.warn = w; console.assert = a;
}

function getNotes(doc: LilyletDoc) {
	return doc.measures.flatMap(m =>
		m.parts.flatMap(p =>
			p.voices.flatMap(v =>
				v.events
					.filter(e => e.type === 'note')
					.map(e => (e as NoteEvent).pitches[0].phonet)
			)
		)
	);
}

function getMeasureCount(doc: LilyletDoc) {
	return doc.measures.length;
}


// ─── Test input ───────────────────────────────────────────────────────────────
//
// Original \parallelMusic syntax with octave marks, as used in real scores.
// Expected absolute pitches verified by running through the lotus decoder:
//
//   voiceA  \relative c'':
//     m1: c'4 d e f  → c(2) d(2) e(2) f(2)   (C6=oct2, since c' in \relative c'')
//     m2: a'4 b c d  → a(3) b(3) c(4) d(4)   (continues from f(2), a'→oct3, wraps)
//
//   voiceB  \relative c':
//     m1: g,2 g      → g(-2) g(-2)            (G, relative c' with , → very low)
//     m2: e,2 e      → e(-3) e(-3)            (continues from g(-2))
//
// \parallelMusic interleaves: voiceA-m1 | voiceB-m1 | voiceA-m2 | voiceB-m2

const LY_PARALLEL = `
\\version "2.22.0"
\\language "english"
\\header { tagline = ##f }

\\parallelMusic #'(voiceA voiceB)
{
  c'4 d e f |
  g,2 g     |
  a'4 b c d |
  e,2 e     |
}

\\score {
  \\new StaffGroup <<
    \\new Staff {
      \\new Voice = "va" {
        \\relative c'' \\voiceA
      }
    }
    \\new Staff {
      \\clef "bass"
      \\new Voice = "vb" {
        \\relative c' \\voiceB
      }
    }
  >>
  \\layout {}
}
`;


// ─── Test 1: decoder produces the correct number of measures ─────────────────

console.log('\nTest 1: \\parallelMusic — correct measure count decoded');

await (async () => {
	let doc: LilyletDoc | undefined;
	let threw = false;
	try {
		doc = await decode(LY_PARALLEL);
	} catch (e: any) {
		threw = true;
		console.log(`  ! Decoder threw: ${e.message}`);
	}

	assert(!threw, 'Decoder does not throw on \\parallelMusic input');
	if (!doc) return;

	const measures = getMeasureCount(doc);
	assert(measures === 2, `Decoded 2 measures (got ${measures})`);
})();


// ─── Test 2: voiceA notes are present (c d e f / a b c d) ────────────────────

console.log('\nTest 2: voiceA notes decoded correctly');

await (async () => {
	const doc = await decode(LY_PARALLEL);
	const allNotes = getNotes(doc);

	// voiceA should contain: c d e f (m1) and a b c d (m2)
	assert(allNotes.includes('c'), `Note 'c' present`);
	assert(allNotes.includes('d'), `Note 'd' present`);
	assert(allNotes.includes('e'), `Note 'e' present`);
	assert(allNotes.includes('f'), `Note 'f' present`);

	// voiceB should contain: g (m1) and e (m2)
	assert(allNotes.includes('g'), `Note 'g' present (voiceB)`);

	const totalNotes = allNotes.length;
	assert(totalNotes >= 10, `Total note count ≥ 10 (got ${totalNotes})`);
})();


// ─── Test 3: voiceA and voiceB land on separate staves/voices ────────────────

console.log('\nTest 3: voiceA and voiceB produce distinct voice entries');

await (async () => {
	const doc = await decode(LY_PARALLEL);

	// Count total voice entries across all measures
	const voiceEntries = doc.measures.flatMap(m =>
		m.parts.flatMap(p => p.voices)
	);
	assert(voiceEntries.length >= 2, `At least 2 voice entries across all measures (got ${voiceEntries.length})`);

	// Each measure should have at least one voice with notes
	for (let mi = 0; mi < doc.measures.length; mi++) {
		const notes = doc.measures[mi].parts.flatMap(p =>
			p.voices.flatMap(v =>
				v.events.filter(e => e.type === 'note')
			)
		);
		assert(notes.length > 0, `Measure ${mi + 1} has note events (got ${notes.length})`);
	}
})();


// ─── Test 4: absolute pitch correctness — decoded octaves match LilyPond ──────
//
// Each pitch is represented as {phonet, octave} absolute values computed by lotus.
// Expected values were verified by running the decoder (not manually guessed):
//   voiceA m1: c(2) d(2) e(2) f(2)   — c' in \relative c'' = C6
//   voiceA m2: a(3) b(3) c(4) d(4)   — continues from f(2), a' pushes to oct3+
//   voiceB m1: g(-2) g(-2)            — g, in \relative c' = very low G
//   voiceB m2: e(-3) e(-3)            — continues from g(-2)

console.log('\nTest 4: absolute pitch correctness (phonet + octave match LilyPond semantics)');

await (async () => {
	const doc = await decode(LY_PARALLEL);

	type Pitch = { phonet: string; octave: number };

	// Collect all note pitches grouped by measure and voice order
	const byMeasure: Pitch[][][] = [];
	for (let mi = 0; mi < doc.measures.length; mi++) {
		byMeasure[mi] = doc.measures[mi].parts
			.flatMap(p => p.voices)
			.map(v => v.events
				.filter(e => e.type === 'note')
				.map(e => ({ phonet: (e as NoteEvent).pitches[0].phonet, octave: (e as NoteEvent).pitches[0].octave }))
			)
			.filter(a => a.length > 0);
	}

	const fmt = (ps: Pitch[]) => ps.map(p => `${p.phonet}(${p.octave})`).join(' ');

	// voiceA m1: c(2) d(2) e(2) f(2)
	const vaM1 = byMeasure[0]?.find(v => v.some(p => p.phonet === 'c' && p.octave === 2));
	assert(!!vaM1, `voiceA m1 found at expected octave 2`);
	if (vaM1) {
		const expected: Pitch[] = [{phonet:'c',octave:2},{phonet:'d',octave:2},{phonet:'e',octave:2},{phonet:'f',octave:2}];
		assert(JSON.stringify(vaM1) === JSON.stringify(expected),
			`voiceA m1 pitches: [${fmt(vaM1)}] === [${fmt(expected)}]`);
	}

	// voiceA m2: a(3) b(3) c(4) d(4)
	const vaM2 = byMeasure[1]?.find(v => v.some(p => p.phonet === 'a' && p.octave === 3));
	assert(!!vaM2, `voiceA m2 found at expected octave 3+`);
	if (vaM2) {
		const expected: Pitch[] = [{phonet:'a',octave:3},{phonet:'b',octave:3},{phonet:'c',octave:4},{phonet:'d',octave:4}];
		assert(JSON.stringify(vaM2) === JSON.stringify(expected),
			`voiceA m2 pitches: [${fmt(vaM2)}] === [${fmt(expected)}]`);
	}

	// voiceB m1: g(-2) g(-2)
	const vbM1 = byMeasure[0]?.find(v => v.some(p => p.phonet === 'g' && p.octave === -2));
	assert(!!vbM1, `voiceB m1 found at expected octave -2`);
	if (vbM1) {
		const expected: Pitch[] = [{phonet:'g',octave:-2},{phonet:'g',octave:-2}];
		assert(JSON.stringify(vbM1) === JSON.stringify(expected),
			`voiceB m1 pitches: [${fmt(vbM1)}] === [${fmt(expected)}]`);
	}

	// voiceB m2: e(-3) e(-3)
	const vbM2 = byMeasure[1]?.find(v => v.some(p => p.phonet === 'e' && p.octave === -3));
	assert(!!vbM2, `voiceB m2 found at expected octave -3`);
	if (vbM2) {
		const expected: Pitch[] = [{phonet:'e',octave:-3},{phonet:'e',octave:-3}];
		assert(JSON.stringify(vbM2) === JSON.stringify(expected),
			`voiceB m2 pitches: [${fmt(vbM2)}] === [${fmt(expected)}]`);
	}
})();


// ─── Test 5: serializer→parser round-trip preserves absolute pitches ──────────
// The serializer converts absolute pitches back to \relative lyl syntax.
// If there is per-measure relative-mode drift, the parsed-back octaves will
// differ from the decoded-doc octaves.

console.log('\nTest 5: serialized .lyl round-trip preserves absolute pitches (detect relative-mode drift)');

await (async () => {
	const doc = await decode(LY_PARALLEL);
	const lyl = serializeLilyletDoc(doc);

	console.log('  lyl output:\n' + lyl.split('\n').map(l => '    ' + l).join('\n'));

	let docRT: LilyletDoc | undefined;
	try { docRT = parseCode(lyl); } catch (e: any) {
		assert(false, `parseCode threw: ${e.message}`);
		return;
	}

	// Extract flat list of {phonet, octave} from all note events
	const getPitches = (d: LilyletDoc) =>
		d.measures.flatMap(m =>
			m.parts.flatMap(p =>
				p.voices.flatMap(v =>
					v.events
						.filter(e => e.type === 'note')
						.map(e => {
							const n = e as NoteEvent;
							return { phonet: n.pitches[0].phonet, octave: n.pitches[0].octave };
						})
				)
			)
		);

	const origPitches = getPitches(doc);
	const rtPitches = getPitches(docRT!);

	console.log('  orig pitches:', origPitches.map(p => p.phonet + p.octave).join(' '));
	console.log('  rt   pitches:', rtPitches.map(p => p.phonet + p.octave).join(' '));

	assert(origPitches.length === rtPitches.length,
		`Same note count: ${origPitches.length} === ${rtPitches.length}`);

	let allMatch = true;
	for (let i = 0; i < origPitches.length; i++) {
		const o = origPitches[i], r = rtPitches[i];
		if (o.phonet !== r.phonet || o.octave !== r.octave) {
			assert(false, `Pitch ${i}: ${o.phonet}(${o.octave}) → round-trip gave ${r.phonet}(${r.octave}) — relative-mode drift`);
			allMatch = false;
		}
	}
	if (allMatch) {
		assert(true, `All ${origPitches.length} pitches preserved through serializer round-trip`);
	}
})();


// ─── Test 6: serialization produces valid .lyl ────────────────────────────────

console.log('\nTest 6: serialized .lyl parses back without error');

await (async () => {
	const doc = await decode(LY_PARALLEL);
	const lyl = serializeLilyletDoc(doc);

	console.log('  lyl output:\n' + lyl.split('\n').map(l => '    ' + l).join('\n'));

	let threw = false;
	let docRT: LilyletDoc | undefined;
	try {
		docRT = parseCode(lyl);
	} catch (e: any) {
		threw = true;
		console.log(`  ! parseCode threw: ${e.message}`);
	}

	assert(!threw, 'Serialized .lyl parses back without error');
	if (!docRT) return;

	const rtMeasures = getMeasureCount(docRT);
	assert(rtMeasures === getMeasureCount(doc),
		`Round-trip measure count matches (${rtMeasures} === ${getMeasureCount(doc)})`);

	const rtNotes = getNotes(docRT);
	const origNotes = getNotes(doc);
	assert(rtNotes.length === origNotes.length,
		`Round-trip note count matches (${rtNotes.length} === ${origNotes.length})`);
})();


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
if (failed > 0) {
	console.log(`⚠️  ${failed} FAILED — \\parallelMusic not fully supported by decoder`);
}
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
