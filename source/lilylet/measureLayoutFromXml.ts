/**
 * Derive a performance-order measure-layout string from a MusicXML part's
 * repeat / volta / navigation markup.
 *
 * Input: the raw per-measure repeat structure collected from `<barline>`
 * (forward/backward repeats, 1st/2nd-ending voltas) and `<direction><sound>`
 * (D.C./D.S./Coda/Fine jumps), in 1-based measure index order (one entry per
 * decoded lilylet measure — no merging of split bars, so indices map 1:1).
 *
 * Output: a lotus-style measure-layout string (e.g. "2*[1..4]",
 * "1, 2*[2..7]{[8,9], 10}, 11..15", "1..19, 3..10, 20, 21") suitable for
 * `metadata.measureLayout`, which the MEI encoder turns into an <expansion> and
 * verovio unfolds for MIDI. See [[lilylet-measure-layout]].
 *
 * Strategy: produce the flat performed-order index sequence by simulating the
 * repeats/jumps (this is always correct, even for D.C.-al-Fine-over-a-volta
 * which the structured DSL can't compactly express), then COMPACT it back into
 * the DSL via the shared serializer when the structure is a clean single
 * repeat/volta/segno-jump. Compaction is best-effort; the flat form is the
 * always-valid fallback.
 */

import { parseMeasureLayout, expandMeasureLayout } from "./measureLayout";
import { getDirectChildren, getAttribute } from "./musicXmlUtils";

// One decoded measure's repeat-relevant markup, in source order.
export interface MeasureRepeatInfo {
	index: number;                       // 1-based decoded measure index
	repeatStart?: boolean;               // <barline location="left"><repeat direction="forward">
	repeatEnd?: boolean;                 // <barline location="right"><repeat direction="backward">
	repeatTimes?: number;                // <repeat times="N"> (on the backward repeat)
	endingStart?: number;                // <ending number="N" type="start"> begins here
	endingStop?: number;                 // <ending number="N" type="stop"|"discontinue"> ends here
	segno?: boolean;                     // a segno point (sound segno= / <segno> glyph)
	coda?: boolean;                      // a coda landing point (sound coda= / <coda> glyph)
	tocoda?: boolean;                    // "to coda" jump origin (sound tocoda=)
	dacapo?: boolean;                    // da capo jump (sound dacapo="yes")
	dalsegno?: boolean;                  // dal segno jump (sound dalsegno=)
	fine?: boolean;                      // Fine stop point (sound fine="yes")
}

// Collapse runs of ≥3 consecutive ascending indices into "a..b"; emit the rest
// comma-separated. Mirrors lotus seqToCode for a flat index list.
const flatToCode = (seq: number[]): string => {
	let code = "";
	let inRange = false;
	for (let i = 0; i < seq.length; i++) {
		const middle = seq[i - 1] === seq[i] - 1 && seq[i + 1] === seq[i] + 1;
		if (middle) {
			if (!inRange) { code += ".."; inRange = true; }
		}
		else {
			if (i > 0 && !inRange) code += ", ";
			inRange = false;
			code += seq[i].toString();
		}
	}
	return code;
};


// ── Performed-order simulator ────────────────────────────────────────────
// Walks the measures executing repeats and navigation jumps, producing the
// flat 1-based performed-order index sequence. Always correct; the structured
// compaction below is only a prettier rendering of clean cases.
//
// Model (single-level, matches the corpus): a backward repeat sends play back
// to the most recent forward repeat (or measure 1). Voltas: on the final pass
// of a repeated section, skip any ending whose number is below the pass count
// — i.e. take the Nth ending on the Nth pass. D.C./D.S. jump to the start /
// segno once, then play to Fine or through To-Coda→Coda.

const simulate = (infos: MeasureRepeatInfo[]): number[] => {
	const n = infos.length;
	if (n === 0) return [];
	const byIndex = new Map<number, MeasureRepeatInfo>();
	for (const info of infos) byIndex.set(info.index, info);

	const segnoIdx = infos.find(i => i.segno)?.index ?? 1;
	const codaIdx = infos.find(i => i.coda)?.index;

	// Ending (volta) spans, sorted by start index. On pass P of the enclosing
	// repeat, the ending whose number === P is played; others are skipped by
	// jumping to the next ending's start (the last ending is the fallthrough).
	const endingSpans = infos
		.filter(i => i.endingStart !== undefined)
		.map(i => ({ number: i.endingStart!, start: i.index }))
		.sort((a, b) => a.start - b.start);
	const nextEndingStartAfter = (idx: number): number | undefined =>
		endingSpans.find(e => e.start > idx)?.start;

	const order: number[] = [];
	const passCount = new Map<number, number>();   // forward-repeat start index → completed passes
	let repeatStartStack: number[] = [1];          // implicit start at measure 1
	let i = 1;
	let jumpedDaCapo = false;
	let jumpedDalSegno = false;
	let toCodaArmed = false;                        // a D.S./D.C. pass arms the To-Coda jump
	let guard = 0;
	const GUARD_MAX = n * 8 + 64;

	while (i >= 1 && i <= n && guard++ < GUARD_MAX) {
		const info = byIndex.get(i);

		if (info?.repeatStart && !repeatStartStack.includes(i)) repeatStartStack.push(i);

		// Volta: decide whether to play or skip this ending on the current pass.
		if (info?.endingStart !== undefined) {
			const start = repeatStartStack[repeatStartStack.length - 1] ?? 1;
			const currentPass = (passCount.get(start) ?? 0) + 1;
			const isLastEnding = endingSpans[endingSpans.length - 1]?.start === i;
			if (info.endingStart !== currentPass && !isLastEnding) {
				const next = nextEndingStartAfter(i);
				if (next !== undefined) { i = next; continue; }
				// no further ending: fall past all endings
				i = i + 1; continue;
			}
		}

		order.push(i);

		// To-Coda jump (only on a post-jump pass — the D.S./D.C. al Coda convention)
		if (info?.tocoda && toCodaArmed && codaIdx !== undefined) { i = codaIdx; continue; }

		// Fine stop (only after a D.C./D.S. jump has occurred)
		if (info?.fine && (jumpedDaCapo || jumpedDalSegno)) break;

		// Backward repeat → jump to current repeat-start, counting the pass.
		// If this same measure ALSO carries a D.C./D.S. (e.g. ABC "!D.C.!:|"), the
		// repeat is resolved FIRST (all passes), then we fall through to the
		// navigation jump below — the da-capo wraps the repeat, not the reverse.
		if (info?.repeatEnd) {
			const start = repeatStartStack[repeatStartStack.length - 1] ?? 1;
			const times = info.repeatTimes ?? 2;
			const done = (passCount.get(start) ?? 0) + 1;
			passCount.set(start, done);
			if (done < times) { i = start; continue; }
			repeatStartStack = repeatStartStack.filter(s => s !== start);
			// repeat exhausted: only advance past it when there is no pending
			// navigation on this measure (otherwise fall through to D.C./D.S.).
			const hasPendingNav = (info.dacapo && !jumpedDaCapo) || (info.dalsegno && !jumpedDalSegno);
			if (!hasPendingNav) { i++; continue; }
		}

		// D.S. (dal segno) — jump back to segno once, arm To-Coda
		if (info?.dalsegno && !jumpedDalSegno) { jumpedDalSegno = true; toCodaArmed = true; i = segnoIdx; continue; }

		// D.C. (da capo) — jump back to the start once, arm To-Coda
		if (info?.dacapo && !jumpedDaCapo) { jumpedDaCapo = true; toCodaArmed = true; i = 1; continue; }

		i++;
	}

	return order;
};


// ── Structured compaction ────────────────────────────────────────────────
// Recognize the clean single-section shapes and render them compactly. For a
// plain repeat → "T*[a..b]"; for a repeat with 1st/2nd endings →
// "pre, T*[body]{[e1…], [e2…]}, post". Anything more tangled (nested repeats,
// D.C./D.S. over a volta, segno jumps) is left to the flat fallback.

const rangeCode = (a: number, b: number): string => a === b ? `${a}` : flatToCode(Array.from({ length: b - a + 1 }, (_, k) => a + k));

// Render the repeat/volta structure over measures [lo..hi] (no navigation),
// or null if it isn't a single clean repeat/volta span. Shared by the plain
// path and the da-capo ABA wrapper.
const renderRepeatSpan = (infos: MeasureRepeatInfo[], lo: number, hi: number): string | null => {
	const span = infos.filter(i => i.index >= lo && i.index <= hi);
	const repeatEnds = span.filter(i => i.repeatEnd);
	if (repeatEnds.length > 1) return null;          // >1 repeat span → caller falls back to flat

	if (repeatEnds.length === 0) {
		// no repeat at all in this span: a plain ascending run (only valid if the
		// caller still wants a structured wrapper around it)
		const hasEnding = span.some(i => i.endingStart !== undefined);
		if (hasEnding) return null;
		return rangeCode(lo, hi);
	}

	const endInfo = repeatEnds[0];
	// The repeat-start for THIS end is the latest repeat-start at or before it; a
	// repeat-start sitting AFTER the end (e.g. the second half of a ":|:"/"::" that
	// opens the next section) belongs to a following span, not this one. Falling
	// back to `lo` models the implicit "repeat from the start of the span".
	const startIdx = span.filter(i => i.repeatStart && i.index <= endInfo.index).map(i => i.index).sort((a, b) => b - a)[0] ?? lo;
	const times = endInfo.repeatTimes ?? 2;
	const endingStarts = span.filter(i => i.endingStart !== undefined).map(i => i.index).sort((a, b) => a - b);

	if (endingStarts.length === 0) {
		// plain repeat: pre, T*[start..end], post
		const parts: string[] = [];
		if (startIdx > lo) parts.push(rangeCode(lo, startIdx - 1));
		parts.push(`${times}*[${rangeCode(startIdx, endInfo.index)}]`);
		if (endInfo.index < hi) parts.push(rangeCode(endInfo.index + 1, hi));
		return parts.join(", ");
	}

	// volta: body = [startIdx .. firstEndingStart-1]; endings partition the rest
	// up to where the last ending stops; tail follows.
	const firstEnding = endingStarts[0];
	const bodyEnd = firstEnding - 1;
	if (bodyEnd < startIdx) return null;
	const endings: number[][] = [];
	for (let e = 0; e < endingStarts.length; e++) {
		const s = endingStarts[e];
		const nextS = endingStarts[e + 1];
		let stop: number;
		if (nextS !== undefined) stop = nextS - 1;
		else {
			const stopInfo = span.find(info => info.index >= s && info.endingStop !== undefined);
			stop = stopInfo ? stopInfo.index : s;
		}
		endings.push(Array.from({ length: stop - s + 1 }, (_, k) => s + k));
	}
	const lastStop = endings[endings.length - 1][endings[endings.length - 1].length - 1];

	const parts: string[] = [];
	if (startIdx > lo) parts.push(rangeCode(lo, startIdx - 1));
	const altCode = endings.map(sp => sp.length > 1 ? `[${flatToCode(sp)}]` : `${sp[0]}`).join(", ");
	parts.push(`${times}*[${rangeCode(startIdx, bodyEnd)}]{${altCode}}`);
	if (lastStop < hi) parts.push(rangeCode(lastStop + 1, hi));
	return parts.join(", ");
};

// Render a span [lo..hi] that has one OR MORE plain repeat/volta sections in
// sequence (no navigation). Real scores are usually multi-section (AABB minuets,
// sonata exposition+recap), which the single-span renderRepeatSpan can't express
// — it bails when it sees >1 repeat-end. Here we cut the span at section
// boundaries (each cut ends a repeat section, voltas included) and render each
// sub-span independently, joining with commas. Any non-repeated measures between
// two sections are absorbed as the `pre` of the following span. Returns null if
// any section isn't a clean single repeat/volta (caller then falls back to flat).
// Used both for the whole piece (lo=1, hi=total) and recursively for the A / B
// halves of a da-capo ABA.
const renderRepeatSections = (infos: MeasureRepeatInfo[], lo: number, hi: number): string | null => {
	const inSpan = (idx: number) => idx >= lo && idx <= hi;
	const repeatEnds = infos.filter(i => i.repeatEnd && inSpan(i.index)).map(i => i.index).sort((a, b) => a - b);
	const repeatStarts = infos.filter(i => i.repeatStart && inSpan(i.index)).map(i => i.index).sort((a, b) => a - b);
	if (repeatEnds.length <= 1) return renderRepeatSpan(infos, lo, hi);

	const endingStops = infos.filter(i => i.endingStop !== undefined && inSpan(i.index)).map(i => i.index);

	const parts: string[] = [];
	let prevHi = lo - 1;
	for (const e of repeatEnds) {
		const sectionLo = prevHi + 1;
		// The next section's repeat-start bounds this section's voltas (2nd/3rd
		// endings sit AFTER the repeat-end but BEFORE the next section starts).
		const nextStart = repeatStarts.find(s => s > e);
		const sectionEndingStarts = infos
			.filter(i => i.endingStart !== undefined && i.index >= sectionLo && (nextStart === undefined || i.index < nextStart) && inSpan(i.index))
			.map(i => i.index)
			.sort((a, b) => a - b);

		let sectionHi: number;
		if (sectionEndingStarts.length) {
			const lastStart = sectionEndingStarts[sectionEndingStarts.length - 1];
			// the last ending's stop closes the section; else the ending start itself
			const stop = endingStops.filter(s => s >= lastStart).sort((a, b) => a - b)[0];
			sectionHi = stop ?? lastStart;
		}
		else sectionHi = e;

		// A repeat-end only loops when an OPEN repeat-start feeds it (the simulate
		// model): either an EXPLICIT repeat-start inside this section [sectionLo..e],
		// or the implicit start of measure 1 for the very first section. A plain
		// (no-volta) repeat-end with neither — e.g. the closing half of a "::" whose
		// matching start was already consumed/popped by an earlier section — is
		// SPURIOUS: those measures play exactly once, so emit a plain range instead
		// of a bogus T*[...] wrapper (which would fail the re-expand guard → flat).
		const explicitStartInSection = repeatStarts.some(s => s >= sectionLo && s <= e);
		const implicitFromStart = sectionLo === lo && lo === 1;
		if (sectionEndingStarts.length === 0 && !explicitStartInSection && !implicitFromStart) {
			parts.push(rangeCode(sectionLo, sectionHi));
			prevHi = sectionHi;
			continue;
		}

		const code = renderRepeatSpan(infos, sectionLo, sectionHi);
		if (code === null) return null;
		parts.push(code);
		prevHi = sectionHi;
	}
	// trailing non-repeated tail
	if (prevHi < hi) parts.push(rangeCode(prevHi + 1, hi));
	return parts.join(", ");
};

const tryStructured = (infos: MeasureRepeatInfo[], total: number): string | null => {
	const dacapo = infos.find(i => i.dacapo);
	const dalsegno = infos.some(i => i.dalsegno);
	const tocoda = infos.some(i => i.tocoda);

	// D.C. (da capo → return to measure 1) over an inner repeat/volta maps cleanly
	// to ABA <main, rest>: the trailing A' re-expansion uses LayoutType.Once (body
	// once + the LAST alternate), which is exactly the "over-volta" convention —
	// on the da-capo pass internal volta repeats are dropped, only the final
	// pass-through plays, stopping at Fine. D.S. (segno ≠ measure 1) and To-Coda
	// truncation can't be expressed this way → flat fallback.
	if (dacapo && !dalsegno && !tocoda) {
		// D.C. over a volta → ABA <main, rest>; Once re-expansion gives the
		// over-volta replay (body + last ending, no inner repeat). Plain D.C. al
		// Fine without a volta can't bound A' at an arbitrary Fine → flat fallback.
		return buildDaCapoABA(infos, dacapo.index);
	}
	if (dalsegno || tocoda || infos.some(i => i.fine || i.segno || i.coda)) return null;

	// No navigation: one or more plain repeat/volta sections in sequence. Most
	// real pieces (AABB minuets, sonata exposition+recap) have ≥2 repeat sections;
	// render each independently and join with commas.
	return renderRepeatSections(infos, 1, total);
};

// Construct the ABA form <main, rest> for a D.C. case. The ABA expansion plays
// A B A' where A = main (Full), B = rest (Full), A' = main (Once: volta bodies
// once + last alternate, no inner repeat). For D.C. al Fine, A is the whole
// pre-Fine span (1..fine) and B is the post-Fine span up to the D.C. (fine+1..dc);
// the da-capo replay A' then plays main once more, stopping at Fine. Both A and B
// can themselves contain repeat/volta sections, so each is structured recursively
// via renderRepeatSections. Returns null when the shape doesn't fit (no Fine to
// bound A, or no rest tail) → caller uses the flat fallback. The end-of-build
// re-expand check still validates the result against the simulated order.
const buildDaCapoABA = (infos: MeasureRepeatInfo[], dcIdx: number): string | null => {
	const fineIdx = infos.find(i => i.fine)?.index;
	if (fineIdx === undefined) {
		// No explicit Fine: fall back to the legacy single-volta ABA shape, where
		// A ends at the last pre-D.C. ending and B is the tail to the D.C. measure.
		return buildDaCapoABALegacy(infos, dcIdx);
	}
	if (fineIdx >= dcIdx) return null;          // Fine must precede the D.C. tail
	const restLo = fineIdx + 1;
	if (restLo > dcIdx) return null;            // no B section

	const mainCode = renderRepeatSections(infos, 1, fineIdx);
	const restCode = renderRepeatSections(infos, restLo, dcIdx);
	if (mainCode === null || restCode === null) return null;

	// `main` is parsed by the ABA grammar as ONE item (parseItem). It needs wrapping
	// in [..] when it is a comma sequence ("1, 2*[..]") or a BARE range ("1..37",
	// which parseItem stops at the first number). A lone number, or a single
	// already-structured token ("2*[..]" / "2*[..]{..}" / "[..]"), parses as one item
	// and needs no extra bracket. `rest` is parsed as a sequence, so it only needs
	// bracketing to group a comma sequence — a range there is fine.
	const isSingleToken = /^\d+$/.test(mainCode) || /^\d+\*\[/.test(mainCode) || /^\[/.test(mainCode);
	const main = isSingleToken ? mainCode : `[${mainCode}]`;
	const rest = /,/.test(restCode) ? `[${restCode}]` : restCode;
	return `<${main}, ${rest}>`;
};

// Legacy ABA builder for D.C. WITHOUT an explicit Fine: main = the single
// volta/repeat structure before the D.C., rest = the post-volta tail. Kept for
// the original over-volta-without-Fine convention.
const buildDaCapoABALegacy = (infos: MeasureRepeatInfo[], dcIdx: number): string | null => {
	const endingStarts = infos.filter(i => i.index <= dcIdx && i.endingStart !== undefined).map(i => i.index).sort((a, b) => a - b);
	if (endingStarts.length === 0) return null;   // plain D.C. al Fine (no volta) → flat
	// body+endings up to the last ending stop; the rest (tail) runs to dcIdx.
	const repeatEnd = infos.find(i => i.index <= dcIdx && i.repeatEnd);
	const startIdx = infos.find(i => i.index <= dcIdx && i.repeatStart)?.index ?? 1;
	const times = repeatEnd?.repeatTimes ?? 2;
	const bodyEnd = endingStarts[0] - 1;
	if (bodyEnd < startIdx) return null;

	const endings: number[][] = [];
	for (let e = 0; e < endingStarts.length; e++) {
		const s = endingStarts[e];
		const nextS = endingStarts[e + 1];
		let stop: number;
		if (nextS !== undefined) stop = nextS - 1;
		else {
			const stopInfo = infos.find(info => info.index >= s && info.endingStop !== undefined);
			stop = stopInfo ? stopInfo.index : s;
		}
		endings.push(Array.from({ length: stop - s + 1 }, (_, k) => s + k));
	}
	const lastStop = endings[endings.length - 1][endings[endings.length - 1].length - 1];
	const altCode = endings.map(sp => sp.length > 1 ? `[${flatToCode(sp)}]` : `${sp[0]}`).join(", ");
	const voltaCode = `${times}*[${rangeCode(startIdx, bodyEnd)}]{${altCode}}`;

	const pre = startIdx > 1 ? rangeCode(1, startIdx - 1) + ", " : "";
	const main = pre ? `[${pre}${voltaCode}]` : voltaCode;
	// rest = the tail from after the last ending to the D.C. measure
	if (lastStop >= dcIdx) return null;   // no tail to form the ABA "rest"
	const rest = rangeCode(lastStop + 1, dcIdx);
	return `<${main}, ${rest}>`;
};


/**
 * Build a measure-layout string from a part's repeat structure, or undefined if
 * there is nothing to unfold (no repeats/voltas/navigation). The result is
 * guaranteed to expand (via measureLayout.ts) to the simulated performed order.
 */
export const buildMeasureLayout = (infos: MeasureRepeatInfo[], totalMeasures: number): string | undefined => {
	const hasAny = infos.some(i =>
		i.repeatStart || i.repeatEnd || i.endingStart !== undefined ||
		i.dacapo || i.dalsegno || i.tocoda || i.fine);
	if (!hasAny) return undefined;

	const performed = simulate(infos);
	if (performed.length === 0) return undefined;
	// No actual unfolding happened (e.g. a lone start-repeat with no end): skip.
	if (performed.length === totalMeasures && performed.every((v, k) => v === k + 1)) return undefined;

	const structured = tryStructured(infos, totalMeasures);
	if (structured) {
		// Trust the structured form only if it reproduces the simulated order.
		try {
			const got = expandMeasureLayout(parseMeasureLayout(structured));
			if (JSON.stringify(got) === JSON.stringify(performed)) return structured;
		} catch { /* fall through to flat */ }
	}
	return flatToCode(performed);
};


// Recognize navigation semantics from a <words> string (case-insensitive).
// "D.C. al Fine" → dacapo (the Fine stop is marked separately where "Fine"
// appears); "D.S. al Coda"/"D.S." → dalsegno; "To Coda" → tocoda; bare "Fine"
// → fine; bare "Coda"/"Segno" → mark the landing point.
// Exported so the ABC decoder can feed its !D.C.!/!D.S.!/!fine! decoration text
// through the SAME recognizer, keeping the ABC and MusicXML nav semantics identical.
export const applyNavText = (info: MeasureRepeatInfo, raw: string): void => {
	const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
	if (!t) return;
	const isDC = /\bd\.?\s*c\.?\b|\bda\s*capo\b/.test(t);
	const isDS = /\bd\.?\s*s\.?\b|\bdal\s*segno\b/.test(t);
	if (isDC) info.dacapo = true;
	if (isDS) info.dalsegno = true;
	if (/\bto\s*coda\b/.test(t)) info.tocoda = true;
	// "al Fine" / standalone "Fine" → this measure (or the jump) ends at Fine.
	// A D.C./D.S. "al Fine" phrase names the STOP target, which is wherever the
	// "Fine" label sits — so only the bare/al-Fine "fine" word sets the stop flag.
	if (/\bfine\b/.test(t) && !isDC && !isDS) info.fine = true;
	// bare "Coda"/"Segno" word (not "to coda", not "al coda") marks the landing
	if (/\bcoda\b/.test(t) && !/\bto\s*coda\b/.test(t) && !/\bal\s*coda\b/.test(t) && !isDS) info.coda = true;
	if (/\bsegno\b/.test(t) && !isDS) info.segno = true;
};

// ── Collector: walk a <part>'s measures → MeasureRepeatInfo[] ─────────────
// One entry per <measure> in document order (1-based index = decoded lilylet
// measure index, since we never merge measures). Reads <barline> repeats/endings
// and <direction><sound> navigation. Repeat markup is part-global and (by
// convention) identical across parts, so the decoder calls this on the first part.

export const collectRepeatInfo = (partEl: Element): MeasureRepeatInfo[] => {
	const infos: MeasureRepeatInfo[] = [];
	const measureEls = getDirectChildren(partEl, "measure");
	for (let m = 0; m < measureEls.length; m++) {
		const measureEl = measureEls[m];
		const info: MeasureRepeatInfo = { index: m + 1 };

		for (const bl of getDirectChildren(measureEl, "barline")) {
			const repeatEl = bl.getElementsByTagName("repeat")[0];
			if (repeatEl) {
				const dir = getAttribute(repeatEl, "direction");
				if (dir === "forward") info.repeatStart = true;
				else if (dir === "backward") {
					info.repeatEnd = true;
					const times = getAttribute(repeatEl, "times");
					if (times) info.repeatTimes = parseInt(times, 10);
				}
			}
			const endingEl = bl.getElementsByTagName("ending")[0];
			if (endingEl) {
				const type = getAttribute(endingEl, "type");
				const numStr = getAttribute(endingEl, "number") || "1";
				// number can be "1" or "1,2"; take the first integer
				const num = parseInt(numStr, 10) || 1;
				if (type === "start") info.endingStart = num;
				else if (type === "stop" || type === "discontinue") info.endingStop = num;
			}
		}

		for (const dirEl of getDirectChildren(measureEl, "direction")) {
			const soundEl = dirEl.getElementsByTagName("sound")[0];
			if (soundEl) {
				if (getAttribute(soundEl, "dacapo") === "yes") info.dacapo = true;
				if (getAttribute(soundEl, "fine") === "yes") info.fine = true;
				if (getAttribute(soundEl, "dalsegno")) info.dalsegno = true;
				if (getAttribute(soundEl, "segno")) info.segno = true;
				if (getAttribute(soundEl, "coda")) info.coda = true;
				if (getAttribute(soundEl, "tocoda")) info.tocoda = true;
			}
			// glyph-only segno/coda (no <sound>) still marks the point
			const dtEl = dirEl.getElementsByTagName("direction-type")[0];
			if (dtEl) {
				if (dtEl.getElementsByTagName("segno")[0]) info.segno = true;
				if (dtEl.getElementsByTagName("coda")[0]) info.coda = true;
			}
			// Text-based navigation: many engravers write only the words
			// ("D.C. al Fine", "D.S. al Coda", "Fine", "To Coda") with no <sound>
			// jump attribute. Parse the displayed text to recover the semantics.
			for (const wEl of Array.from(dirEl.getElementsByTagName("words"))) {
				applyNavText(info, wEl.textContent || "");
			}
		}
		// also catch a bare <sound> child of <measure> (outside <direction>)
		for (const soundEl of getDirectChildren(measureEl, "sound")) {
			if (getAttribute(soundEl, "dacapo") === "yes") info.dacapo = true;
			if (getAttribute(soundEl, "fine") === "yes") info.fine = true;
			if (getAttribute(soundEl, "dalsegno")) info.dalsegno = true;
			if (getAttribute(soundEl, "segno")) info.segno = true;
			if (getAttribute(soundEl, "coda")) info.coda = true;
			if (getAttribute(soundEl, "tocoda")) info.tocoda = true;
		}

		infos.push(info);
	}
	return infos;
};

/**
 * Derive metadata.measureLayout from a <part> element, or undefined if no
 * repeats/voltas/navigation are present. Convenience wrapper combining the
 * collector + builder; never throws (returns undefined on any failure).
 */
export const measureLayoutFromPart = (partEl: Element): string | undefined => {
	try {
		const infos = collectRepeatInfo(partEl);
		return buildMeasureLayout(infos, infos.length);
	} catch {
		return undefined;
	}
};



