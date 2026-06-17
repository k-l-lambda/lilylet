
// Generate a framework-agnostic syntax-highlighting definition for Lilylet
// directly from the lexer (`%lex`) section of `source/lilylet/lilylet.jison`.
//
// Why generate? The jison lexer already is the authoritative "regex -> token"
// table for the language. A syntax highlighter is exactly a lexer plus a
// "token -> scope" colouring map, so deriving it from the grammar keeps the
// highlighter in lock-step with the language definition instead of drifting in
// a hand-maintained copy.
//
// The emitted module (`source/lilylet/highlight.ts`) has NO editor dependency
// (no CodeMirror/Lezer). It exports generic, semantic SCOPE names plus a
// longest-match tokenizer. Downstream editors map SCOPE -> their own theme.
//
// Run: `npx tsx ./tools/buildHighlight.ts`  (wired into build:highlight)

import fs from "fs";

const JISON_PATH = "./source/lilylet/lilylet.jison";
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
	pattern: string;	// raw flex pattern (left-hand side)
	token: string | null;	// returned token name, or null for discarded rules
	scope: string;		// resolved highlight scope ("" = emit nothing)
}

// Extract the `%lex ... /lex` section's rule lines. Each rule is
// `<pattern><whitespace><action>`, where action is either `return 'TOKEN'`,
// `{}` / `{...}` (discard), or `%{ ... %}` (multiline — none in the lex block).
const extractLexRules = (jison: string): LexRule[] => {
	const lexStart = jison.indexOf("%lex");
	const lexEnd = jison.indexOf("/lex", lexStart);
	if (lexStart < 0 || lexEnd < 0) throw new Error("no %lex .. /lex block found");
	// The rule table is after the `%%` that follows the %options.
	const body = jison.slice(lexStart, lexEnd);
	const ruleStart = body.indexOf("%%");
	if (ruleStart < 0) throw new Error("no %% in lex block");
	const lines = body.slice(ruleStart + 2).split(/\r?\n/);

	const rules: LexRule[] = [];
	for (const raw of lines) {
		const line = raw.replace(/\s+$/, "");
		if (!line.trim()) continue;
		if (line.trim().startsWith("//")) continue;

		// Split pattern from action at the first run of whitespace that is NOT
		// inside the pattern. flex patterns here have no unescaped spaces, so the
		// first tab/space run is the separator.
		const m = line.match(/^(\S+)\s+(.*)$/);
		if (!m) {
			// A pattern with no action on the same line — skip (none expected).
			continue;
		}
		const pattern = m[1];
		const action = m[2].trim();

		let token: string | null = null;
		const ret = action.match(/^return\s+'([^']+)'/);
		if (ret) token = ret[1];

		let scope: string;
		if (token) {
			if (!(token in SCOPE_MAP))
				throw new Error(`unmapped token '${token}' (pattern ${pattern}) — add it to SCOPE_MAP`);
			scope = SCOPE_MAP[token];
		} else {
			// Discarded rule ({} or {...}). Colour only if listed in DISCARD_SCOPE.
			scope = pattern in DISCARD_SCOPE ? DISCARD_SCOPE[pattern] : "";
		}

		rules.push({ pattern, token, scope });
	}
	return rules;
};

// Convert a flex/jison lexer pattern into a JS regex *source* string anchored
// at the current position. The lexer patterns used here are a small subset:
//   - "..." double-quoted literals  -> escaped literal
//   - character classes [a-g], [0-9], [ \t]
//   - groups, ?, +, *, alternation
//   - escaped metachars \%, \[, \", \\, \-, \r, \n
// flex quoted strings treat their contents literally; outside quotes the text
// is already regex-like. We scan structurally — quoted literals, character
// classes, escape pairs, and bare chars each handled as a unit — then escape
// `/` so the result is safe to drop into a `/.../ ` regex literal.
const flexToRegexSource = (pattern: string): string => {
	let out = "";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === '"') {
			// Quoted literal: copy verbatim until the closing quote, escaping
			// regex metachars. Inside, `\\` is an escaped backslash.
			i++;
			let lit = "";
			while (i < pattern.length && pattern[i] !== '"') {
				if (pattern[i] === "\\" && i + 1 < pattern.length) {
					// keep the escaped char literally (e.g. \\ -> backslash)
					lit += pattern[i + 1] === "\\" ? "\\" : pattern[i + 1];
					i += 2;
				} else {
					lit += pattern[i];
					i++;
				}
			}
			i++; // closing quote
			out += lit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
		} else if (ch === "[") {
			// Character class: copy verbatim through the matching `]`. Contents
			// (incl. a literal `"`) are regex-valid as-is; honour escapes so a
			// `\]` doesn't prematurely close the class.
			out += ch;
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				if (pattern[i] === "\\" && i + 1 < pattern.length) {
					out += pattern[i] + pattern[i + 1];
					i += 2;
				} else {
					out += pattern[i];
					i++;
				}
			}
			if (i < pattern.length) { out += "]"; i++; }
		} else if (ch === "\\" && i + 1 < pattern.length) {
			// Escape pair outside quotes/classes. Keep it as a unit so an
			// escaped quote (\") does NOT open a quoted-literal run. flex
			// escapes here (\%, \[, \], \-, \r, \n) are all valid JS regex
			// escapes; \" becomes a bare " (needs no escaping in a regex).
			const next = pattern[i + 1];
			out += next === '"' ? '"' : "\\" + next;
			i += 2;
		} else if (ch === "/") {
			// Bare slash — escape for the regex literal.
			out += "\\/";
			i++;
		} else {
			// Bare regex char (groups, ?, +, *, |, etc.) — pass through.
			out += ch;
			i++;
		}
	}
	return out;
};

const main = (): void => {
	const jison = fs.readFileSync(JISON_PATH, "utf-8");
	const rules = extractLexRules(jison);

	// Emit only rules that carry a scope (drop pure whitespace/fallthrough), but
	// KEEP their original order: flex uses longest-match with order as the
	// tie-breaker, and the tokenizer below honours longest-match explicitly.
	const emitted = rules.filter(r => r.scope);

	const ruleLiterals = emitted.map(r => {
		const src = flexToRegexSource(r.pattern);
		return `\t{ re: /${src}/iy, scope: ${JSON.stringify(r.scope)} },`;
	}).join("\n");

	const scopes = Array.from(new Set(emitted.map(r => r.scope))).sort();

	const out = `// AUTO-GENERATED by tools/buildHighlight.ts from source/lilylet/lilylet.jison.
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

