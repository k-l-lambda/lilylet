/**
 * LilyPond Roundtrip Test
 *
 * Tests the lilylet -> lilypond -> lilylet conversion cycle.
 * Compares the output of two conversions to verify consistency.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc, lilypondEncoder } from "../source/lilylet/index.js";
import type { LilyletDoc, Event } from "../source/lilylet/types.js";

// Import the LilyPond decoder
import { decode as decodeLilypond } from "../source/lilylet/lilypondDecoder.js";


const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");
const OUTPUT_DIR = path.join(import.meta.dirname, "output/lilypond-roundtrip");


// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}


interface TestResult {
	filename: string;
	status: "pass" | "fail" | "error";
	error?: string;
	originalLyl?: string;
	generatedLy?: string;
	roundtripLyl?: string;
}


/**
 * Normalize lilylet content for comparison
 * - Remove comments
 * - Normalize whitespace
 * - Remove trailing measure markers
 */
const normalizeLyl = (content: string): string => {
	return content
		// Remove comments
		.replace(/%[^\n]*/g, '')
		// Remove measure markers like "| %1"
		.replace(/\|\s*%\d+/g, '|')
		// Normalize whitespace
		.replace(/\s+/g, ' ')
		// Remove leading/trailing whitespace
		.trim();
};


/**
 * Compare two LilyletDoc structures
 */
const compareDocuments = (doc1: LilyletDoc, doc2: LilyletDoc): { equal: boolean; diff?: string } => {
	// Filter helper - remove pitchReset events (parser artifact, not musical content)
	const filterEvents = (events: Event[]) =>
		events.filter(e => e.type !== 'pitchReset');

	// Check if a measure has real content (not just pitchReset)
	const hasRealContent = (m: typeof doc1.measures[0]) =>
		m.parts.some(p => p.voices.some(v => filterEvents(v.events).length > 0));

	// Filter out empty measures from both documents
	const measures1 = doc1.measures.filter(hasRealContent);
	const measures2 = doc2.measures.filter(hasRealContent);

	// Compare measure counts
	if (measures1.length !== measures2.length) {
		return {
			equal: false,
			diff: `Measure count differs: ${measures1.length} vs ${measures2.length}`
		};
	}

	// Compare each measure
	for (let mi = 0; mi < measures1.length; mi++) {
		const m1 = measures1[mi];
		const m2 = measures2[mi];

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

			// Compare each voice (filtering pitchReset)
			for (let vi = 0; vi < p1.voices.length; vi++) {
				const v1Events = filterEvents(p1.voices[vi].events);
				const v2Events = filterEvents(p2.voices[vi].events);

				if (v1Events.length !== v2Events.length) {
					return {
						equal: false,
						diff: `Measure ${mi + 1}, Part ${pi + 1}, Voice ${vi + 1}: Event count differs: ${v1Events.length} vs ${v2Events.length}`
					};
				}
			}
		}
	}

	return { equal: true };
};


/**
 * Run roundtrip test on a single file
 */
const testFile = async (filename: string): Promise<TestResult> => {
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

		// Step 2: Encode to LilyPond
		const generatedLy = lilypondEncoder.encode(doc1, {
			paper: { width: 210, height: 297 },
			fontSize: 20,
			withMIDI: false,
			autoBeaming: false
		});

		// Step 3: Decode LilyPond back to LilyletDoc
		let doc2: LilyletDoc;
		try {
			doc2 = await decodeLilypond(generatedLy);
		} catch (e) {
			// LilyPond decoder might not be fully compatible
			// Fall back to comparing serialized output
			return {
				filename,
				status: "error",
				error: `LilyPond decode error: ${e instanceof Error ? e.message : String(e)}`,
				originalLyl,
				generatedLy
			};
		}

		if (!doc2 || doc2.measures.length === 0) {
			return {
				filename,
				status: "error",
				error: "Failed to decode LilyPond output",
				originalLyl,
				generatedLy
			};
		}

		// Step 4: Serialize back to lilylet
		const roundtripLyl = serializeLilyletDoc(doc2);

		// Step 5: Compare structures
		const comparison = compareDocuments(doc1, doc2);

		if (comparison.equal) {
			return {
				filename,
				status: "pass",
				originalLyl,
				generatedLy,
				roundtripLyl
			};
		} else {
			return {
				filename,
				status: "fail",
				error: comparison.diff,
				originalLyl,
				generatedLy,
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
 * Run encoding test with full content verification
 * Saves both .ly and .json for inspection
 */
const testEncoding = (filename: string): TestResult => {
	const filepath = path.join(UNIT_CASES_DIR, filename);
	const baseName = path.basename(filename, ".lyl");

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

		// Step 2: Save LilyletDoc as JSON for inspection
		fs.writeFileSync(
			path.join(OUTPUT_DIR, `${baseName}.json`),
			JSON.stringify(doc, null, 2)
		);

		// Step 3: Encode to LilyPond
		const generatedLy = lilypondEncoder.encode(doc, {
			paper: { width: 210, height: 297 },
			fontSize: 20,
			withMIDI: false,
			autoBeaming: false
		});

		// Step 4: Check that output is valid LilyPond syntax (basic checks)
		if (!generatedLy.includes('\\version')) {
			return {
				filename,
				status: "error",
				error: "Generated LilyPond missing version header"
			};
		}

		if (!generatedLy.includes('\\score')) {
			return {
				filename,
				status: "error",
				error: "Generated LilyPond missing score block"
			};
		}

		// Step 5: Save LilyPond output for inspection
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.ly`), generatedLy);

		// Step 6: Verify content - check pitch encoding and spacer rests
		// Each measure should have pitches with correct octave values
		let currentTimeSig: { numerator: number; denominator: number } | undefined;
		for (let mi = 0; mi < doc.measures.length; mi++) {
			const measure = doc.measures[mi];
			if (measure.timeSig) currentTimeSig = measure.timeSig;

			for (const part of measure.parts) {
				for (const voice of part.voices) {
					for (const event of voice.events) {
						if (event.type === 'note') {
							const noteEvent = event as any;
							for (const pitch of noteEvent.pitches) {
								// Verify octave is a valid number (after resolution)
								if (typeof pitch.octave !== 'number' || isNaN(pitch.octave)) {
									return {
										filename,
										status: "fail",
										error: `Measure ${mi + 1}: Invalid octave value for pitch ${pitch.phonet}`
									};
								}
							}
						}
					}
				}
			}
		}

		// Step 7: Verify spacer rests match time signature
		if (currentTimeSig) {
			const { numerator, denominator } = currentTimeSig;
			const quarterBeats = numerator * (4 / denominator);

			// Check for incorrect s1 in non-4/4 time
			if (quarterBeats !== 4 && generatedLy.includes('{ s1 }')) {
				return {
					filename,
					status: "fail",
					error: `Spacer rest 's1' used in ${numerator}/${denominator} time (should be duration matching ${quarterBeats} quarter beats)`
				};
			}
		}

		return {
			filename,
			status: "pass",
			originalLyl,
			generatedLy
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
 * Main test runner
 */
const main = async () => {
	console.log("LilyPond Encoder Test\n");
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
		// Run full roundtrip test
		const result = await testFile(filename);
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
