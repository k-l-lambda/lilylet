
import fs from "fs";
import path from "path";
import { parseMeasureLayout, expandMeasureLayout } from "../source/lilylet/measureLayout";

// Batch-expand every .lyl file's [measures "…"] code into its PLAYED source-measure
// sequence (1-based), and count its %N measure markers. Emits ONE JSON object
// { [stem]: { played: number[] | null, lylCount: number, code: string | null } }
// to --out, so a downstream driver can attach played->source per MIDI measure
// WITHOUT spawning a node process per file.
//
//   npx tsx tools/expandLylMeasures.ts --lyl-dir DIR --out OUT.json
//
// DIR is walked recursively (XX/YY/<stem>.lyl); the key is the bare <stem>.

const parseArgs = (argv: string[]): Record<string, string> => {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; ++i) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const val = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : "true";
			out[key] = val;
		}
	}
	return out;
};

const walkLyl = (dir: string): string[] => {
	const found: string[] = [];
	const rec = (d: string): void => {
		for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, ent.name);
			if (ent.isDirectory())
				rec(p);
			else if (ent.isFile() && /\.lyl$/i.test(ent.name))
				found.push(p);
		}
	};
	rec(dir);
	return found;
};

const MEASURES_RE = /\[measures\s+"([^"]*)"\]/;
const NMARK_RE = /%(\d+)\b/g;

const lylMeasureCount = (text: string): number => {
	let max = 0, m: RegExpExecArray | null;
	NMARK_RE.lastIndex = 0;
	while ((m = NMARK_RE.exec(text)) !== null)
		max = Math.max(max, parseInt(m[1], 10));
	return max;
};

const main = (): void => {
	const args = parseArgs(process.argv.slice(2));
	const lylDir = args["lyl-dir"];
	const outPath = args["out"];
	if (!lylDir || !outPath)
		throw new Error("usage: expandLylMeasures.ts --lyl-dir DIR --out OUT.json");

	const files = walkLyl(path.resolve(lylDir));
	const result: Record<string, { played: number[] | null; lylCount: number; code: string | null }> = {};
	let withCode = 0, expandFail = 0;

	for (const f of files) {
		const stem = path.basename(f, ".lyl");
		const text = fs.readFileSync(f, "utf8");
		const lylCount = lylMeasureCount(text);
		const mm = text.match(MEASURES_RE);
		let played: number[] | null = null;
		let code: string | null = null;
		if (mm) {
			code = mm[1];
			withCode += 1;
			try {
				played = expandMeasureLayout(parseMeasureLayout(code));
			}
			catch (e) {
				expandFail += 1;
				played = null;
			}
		}
		result[stem] = { played, lylCount, code };
	}

	fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(result));
	console.error(`expanded ${files.length} lyl (with [measures]: ${withCode}, expand-fail: ${expandFail}) -> ${outPath}`);
};

main();
