/**
 * Measure-layout (performance / repeat order) parser + expander, ported from
 * lotus (`jison/measureLayout.jison` + `inc/measureLayout.ts`).
 *
 * A measure-layout string encodes the order in which notated measures are
 * PLAYED — repeats, voltas, da-capo / ABA — independently of the notated
 * sequence. It compiles to MEI `<expansion plist="#m1 #m2 #m1 …">`, which is
 * what verovio's `expand` option unfolds for MIDI / time-map output.
 *
 * Two modes:
 *   - index-wise (`i:`, the default): leaves are 1-based measure INDICES.
 *       e.g. "2*[1..8]{9,10}, 11..16"
 *   - segment-wise (`s:`): leaves are segment LENGTHS; measures are
 *       auto-numbered left-to-right from 1.  e.g. "s: 4 <2 6> 2"
 *
 * Constructs (both modes): `N` single, `A..B` inclusive range (index-wise
 * only), `[ … ]` block, `N*[ … ]{ alt1, alt2 }` volta with alternate endings,
 * `< main, rest >` ABA / da-capo (play `main rest main`).
 *
 * Expansion semantics mirror lotus `LayoutType`: `Full` unfolds every repeat
 * (volta body repeated once per pass with each alternate ending; ABA → A B A) —
 * this is the form used for MIDI unfolding.
 */

export enum LayoutType {
	Ordinary = "ordinary",       // volta body once + all alternates appended; ABA → A B
	Full = "full",               // every repeat unfolded; ABA → A B A
	Conservative = "conservative",
	Once = "once",               // volta body once + last alternate; ABA → B A'
}

export interface SingleMLayout { kind: "single"; measure: number; }
export interface BlockMLayout { kind: "block"; seq: MeasureLayout[]; }
export interface VoltaMLayout { kind: "volta"; times: number; body: MeasureLayout[]; alternates: MeasureLayout[][] | null; }
export interface ABAMLayout { kind: "aba"; main: MeasureLayout; rest: MeasureLayout[]; }

// Transient leaf used only while parsing segment-wise mode; replaced by
// SingleMLayout(s) during the index-assignment pass before expansion.
interface SegmentMLayout { kind: "segment"; length: number; }

export type MeasureLayout = SingleMLayout | BlockMLayout | VoltaMLayout | ABAMLayout;

type ParsedLayout = MeasureLayout | SegmentMLayout;

const single = (measure: number): SingleMLayout => ({ kind: "single", measure });
const block = (seq: ParsedLayout[]): BlockMLayout => ({ kind: "block", seq: seq as MeasureLayout[] });
const volta = (times: number, body: ParsedLayout[], alternates: ParsedLayout[][] | null): VoltaMLayout =>
	({ kind: "volta", times, body: body as MeasureLayout[], alternates: alternates as MeasureLayout[][] | null });
const aba = (main: ParsedLayout, rest: ParsedLayout[]): ABAMLayout =>
	({ kind: "aba", main: main as MeasureLayout, rest: rest as MeasureLayout[] });
const segment = (length: number): SegmentMLayout => ({ kind: "segment", length });


// ── Tokenizer ────────────────────────────────────────────────────────────
// Tokens: UNSIGNED (positive int), ".." (range), the specials * , [ ] < > { },
// and the mode prefixes "i:" / "s:". Whitespace is insignificant.

type Token =
	| { t: "num"; v: number }
	| { t: "range" }          // ".."
	| { t: "mode"; v: "i" | "s" }
	| { t: "sym"; v: "*" | "," | "[" | "]" | "<" | ">" | "{" | "}" }
	| { t: "eof" };

const SYMS = new Set(["*", ",", "[", "]", "<", ">", "{", "}"]);

const tokenize = (code: string): Token[] => {
	const tokens: Token[] = [];
	let i = 0;
	const n = code.length;
	while (i < n) {
		const c = code[i];
		if (/\s/.test(c)) { i++; continue; }
		if (c === "." && code[i + 1] === ".") { tokens.push({ t: "range" }); i += 2; continue; }
		if (c >= "1" && c <= "9") {
			let j = i + 1;
			while (j < n && code[j] >= "0" && code[j] <= "9") j++;
			tokens.push({ t: "num", v: Number(code.slice(i, j)) });
			i = j;
			continue;
		}
		if (SYMS.has(c)) { tokens.push({ t: "sym", v: c as any }); i++; continue; }
		// mode prefix:  letters followed by ':'
		if (/[a-z]/i.test(c)) {
			let j = i;
			while (j < n && /[a-z]/i.test(code[j])) j++;
			const word = code.slice(i, j);
			if (code[j] === ":") {
				if (word === "i" || word === "s") { tokens.push({ t: "mode", v: word }); i = j + 1; continue; }
				throw new Error(`unknown measure-layout mode prefix: "${word}:"`);
			}
			throw new Error(`unexpected token in measure-layout: "${word}"`);
		}
		throw new Error(`unexpected character in measure-layout: "${c}" at ${i}`);
	}
	tokens.push({ t: "eof" });
	return tokens;
};


// ── Recursive-descent parser ─────────────────────────────────────────────
// Faithful to lotus's jison grammar. The two modes share the same construct
// shapes; the only differences are: segment-wise leaves are SEGMENT LENGTHS
// (not indices), there are no ranges in segment-wise, and the ABA separator is
// a comma in index-wise but plain juxtaposition in segment-wise.

class Parser {
	private tokens: Token[];
	private pos = 0;
	private segMode: boolean;

	constructor (tokens: Token[], segMode: boolean) {
		this.tokens = tokens;
		this.segMode = segMode;
	}

	private peek (): Token { return this.tokens[this.pos]; }

	private isSym (v: string): boolean {
		const tk = this.peek();
		return tk.t === "sym" && tk.v === v;
	}

	private expectSym (v: string): void {
		if (!this.isSym(v))
			throw new Error(`measure-layout: expected "${v}", got ${JSON.stringify(this.peek())}`);
		this.pos++;
	}

	private takeNum (): number {
		const tk = this.peek();
		if (tk.t !== "num")
			throw new Error(`measure-layout: expected number, got ${JSON.stringify(tk)}`);
		this.pos++;
		return tk.v;
	}

	// top-level sequence → a Block (or the single bare block if it's the only item)
	parseTop (): MeasureLayout {
		const seq = this.parseSequence();
		if (seq.length === 1 && seq[0].kind === "block")
			return seq[0] as BlockMLayout;
		return block(seq);
	}

	// A comma-separated (index-wise) or juxtaposed (segment-wise) sequence of
	// items, terminated by EOF or a closing ] > } token.
	private parseSequence (): ParsedLayout[] {
		const seq: ParsedLayout[] = [];
		for (;;) {
			const tk = this.peek();
			if (tk.t === "eof" || this.isSym("]") || this.isSym(">") || this.isSym("}")) break;

			if (!this.segMode && tk.t === "num" && this.tokens[this.pos + 1]?.t === "range") {
				// index-wise range A..B
				const start = this.takeNum();
				this.pos++; // consume ".."
				const end = this.takeNum();
				if (!(end >= start)) throw new Error(`invalid measure range: ${start}..${end}`);
				for (let m = start; m <= end; m++) seq.push(single(m));
			}
			else {
				seq.push(this.parseItem());
			}

			// index-wise items are comma-separated; consume an optional comma
			if (!this.segMode && this.isSym(",")) this.pos++;
		}
		return seq;
	}

	private parseItem (): ParsedLayout {
		// volta:  N *[ … ]{ … }
		if (this.peek().t === "num" && this.tokens[this.pos + 1]?.t === "sym" && (this.tokens[this.pos + 1] as any).v === "*") {
			const times = this.takeNum();
			this.pos++; // consume '*'
			const body = this.parseBlock();
			let alternates: ParsedLayout[][] | null = null;
			if (this.isSym("{")) alternates = this.parseAlternates();
			return volta(times, body, alternates);
		}
		// block
		if (this.isSym("[")) return block(this.parseBlock());
		// ABA  < main rest >
		if (this.isSym("<")) return this.parseAba();
		// leaf
		const v = this.takeNum();
		return this.segMode ? segment(v) : single(v);
	}

	private parseBlock (): ParsedLayout[] {
		this.expectSym("[");
		const seq = this.parseSequence();
		this.expectSym("]");
		return seq;
	}

	private parseAlternates (): ParsedLayout[][] {
		this.expectSym("{");
		const seq = this.parseSequence();
		this.expectSym("}");
		// each item becomes an ending: unwrap a block into its inner seq, wrap a
		// bare item into a 1-element seq (lotus's `alternates` helper)
		return seq.map(item => item.kind === "block" ? (item as BlockMLayout).seq as ParsedLayout[] : [item]);
	}

	private parseAba (): ABAMLayout {
		this.expectSym("<");
		const main = this.parseItem();
		if (!this.segMode) this.expectSym(",");   // index-wise: comma between main and rest
		const rest = this.parseSequence();
		this.expectSym(">");
		return aba(main, rest);
	}
}


// ── Segment-wise → index assignment ──────────────────────────────────────
// In segment-wise mode the leaves are segment lengths; measures auto-number
// left-to-right from 1. This walk replaces each SegmentMLayout with the right
// run of SingleMLayout, threading a shared running index (lotus's `serialize`).

const assignIndices = (item: ParsedLayout, state: { index: number }): MeasureLayout => {
	switch (item.kind) {
	case "single":
		return item;
	case "segment": {
		// a lone segment (e.g. the `main` of a segment-wise ABA) → run of singles
		const seq: MeasureLayout[] = [];
		for (let k = 0; k < item.length; k++) seq.push(single(state.index + k));
		state.index += item.length;
		return seq.length === 1 ? seq[0] : { kind: "block", seq };
	}
	case "block":
		return { kind: "block", seq: spreadSegments(item.seq, state) };
	case "volta":
		return {
			kind: "volta",
			times: item.times,
			body: spreadSegments(item.body, state),
			alternates: item.alternates ? item.alternates.map(seq => spreadSegments(seq, state)) : null,
		};
	case "aba":
		return {
			kind: "aba",
			main: assignIndices(item.main, state),
			rest: spreadSegments(item.rest, state),
		};
	}
};

const spreadSegments = (seq: ParsedLayout[], state: { index: number }): MeasureLayout[] => {
	const out: MeasureLayout[] = [];
	for (const item of seq) {
		if (item.kind === "segment") {
			for (let k = 0; k < item.length; k++) out.push(single(state.index + k));
			state.index += item.length;
		}
		else {
			out.push(assignIndices(item, state));
		}
	}
	return out;
};


/**
 * Parse a measure-layout string into its AST. The optional `i:` / `s:` prefix
 * selects index-wise (default) or segment-wise mode; segment-wise leaves are
 * resolved to 1-based indices here, so the returned AST is mode-agnostic.
 */
export const parseMeasureLayout = (code: string): MeasureLayout => {
	const tokens = tokenize(code);
	let segMode = false;
	let start = 0;
	if (tokens[0].t === "mode") {
		segMode = tokens[0].v === "s";
		start = 1;
	}
	const parser = new Parser(tokens.slice(start), segMode);
	const ast = parser.parseTop();
	if (segMode) {
		const state = { index: 1 };
		return assignIndices(ast, state);
	}
	return ast;
};


// ── Expander ─────────────────────────────────────────────────────────────
// Port of lotus's MeasureLayout.serialize(type). Returns the performed order
// as a flat list of 1-based measure indices.

const spreadSeq = (seq: MeasureLayout[], type: LayoutType): number[] =>
	([] as number[]).concat(...seq.map(item => expand(item, type)));

const expand = (item: MeasureLayout, type: LayoutType): number[] => {
	switch (item.kind) {
	case "single":
		return [item.measure];

	case "block":
		return spreadSeq(item.seq, type);

	case "volta": {
		const bodySeq = spreadSeq(item.body, LayoutType.Ordinary);

		if (item.alternates) {
			const alternateSeqs = item.alternates.map(seq => spreadSeq(seq, LayoutType.Ordinary));
			const lastAlternateSeq = alternateSeqs[alternateSeqs.length - 1];

			switch (type) {
			case LayoutType.Ordinary:
				return ([] as number[]).concat(bodySeq, ...alternateSeqs);

			case LayoutType.Conservative:
			case LayoutType.Full: {
				const prior = ([] as number[]).concat(
					...Array(item.times - 1).fill(null).map((_, i) => [
						...bodySeq,
						...alternateSeqs[i % (item.times - 1)],
					]),
				);
				return [...prior, ...bodySeq, ...lastAlternateSeq];
			}

			case LayoutType.Once:
				return [...bodySeq, ...lastAlternateSeq];
			}
		}
		else {
			switch (type) {
			case LayoutType.Ordinary:
			case LayoutType.Conservative:
			case LayoutType.Once:
				return bodySeq;

			case LayoutType.Full:
				return ([] as number[]).concat(...Array(item.times).fill(null).map(() => bodySeq));
			}
		}
		return bodySeq;  // unreachable; keeps the type checker happy
	}

	case "aba": {
		const seqA = expand(item.main, type);
		const seqA_ = expand(item.main, LayoutType.Once);
		const seqB = spreadSeq(item.rest, type);

		switch (type) {
		case LayoutType.Ordinary:        // A B
			return [...seqA, ...seqB];
		case LayoutType.Once:            // B A'
			return [...seqB, ...seqA_];
		case LayoutType.Conservative:    // A B A'
		case LayoutType.Full:            // A B A'
			return [...seqA, ...seqB, ...seqA_];
		}
		return [...seqA, ...seqB, ...seqA_];
	}
	}
};

/**
 * Expand a measure-layout AST to the performed order as 1-based measure
 * indices. `LayoutType.Full` (the default) unfolds every repeat — the form
 * used to build an MEI `<expansion>` for MIDI playback.
 */
export const expandMeasureLayout = (layout: MeasureLayout, type: LayoutType = LayoutType.Full): number[] =>
	expand(layout, type);


// ── Volta-ending spans ─────────────────────────────────────────────────────
// Every measure index covered by an alternate of a VoltaMLayout, tagged with its
// 1-based ending number. Used by the MEI encoder to wrap the right run of
// <measure>s in an <ending n="N"> container so verovio draws the 1./2. brackets.
// (The notated/play ORDER is still driven by <expansion>; this only supplies the
// visual house brackets, which expansion alone does not produce.)
export interface VoltaEndingSpan { number: number; measures: number[]; }

export const collectVoltaSpans = (layout: MeasureLayout): VoltaEndingSpan[] => {
	const spans: VoltaEndingSpan[] = [];
	// Indices a node covers in notation order (each measure once, ascending).
	const indicesOf = (node: MeasureLayout): number[] => {
		switch (node.kind) {
		case "single": return [node.measure];
		case "block": return ([] as number[]).concat(...node.seq.map(indicesOf));
		case "volta": return ([] as number[]).concat(...node.body.map(indicesOf),
			...(node.alternates ? node.alternates.flat().map(indicesOf).flat() : []));
		case "aba": return ([] as number[]).concat(indicesOf(node.main), ...node.rest.map(indicesOf));
		}
	};
	const walk = (node: MeasureLayout): void => {
		switch (node.kind) {
		case "block": node.seq.forEach(walk); break;
		case "aba": walk(node.main); node.rest.forEach(walk); break;
		case "volta":
			node.body.forEach(walk);
			if (node.alternates) {
				node.alternates.forEach((alt, ai) => {
					const measures = ([] as number[]).concat(...alt.map(indicesOf)).sort((a, b) => a - b);
					if (measures.length) spans.push({ number: ai + 1, measures });
					alt.forEach(walk);
				});
			}
			break;
		default: break;
		}
	};
	walk(layout);
	return spans;
};


// ── Segment decomposition (for MEI nested sections + section-level expansion) ──
// Verovio draws volta house brackets only from <ending> containers, and only
// plays an <expansion> correctly when the plist references SECTION/ENDING ids
// (not bare measures) over a properly nested structure. So decompose the layout
// into contiguous measure groups — a "section" for plain runs and volta bodies,
// an "ending" for each volta alternate — and a performance order over those
// segment ids (a body segment id repeats once per pass). Returns null when the
// layout has no voltas (caller uses the simpler flat measure-level expansion) or
// can't be cleanly decomposed (non-contiguous segment → fall back to flat).

export interface LayoutSegment { id: string; kind: "section" | "ending"; endingNumber?: number; measures: number[]; }
export interface SegmentDecomposition { segments: LayoutSegment[]; order: string[]; }

export const decomposeToSegments = (layout: MeasureLayout): SegmentDecomposition | null => {
	const segments: LayoutSegment[] = [];
	let hasEnding = false;
	let counter = 0;
	const newId = (k: string) => `seg-${k}-${counter++}`;

	// Indices a node covers in notation order (each measure once, ascending).
	const indicesOf = (node: MeasureLayout): number[] => {
		switch (node.kind) {
		case "single": return [node.measure];
		case "block": return ([] as number[]).concat(...node.seq.map(indicesOf));
		case "volta": return ([] as number[]).concat(...node.body.map(indicesOf),
			...(node.alternates ? ([] as number[]).concat(...node.alternates.map(a => ([] as number[]).concat(...a.map(indicesOf)))) : []));
		case "aba": return ([] as number[]).concat(indicesOf(node.main), ...node.rest.map(indicesOf));
		}
	};
	const contiguousAsc = (xs: number[]): boolean => xs.length > 0 && xs.every((v, i) => i === 0 || v === xs[i - 1] + 1);

	// Accumulate a run of plain (non-volta/non-aba) measures into one section,
	// flushing whenever a structural node (volta/aba) interrupts the run.
	let run: number[] = [];
	const flushRun = (): void => {
		if (run.length === 0) return;
		if (!contiguousAsc(run)) throw new Error("non-contiguous section run");
		segments.push({ id: newId("sec"), kind: "section", measures: run });
		run = [];
	};

	// Emit segments for a node in document order. Plain singles/blocks extend the
	// current run; a volta flushes the run then emits body-section + ending(s); an
	// aba flushes then recurses into main and rest (so the replayed main is its own
	// segment run). Throws on any non-contiguous group → caller falls back to flat.
	const emit = (node: MeasureLayout): void => {
		switch (node.kind) {
		case "single": run.push(node.measure); break;
		case "block": node.seq.forEach(emit); break;
		case "aba": flushRun(); emit(node.main); flushRun(); node.rest.forEach(emit); flushRun(); break;
		case "volta": {
			flushRun();
			const body = indicesOf({ kind: "block", seq: node.body });
			if (!contiguousAsc(body)) throw new Error("non-contiguous volta body");
			segments.push({ id: newId("body"), kind: "section", measures: body });
			if (node.alternates) {
				hasEnding = true;
				node.alternates.forEach((alt, ai) => {
					const m = indicesOf({ kind: "block", seq: alt });
					if (!contiguousAsc(m)) throw new Error("non-contiguous ending");
					segments.push({ id: newId("end"), kind: "ending", endingNumber: ai + 1, measures: m });
				});
			}
			break;
		}
		}
	};

	try { emit(layout); flushRun(); } catch { return null; }
	if (!hasEnding) return null;   // no voltas → flat measure-level path is fine

	// Map each measure index to the segment whose `measures` contains it. A volta
	// body measure belongs to its body section; alternate measures to their ending.
	const segOfMeasure = new Map<number, string>();
	for (const s of segments) for (const m of s.measures) if (!segOfMeasure.has(m)) segOfMeasure.set(m, s.id);

	// Performance order over segment ids: walk the flat Full expansion and collapse
	// consecutive measures that map to the same segment into one segment ref. This
	// reproduces the exact playback order (body repeats → body id appears twice,
	// ABA replay → main segment id reappears), keyed off the proven expander.
	const flat = expandMeasureLayout(layout, LayoutType.Full);
	const order: string[] = [];
	for (const m of flat) {
		const id = segOfMeasure.get(m);
		if (id === undefined) return null;   // a played measure isn't in any segment → bail to flat
		if (order.length === 0 || order[order.length - 1] !== id) order.push(id);
		else if (segments.find(s => s.id === id)!.measures[0] === m) order.push(id);  // same seg restarting (repeat) → new ref
	}
	return { segments, order };
};


// ── Serializer ───────────────────────────────────────────────────────────
// Canonical index-wise form, collapsing runs of ≥3 consecutive singles into
// "A..B" ranges (lotus's seqToCode).

const seqToCode = (seq: MeasureLayout[], withBrackets = false): string => {
	let code = "";
	let inRange = false;
	for (let i = 0; i < seq.length; i++) {
		const prev = seq[i - 1], cur = seq[i], next = seq[i + 1];
		const middle = prev?.kind === "single" && cur.kind === "single" && next?.kind === "single"
			&& (prev as SingleMLayout).measure + 1 === (cur as SingleMLayout).measure
			&& (cur as SingleMLayout).measure + 1 === (next as SingleMLayout).measure;
		if (middle) {
			if (!inRange) { code += ".."; inRange = true; }
		}
		else {
			if (i > 0 && !inRange) code += ", ";
			inRange = false;
			code += layoutToCode(cur);
		}
	}
	return withBrackets ? `[${code}]` : code;
};

const layoutToCode = (item: MeasureLayout): string => {
	switch (item.kind) {
	case "single":
		return item.measure.toString();
	case "block":
		return seqToCode(item.seq, true);
	case "volta": {
		let code = `${item.times}*${seqToCode(item.body, true)}`;
		if (item.alternates)
			code += "{" + item.alternates.map(seq => seqToCode(seq, seq.length > 1)).join(", ") + "}";
		return code;
	}
	case "aba":
		return "<" + layoutToCode(item.main) + ", " + seqToCode(item.rest) + ">";
	}
};

/** Serialize an AST back to the canonical index-wise DSL string. */
export const serializeMeasureLayout = (layout: MeasureLayout): string => {
	if (layout.kind === "block") return seqToCode(layout.seq);
	return layoutToCode(layout);
};
