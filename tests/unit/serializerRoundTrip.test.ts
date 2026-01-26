/**
 * Round-trip test for Lilylet serializer
 *
 * Loads LilyletDoc JSON -> serializes to .lyl -> parses back -> compares
 *
 * Usage: npx ts-node tests/unit/serializerRoundTrip.test.ts [json-dir] [max-files]
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCode } from '../../source/lilylet/parser';
import { serializeLilyletDoc } from '../../source/lilylet/serializer';
import { LilyletDoc, NoteEvent, RestEvent, ContextChange, Event, Voice, Part, Measure } from '../../source/lilylet/types';


// Get args
const args = process.argv.slice(2);
const JSON_DIR = args[0] || './tests/output/from-ly';
const MAX_FILES = parseInt(args[1] || '0', 10); // 0 = all files


/**
 * Check if a context change event is effectively empty
 * (created by \staff command which doesn't set any context properties)
 */
const isEmptyContextChange = (event: Event): boolean => {
	if (event.type !== 'context') return false;
	const ctx = event as ContextChange;
	return !ctx.clef && !ctx.key && !ctx.time && !ctx.tempo &&
	       ctx.ottava === undefined && !ctx.stemDirection;
};


/**
 * Check if a context change only has key or time (from measure-level serialization)
 */
const isKeyOrTimeOnlyContext = (event: Event): boolean => {
	if (event.type !== 'context') return false;
	const ctx = event as ContextChange;
	// Only has key or time, nothing else
	const hasKey = !!ctx.key;
	const hasTime = !!ctx.time;
	const hasOther = !!ctx.clef || !!ctx.tempo || ctx.ottava !== undefined || !!ctx.stemDirection;
	return (hasKey || hasTime) && !hasOther;
};


/**
 * Check if an event is a space rest (invisible rest, used for empty measures)
 */
const isSpaceRest = (event: Event): boolean => {
	if (event.type !== 'rest') return false;
	const rest = event as RestEvent;
	return !!rest.invisible;
};


/**
 * Filter out empty context changes and key/time-only context changes from events array
 * Key/time context changes may come from measure-level properties during serialization
 * Also filters space rests that were added to preserve empty measures
 */
const filterEvents = (events: Event[], isFirstMeasure: boolean = false, filterSpaceRests: boolean = false): Event[] => {
	return events.filter(e => {
		if (isEmptyContextChange(e)) return false;
		// In first measure, key/time context events may come from measure properties
		if (isFirstMeasure && isKeyOrTimeOnlyContext(e)) return false;
		// Filter space rests if requested (for comparing with originally empty voices)
		if (filterSpaceRests && isSpaceRest(e)) return false;
		return true;
	});
};


/**
 * Deep comparison of two LilyletDoc objects
 * Returns list of differences found
 */
const compareDocs = (original: LilyletDoc, roundTrip: LilyletDoc): string[] => {
	const diffs: string[] = [];

	// Compare measure count
	if (original.measures.length !== roundTrip.measures.length) {
		diffs.push(`Measure count: ${original.measures.length} vs ${roundTrip.measures.length}`);
		return diffs; // Can't compare further if measure counts differ
	}

	// Compare each measure
	for (let m = 0; m < original.measures.length; m++) {
		const origMeasure = original.measures[m];
		const rtMeasure = roundTrip.measures[m];

		// Compare parts count
		if (origMeasure.parts.length !== rtMeasure.parts.length) {
			diffs.push(`Measure ${m + 1}: part count ${origMeasure.parts.length} vs ${rtMeasure.parts.length}`);
			continue;
		}

		// Compare each part
		for (let p = 0; p < origMeasure.parts.length; p++) {
			const origPart = origMeasure.parts[p];
			const rtPart = rtMeasure.parts[p];

			// Compare voice count
			if (origPart.voices.length !== rtPart.voices.length) {
				diffs.push(`Measure ${m + 1}, Part ${p + 1}: voice count ${origPart.voices.length} vs ${rtPart.voices.length}`);
				continue;
			}

			// Compare each voice
			for (let v = 0; v < origPart.voices.length; v++) {
				const origVoice = origPart.voices[v];
				const rtVoice = rtPart.voices[v];

				// Filter out empty context changes (created by \staff command)
				// Also filter key/time context in first measure (from measure properties)
				const isFirstMeasure = m === 0;
				// If original voice was empty, filter space rests from round-trip
				// (they were added to preserve empty measures)
				const origWasEmpty = origVoice.events.length === 0;
				const origEvents = filterEvents(origVoice.events, isFirstMeasure, false);
				const rtEvents = filterEvents(rtVoice.events, isFirstMeasure, origWasEmpty);

				// Compare staff (skip for empty voices - staff number is semantically irrelevant)
				const voiceIsEmpty = origEvents.length === 0 && rtEvents.length === 0;
				if (origVoice.staff !== rtVoice.staff && !voiceIsEmpty) {
					diffs.push(`Measure ${m + 1}, Part ${p + 1}, Voice ${v + 1}: staff ${origVoice.staff} vs ${rtVoice.staff}`);
				}

				// Compare event count
				if (origEvents.length !== rtEvents.length) {
					diffs.push(`Measure ${m + 1}, Part ${p + 1}, Voice ${v + 1}: event count ${origEvents.length} vs ${rtEvents.length}`);
					continue;
				}

				// Compare each event
				for (let e = 0; e < origEvents.length; e++) {
					const origEvent = origEvents[e];
					const rtEvent = rtEvents[e];

					const eventDiffs = compareEvents(origEvent, rtEvent, `M${m + 1}P${p + 1}V${v + 1}E${e + 1}`);
					diffs.push(...eventDiffs);
				}
			}
		}
	}

	return diffs;
};


/**
 * Compare two events
 */
const compareEvents = (orig: Event, rt: Event, location: string): string[] => {
	const diffs: string[] = [];

	// Compare type
	if (orig.type !== rt.type) {
		diffs.push(`${location}: type ${orig.type} vs ${rt.type}`);
		return diffs;
	}

	if (orig.type === 'note' && rt.type === 'note') {
		const origNote = orig as NoteEvent;
		const rtNote = rt as NoteEvent;

		// Compare pitch count
		if (origNote.pitches.length !== rtNote.pitches.length) {
			diffs.push(`${location}: pitch count ${origNote.pitches.length} vs ${rtNote.pitches.length}`);
		} else {
			// Compare each pitch
			for (let i = 0; i < origNote.pitches.length; i++) {
				const origPitch = origNote.pitches[i];
				const rtPitch = rtNote.pitches[i];

				if (origPitch.phonet !== rtPitch.phonet) {
					diffs.push(`${location}: pitch[${i}] phonet ${origPitch.phonet} vs ${rtPitch.phonet}`);
				}
				if (origPitch.octave !== rtPitch.octave) {
					diffs.push(`${location}: pitch[${i}] octave ${origPitch.octave} vs ${rtPitch.octave}`);
				}
				// Compare accidentals (normalize undefined to no accidental)
				const origAcc = origPitch.accidental || null;
				const rtAcc = rtPitch.accidental || null;
				if (origAcc !== rtAcc) {
					diffs.push(`${location}: pitch[${i}] accidental ${origAcc} vs ${rtAcc}`);
				}
			}
		}

		// Compare duration
		if (origNote.duration.division !== rtNote.duration.division) {
			diffs.push(`${location}: duration division ${origNote.duration.division} vs ${rtNote.duration.division}`);
		}
		if (origNote.duration.dots !== rtNote.duration.dots) {
			diffs.push(`${location}: duration dots ${origNote.duration.dots} vs ${rtNote.duration.dots}`);
		}
	}

	if (orig.type === 'rest' && rt.type === 'rest') {
		const origRest = orig as RestEvent;
		const rtRest = rt as RestEvent;

		// Compare duration
		if (origRest.duration.division !== rtRest.duration.division) {
			diffs.push(`${location}: duration division ${origRest.duration.division} vs ${rtRest.duration.division}`);
		}
		if (origRest.duration.dots !== rtRest.duration.dots) {
			diffs.push(`${location}: duration dots ${origRest.duration.dots} vs ${rtRest.duration.dots}`);
		}

		// Compare rest type flags
		if (!!origRest.invisible !== !!rtRest.invisible) {
			diffs.push(`${location}: invisible ${origRest.invisible} vs ${rtRest.invisible}`);
		}
		if (!!origRest.fullMeasure !== !!rtRest.fullMeasure) {
			diffs.push(`${location}: fullMeasure ${origRest.fullMeasure} vs ${rtRest.fullMeasure}`);
		}
	}

	return diffs;
};


/**
 * Run round-trip test on a single JSON file
 */
const testRoundTrip = (jsonPath: string): { success: boolean; diffs: string[]; lylLength: number } => {
	// Load original JSON
	const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
	const original: LilyletDoc = JSON.parse(jsonContent);

	// Serialize to .lyl
	const lylContent = serializeLilyletDoc(original);

	// Parse back to LilyletDoc
	const roundTrip = parseCode(lylContent);

	// Compare
	const diffs = compareDocs(original, roundTrip);

	return {
		success: diffs.length === 0,
		diffs,
		lylLength: lylContent.length,
	};
};


const main = async () => {
	console.log(`Round-trip test: JSON -> .lyl -> JSON`);
	console.log(`JSON directory: ${JSON_DIR}\n`);

	// Find JSON files (exclude _summary.json)
	let jsonFiles = fs.readdirSync(JSON_DIR)
		.filter(f => f.endsWith('.json') && !f.startsWith('_'))
		.map(f => path.join(JSON_DIR, f));

	if (MAX_FILES > 0) {
		jsonFiles = jsonFiles.slice(0, MAX_FILES);
	}

	console.log(`Found ${jsonFiles.length} JSON files to test\n`);

	let passed = 0;
	let failed = 0;
	const failures: { file: string; diffs: string[] }[] = [];

	for (let i = 0; i < jsonFiles.length; i++) {
		const jsonPath = jsonFiles[i];
		const filename = path.basename(jsonPath);

		try {
			const result = testRoundTrip(jsonPath);

			if (result.success) {
				console.log(`[${i + 1}/${jsonFiles.length}] ✓ ${filename} (${result.lylLength} chars)`);
				passed++;
			} else {
				console.log(`[${i + 1}/${jsonFiles.length}] ✗ ${filename} (${result.diffs.length} diffs)`);
				failed++;
				failures.push({ file: filename, diffs: result.diffs.slice(0, 5) }); // Keep first 5 diffs
			}
		} catch (e) {
			console.log(`[${i + 1}/${jsonFiles.length}] ✗ ${filename}: ${(e as Error).message.slice(0, 80)}`);
			failed++;
			failures.push({ file: filename, diffs: [(e as Error).message.slice(0, 200)] });
		}
	}

	console.log('\n========================================');
	console.log(`Total: ${jsonFiles.length}, Passed: ${passed}, Failed: ${failed}`);

	// Show failure details
	if (failures.length > 0) {
		console.log('\n--- Failure Details (first 10) ---');
		for (const f of failures.slice(0, 10)) {
			console.log(`\n${f.file}:`);
			for (const diff of f.diffs) {
				console.log(`  - ${diff}`);
			}
		}
	}

	// Exit with error code if there are failures
	process.exit(failed > 0 ? 1 : 0);
};


main().catch(console.error);
