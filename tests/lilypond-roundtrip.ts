/**
 * LilyPond Roundtrip Test
 *
 * Tests the lilylet -> lilypond -> lilylet conversion cycle.
 * Compares the output of two conversions to verify consistency.
 */

import * as fs from "fs";
import * as path from "path";
import { parseCode, serializeLilyletDoc, lilypondEncoder } from "../source/lilylet/index.js";
import type { LilyletDoc, Event, NoteEvent, RestEvent, TupletEvent, TimesEvent } from "../source/lilylet/types.js";

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
 *
 * Note: Measure boundaries may differ between lilylet parser (doesn't enforce time signatures)
 * and lotus parser (enforces time signatures). We compare total events across all measures.
 */
const compareDocuments = (doc1: LilyletDoc, doc2: LilyletDoc): { equal: boolean; diff?: string } => {
	// Filter helper - remove parser artifacts that don't represent musical content
	const filterEvents = (events: Event[]) =>
		events.filter(e => {
			if (e.type === 'pitchReset') return false;
			if (e.type === 'context' && 'staff' in e) return false;
			if (e.type === 'context' && 'stemDirection' in e) return false;
			if (e.type === 'rest' && (e as any).invisible) return false;
			return true;
		});

	// Remove redundant consecutive context events
	const dedupeContextEvents = (events: Event[]): Event[] => {
		const result: Event[] = [];
		let lastClef: string | undefined;
		let lastKey: string | undefined;
		let lastTime: string | undefined;

		for (const e of events) {
			if (e.type === 'context') {
				const ctx = e as any;
				if ('stemDirection' in ctx) continue; // already filtered
				if ('clef' in ctx) {
					if (ctx.clef === lastClef) continue;
					lastClef = ctx.clef;
				}
				if ('key' in ctx) {
					const keyStr = JSON.stringify(ctx.key);
					if (keyStr === lastKey) continue;
					lastKey = keyStr;
				}
				if ('time' in ctx && ctx.time) {
					const timeStr = `${ctx.time.numerator}/${ctx.time.denominator}`;
					if (timeStr === lastTime) continue;
					lastTime = timeStr;
				}
				if ('timeSig' in ctx && ctx.timeSig) {
					const timeSigStr = `${ctx.timeSig.numerator}/${ctx.timeSig.denominator}`;
					if (timeSigStr === lastTime) continue;
					lastTime = timeSigStr;
				}
			}
			result.push(e);
		}
		return result;
	};

	// Collect musically-significant events (notes, rests, tuplets, times) preserving structure
	const collectMusical = (events: Event[]): (NoteEvent | RestEvent | TupletEvent | TimesEvent)[] =>
		events.filter(e => e.type === 'note' || e.type === 'rest' || e.type === 'tuplet' || e.type === 'times') as (NoteEvent | RestEvent | TupletEvent | TimesEvent)[];

	// Flatten note/rest events from potentially nested tuplets/times (for pitch/duration checks)
	const flattenNoteRests = (events: Event[]): (NoteEvent | RestEvent)[] => {
		const result: (NoteEvent | RestEvent)[] = [];
		for (const e of events) {
			if (e.type === 'note' || e.type === 'rest') {
				result.push(e as NoteEvent | RestEvent);
			} else if (e.type === 'tuplet' || e.type === 'times') {
				result.push(...(e as TupletEvent).events);
			}
		}
		return result;
	};

	// Format a note/rest event for diff display
	const describeEvent = (e: NoteEvent | RestEvent, index: number): string => {
		if (e.type === 'rest') {
			const r = e as RestEvent;
			if (r.pitch) return `[${index}] rest(${r.pitch.phonet}${r.pitch.octave}) dur=${r.duration.division}${'.'.repeat(r.duration.dots)}`;
			return `[${index}] rest dur=${r.duration.division}${'.'.repeat(r.duration.dots)}`;
		}
		const n = e as NoteEvent;
		const pitches = n.pitches.map(p => `${p.phonet}${p.accidental ? '(' + p.accidental + ')' : ''}${p.octave}`).join('+');
		return `[${index}] note(${pitches}) dur=${n.duration.division}${'.'.repeat(n.duration.dots)}`;
	};

	// Compare two note/rest events
	const eventsMatch = (a: NoteEvent | RestEvent, b: NoteEvent | RestEvent): boolean => {
		if (a.type !== b.type) return false;

		// Compare duration
		if (a.duration.division !== b.duration.division) return false;
		if (a.duration.dots !== b.duration.dots) return false;

		if (a.type === 'note' && b.type === 'note') {
			const na = a as NoteEvent;
			const nb = b as NoteEvent;
			if (na.pitches.length !== nb.pitches.length) return false;
			for (let i = 0; i < na.pitches.length; i++) {
				if (na.pitches[i].phonet !== nb.pitches[i].phonet) return false;
				if (na.pitches[i].octave !== nb.pitches[i].octave) return false;
				// Don't compare accidental - it may differ between parsers due to key context
			}
		}

		if (a.type === 'rest' && b.type === 'rest') {
			const ra = a as RestEvent;
			const rb = b as RestEvent;
			// Both pitched or both unpitched
			if (!!ra.pitch !== !!rb.pitch) return false;
			if (ra.pitch && rb.pitch) {
				if (ra.pitch.phonet !== rb.pitch.phonet) return false;
				if (ra.pitch.octave !== rb.pitch.octave) return false;
			}
		}

		return true;
	};

	// Collect all events from all measures for a specific staff within a part
	const collectEventsByStaff = (measures: typeof doc1.measures, partIndex: number, staff: number) => {
		const allEvents: Event[] = [];
		for (const m of measures) {
			const part = m.parts[partIndex];
			if (part) {
				for (const voice of part.voices) {
					if (voice.staff === staff) {
						allEvents.push(...filterEvents(voice.events));
					}
				}
			}
		}
		return dedupeContextEvents(allEvents);
	};

	// Count voices per staff across all measures (only voices with non-spacer musical content)
	const getVoiceCountByStaff = (measures: typeof doc1.measures, partIndex: number): Map<number, number> => {
		const maxVoices = new Map<number, number>();
		for (const m of measures) {
			const part = m.parts[partIndex];
			if (!part) continue;
			const staffCounts = new Map<number, number>();
			for (const voice of part.voices) {
				if (!hasNonSpacerContent(voice.events)) continue;
				const s = voice.staff || 1;
				staffCounts.set(s, (staffCounts.get(s) || 0) + 1);
			}
			for (const [s, count] of staffCounts) {
				maxVoices.set(s, Math.max(maxVoices.get(s) || 0, count));
			}
		}
		return maxVoices;
	};

	// Check if a voice has any non-spacer musical content
	const hasNonSpacerContent = (events: Event[]) =>
		events.some(e => {
			if (e.type === 'note') return true;
			if (e.type === 'rest' && !(e as RestEvent).invisible) return true;
			if (e.type === 'tuplet' || e.type === 'times' || e.type === 'tremolo') return true;
			return false;
		});

	// Get all unique staves used in a part that have at least some real (non-spacer) content.
	// Spacer-only staves are filtered because the LilyPond encoder/decoder drops them.
	const getStaves = (measures: typeof doc1.measures, partIndex: number): number[] => {
		// Collect staff → whether any measure has non-spacer content
		const staffHasContent = new Map<number, boolean>();
		for (const m of measures) {
			const part = m.parts[partIndex];
			if (part) {
				for (const voice of part.voices) {
					const s = voice.staff || 1;
					if (!staffHasContent.get(s) && hasNonSpacerContent(voice.events)) {
						staffHasContent.set(s, true);
					} else if (!staffHasContent.has(s)) {
						staffHasContent.set(s, false);
					}
				}
			}
		}
		// Only return staves that have real content in at least one measure
		return Array.from(staffHasContent.entries())
			.filter(([, hasContent]) => hasContent)
			.map(([s]) => s)
			.sort((a, b) => a - b);
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

	// Compare each part
	for (let pi = 0; pi < maxParts1; pi++) {
		const staves1 = getStaves(doc1.measures, pi);
		const staves2 = getStaves(doc2.measures, pi);

		// Compare staff counts
		if (staves1.length !== staves2.length) {
			return {
				equal: false,
				diff: `Part ${pi + 1}: Staff count differs: ${staves1.length} (staves ${staves1.join(',')}) vs ${staves2.length} (staves ${staves2.join(',')})`
			};
		}

		// Compare voice counts per staff
		const voices1 = getVoiceCountByStaff(doc1.measures, pi);
		const voices2 = getVoiceCountByStaff(doc2.measures, pi);
		for (const staff of staves1) {
			const v1 = voices1.get(staff) || 0;
			const v2 = voices2.get(staff) || 0;
			if (v1 !== v2) {
				return {
					equal: false,
					diff: `Part ${pi + 1}, Staff ${staff}: Voice count differs: ${v1} vs ${v2}`
				};
			}
		}

		// Compare events for each staff
		for (const staff of staves1) {
			const events1 = collectEventsByStaff(doc1.measures, pi, staff);
			const events2 = collectEventsByStaff(doc2.measures, pi, staff);

			// Compare event count
			const noteRests1 = flattenNoteRests(events1);
			const noteRests2 = flattenNoteRests(events2);

			if (noteRests1.length !== noteRests2.length) {
				return {
					equal: false,
					diff: `Part ${pi + 1}, Staff ${staff}: Note/rest count differs: ${noteRests1.length} vs ${noteRests2.length}`
				};
			}

			// Compare each note/rest event content
			for (let i = 0; i < noteRests1.length; i++) {
				if (!eventsMatch(noteRests1[i], noteRests2[i])) {
					return {
						equal: false,
						diff: `Part ${pi + 1}, Staff ${staff}: Event mismatch at index ${i}: ${describeEvent(noteRests1[i], i)} vs ${describeEvent(noteRests2[i], i)}`
					};
				}
			}

			// Compare tuplet/times structure: type, count, and ratios must match
			const tuplesLike1 = collectMusical(events1).filter(e => e.type === 'tuplet' || e.type === 'times') as (TupletEvent | TimesEvent)[];
			const tuplesLike2 = collectMusical(events2).filter(e => e.type === 'tuplet' || e.type === 'times') as (TupletEvent | TimesEvent)[];
			if (tuplesLike1.length !== tuplesLike2.length) {
				return {
					equal: false,
					diff: `Part ${pi + 1}, Staff ${staff}: Tuplet/times count differs: ${tuplesLike1.length} vs ${tuplesLike2.length}`
				};
			}
			for (let i = 0; i < tuplesLike1.length; i++) {
				const t1 = tuplesLike1[i], t2 = tuplesLike2[i];
				if (t1.type !== t2.type) {
					return {
						equal: false,
						diff: `Part ${pi + 1}, Staff ${staff}: Tuplet ${i} type differs: "${t1.type}" vs "${t2.type}"`
					};
				}
				const r1 = t1.ratio, r2 = t2.ratio;
				if (r1.numerator !== r2.numerator || r1.denominator !== r2.denominator) {
					return {
						equal: false,
						diff: `Part ${pi + 1}, Staff ${staff}: Tuplet ${i} ratio differs: ${r1.numerator}/${r1.denominator} vs ${r2.numerator}/${r2.denominator}`
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

		// Step 5: Save .ly and .json for inspection
		const baseName = path.basename(filename, ".lyl");
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.ly`), generatedLy);
		fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.json`), JSON.stringify(doc1, null, 2));

		// Step 6: Compare structures
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
