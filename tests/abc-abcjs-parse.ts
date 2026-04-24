/**
 * Parse all tests/assets/abc/*.abc files with abcjs and report:
 *  - warnings / parse errors from abcjs
 *  - note / rest / bar counts
 * This acts as a ground-truth reference: files abcjs parses cleanly are
 * valid ABC; failures indicate either invalid ABC or abcjs limitations.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const abcjs = require("abcjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_DIR = path.join(__dirname, "assets/abc");

interface VoiceStat {
	notes: number;
	rests: number;
	bars: number;
}

interface FileStat {
	file: string;
	warnings: string[] | undefined;
	voices: VoiceStat[];
	totalNotes: number;
	totalRests: number;
	totalBars: number;
}

function countElements(tune: any): VoiceStat[] {
	const stats: VoiceStat[] = [];
	for (const line of tune.lines) {
		if (!line.staff) continue;
		for (const staff of line.staff) {
			for (let vi = 0; vi < staff.voices.length; vi++) {
				if (!stats[vi]) stats[vi] = { notes: 0, rests: 0, bars: 0 };
				for (const el of staff.voices[vi]) {
					if (el.el_type === "note") {
						if (el.rest) stats[vi].rests++;
						else stats[vi].notes++;
					} else if (el.el_type === "bar") {
						stats[vi].bars++;
					}
				}
			}
		}
	}
	return stats;
}

const files = fs.readdirSync(ABC_DIR)
	.filter(f => f.endsWith(".abc"))
	.sort();

console.log(`Parsing ${files.length} ABC files with abcjs\n`);
console.log("=".repeat(60));

let pass = 0;
let warn = 0;
const results: FileStat[] = [];

for (const file of files) {
	const content = fs.readFileSync(path.join(ABC_DIR, file), "utf-8");
	let tunes: any[];
	try {
		tunes = abcjs.parseOnly(content);
	} catch (e: any) {
		console.log(`CRASH ${file}`);
		// known abcjs bug: cross-bar slur continuation in inline multi-voice format
		console.log(`      ${e.message.split("\n")[0]}`);
		continue;
	}

	const tune = tunes[0];
	const voices = countElements(tune);
	const totalNotes = voices.reduce((s, v) => s + v.notes, 0);
	const totalRests = voices.reduce((s, v) => s + v.rests, 0);
	const totalBars  = voices.reduce((s, v) => s + v.bars, 0);
	const warnings: string[] | undefined = tune.warnings;

	results.push({ file, warnings, voices, totalNotes, totalRests, totalBars });

	const tag = warnings ? "WARN" : "OK  ";
	if (warnings) warn++; else pass++;

	console.log(`${tag}  ${file}`);
	console.log(`      notes=${totalNotes}  rests=${totalRests}  bars=${totalBars}  voices=${voices.length}`);
	if (warnings) {
		for (const w of warnings) {
			console.log(`      ⚠  ${w}`);
		}
	}
}

console.log("\n" + "=".repeat(60));
console.log(`Results: ${pass} clean, ${warn} with warnings, out of ${files.length} files`);

// Summary: files that abcjs WARNS on — these are the ones to fix in lilylet
if (warn > 0) {
	console.log("\nFiles with abcjs warnings:");
	for (const r of results) {
		if (r.warnings) console.log(`  ${r.file}`);
	}
}
