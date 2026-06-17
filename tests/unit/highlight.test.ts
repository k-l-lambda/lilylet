import { tokenizeLine, matchAt, HIGHLIGHT_RULES } from "../../source/lilylet/highlight";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
	const g = JSON.stringify(got), w = JSON.stringify(want);
	if (g === w) { pass++; }
	else { fail++; console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
};

// Helper: render a line as "<text>:<scope>" spans for compact assertions.
const spans = (line: string) =>
	tokenizeLine(line).map(t => `${line.slice(t.start, t.end)}:${t.scope}`);

// 1. Longest-match: \staccatissimo must NOT be split into \staccato + tissimo,
//    and \fff must win over \ff/\f.
eq("longest \\staccatissimo", spans("\\staccatissimo"), ["\\staccatissimo:articulation"]);
eq("longest \\fff", spans("\\fff"), ["\\fff:dynamic"]);
eq("longest \\ff", spans("\\ff"), ["\\ff:dynamic"]);
eq("longest \\f", spans("\\f"), ["\\f:dynamic"]);

// 2. Pitch with accidental + octave marks. Pitch rule matches [a-g](ss|ff|s|f)?,
//    octave marks ' , are separate tokens.
eq("pitch cs''", spans("cs''"), ["cs:pitch", "':octave", "':octave"]);
eq("pitch bf,", spans("bf,"), ["bf:pitch", ",:octave"]);

// 3. A realistic note line: pitch + duration number + articulation.
eq("c4-.", spans("c4-."), ["c:pitch", "4:number", "-:punctuation", ".:punctuation"]);

// 4. Comment to end of line.
eq("comment", spans("c4 % a tune"), ["c:pitch", "4:number", "% a tune:comment"]);

// 5. Quoted string (clef/tempo argument).
eq("clef string", spans('\\clef "bass"'), ["\\clef:keyword", '"bass":string']);

// 6. Header token + string.
eq("header title", spans('[title "Song"]'),
	["[title:header", '"Song":string', "]:squareBracket"]);

// 7. Chord brackets, braces, bar, separators.
eq("chord <c e>", spans("<c e>"),
	["<:chordBracket", "c:pitch", "e:pitch", ">:chordBracket"]);
eq("bar |", spans("c4 | d4"),
	["c:pitch", "4:number", "|:bar", "d:pitch", "4:number"]);
eq("part sep \\\\\\", spans("\\\\\\"), ["\\\\\\:separator"]);
eq("voice sep \\\\", spans("\\\\"), ["\\\\:separator"]);

// 8. Tuplet command + ratio.
eq("times 2/3", spans("\\times 2/3"),
	["\\times:tuplet", "2:number", "/:operator", "3:number"]);

// 9. Rest chars.
eq("rest r4", spans("r4"), ["r:rest", "4:number"]);
eq("full-measure R", spans("R1"), ["R:rest", "1:number"]);

// 10. matchAt returns null where nothing matches (e.g. a stray '@').
eq("matchAt miss", matchAt("@", 0), null);

// 11. Sanity: rule set is non-trivial and every rule regex is sticky+icase.
eq("rules present", HIGHLIGHT_RULES.length > 50, true);
eq("rules sticky/icase",
	HIGHLIGHT_RULES.every(r => r.re.sticky && r.re.ignoreCase), true);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
