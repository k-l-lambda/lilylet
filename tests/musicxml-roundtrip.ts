/**
 * MusicXML Roundtrip Test
 *
 * Tests the lilylet -> musicxml -> lilylet conversion cycle.
 * Compares the output of two conversions to verify consistency.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc, musicXmlEncoder, musicXmlDecoder } from "../source/lilylet/index.js";
import type { LilyletDoc, Event, NoteEvent, RestEvent, TupletEvent } from "../source/lilylet/types.js";


const UNIT_CASES_DIR = path.join(import.meta.dirname, "assets/unit-cases");
const OUTPUT_DIR = path.join(import.meta.dirname, "output/musicxml-roundtrip");

// Known limitations - skip these tests
const SKIP_FILES = new Set<string>([
]);


// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}


interface TestResult {
	filename: string;
	status: "pass" | "fail" | "skip" | "error";
	error?: string;
	originalLyl?: string;
	generatedXml?: string;
	roundtripLyl?: string;
}


/**
 * Flatten tuplet events - extract inner events from TupletEvent
 */
const flattenEvents = (events: Event[]): Event[] => {
	const result: Event[] = [];
	for (const e of events) {
		if (e.type === 'tuplet') {
			result.push(...(e as TupletEvent).events);
		} else {
			result.push(e);
		}
	}
	return result;
};


/**
 * Filter to only note and rest events (core musical content).
 * Context events (key, time, clef, ottava, stemDirection, tempo) are handled
 * at the measure/attribute level in MusicXML and may not survive as voice events.
 * Other event types (tremolo, harmony, barline, markup) may also be lost or
 * repositioned during roundtrip.
 */
const filterToNoteRest = (events: Event[]): (NoteEvent | RestEvent)[] =>
	events.filter(e => e.type === 'note' || e.type === 'rest') as (NoteEvent | RestEvent)[];


/**
 * Compare two LilyletDoc structures with robust comparison.
 *
 * Strategy:
 * - Flatten tuplets, filter artifacts, dedupe context events
 * - Compare by staff (not voice index) across all measures
 * - Verify pitch/duration content of note events
 */
const compareDocuments = (doc1: LilyletDoc, doc2: LilyletDoc): { equal: boolean; diff?: string } => {
	// Collect all note/rest events from all measures for a specific staff within a part
	const collectEventsByStaff = (measures: typeof doc1.measures, partIndex: number, staff: number) => {
		const allEvents: (NoteEvent | RestEvent)[] = [];
		for (const m of measures) {
			const part = m.parts[partIndex];
			if (part) {
				for (const voice of part.voices) {
					if ((voice.staff || 1) === staff) {
						allEvents.push(...filterToNoteRest(flattenEvents(voice.events)));
					}
				}
			}
		}
		return allEvents;
	};

	// Get all unique staves used in a part across all measures
	const getStaves = (measures: typeof doc1.measures, partIndex: number): number[] => {
		const staves = new Set<number>();
		for (const m of measures) {
			const part = m.parts[partIndex];
			if (part) {
				for (const voice of part.voices) {
					staves.add(voice.staff || 1);
				}
			}
		}
		return Array.from(staves).sort((a, b) => a - b);
	};

	// Get max parts count
	const maxParts1 = Math.max(...doc1.measures.map(m => m.parts.length), 0);
	const maxParts2 = Math.max(...doc2.measures.map(m => m.parts.length), 0);

	if (maxParts1 !== maxParts2) {
		return {
			equal: false,
			diff: `Part count differs: ${maxParts1} vs ${maxParts2}`
		};
	}

	// Compare each part by staff
	for (let pi = 0; pi < maxParts1; pi++) {
		const staves1 = getStaves(doc1.measures, pi);
		const staves2 = getStaves(doc2.measures, pi);

		if (staves1.length !== staves2.length) {
			return {
				equal: false,
				diff: `Part ${pi + 1}: Staff count differs: ${staves1.length} vs ${staves2.length}`
			};
		}

		// Compare events for each staff
		for (const staff of staves1) {
			const events1 = collectEventsByStaff(doc1.measures, pi, staff);
			const events2 = collectEventsByStaff(doc2.measures, pi, staff);

			if (events1.length !== events2.length) {
				return {
					equal: false,
					diff: `Part ${pi + 1}, Staff ${staff}: Total event count differs: ${events1.length} vs ${events2.length}`
				};
			}

			// Content verification: compare note/rest pitch and duration values
			for (let i = 0; i < events1.length; i++) {
				const e1 = events1[i];
				const e2 = events2[i];

				if (e1.type !== e2.type) {
					return {
						equal: false,
						diff: `Part ${pi + 1}, Staff ${staff}, Event ${i + 1}: Type differs: ${e1.type} vs ${e2.type}`
					};
				}

				if (e1.type === 'note' && e2.type === 'note') {
					// Compare pitch count
					if (e1.pitches.length !== e2.pitches.length) {
						return {
							equal: false,
							diff: `Part ${pi + 1}, Staff ${staff}, Event ${i + 1}: Pitch count differs: ${e1.pitches.length} vs ${e2.pitches.length}`
						};
					}

					// Compare each pitch (phonet + octave)
					for (let j = 0; j < e1.pitches.length; j++) {
						const p1 = e1.pitches[j];
						const p2 = e2.pitches[j];
						if (p1.phonet !== p2.phonet || p1.octave !== p2.octave) {
							return {
								equal: false,
								diff: `Part ${pi + 1}, Staff ${staff}, Event ${i + 1}: Pitch ${j + 1} differs: ${p1.phonet}${p1.octave} vs ${p2.phonet}${p2.octave}`
							};
						}
					}

					// Compare duration (division + dots)
					if (e1.duration.division !== e2.duration.division || e1.duration.dots !== e2.duration.dots) {
						return {
							equal: false,
							diff: `Part ${pi + 1}, Staff ${staff}, Event ${i + 1}: Duration differs: div=${e1.duration.division} dots=${e1.duration.dots} vs div=${e2.duration.division} dots=${e2.duration.dots}`
						};
					}
				}

				if (e1.type === 'rest' && e2.type === 'rest') {
					if (e1.duration.division !== e2.duration.division || e1.duration.dots !== e2.duration.dots) {
						return {
							equal: false,
							diff: `Part ${pi + 1}, Staff ${staff}, Event ${i + 1}: Rest duration differs: div=${e1.duration.division} dots=${e1.duration.dots} vs div=${e2.duration.division} dots=${e2.duration.dots}`
						};
					}
				}
			}
		}
	}

	return { equal: true };
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
	console.log("MusicXML Roundtrip Test\n");
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
	let skipped = 0;

	for (const filename of files) {
		// Check skip list
		if (SKIP_FILES.has(filename)) {
			results.push({ filename, status: "skip" });
			skipped++;
			console.log(`⏭️  ${filename} (skipped - known limitation)`);
			continue;
		}

		// Run full roundtrip test
		const result = testRoundtrip(filename);
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
	console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors, ${skipped} skipped`);
	console.log(`Output files saved to: ${OUTPUT_DIR}\n`);

	// Save summary
	const summary = {
		total: files.length,
		passed,
		failed,
		errors,
		skipped,
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
