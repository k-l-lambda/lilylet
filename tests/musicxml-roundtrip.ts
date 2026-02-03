/**
 * MusicXML Roundtrip Test
 *
 * Tests the lilylet -> musicxml -> lilylet conversion cycle.
 * Compares the output of two conversions to verify consistency.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc, musicXmlEncoder, musicXmlDecoder } from "../source/lilylet/index.js";
import type { LilyletDoc } from "../source/lilylet/types.js";


const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");
const OUTPUT_DIR = path.join(import.meta.dirname, "output/musicxml-roundtrip");


// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}


interface TestResult {
	filename: string;
	status: "pass" | "fail" | "error";
	error?: string;
	originalLyl?: string;
	generatedXml?: string;
	roundtripLyl?: string;
}


/**
 * Compare two LilyletDoc structures
 */
const compareDocuments = (doc1: LilyletDoc, doc2: LilyletDoc): { equal: boolean; diff?: string } => {
	// Compare measure counts
	if (doc1.measures.length !== doc2.measures.length) {
		return {
			equal: false,
			diff: `Measure count differs: ${doc1.measures.length} vs ${doc2.measures.length}`
		};
	}

	// Compare each measure
	for (let mi = 0; mi < doc1.measures.length; mi++) {
		const m1 = doc1.measures[mi];
		const m2 = doc2.measures[mi];

		// Compare parts count
		if (m1.parts.length !== m2.parts.length) {
			return {
				equal: false,
				diff: `Measure ${mi + 1}: Part count differs: ${m1.parts.length} vs ${m2.parts.length}`
			};
		}

		// Compare each part
		for (let pi = 0; pi < m1.parts.length; pi++) {
			const p1 = m1.parts[pi];
			const p2 = m2.parts[pi];

			// Compare voices count
			if (p1.voices.length !== p2.voices.length) {
				return {
					equal: false,
					diff: `Measure ${mi + 1}, Part ${pi + 1}: Voice count differs: ${p1.voices.length} vs ${p2.voices.length}`
				};
			}

			// Compare each voice event count
			for (let vi = 0; vi < p1.voices.length; vi++) {
				const v1 = p1.voices[vi];
				const v2 = p2.voices[vi];

				// Filter out context events for comparison (they may differ in encoding)
				const events1 = v1.events.filter(e => e.type === 'note' || e.type === 'rest');
				const events2 = v2.events.filter(e => e.type === 'note' || e.type === 'rest');

				if (events1.length !== events2.length) {
					return {
						equal: false,
						diff: `Measure ${mi + 1}, Part ${pi + 1}, Voice ${vi + 1}: Note/Rest event count differs: ${events1.length} vs ${events2.length}`
					};
				}
			}
		}
	}

	return { equal: true };
};


/**
 * Run encoding test (just check if encoding works without errors)
 */
const testEncoding = (filename: string): TestResult => {
	const filepath = path.join(UNIT_CASES_DIR, filename);

	try {
		// Step 1: Read and parse original lilylet
		const originalLyl = fs.readFileSync(filepath, "utf-8");
		const doc = parseCode(originalLyl);

		if (!doc || doc.measures.length === 0) {
			return {
				filename,
				status: "error",
				error: "Failed to parse original lilylet file"
			};
		}

		// Step 2: Encode to MusicXML
		const generatedXml = musicXmlEncoder.encode(doc);

		// Step 3: Check that output is valid XML (basic checks)
		if (!generatedXml.includes('<?xml')) {
			return {
				filename,
				status: "error",
				error: "Generated MusicXML missing XML declaration"
			};
		}

		if (!generatedXml.includes('score-partwise')) {
			return {
				filename,
				status: "error",
				error: "Generated MusicXML missing score-partwise element"
			};
		}

		if (!generatedXml.includes('<measure')) {
			return {
				filename,
				status: "error",
				error: "Generated MusicXML missing measure elements"
			};
		}

		// Save output for inspection
		const baseName = path.basename(filename, ".lyl");
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.musicxml`), generatedXml);

		return {
			filename,
			status: "pass",
			originalLyl,
			generatedXml
		};

	} catch (e) {
		return {
			filename,
			status: "error",
			error: e instanceof Error ? e.message : String(e)
		};
	}
};


/**
 * Run full roundtrip test
 */
const testRoundtrip = (filename: string): TestResult => {
	const filepath = path.join(UNIT_CASES_DIR, filename);

	try {
		// Step 1: Read and parse original lilylet
		const originalLyl = fs.readFileSync(filepath, "utf-8");
		const doc1 = parseCode(originalLyl);

		if (!doc1 || doc1.measures.length === 0) {
			return {
				filename,
				status: "error",
				error: "Failed to parse original lilylet file"
			};
		}

		// Step 2: Encode to MusicXML
		const generatedXml = musicXmlEncoder.encode(doc1);

		// Save MusicXML for inspection
		const baseName = path.basename(filename, ".lyl");
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.musicxml`), generatedXml);

		// Step 3: Decode MusicXML back to LilyletDoc
		let doc2: LilyletDoc;
		try {
			doc2 = musicXmlDecoder.decode(generatedXml);
		} catch (e) {
			return {
				filename,
				status: "error",
				error: `MusicXML decode error: ${e instanceof Error ? e.message : String(e)}`,
				originalLyl,
				generatedXml
			};
		}

		if (!doc2 || doc2.measures.length === 0) {
			return {
				filename,
				status: "error",
				error: "Failed to decode MusicXML output",
				originalLyl,
				generatedXml
			};
		}

		// Step 4: Serialize back to lilylet
		const roundtripLyl = serializeLilyletDoc(doc2);
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.roundtrip.lyl`), roundtripLyl);

		// Step 5: Compare structures
		const comparison = compareDocuments(doc1, doc2);

		if (comparison.equal) {
			return {
				filename,
				status: "pass",
				originalLyl,
				generatedXml,
				roundtripLyl
			};
		} else {
			return {
				filename,
				status: "fail",
				error: comparison.diff,
				originalLyl,
				generatedXml,
				roundtripLyl
			};
		}

	} catch (e) {
		return {
			filename,
			status: "error",
			error: e instanceof Error ? e.message : String(e)
		};
	}
};


/**
 * Main test runner
 */
const main = async () => {
	const args = process.argv.slice(2);
	const doRoundtrip = args.includes('--roundtrip');

	console.log(`MusicXML ${doRoundtrip ? 'Roundtrip' : 'Encoder'} Test\n`);
	console.log("=" .repeat(80));

	// Get all .lyl files in unit-cases
	const files = fs.readdirSync(UNIT_CASES_DIR)
		.filter(f => f.endsWith(".lyl"))
		.sort();

	console.log(`\nFound ${files.length} test files\n`);

	const results: TestResult[] = [];
	let passed = 0;
	let failed = 0;
	let errors = 0;

	for (const filename of files) {
		// Run test
		const result = doRoundtrip ? testRoundtrip(filename) : testEncoding(filename);
		results.push(result);

		const statusIcon = result.status === "pass" ? "✅" :
			result.status === "fail" ? "❌" : "⚠️";

		console.log(`${statusIcon} ${filename}`);

		if (result.status === "pass") {
			passed++;
		} else if (result.status === "fail") {
			failed++;
			console.log(`   Diff: ${result.error}`);
		} else {
			errors++;
			console.log(`   Error: ${result.error}`);
		}
	}

	console.log("\n" + "=" .repeat(80));
	console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors`);
	console.log(`Output files saved to: ${OUTPUT_DIR}\n`);

	// Save summary
	const summary = {
		total: files.length,
		passed,
		failed,
		errors,
		mode: doRoundtrip ? 'roundtrip' : 'encoding',
		results: results.map(r => ({
			filename: r.filename,
			status: r.status,
			error: r.error
		}))
	};

	fs.writeFileSync(
		path.join(OUTPUT_DIR, "_summary.json"),
		JSON.stringify(summary, null, 2)
	);

	// Exit with error code if any tests failed
	process.exit(failed + errors > 0 ? 1 : 0);
};


main().catch(console.error);
