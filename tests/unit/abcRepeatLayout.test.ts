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
	// A 2nd-ending (:|2) immediately followed by a NEW repeat section (|:). The
	// volta must CLOSE at its own measure — the new |: section opening also closes
	// any still-open ending, else the ending overshoots into the next section and
	// the whole piece falls back to flat. Mirrors a real corpus pattern (Chopin).
	'volta-then-repeat-section': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F |1 G A B c :|2 d e f g |: a b c d | e f g a :|\n',
		layout: '2*[1]{2, 3}, 2*[4, 5]',
		order: [1, 2, 1, 3, 4, 5, 4, 5],
	},
	// Multi-section AABB (two independent repeat sections, the common minuet /
	// sonata exposition+recap shape). Each section structures independently and
	// joins with a comma — this is what the multi-section renderer added.
	'aabb-two-sections': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\n|: C D E F | G A B c :| |: d e f g | a b c d :|\n',
		layout: '2*[1, 2], 2*[3, 4]',
		order: [1, 2, 1, 2, 3, 4, 3, 4],
	},
	// End-and-start repeat ("::" / ":|:"): one bar both closes a repeat and opens
	// the next section. The repeat-end (m2) pairs with the implicit start (m1), and
	// the repeatStart it also sets on m3 belongs to the FOLLOWING (here non-repeated)
	// span — so this must render 2*[1, 2], 3.. , not mis-pair the start after the end.
	'end-and-start-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A B c :: d e f g | a b c d |]\n',
		layout: '2*[1, 2], 3, 4',
		order: [1, 2, 1, 2, 3, 4],
	},
	// Spurious end-and-start repeat: a later "::" bar's repeat-end half has NO
	// matching open repeat-start (its start was already consumed by an earlier
	// section), so simulate plays that measure ONCE. Mirrors the real-corpus
	// repeatEnds=[41,60,76,96]/repeatStarts=[42,77] shape: the 3rd repeat-end is
	// spurious and must render as a plain range, not a bogus 2*[...].
	'spurious-end-and-start-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A B c :: d e f g | a b c d :| e f g a :: f g a b | c d e f :| g a b c |]\n',
		layout: '2*[1, 2], 2*[3, 4], 5, 2*[6, 7], 8',
		order: [1, 2, 1, 2, 3, 4, 3, 4, 5, 6, 7, 6, 7, 8],
	},
	// Navigation: D.C. al Fine — !D.C.! sends play back to measure 1, !fine! stops it.
	// Structured as ABA <main, rest>: main = the pre-Fine span (with its inner
	// repeat), rest = the post-Fine tail; the Once re-expansion replays main to Fine.
	'dc-al-fine': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F |: G A B c !fine!:| d e f g !D.C.!|]\n',
		layout: '<[1, 2*[2]], 3>',
		order: [1, 2, 2, 3, 1, 2],
	},
	// D.C. that shares its measure with a repeat-end ("!D.C.!:|", common in ABC
	// minuet+trio engravings, e.g. Chopin). The repeat must resolve FIRST (all
	// passes), THEN the da-capo fires — so the D.C. wraps the trio repeat as the
	// outer ABA, not the other way round. A=1,2 (to Fine), B=the |:3 4:| repeat.
	'dc-al-fine-shared-repeat-end': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A B c !fine!|: d e f g | a b c d !D.C.!:|\n',
		layout: '<[1, 2], [2*[3, 4]]>',
		order: [1, 2, 3, 4, 3, 4, 1, 2],
	},
	// Pure D.C. al Fine with NO inner repeat (the simplest minuet+trio shape):
	// play A (1..fine) then B (fine+1..dc), then da-capo replay A to the Fine.
	// Both halves are comma sequences so both get bracketed: <[..], [..]>.
	'dc-al-fine-no-repeat': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A B c !fine! d e f g | a b c d | e f g a !D.C.!|]\n',
		layout: '<[1, 2], [3, 4]>',
		order: [1, 2, 3, 4, 1, 2],
	},
	// Navigation as a quoted text annotation (abc2xml treats "Fine" text as the Fine
	// stop; we match it). Same effect as !fine!. ABA: main = 1,2 (to Fine), rest = 3.
	'dc-fine-text': {
		abc: 'X:1\nL:1/4\nM:4/4\nK:C\nC D E F | G A "_Fine." B c | d e f g "_D.C."|]\n',
		layout: '<[1, 2], 3>',
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

console.log('\nNavigation directives → visible marks (D.C./Fine attached to a note):');
{
	// !D.C.! + !fine! should attach a markup "D.C." and "Fine" to a note (mirrors
	// the MusicXML path, which renders the same labels). Verify the marks land in
	// the doc model so the serializer emits ^\markup "D.C." / "Fine".
	const doc = abcDecoder.decode('X:1\nL:1/4\nM:4/4\nK:C\nC D E F |: G A B c !fine!:| d e f g !D.C.!|]\n');
	const markupContents: string[] = [];
	for (const m of doc.measures) for (const p of m.parts) for (const v of p.voices)
		for (const e of v.events) if (e.type === 'note')
			for (const mk of (e as any).marks || []) if (mk.markType === 'markup') markupContents.push(mk.content);
	assert(markupContents.includes('Fine'), `dc-al-fine: markup "Fine" attached (got ${JSON.stringify(markupContents)})`);
	assert(markupContents.includes('D.C.'), `dc-al-fine: markup "D.C." attached (got ${JSON.stringify(markupContents)})`);

	// !coda!/!segno! glyphs → navigation marks (\coda / \segno).
	const doc2 = abcDecoder.decode('X:1\nL:1/4\nM:4/4\nK:C\n!segno! C D E F | G A B c | d e f g !coda! a2 a2 |]\n');
	const navTypes: string[] = [];
	for (const m of doc2.measures) for (const p of m.parts) for (const v of p.voices)
		for (const e of v.events) if (e.type === 'note')
			for (const mk of (e as any).marks || []) if (mk.markType === 'navigation') navTypes.push(mk.type);
	assert(navTypes.includes('segno'), `glyph nav: \\segno attached (got ${JSON.stringify(navTypes)})`);
	assert(navTypes.includes('coda'), `glyph nav: \\coda attached (got ${JSON.stringify(navTypes)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
