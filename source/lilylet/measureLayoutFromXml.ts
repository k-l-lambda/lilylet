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

import { parseMeasureLayout, expandMeasureLayout, LayoutType } from "./measureLayout";
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

	// Classify repeat/volta sections once so ending-skip decisions are scoped to
	// the current repeat section, not a later independent section's endings.
	const sections = classifyRepeatSections(infos, 1, n);

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
			const section = findSectionForIndex(sections, i);
			const endingSpans = section ? endingSpansForSection(infos, section) : [];
			const isLastEnding = endingSpans[endingSpans.length - 1]?.start === i;
			if (info.endingStart !== currentPass && !isLastEnding) {
				const next = endingSpans.find(e => e.start > i)?.start;
				if (next !== undefined) { i = next; continue; }
				i = section ? section.hi + 1 : i + 1;
				continue;
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

const isAscendingRun = (seq: number[]): boolean => seq.every((v, i) => i === 0 || v === seq[i - 1] + 1);

const compactFlatToCode = (seq: number[]): string => {
	const parts: string[] = [];
	let plain: number[] = [];
	const flushPlain = (): void => {
		if (plain.length > 0) {
			parts.push(flatToCode(plain));
			plain = [];
		}
	};

	let i = 0;
	while (i < seq.length) {
		let repeatLen = 0;
		for (let len = Math.floor((seq.length - i) / 2); len >= 1; len--) {
			const chunk = seq.slice(i, i + len);
			if (!isAscendingRun(chunk)) continue;
			const next = seq.slice(i + len, i + 2 * len);
			if (JSON.stringify(chunk) === JSON.stringify(next)) { repeatLen = len; break; }
		}

		if (repeatLen > 0) {
			flushPlain();
			parts.push(`2*[${flatToCode(seq.slice(i, i + repeatLen))}]`);
			i += repeatLen * 2;
		}
		else plain.push(seq[i++]);
	}
	flushPlain();
	return parts.join(", ");
};

const layoutExpandsTo = (code: string, seq: number[], type: LayoutType = LayoutType.Full): boolean => {
	try {
		const got = expandMeasureLayout(parseMeasureLayout(code), type);
		return JSON.stringify(got) === JSON.stringify(seq);
	} catch { return false; }
};

interface RepeatSection {
	lo: number;
	hi: number;
	startIdx: number;
	endIdx?: number;
	times: number;
	endingStarts: number[];
	spurious: boolean;
}

const classifyRepeatSections = (infos: MeasureRepeatInfo[], lo: number, hi: number): RepeatSection[] => {
	const inSpan = (idx: number): boolean => idx >= lo && idx <= hi;
	const repeatEnds = infos.filter(i => i.repeatEnd && inSpan(i.index)).map(i => i.index).sort((a, b) => a - b);
	const repeatStarts = infos.filter(i => i.repeatStart && inSpan(i.index)).map(i => i.index).sort((a, b) => a - b);
	const endingStops = infos.filter(i => i.endingStop !== undefined && inSpan(i.index)).map(i => i.index).sort((a, b) => a - b);

	if (repeatEnds.length === 0) {
		return [{ lo, hi, startIdx: lo, times: 1, endingStarts: [], spurious: false }];
	}

	const sections: RepeatSection[] = [];
	let prevHi = lo - 1;
	for (const e of repeatEnds) {
		if (e <= prevHi) continue;
		const sectionLo = prevHi + 1;
		const nextStart = repeatStarts.find(s => s > e);
		const sectionEndingStarts = infos
			.filter(i => i.endingStart !== undefined && i.index >= sectionLo && (nextStart === undefined || i.index < nextStart) && inSpan(i.index))
			.map(i => i.index)
			.sort((a, b) => a - b);

		let sectionHi: number;
		if (repeatEnds.length === 1) sectionHi = hi;
		else if (sectionEndingStarts.length) {
			const lastStart = sectionEndingStarts[sectionEndingStarts.length - 1];
			const stop = endingStops.find(s => s >= lastStart);
			sectionHi = stop ?? lastStart;
		}
		else sectionHi = e;

		const explicitStartInSection = repeatStarts.some(s => s >= sectionLo && s <= e);
		const implicitFromStart = sectionLo === lo && lo === 1;
		const spurious = sectionEndingStarts.length === 0 && !explicitStartInSection && !implicitFromStart;
		const startIdx = repeatStarts.filter(s => s >= sectionLo && s <= e).sort((a, b) => b - a)[0] ?? sectionLo;
		const endInfo = infos.find(i => i.index === e);
		sections.push({ lo: sectionLo, hi: sectionHi, startIdx, endIdx: e, times: endInfo?.repeatTimes ?? 2, endingStarts: sectionEndingStarts, spurious });
		prevHi = sectionHi;
	}

	if (prevHi < hi) sections.push({ lo: prevHi + 1, hi, startIdx: prevHi + 1, times: 1, endingStarts: [], spurious: false });
	return sections;
};

const findSectionForIndex = (sections: RepeatSection[], idx: number): RepeatSection | undefined =>
	sections.find(s => idx >= s.lo && idx <= s.hi);

const endingSpansForSection = (infos: MeasureRepeatInfo[], section: RepeatSection): Array<{ number: number; start: number; stop: number }> => {
	const spans: Array<{ number: number; start: number; stop: number }> = [];
	for (let e = 0; e < section.endingStarts.length; e++) {
		const start = section.endingStarts[e];
		const nextStart = section.endingStarts[e + 1];
		let stop: number;
		if (nextStart !== undefined) stop = nextStart - 1;
		else {
			const stopInfo = infos.find(info => info.index >= start && info.index <= section.hi && info.endingStop !== undefined);
			stop = stopInfo ? stopInfo.index : start;
		}
		const number = infos.find(info => info.index === start)?.endingStart ?? e + 1;
		spans.push({ number, start, stop });
	}
	return spans;
};

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
	const sections = classifyRepeatSections(infos, lo, hi);
	const parts: string[] = [];
	for (const section of sections) {
		if (section.spurious) {
			parts.push(rangeCode(section.lo, section.hi));
			continue;
		}
		const code = renderRepeatSpan(infos, section.lo, section.hi);
		if (code === null) return null;
		parts.push(code);
	}
	return parts.join(", ");
};

const tryStructured = (infos: MeasureRepeatInfo[], total: number, performed: number[]): string | null => {
	const dacapo = infos.find(i => i.dacapo);
	const dalsegno = infos.some(i => i.dalsegno);
	const tocoda = infos.some(i => i.tocoda);

	// D.C. / D.S. jumps that replay from the start can use the ABA form. A real
	// Segno (not measure 1) and To-Coda still fall back to flat because the DSL has
	// no "replay from arbitrary middle marker" construct. Bare Fine/Segno/Coda marks
	// without a jump are visual landmarks only; they must not block repeat structuring.
	const hasExplicitSegno = infos.some(i => i.segno);
	if (!tocoda && dacapo) return buildDaCapoABA(infos, dacapo.index, performed);
	if (!tocoda && dalsegno && !hasExplicitSegno) {
		const ds = infos.find(i => i.dalsegno);
		if (ds) return buildDaCapoABA(infos, ds.index, performed);
	}
	if (dalsegno || tocoda) return null;

	// No playback-changing navigation: one or more plain repeat/volta sections in sequence. Most
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
const buildDaCapoABA = (infos: MeasureRepeatInfo[], dcIdx: number, performed: number[]): string | null => {
	const fineIdx = infos.find(i => i.fine)?.index;
	if (fineIdx === undefined) {
		// No explicit Fine: fall back to the legacy single-volta ABA shape, where
		// A ends at the last pre-D.C. ending and B is the tail to the D.C. measure.
		return buildDaCapoABALegacy(infos, dcIdx);
	}
	if (fineIdx >= dcIdx) return null;          // Fine must precede the D.C./D.S. tail
	const restLo = fineIdx + 1;

	const mainCode = renderRepeatSections(infos, 1, fineIdx);
	const restCode = restLo > dcIdx ? "" : renderRepeatSections(infos, restLo, dcIdx);
	if (mainCode === null || restCode === null) return buildDaCapoABAFromReplay(infos, dcIdx, fineIdx, performed);

	// `main` is parsed by the ABA grammar as ONE item (parseItem). It needs wrapping
	// in [..] when it is a comma sequence ("1, 2*[..]") or a BARE range ("1..37",
	// which parseItem stops at the first number). A lone number, or a single
	// already-structured token ("2*[..]" / "2*[..]{..}" / "[..]"), parses as one item
	// and needs no extra bracket. `rest` is parsed as a sequence, so it only needs
	// bracketing to group a comma sequence — a range there is fine.
	const isSingleToken = /^\d+$/.test(mainCode) || /^\d+\*\[/.test(mainCode) || /^\[/.test(mainCode);
	const main = isSingleToken ? mainCode : `[${mainCode}]`;
	const rest = /,/.test(restCode) ? `[${restCode}]` : restCode;
	const candidate = `<${main}, ${rest}>`;
	return layoutExpandsTo(candidate, performed) ? candidate : buildDaCapoABAFromReplay(infos, dcIdx, fineIdx, performed);
};

const wrapAbaMain = (code: string): string => /^\d+$/.test(code) || /^\d+\*\[/.test(code) || /^\[/.test(code) ? code : `[${code}]`;
const wrapAbaRest = (code: string): string => code === "" ? "" : (/,/.test(code) ? `[${code}]` : code);

const buildDaCapoABAFromReplay = (infos: MeasureRepeatInfo[], dcIdx: number, fineIdx: number, performed: number[]): string | null => {
	// Some ABC/MusicXML D.C. exports place repeat-end/start boundaries so the
	// notated pre-Fine span (1..Fine) is not enough to render main via source flags,
	// even though the simulated order is a clean ABA: A(full) B A(once). Detect that
	// shape from the final da-capo replay, then reuse the section renderer for the
	// longer A candidate and derive B from the performed middle slice.
	for (let k = Math.min(fineIdx, performed.length - 1); k >= 1; k--) {
		const replay = Array.from({ length: k }, (_, i) => i + 1);
		if (JSON.stringify(performed.slice(-k)) !== JSON.stringify(replay)) continue;

		for (let mainHi = k; mainHi < dcIdx; mainHi++) {
			const mainCode = renderRepeatSections(infos, 1, mainHi);
			if (mainCode === null) continue;
			const mainFull = expandMeasureLayout(parseMeasureLayout(mainCode));
			const mainOnce = expandMeasureLayout(parseMeasureLayout(mainCode), LayoutType.Once);
			if (JSON.stringify(mainOnce) !== JSON.stringify(replay)) continue;
			if (JSON.stringify(performed.slice(0, mainFull.length)) !== JSON.stringify(mainFull)) continue;

			const restSeq = performed.slice(mainFull.length, performed.length - mainOnce.length);
			const restCode = compactFlatToCode(restSeq);
			const candidate = `<${wrapAbaMain(mainCode)}, ${wrapAbaRest(restCode)}>`;
			if (layoutExpandsTo(candidate, performed)) return candidate;
		}
	}
	return null;
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
	// rest = the tail from after the last ending to the D.C. measure. It may be
	// empty when the navigation jump follows immediately after the main repeat.
	const rest = lastStop >= dcIdx ? "" : rangeCode(lastStop + 1, dcIdx);
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

	const structured = tryStructured(infos, totalMeasures, performed);
	if (structured) {
		// Trust the structured form only if it reproduces the simulated order.
		try {
			const got = expandMeasureLayout(parseMeasureLayout(structured));
			if (JSON.stringify(got) === JSON.stringify(performed)) return structured;
		} catch { /* fall through to flat */ }
	}
	const compacted = compactFlatToCode(performed);
	if (compacted !== flatToCode(performed) && layoutExpandsTo(compacted, performed)) return compacted;
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



