
/*
 * musicxml-mei-diff.ts — multi-dimensional comparison of two MusicXML→MEI routes.
 *
 *   Route A (lilylet):  MusicXML --musicXmlDecoder.decode--> LilyletDoc
 *                                --meiEncoder.encode--------> MEI
 *   Route B (verovio):  MusicXML --toolkit.loadData---------> (internal)
 *                                --toolkit.getMEI-----------> MEI
 *
 * For every .xml under tests/assets/musicxml (plus any files passed as CLI args),
 * both routes are run and their MEI outputs are tallied across many dimensions.
 * The point is to surface REAL CONTENT LOSS — performance markings (pedal,
 * hairpin, dir/words, dynamics, tempo, ...) that lilylet's decoder silently drops.
 *
 * tie / accid / key / meter are counted in BOTH their element and attribute forms
 * and normalized, because lilylet prefers attributes (@tie, @accid, key.sig=...)
 * while verovio prefers child elements (<tie>, <accid>, <keySig>) — that is an
 * equivalent representation difference, not a loss, and must not be flagged as one.
 *
 * Usage:
 *   npx tsx tests/musicxml-mei-diff.ts                # all assets
 *   npx tsx tests/musicxml-mei-diff.ts path/to/x.xml  # specific file(s)
 *
 * Output: per-file table + a summary of net losses. Writes both MEI files and a
 * JSON report under tests/output/musicxml-mei-diff/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import createVerovioModule from "verovio/wasm";
// @ts-ignore
import { VerovioToolkit } from "verovio/esm";

import { musicXmlDecoder, meiEncoder } from "../source/lilylet/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSICXML_DIR = path.join(__dirname, "assets/musicxml");
const OUTPUT_DIR = path.join(__dirname, "output/musicxml-mei-diff");

interface IVerovioToolkit {
	loadData(data: string): boolean;
	getMEI(options?: object): string;
	getLog(): string;
}

const initVerovio = async (): Promise<IVerovioToolkit> => {
	const VerovioModule = await createVerovioModule();
	return new VerovioToolkit(VerovioModule) as IVerovioToolkit;
};

// ─── Dimensions ────────────────────────────────────────────────────
// category: "structure" = note-level skeleton (should match exactly);
//           "performance" = expression/markings (lilylet tends to drop these);
//           "layout" = clef/keySig/meterSig running repeats (representation differs).
// count():  given an MEI string, return the count for this dimension. For
//           tie/accid/key/meter we sum BOTH element and attribute forms so the
//           element-vs-attribute style difference doesn't masquerade as loss.

type Category = "structure" | "performance" | "layout";

interface Dimension {
	key: string;
	label: string;
	category: Category;
	count: (mei: string) => number;
}

// Count occurrences of a regex (global) in a string.
const m = (mei: string, re: RegExp): number => (mei.match(re) || []).length;

// Count an attribute appearing on any element, e.g. attr("tie") matches tie="...".
// Subtracts occurrences where the attribute sits on its OWN same-named element
// (e.g. <accid accid="n">, <tie tie="i">) so element-form and attribute-form
// aren't double-counted when both happen to use the same token. `.ges` gestural
// variants (accid.ges, etc.) are NOT matched — `\b${name}="` stops at the dot —
// so verovio's implied/gestural accidentals don't inflate the written count.
const attr = (mei: string, name: string): number => {
	const total = m(mei, new RegExp(`\\b${name}="[^"]*"`, "g"));
	// Element whose tag === attr name, carrying that attr on itself.
	const onOwnElem = m(mei, new RegExp(`<${name}\\b[^>]*\\b${name}="`, "g"));
	return total - onOwnElem;
};

// Normalized count for a marking that MEI may render as <tag> OR as @tag on a
// host element: element count + host-borne attribute count (no double count).
const elemOrAttr = (mei: string, tag: string): number => m(mei, new RegExp(`<${tag}\\b`, "g")) + attr(mei, tag);

const DIMENSIONS: Dimension[] = [
	// ---- structure (expected to match) ----
	{ key: "measure", label: "measures", category: "structure", count: x => m(x, /<measure\b/g) },
	{ key: "staff", label: "staff", category: "structure", count: x => m(x, /<staff\b/g) },
	{ key: "layer", label: "layer", category: "structure", count: x => m(x, /<layer\b/g) },
	{ key: "note", label: "notes", category: "structure", count: x => m(x, /<note\b/g) },
	{ key: "rest", label: "rests (real)", category: "structure", count: x => m(x, /<rest\b/g) + m(x, /<mRest\b/g) },
	{ key: "chord", label: "chords", category: "structure", count: x => m(x, /<chord\b/g) },
	{ key: "beam", label: "beams", category: "structure", count: x => m(x, /<beam\b/g) },
	{ key: "tuplet", label: "tuplets", category: "structure", count: x => m(x, /<tuplet\b/g) },
	{ key: "grace", label: "grace notes", category: "structure", count: x => attr(x, "grace") },
	// accid (written): element OR attribute form — normalized (no double count,
	// excludes verovio's gestural @accid.ges so only notated accidentals count).
	{ key: "accid", label: "accid written (elem+attr)", category: "structure", count: x => elemOrAttr(x, "accid") },

	// ---- performance markings (real loss risk) ----
	{ key: "slur", label: "slurs", category: "performance", count: x => m(x, /<slur\b/g) },
	{ key: "dynam", label: "dynamics", category: "performance", count: x => m(x, /<dynam\b/g) },
	{ key: "hairpin", label: "hairpins (cresc/dim)", category: "performance", count: x => m(x, /<hairpin\b/g) },
	{ key: "pedal", label: "pedals", category: "performance", count: x => m(x, /<pedal\b/g) },
	{ key: "dir", label: "directions (words)", category: "performance", count: x => m(x, /<dir\b/g) },
	{ key: "tempo", label: "tempo marks", category: "performance", count: x => m(x, /<tempo\b/g) },
	{ key: "artic", label: "articulations", category: "performance", count: x => elemOrAttr(x, "artic") },
	{ key: "fermata", label: "fermatas", category: "performance", count: x => elemOrAttr(x, "fermata") },
	{ key: "ornam", label: "ornaments (trill/mordent/turn)", category: "performance", count: x => m(x, /<(trill|mordent|turn)\b/g) },
	{ key: "arpeg", label: "arpeggios", category: "performance", count: x => m(x, /<arpeg\b/g) },
	{ key: "octave", label: "ottava (8va/8vb)", category: "performance", count: x => m(x, /<octave\b/g) },
	{ key: "fing", label: "fingerings", category: "performance", count: x => m(x, /<fing\b/g) },
	{ key: "harm", label: "harmony/chord sym", category: "performance", count: x => m(x, /<harm\b/g) },

	// ---- layout / representation (style differs; informational, not loss) ----
	// tie: lilylet marks @tie per-note (i/m/t), verovio emits one <tie> per span —
	// different counting units, so a delta here is representation, not loss.
	{ key: "tie", label: "ties (per-note vs span)", category: "layout", count: x => elemOrAttr(x, "tie") },
	// space: verovio fills secondary-voice gaps with <space>; lilylet omits them.
	{ key: "space", label: "space fillers", category: "layout", count: x => m(x, /<space\b/g) + m(x, /<mSpace\b/g) },
	{ key: "clef", label: "clefs (elem+attr)", category: "layout", count: x => m(x, /<clef\b/g) + attr(x, "clef.shape") },
	{ key: "keysig", label: "key sigs (elem+attr)", category: "layout", count: x => m(x, /<keySig\b/g) + attr(x, "key.sig") },
	{ key: "metersig", label: "meter sigs (elem+attr)", category: "layout", count: x => m(x, /<meterSig\b/g) + attr(x, "meter.count") },
];
// PLACEHOLDER_TALLY
// ─── Source-side ground truth ──────────────────────────────────────
// Tally markings straight from the MusicXML so that, when the two routes
// disagree, we know which one is faithful to the source. These are the
// dimensions most prone to silent loss; keyed to match DIMENSIONS where
// a direct source analogue exists.

interface SourceTally {
	notes: number;        // <note> not inside <chord> grace excluded? keep simple: all pitched notes
	pedalMarks: number;   // <pedal> elements (start/stop/change/continue)
	wedges: number;       // <wedge> (crescendo/diminuendo/stop) → MEI <hairpin>
	dynamics: number;     // <dynamics> elements
	words: number;        // <words> direction text → MEI <dir>/<tempo>
	slurs: number;        // <slur> (type=start only, to count spans)
	tuplets: number;      // <tuplet type="start">
	fermata: number;      // <fermata>
	arpeggiate: number;   // <arpeggiate>
	ottava: number;       // <octave-shift type=up|down> (start)
}

const tallySource = (xml: string): SourceTally => ({
	notes: m(xml, /<note\b/g),
	pedalMarks: m(xml, /<pedal\b[^>]*\btype="/g),
	wedges: m(xml, /<wedge\b[^>]*\btype="/g),
	dynamics: m(xml, /<dynamics\b/g),
	words: m(xml, /<words\b/g),
	slurs: m(xml, /<slur\b[^>]*\btype="start"/g),
	tuplets: m(xml, /<tuplet\b[^>]*\btype="start"/g),
	fermata: m(xml, /<fermata\b/g),
	arpeggiate: m(xml, /<arpeggiate\b/g),
	ottava: m(xml, /<octave-shift\b[^>]*\btype="(up|down)"/g),
});

// ─── Per-file run ──────────────────────────────────────────────────

interface FileReport {
	name: string;
	source: SourceTally;
	lilylet: Record<string, number> | null;
	verovio: Record<string, number> | null;
	lilyletError?: string;
	verovioError?: string;
	verovioLog?: string;
}

const tallyMei = (mei: string): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const d of DIMENSIONS) out[d.key] = d.count(mei);
	return out;
};

const runFile = async (vrv: IVerovioToolkit, filePath: string): Promise<FileReport> => {
	const name = path.basename(filePath);
	const xml = fs.readFileSync(filePath, { encoding: "utf-8" });
	const report: FileReport = { name, source: tallySource(xml), lilylet: null, verovio: null };

	// Route A: lilylet
	let lilyletMei = "";
	try {
		const doc = musicXmlDecoder.decode(xml);
		lilyletMei = meiEncoder.encode(doc);
		report.lilylet = tallyMei(lilyletMei);
	} catch (e: any) {
		report.lilyletError = e?.message || String(e);
	}

	// Route B: verovio
	let verovioMei = "";
	try {
		const ok = vrv.loadData(xml);
		report.verovioLog = vrv.getLog?.() || "";
		if (!ok) {
			report.verovioError = "loadData returned false";
		} else {
			verovioMei = vrv.getMEI({ pageNo: 0 });
			report.verovio = tallyMei(verovioMei);
		}
	} catch (e: any) {
		report.verovioError = e?.message || String(e);
	}

	// Persist MEI for manual inspection.
	const base = name.replace(/\.xml$/i, "");
	if (lilyletMei) fs.writeFileSync(path.join(OUTPUT_DIR, `${base}.lilylet.mei`), lilyletMei);
	if (verovioMei) fs.writeFileSync(path.join(OUTPUT_DIR, `${base}.verovio.mei`), verovioMei);

	return report;
};

// ─── Reporting helpers ─────────────────────────────────────────────

const pad = (s: string | number, w: number): string => String(s).padEnd(w);
const padL = (s: string | number, w: number): string => String(s).padStart(w);

// ANSI (skipped when not a TTY).
const useColor = process.stdout.isTTY;
const red = (s: string) => useColor ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s: string) => useColor ? `\x1b[33m${s}\x1b[0m` : s;
const green = (s: string) => useColor ? `\x1b[32m${s}\x1b[0m` : s;
const dim = (s: string) => useColor ? `\x1b[2m${s}\x1b[0m` : s;
const bold = (s: string) => useColor ? `\x1b[1m${s}\x1b[0m` : s;

// Print one file's dimension table. Flags rows where lilylet < verovio
// (potential loss) and, for performance dims, cross-checks against source.
const printFileTable = (r: FileReport): { losses: number; lossKeys: string[] } => {
	console.log("\n" + bold("━".repeat(72)));
	console.log(bold(`FILE: ${r.name}`));
	if (r.lilyletError) console.log(red(`  lilylet route FAILED: ${r.lilyletError}`));
	if (r.verovioError) console.log(red(`  verovio route FAILED: ${r.verovioError}`));
	if (!r.lilylet || !r.verovio) return { losses: 0, lossKeys: [] };

	const log = (r.verovioLog || "").replace(/\s+/g, " ").trim();
	if (log) console.log(dim(`  verovio log: ${log.slice(0, 160)}`));

	console.log(
		"  " + pad("dimension", 30) + padL("lilylet", 9) + padL("verovio", 9) +
		padL("Δ", 7) + "  category",
	);
	console.log("  " + dim("─".repeat(68)));

	let losses = 0;
	const lossKeys: string[] = [];
	let lastCat = "";
	for (const d of DIMENSIONS) {
		const a = r.lilylet[d.key];
		const b = r.verovio[d.key];
		const delta = a - b;
		if (d.category !== lastCat) {
			console.log("  " + dim(`[${d.category}]`));
			lastCat = d.category;
		}
		let deltaStr = String(delta);
		let flag = "";
		if (delta < 0) {
			// lilylet has fewer — possible loss. For performance dims this is the headline.
			deltaStr = d.category === "performance" ? red(padL(delta, 7)) : yellow(padL(delta, 7));
			if (d.category === "performance" || d.category === "structure") {
				losses += -delta;
				lossKeys.push(d.key);
				flag = d.category === "performance" ? red("  ← LOSS") : yellow("  ← fewer");
			}
		} else if (delta > 0) {
			deltaStr = padL("+" + delta, 7);
		} else {
			deltaStr = green(padL(0, 7));
		}
		console.log(
			"  " + pad(d.label, 30) + padL(a, 9) + padL(b, 9) +
			(delta < 0 ? deltaStr : padL(deltaStr.trim(), 7)) + flag,
		);
	}
	return { losses, lossKeys };
};

// Cross-check the loss-prone dimensions against the source MusicXML, so the
// table isn't just "A vs B" but "A vs B vs ground truth". Maps source tally
// fields to the MEI dimension keys they should roughly correspond to.
const SOURCE_MAP: Array<{ src: keyof SourceTally; meiKey: string; label: string }> = [
	{ src: "pedalMarks", meiKey: "pedal", label: "pedals" },
	{ src: "wedges", meiKey: "hairpin", label: "hairpins" },
	{ src: "dynamics", meiKey: "dynam", label: "dynamics" },
	{ src: "words", meiKey: "dir", label: "directions/words" },
	{ src: "fermata", meiKey: "fermata", label: "fermatas" },
	{ src: "arpeggiate", meiKey: "arpeg", label: "arpeggios" },
	{ src: "ottava", meiKey: "octave", label: "ottava" },
];

const printSourceCrossCheck = (r: FileReport): void => {
	if (!r.lilylet || !r.verovio) return;
	const rows = SOURCE_MAP.filter(({ src }) => r.source[src] > 0);
	if (!rows.length) return;
	console.log("  " + dim("─".repeat(68)));
	console.log("  " + bold("source cross-check (XML ground truth):"));
	console.log("  " + pad("marking", 24) + padL("source", 8) + padL("lilylet", 9) + padL("verovio", 9) + "  verdict");
	for (const { src, meiKey, label } of rows) {
		const s = r.source[src];
		const a = r.lilylet[meiKey];
		const b = r.verovio[meiKey];
		// Verdict: which route is closer to source count.
		let verdict: string;
		if (a >= s && b >= s) verdict = green("both ≥ source");
		else if (a < s && b >= s) verdict = red(`lilylet drops ~${s - a}`);
		else if (a < s && b < s) verdict = yellow(`both under (A −${s - a}, B −${s - b})`);
		else verdict = dim("ok");
		console.log("  " + pad(label, 24) + padL(s, 8) + padL(a, 9) + padL(b, 9) + "  " + verdict);
	}
};

// ─── Main ──────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	// Files: CLI args (if any) else all .xml under assets/musicxml.
	const argv = process.argv.slice(2).filter(a => !a.startsWith("-"));
	let files: string[];
	if (argv.length) {
		files = argv.map(a => path.resolve(a));
	} else {
		files = fs.readdirSync(MUSICXML_DIR)
			.filter(f => /\.xml$/i.test(f))
			.sort()
			.map(f => path.join(MUSICXML_DIR, f));
	}

	console.log(bold(`MusicXML → MEI two-route diff  (${files.length} file(s))`));
	console.log(dim("Route A = lilylet (musicXmlDecoder + meiEncoder)   Route B = verovio (loadData + getMEI)"));

	const vrv = await initVerovio();
	const reports: FileReport[] = [];
	for (const f of files) {
		if (!fs.existsSync(f)) { console.log(red(`  missing: ${f}`)); continue; }
		reports.push(await runFile(vrv, f));
	}

	// Per-file detail.
	const perfLossTotals: Record<string, number> = {};
	const structLossFiles: string[] = [];
	for (const r of reports) {
		const { lossKeys } = printFileTable(r);
		printSourceCrossCheck(r);
		if (!r.lilylet || !r.verovio) continue;
		for (const d of DIMENSIONS) {
			const delta = r.lilylet[d.key] - r.verovio[d.key];
			if (delta < 0 && d.category === "performance")
				perfLossTotals[d.key] = (perfLossTotals[d.key] || 0) - delta;
			if (delta < 0 && d.category === "structure" && !structLossFiles.includes(r.name))
				structLossFiles.push(r.name);
		}
	}

	// ─── Summary ───
	console.log("\n" + bold("═".repeat(72)));
	console.log(bold("SUMMARY — aggregate content loss (lilylet vs verovio)"));
	console.log("═".repeat(72));

	const okFiles = reports.filter(r => r.lilylet && r.verovio).length;
	const failFiles = reports.length - okFiles;
	console.log(`files compared: ${okFiles}/${reports.length}` + (failFiles ? red(`  (${failFiles} failed a route)`) : ""));

	if (structLossFiles.length)
		console.log(yellow(`\n⚠ structural dimensions fewer in lilylet for: ${structLossFiles.join(", ")}`));
	else
		console.log(green("\n✓ no structural-dimension shortfalls (notes/chords/rests/tuplets/ties/accid all ≥ verovio)"));

	const perfKeys = Object.keys(perfLossTotals).sort((a, b) => perfLossTotals[b] - perfLossTotals[a]);
	if (perfKeys.length) {
		console.log(red("\n⚠ performance-marking losses (total dropped across all files):"));
		for (const k of perfKeys) {
			const d = DIMENSIONS.find(x => x.key === k)!;
			console.log("  " + red(pad(d.label, 32) + padL("−" + perfLossTotals[k], 8)));
		}
	} else {
		console.log(green("\n✓ no performance-marking losses detected"));
	}

	// JSON report.
	const jsonPath = path.join(OUTPUT_DIR, "report.json");
	fs.writeFileSync(jsonPath, JSON.stringify({
		files: reports,
		summary: { okFiles, failFiles, perfLossTotals, structLossFiles },
	}, null, 2));
	console.log(dim(`\nMEI outputs + report.json written to ${OUTPUT_DIR}`));
};

main().catch(e => { console.error(e); process.exit(1); });


