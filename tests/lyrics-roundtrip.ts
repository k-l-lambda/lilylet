/**
 * Lyrics round-trip test — `\addlyrics` lane text stability.
 *
 * Path under test:
 *   parseCode(.lyl)  →  serializeLilyletDoc  →  parseCode
 *
 * Distinct from lyl-roundtrip.ts, which only checks clef/staff position
 * stability — that test is blind to lyric corruption because the MEI clef
 * extraction never touches `\addlyrics` lanes. A serializer bug that drops a
 * syllable's text (e.g. emitting `__` without the text on a melisma) or fails
 * to strip quotes from a quoted LYRIC_WORD would pass lyl-roundtrip silently.
 *
 * Contract: for every lyrics-*.lyl unit case, the syllable sequence of every
 * lane (text, hyphen, skip, extend) must be identical before and after a
 * serialize → parse round-trip.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc } from "../source/lilylet/index.js";

const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");

interface SyllableSnap { t?: string; h: boolean; k: boolean; e: boolean }
interface LaneSnap { v: number; s: SyllableSnap[] }

const snap = (doc: { measures: Array<{ lyrics?: Array<{ verse?: number; syllables: Array<{ text?: string; hyphen?: boolean; skip?: boolean; extend?: boolean }> }> }> }): string =>
	JSON.stringify(doc.measures.map(m =>
		(m.lyrics || []).map((l): LaneSnap => ({
			v: l.verse ?? 0,
			s: l.syllables.map((s): SyllableSnap => ({ t: s.text, h: !!s.hyphen, k: !!s.skip, e: !!s.extend })),
		}))));

interface Result { filename: string; status: "pass" | "fail" | "error" | "skip"; error?: string }

const testFile = (filename: string): Result => {
	try {
		const lyl = fs.readFileSync(path.join(UNIT_CASES_DIR, filename), "utf-8");
		const doc1 = parseCode(lyl);
		if (!doc1 || doc1.measures.length === 0) return { filename, status: "error", error: "parse produced empty doc" };

		const before = snap(doc1);
		const doc2 = parseCode(serializeLilyletDoc(doc1));
		const after = snap(doc2);

		if (before === after) return { filename, status: "pass" };

		// Surface the first divergent lane for diagnosis.
		const b = JSON.parse(before) as LaneSnap[][]; const a = JSON.parse(after) as LaneSnap[][];
		const diff: string[] = [];
		for (let mi = 0; mi < Math.max(b.length, a.length); mi++) {
			const lb = b[mi] || []; const la = a[mi] || [];
			for (let li = 0; li < Math.max(lb.length, la.length); li++) {
				const sb = JSON.stringify(lb[li]); const sa = JSON.stringify(la[li]);
				if (sb !== sa) diff.push(`m${mi}/lane${li}: ${sb} → ${sa}`);
			}
		}
		return { filename, status: "fail", error: diff.slice(0, 3).join("; ") };
	} catch (e) {
		return { filename, status: "error", error: e instanceof Error ? e.message : String(e) };
	}
};

const main = (): void => {
	console.log("Lilylet Lyrics Round-trip Test (\\addlyrics lane text stability)\n");
	console.log("=".repeat(80));
	const files = fs.readdirSync(UNIT_CASES_DIR).filter(f => f.startsWith("lyrics-") && f.endsWith(".lyl")).sort();
	console.log(`\nFound ${files.length} lyrics test files\n`);

	let passed = 0, failed = 0, errors = 0;
	for (const filename of files) {
		const r = testFile(filename);
		if (r.status === "pass") { passed++; continue; }
		if (r.status === "fail") { failed++; console.log(`❌ ${filename}\n   ${r.error}`); }
		else { errors++; console.log(`⚠️  ${filename}\n   ${r.error}`); }
	}

	console.log("\n" + "=".repeat(80));
	console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors\n`);
	process.exit(failed + errors > 0 ? 1 : 0);
};

main();
