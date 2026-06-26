/**
 * Lilylet (.lyl) text round-trip test — clef / staff position stability.
 *
 * Path under test:
 *   parseCode(.lyl)  →  serializeLilyletDoc  →  parseCode  →  (re-encode)
 *
 * This is DISTINCT from lilypond-roundtrip.ts, which round-trips through the
 * LilyPond encoder/decoder. That path preserves clefs via LilyPond's own explicit
 * Staff/clef context model, so it never exercises the .lyl serializer's staff-carry
 * heuristics — and cannot catch bugs in them. The serializer decides per-voice when
 * to emit `\staff` / `\clef`, relying on cross-measure/cross-voice carry state; a
 * stale carry can drop a needed `\staff` anchor (relocating a voice and its leading
 * clef) or re-emit a stale clef onto a clef-less sibling voice. Those corruptions
 * are invisible until the text is re-parsed, which only this round-trip does.
 *
 * Contract: the MEI clef set (shape/line + position: measure, staff, event index)
 * produced from the original doc must equal the one produced after a serialize→parse
 * round-trip. We compare via MEI rather than raw doc context events so that benign
 * redundant clef restatements (which the encoder dedupes) are not flagged — only a
 * genuine clef relocation, drop, addition, or shape change fails.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc, meiEncoder } from "../source/lilylet/index.js";

const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");

// Extract clef position signatures from an MEI string. A signature encodes the
// clef's shape+line AND where it sits: staffDef (initial, index -1) or mid-measure
// at a given event index within a staff block. Sorted for order-independent compare.
const extractClefSigs = (mei: string): string[] => {
	const clefs: string[] = [];
	let curMeasure = "";
	let curStaff = "";
	let eventIdx = 0;
	const tagRe = /<(staffDef|measure|staff|note|rest|mRest|chord|clef)\b([^>]*)>/g;
	let mt: RegExpExecArray | null;
	while ((mt = tagRe.exec(mei))) {
		const tag = mt[1];
		const attrs = mt[2];
		const at = (n: string): string => {
			const r = attrs.match(new RegExp(`\\b${n}="([^"]*)"`));
			return r ? r[1] : "";
		};
		if (tag === "measure") curMeasure = at("n");
		else if (tag === "staff") { curStaff = at("n"); eventIdx = 0; }
		else if (tag === "staffDef") {
			const shape = at("clef.shape");
			if (shape) clefs.push(`m/s${at("n") || curStaff}@-1:${shape}${at("clef.line")}`);
		} else if (tag === "note" || tag === "rest" || tag === "mRest" || tag === "chord") {
			eventIdx++;
		} else if (tag === "clef") {
			clefs.push(`m${curMeasure}/s${curStaff}@${eventIdx}:${at("shape")}${at("line")}`);
		}
	}
	return clefs.sort();
};

interface Result { filename: string; status: "pass" | "fail" | "error" | "skip"; error?: string }

// Files with a KNOWN, pre-existing round-trip defect unrelated to clef/staff — the
// serializer emits a directional symbolic articulation (`^!` / `_!`) that the grammar
// cannot parse back (it only accepts the `-!` form). Tracked separately; skipped here
// so this clef/staff test isn't blocked by an orthogonal articulation-grammar bug.
const KNOWN_REPARSE_FAILURES = new Set<string>([
	"articulations-staccatissimo-shorthand.lyl",
]);

const testFile = (filename: string): Result => {
	try {
		const lyl = fs.readFileSync(path.join(UNIT_CASES_DIR, filename), "utf-8");
		const doc1 = parseCode(lyl);
		if (!doc1 || doc1.measures.length === 0) return { filename, status: "error", error: "parse produced empty doc" };

		const meiA = meiEncoder.encode(doc1);
		let doc2;
		try {
			doc2 = parseCode(serializeLilyletDoc(doc1));
		} catch (e) {
			if (KNOWN_REPARSE_FAILURES.has(filename)) return { filename, status: "skip" };
			throw e;
		}
		const meiB = meiEncoder.encode(doc2);

		const a = extractClefSigs(meiA);
		const b = extractClefSigs(meiB);
		if (a.join("|") === b.join("|")) return { filename, status: "pass" };

		const onlyA = a.filter(x => !b.includes(x));
		const onlyB = b.filter(x => !a.includes(x));
		return {
			filename,
			status: "fail",
			error: `clef positions differ — lost: [${onlyA.join(", ")}]  spurious: [${onlyB.join(", ")}]`,
		};
	} catch (e) {
		return { filename, status: "error", error: e instanceof Error ? e.message : String(e) };
	}
};

const main = (): void => {
	console.log("Lilylet .lyl Round-trip Test (clef/staff position stability)\n");
	console.log("=".repeat(80));
	const files = fs.readdirSync(UNIT_CASES_DIR).filter(f => f.endsWith(".lyl")).sort();
	console.log(`\nFound ${files.length} test files\n`);

	let passed = 0, failed = 0, errors = 0, skipped = 0;
	for (const filename of files) {
		const r = testFile(filename);
		if (r.status === "pass") { passed++; continue; }
		if (r.status === "skip") { skipped++; console.log(`⏭️  ${filename} (known pre-existing re-parse failure, unrelated to clef/staff)`); continue; }
		if (r.status === "fail") { failed++; console.log(`❌ ${filename}\n   ${r.error}`); }
		else { errors++; console.log(`⚠️  ${filename}\n   ${r.error}`); }
	}

	console.log("\n" + "=".repeat(80));
	console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors, ${skipped} skipped\n`);
	process.exit(failed + errors > 0 ? 1 : 0);
};

main();
