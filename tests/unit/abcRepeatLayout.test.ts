/**
 * Tests for deriving measure-layout from ABC repeats/voltas
 * (abcDecoder → metadata.measureLayout via collectAbcRepeatInfo + the shared
 * buildMeasureLayout). This mirrors the MusicXML path (measureLayoutFromXml.test.ts)
 * so the two import routes converge on the same layout string for equivalent
 * repeat/volta structures. See [[lilylet-repeat-decode-constraints]].
 *
 * Ground truth = the performed order abc2xml→MusicXML→lilylet produces for the same
 * tune (verified once at authoring time); here we assert against the canonical
 * layout string and its expanded order so the test runs without abc2xml in CI.
 *
 * Usage: npx tsx tests/unit/abcRepeatLayout.test.ts
 */

import { abcDecoder } from '../../source/lilylet';
import { parseMeasureLayout, expandMeasureLayout } from '../../source/lilylet/measureLayout';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

// name → { abc, layout (expected metadata.measureLayout), order (expanded performed order) }
const CASES: Record<string, { abc: string; layout: string; order: number[] }> = {
	'plain-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F | G A B c :| c B A G | F E D C |]\n',
		layout: '2*[1, 2], 3, 4',
		order: [1, 2, 1, 2, 3, 4],
	},
	'mid-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F |: G A B c :| d e f g |]\n',
		layout: '1, 2*[2], 3',
		order: [1, 2, 2, 3],
	},
	'bracket-volta': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F | G A B c |[1 d e f g :|[2 c2 c2 |]\n',
		layout: '2*[1, 2]{3, 4}',
		order: [1, 2, 3, 1, 2, 4],
	},
	'pipe-volta': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F | G A B c |1 d e f g :|2 c2 c2 |]\n',
		layout: '2*[1, 2]{3, 4}',
		order: [1, 2, 3, 1, 2, 4],
	},
	'multimeasure-volta': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F |[1 G A B c | d e f g :|[2 c2 c2 | e2 e2 |]\n',
		layout: '2*[1]{[2, 3], [4, 5]}',
		order: [1, 2, 3, 1, 4, 5],
	},
	'comma-volta': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F |[1,2 G A B c :|[3 d e f g |]\n',
		layout: '2*[1]{2, 3}',
		order: [1, 2, 1, 3],
	},
	'back-to-back-repeats': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F :| |: G A B c :| d e f g |]\n',
		layout: '2*[1], 2*[2], 3',
		order: [1, 1, 2, 2, 3],
	},
	// Multi-section AABB (two independent repeat sections, the common minuet /
	// sonata exposition+recap shape). Each section structures independently and
	// joins with a comma — this is what the multi-section renderer added.
	'aabb-two-sections': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F | G A B c :| |: d e f g | a b c d :|\n',
		layout: '2*[1, 2], 2*[3, 4]',
		order: [1, 2, 1, 2, 3, 4, 3, 4],
	},
	// Navigation: D.C. al Fine — !D.C.! sends play back to measure 1, !fine! stops it.
	// (body 1-3 with the inner repeat, then da-capo replay 1-2 stopping at the Fine.)
	'dc-al-fine': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F |: G A B c !fine!:| d e f g !D.C.!|]\n',
		layout: '1, 2, 2, 3, 1, 2',
		order: [1, 2, 2, 3, 1, 2],
	},
	// Navigation as a quoted text annotation (abc2xml treats "Fine" text as the Fine
	// stop; we match it). Same effect as !fine!.
	'dc-fine-text': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A "_Fine." B c | d e f g "_D.C."|]\n',
		layout: '1..3, 1, 2',
		order: [1, 2, 3, 1, 2],
	},
	'no-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A B c |]\n',
		layout: '',  // no repeats → no measureLayout
		order: [],
	},
};

console.log('\nDecode ABC repeats → metadata.measureLayout (performed order):');
for (const name of Object.keys(CASES)) {
	const { abc, layout: wantLayout, order: wantOrder } = CASES[name];
	const doc = abcDecoder.decode(abc);
	const layout = doc.metadata?.measureLayout;

	if (wantLayout === '') {
		assert(layout === undefined, `${name}: no measureLayout (got ${JSON.stringify(layout)})`);
		continue;
	}

	if (!layout) { assert(false, `${name}: measureLayout derived (got undefined)`); continue; }
	assert(layout === wantLayout, `${name}: layout "${layout}" === "${wantLayout}"`);

	const got = expandMeasureLayout(parseMeasureLayout(layout));
	assert(JSON.stringify(got) === JSON.stringify(wantOrder),
		`${name}: performed order [${got}] === [${wantOrder}]`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
