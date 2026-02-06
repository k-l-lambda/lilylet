/**
 * Test: Encoder should not mutate input AST
 *
 * GPT-5.2 flagged that the encoder temporarily mutates subEvent.duration.tuplet
 * during tuplet encoding. This test verifies:
 * 1. Encoding a doc twice produces identical output
 * 2. The doc's tuplet events are unchanged after encoding
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, musicXmlEncoder } from "../source/lilylet/index.js";
import type { TupletEvent } from "../source/lilylet/types.js";

const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");

// Collect all .lyl files that contain tuplets
const files = fs.readdirSync(UNIT_CASES_DIR)
	.filter(f => f.endsWith(".lyl"))
	.sort();

let passed = 0;
let failed = 0;

console.log("Encoder Mutation Test\n");
console.log("=" .repeat(80));

for (const filename of files) {
	const filepath = path.join(UNIT_CASES_DIR, filename);
	const lyl = fs.readFileSync(filepath, "utf-8");
	const doc = parseCode(lyl);

	if (!doc || doc.measures.length === 0) continue;

	// Check if doc has tuplets
	let hasTuplets = false;
	for (const m of doc.measures) {
		for (const p of m.parts) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e.type === 'tuplet') hasTuplets = true;
				}
			}
		}
	}
	if (!hasTuplets) continue;

	// Snapshot tuplet sub-event durations before encoding
	const snapshotBefore: string[] = [];
	for (const m of doc.measures) {
		for (const p of m.parts) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e.type === 'tuplet') {
						for (const sub of (e as TupletEvent).events) {
							snapshotBefore.push(JSON.stringify(sub.duration));
						}
					}
				}
			}
		}
	}

	// Encode first time
	const xml1 = musicXmlEncoder.encode(doc);

	// Snapshot after first encode
	const snapshotAfter: string[] = [];
	for (const m of doc.measures) {
		for (const p of m.parts) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e.type === 'tuplet') {
						for (const sub of (e as TupletEvent).events) {
							snapshotAfter.push(JSON.stringify(sub.duration));
						}
					}
				}
			}
		}
	}

	// Encode second time
	const xml2 = musicXmlEncoder.encode(doc);

	// Check 1: Duration snapshots unchanged
	let durationMutated = false;
	if (snapshotBefore.length !== snapshotAfter.length) {
		durationMutated = true;
	} else {
		for (let i = 0; i < snapshotBefore.length; i++) {
			if (snapshotBefore[i] !== snapshotAfter[i]) {
				durationMutated = true;
				console.log(`  Duration mutated at index ${i}:`);
				console.log(`    Before: ${snapshotBefore[i]}`);
				console.log(`    After:  ${snapshotAfter[i]}`);
				break;
			}
		}
	}

	// Check 2: Identical output
	const identicalOutput = xml1 === xml2;

	if (!durationMutated && identicalOutput) {
		console.log(`✅ ${filename}`);
		passed++;
	} else {
		console.log(`❌ ${filename}`);
		if (durationMutated) {
			console.log(`   AST mutation detected: tuplet sub-event duration changed after encode`);
		}
		if (!identicalOutput) {
			console.log(`   Non-idempotent: second encode produced different output`);
		}
		failed++;
	}
}

console.log("\n" + "=" .repeat(80));
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
