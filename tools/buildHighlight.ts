
// Generate a framework-agnostic syntax-highlighting definition for Lilylet
// directly from the COMPILED lexer in `source/lilylet/grammar.jison.js`.
//
// Why generate? The jison lexer already is the authoritative "regex -> token"
// table for the language. A syntax highlighter is exactly a lexer plus a
// "token -> scope" colouring map, so deriving it from the grammar keeps the
// highlighter in lock-step with the language definition instead of drifting in
// a hand-maintained copy.
//
// Why read the compiled parser (not the .jison text)? The generated parser
// already holds the lexer rules as ready-to-use JS RegExp objects, so we skip a
// hand-rolled flex->regex converter entirely (and inherit jison's `\b` word
// boundaries, which the text form lacked). We recover the token NAME for each
// rule from `lexer.performAction` (case index -> numeric token id) crossed with
// `parser.symbols_` (name -> id). The token->scope VALUE map is still the one
// hand-maintained artifact below — the grammar has no notion of "colour".
//
// The emitted module (`source/lilylet/highlight.ts`) has NO editor dependency
// (no CodeMirror/Lezer). It exports generic, semantic SCOPE names plus a
// longest-match tokenizer. Downstream editors map SCOPE -> their own theme.
//
// Build order: this MUST run after grammar.jison.js is (re)generated — it is
// chained after build:grammar. Run: `npx tsx ./tools/buildHighlight.ts`.

import fs from "fs";
// @ts-ignore - jison generated file
import grammar from "../source/lilylet/grammar.jison.js";

const OUT_PATH = "./source/lilylet/highlight.ts";

// The ONE hand-maintained artifact: map each lexer token name to a generic,
// editor-neutral highlight scope. Adding a command to the grammar means adding
// one line here. Keep scopes semantic (what the token means), not visual.
const SCOPE_MAP: Record<string, string> = {
	NEWLINE: "",
	EOF: "",	// flex's <<EOF>> sentinel — not a real lexical pattern

	HEADER_TITLE: "header",
	HEADER_SUBTITLE: "header",
	HEADER_COMPOSER: "header",
	HEADER_ARRANGER: "header",
	HEADER_LYRICIST: "header",
	HEADER_OPUS: "header",
	HEADER_INSTRUMENT: "header",
	HEADER_INSTRUMENT_STAFF: "header",
	HEADER_GENRE: "header",
	HEADER_STAVES: "header",
	HEADER_MEASURES: "header",
	HEADER_AUTOBEAM: "header",

	STRING: "string",

	CMD_CLEF: "keyword",
	CMD_KEY: "keyword",
	CMD_TIME: "keyword",
	CMD_PARTIAL: "keyword",
	CMD_NUMERIC_TIME_SIG: "keyword",
	CMD_DEFAULT_TIME_SIG: "keyword",
	CMD_TEMPO: "keyword",
	CMD_STAFF: "keyword",
	CMD_OTTAVA: "keyword",
	CMD_BAR: "keyword",
	CMD_CHORDS: "keyword",
	CMD_REPEAT: "keyword",
	TREMOLO: "keyword",

	CMD_TIMES: "tuplet",
	CMD_TUPLET: "tuplet",

	CMD_GRACE: "grace",
	CMD_MARKUP: "markup",

	CMD_STEMUP: "stem",
	CMD_STEMDOWN: "stem",
	CMD_STEMNEUTRAL: "stem",

	MODE_MAJOR: "mode",
	MODE_MINOR: "mode",

	CMD_SUSTAINON: "pedal",
	CMD_SUSTAINOFF: "pedal",

	CMD_CODA: "navigation",
	CMD_SEGNO: "navigation",

	CMD_CRESC_BEGIN: "hairpin",
	CMD_DIM_BEGIN: "hairpin",
	CMD_DYNAMICS_END: "hairpin",

	ART_STACCATO: "articulation",
	ART_STACCATISSIMO: "articulation",
	ART_TENUTO: "articulation",
	ART_MARCATO: "articulation",
	ART_ACCENT: "articulation",
	ART_PORTATO: "articulation",

	ORN_TRILL: "ornament",
	ORN_TURN: "ornament",
	ORN_MORDENT: "ornament",
	ORN_PRALL: "ornament",
	ORN_FERMATA: "ornament",
	ORN_SHORTFERMATA: "ornament",
	ORN_ARPEGGIO: "ornament",

	DYN_PPP: "dynamic",
	DYN_PP: "dynamic",
	DYN_MP: "dynamic",
	DYN_MF: "dynamic",
	DYN_FFF: "dynamic",
	DYN_FF: "dynamic",
	DYN_SFZ: "dynamic",
	DYN_RFZ: "dynamic",
	DYN_SF: "dynamic",
	DYN_FP: "dynamic",
	DYN_P: "dynamic",
	DYN_F: "dynamic",

	CMD_REST: "rest",
	REST_CHAR: "rest",
	SPACE_CHAR: "rest",

	PART_SEP: "separator",
	VOICE_SEP: "separator",

	PITCH: "pitch",
	OCT_UP: "octave",
	OCT_DOWN: "octave",
	NUMBER: "number",

	"/": "operator",
	":": "operator",
	"=": "operator",
	"~": "tie",
	"#": "punctuation",
	".": "punctuation",
	"-": "punctuation",
	_: "punctuation",
	"^": "punctuation",
	"!": "punctuation",

	"{": "brace",
	"}": "brace",
	"<": "chordBracket",
	">": "chordBracket",
	"|": "bar",
	"[": "squareBracket",
	"]": "squareBracket",
	"(": "paren",
	")": "paren",
};

// Scopes for lexer rules that DISCARD their match (action `{}`, no token name),
// keyed by the raw flex pattern. Lexer throws these away, but a highlighter
// wants to colour some of them (comments). "" = consume text, emit no token.
const DISCARD_SCOPE: Record<string, string> = {
	"\\%.*": "comment",
	"[ \\t]+": "",
	".": "",
};

interface LexRule {
	re: RegExp;		// compiled lexer regex (anchored ^(?:...) form from jison)
	token: string | null;	// token name, or null for discarded rules
	scope: string;		// resolved highlight scope ("" = emit nothing)
}

// Recover, for each compiled lexer rule, its token name and highlight scope by
// reading the generated parser's internals:
//   - grammar.lexer.rules[i]    : the compiled RegExp for rule i
//   - grammar.lexer.performAction: a big switch; `case i:` returns a numeric
//                                   token id (or nothing, for discarded rules)
//   - grammar.symbols_          : { name -> id }; we invert it to id -> name
const extractLexRules = (): LexRule[] => {
	const lexer = grammar.lexer;
	const symbols: Record<string, number> = grammar.symbols_;
	if (!lexer || !Array.isArray(lexer.rules) || !symbols)
		throw new Error("grammar.jison.js missing lexer.rules / symbols_ — rebuild the parser first");

	const idToName: Record<number, string> = {};
	for (const [name, id] of Object.entries(symbols)) idToName[id] = name;

	// Parse performAction's `case <i>: ... return <id>` to map rule index ->
	// token id. Rules whose case has no `return` are discarded by the lexer.
	const actionSrc: string = lexer.performAction.toString();
	const parts = actionSrc.split(/case (\d+):/).slice(1);
	const tokenIdByRule: Record<number, number | null> = {};
	for (let i = 0; i < parts.length; i += 2) {
		const idx = Number(parts[i]);
		const body = parts[i + 1] || "";
		const ret = body.match(/return (\d+)/);
		tokenIdByRule[idx] = ret ? Number(ret[1]) : null;
	}

	const rules: LexRule[] = [];
	lexer.rules.forEach((re: RegExp, i: number) => {
		const tokenId = tokenIdByRule[i] ?? null;
		const token = tokenId != null ? idToName[tokenId] : null;

		let scope: string;
		if (token) {
			if (!(token in SCOPE_MAP))
				throw new Error(`unmapped token '${token}' (rule ${i}, /${re.source}/) — add it to SCOPE_MAP`);
			scope = SCOPE_MAP[token];
		} else {
			// Discarded rule. Colour only if its regex source is listed in
			// DISCARD_SCOPE (keys are flex patterns; match against re.source).
			scope = discardScopeFor(re);
		}

		rules.push({ re, token, scope });
	});
	return rules;
};

// Resolve a discarded rule's scope by matching its compiled regex against the
// DISCARD_SCOPE table. The compiled form is `^(?:<body>)`, so we test the body
// against the known flex patterns (comment `%.*`, whitespace, catch-all `.`).
const discardScopeFor = (re: RegExp): string => {
	const body = re.source.replace(/^\^\(\?:/, "").replace(/\)$/, "");
	if (/^%\.\*$/.test(body)) return DISCARD_SCOPE["\\%.*"] ?? "";
	return "";
};

// Turn jison's anchored `^(?:<body>)` source into a sticky, case-insensitive
// regex literal source for the emitted tokenizer: drop the leading `^` (sticky
// `y` already anchors at lastIndex), keep the rest verbatim.
const toStickySource = (re: RegExp): string => {
	const s = re.source;
	return s.startsWith("^") ? s.slice(1) : s;
};

const main = (): void => {
	const rules = extractLexRules();

	// Cross-check SCOPE_MAP against the grammar's real token set: warn on entries
	// that no longer correspond to any lexer token (stale after a grammar edit).
	// Unmapped *new* tokens already throw inside extractLexRules.
	const grammarTokens = new Set(rules.map(r => r.token).filter(Boolean) as string[]);
	const stale = Object.keys(SCOPE_MAP).filter(
		name => !grammarTokens.has(name) && !["NEWLINE", "EOF"].includes(name));
	if (stale.length)
		console.warn(`[buildHighlight] WARNING: SCOPE_MAP has ${stale.length} token(s) not in the grammar: ${stale.join(", ")}`);

	// Emit only rules that carry a scope (drop pure whitespace/fallthrough), but
	// KEEP their original order: flex uses longest-match with order as the
	// tie-breaker, and the tokenizer below honours longest-match explicitly.
	const emitted = rules.filter(r => r.scope);

	const ruleLiterals = emitted.map(r => {
		const src = toStickySource(r.re);
		return `\t{ re: /${src}/iy, scope: ${JSON.stringify(r.scope)} },`;
	}).join("\n");

	const scopes = Array.from(new Set(emitted.map(r => r.scope))).sort();

	const out = `// AUTO-GENERATED by tools/buildHighlight.ts from source/lilylet/grammar.jison.js.
// Do NOT edit by hand. Run \`npm run build:highlight\` to regenerate.
//
// Framework-agnostic syntax-highlighting definition for Lilylet, derived from
// the grammar's lexer so it never drifts from the language. No editor
// dependency: it exposes generic SCOPE names and a longest-match tokenizer.
// Downstream editors (CodeMirror, Monaco, Prism, ...) map SCOPE -> their theme.

/** Generic highlight scopes Lilylet tokens can carry. */
export type HighlightScope =
${scopes.map(s => `\t| ${JSON.stringify(s)}`).join("\n")};

export interface HighlightRule {
	/** Sticky, case-insensitive regex anchored at the scan position. */
	re: RegExp;
	scope: HighlightScope;
}

export interface HighlightToken {
	scope: HighlightScope;
	/** Start offset within the line (inclusive). */
	start: number;
	/** End offset within the line (exclusive). */
	end: number;
}

/**
 * Ordered highlight rules. Order mirrors the grammar's lexer; the tokenizer
 * applies LONGEST-match (flex semantics), using order only as a tie-breaker.
 */
export const HIGHLIGHT_RULES: HighlightRule[] = [
${ruleLiterals}
];

/**
 * Match a single token at \`pos\` in \`line\` using longest-match. Returns the
 * winning token, or null if no rule matches (caller should advance one char).
 */
export const matchAt = (line: string, pos: number): HighlightToken | null => {
	let best: HighlightToken | null = null;
	for (const rule of HIGHLIGHT_RULES) {
		rule.re.lastIndex = pos;
		const m = rule.re.exec(line);
		if (m && m.index === pos && m[0].length > 0) {
			const end = pos + m[0].length;
			if (!best || end > best.end)
				best = { scope: rule.scope, start: pos, end };
		}
	}
	return best;
};

/**
 * Tokenize one line into a list of scoped spans. Characters that match no rule
 * are skipped (no token emitted), mirroring the lexer's catch-all.
 */
export const tokenizeLine = (line: string): HighlightToken[] => {
	const tokens: HighlightToken[] = [];
	let pos = 0;
	while (pos < line.length) {
		const tok = matchAt(line, pos);
		if (tok) {
			tokens.push(tok);
			pos = tok.end;
		} else {
			pos++;
		}
	}
	return tokens;
};
`;

	fs.writeFileSync(OUT_PATH, out);
	console.log(`Wrote ${OUT_PATH}: ${emitted.length} rules, ${scopes.length} scopes.`);
	console.log("Scopes:", scopes.join(", "));
};

main();

