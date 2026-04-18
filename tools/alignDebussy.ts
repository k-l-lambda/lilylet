/**
 * Align debussy--Ste_Bergamesq_Clair.lyl (new, correct pitch, 81 measures)
 * into debussy--debussy_Ste_Bergamesq_Clair.lyl (reference, correct structure, 72 measures).
 *
 * Strategy:
 * 1. Parse both files into LilyletDoc
 * 2. For each reference measure, find best-matching new measure by phonet overlap
 * 3. For each reference voice within that measure, find best-matching new voice
 * 4. Replace pitch content (note/rest/tuplet events) in reference voice with new voice events
 * 5. Write the merged result
 */

import { parseCode, serializeLilyletDoc } from '../source/lilylet/index.js';
import type { LilyletDoc, Measure, Voice, Event, NoteEvent, RestEvent, TupletEvent, TimesEvent } from '../source/lilylet/types.js';
import * as fs from 'fs';

// ─── helpers ─────────────────────────────────────────────────────────────────

function getPitchEvents(events: Event[]): (NoteEvent | RestEvent)[] {
	const result: (NoteEvent | RestEvent)[] = [];
	for (const e of events) {
		if (e.type === 'note' || e.type === 'rest') result.push(e as NoteEvent | RestEvent);
		else if (e.type === 'tuplet' || e.type === 'times') {
			for (const inner of (e as TupletEvent).events) result.push(inner);
		}
	}
	return result;
}

function getPhonets(events: Event[]): string[] {
	return getPitchEvents(events)
		.flatMap(e => e.type === 'note' ? (e as NoteEvent).pitches.map(p => p.phonet) : []);
}

function phonetOverlap(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 1;
	if (a.length === 0 || b.length === 0) return 0;
	const map = new Map<string, number>();
	for (const p of a) map.set(p, (map.get(p) || 0) + 1);
	let matches = 0;
	for (const p of b) {
		const c = map.get(p) || 0;
		if (c > 0) { matches++; map.set(p, c - 1); }
	}
	return matches / Math.max(a.length, b.length);
}

function getMusicEvents(events: Event[]): Event[] {
	return events.filter(e =>
		e.type === 'note' || e.type === 'rest' || e.type === 'tuplet' ||
		e.type === 'times' || e.type === 'tremolo' || e.type === 'barline'
	);
}

function getNonMusicEvents(events: Event[]): Event[] {
	return events.filter(e =>
		e.type === 'context' || e.type === 'pitchReset'
	);
}

// ─── load files ──────────────────────────────────────────────────────────────

const refSrc = fs.readFileSync('/home/camus/work/lilypond-scores/lilylet/debussy--debussy_Ste_Bergamesq_Clair.lyl', 'utf-8');
const newSrc = fs.readFileSync('/home/camus/work/lilypond-scores/lilylet/debussy--Ste_Bergamesq_Clair.lyl', 'utf-8');

const refDoc = parseCode(refSrc);
const newDoc = parseCode(newSrc);

console.log(`Ref: ${refDoc.measures.length} measures`);
console.log(`New: ${newDoc.measures.length} measures`);

// ─── build measure-level phonet lists ────────────────────────────────────────

function measurePhonets(m: Measure): string[] {
	return m.parts.flatMap(p => p.voices.flatMap(v => getPhonets(v.events)));
}

const refPh = refDoc.measures.map(measurePhonets);
const newPh = newDoc.measures.map(measurePhonets);

// ─── DP measure alignment (global optimal) ────────────────────────────────────
// Score matrix: s[ri][ni] = phonetOverlap(refPh[ri], newPh[ni])
// DP: find monotone matching that maximizes total score

const R = refDoc.measures.length;
const N = newDoc.measures.length;

// Build score matrix
const scores: number[][] = [];
for (let ri = 0; ri < R; ri++) {
	scores[ri] = [];
	for (let ni = 0; ni < N; ni++) {
		scores[ri][ni] = refPh[ri].length === 0 ? 0 : phonetOverlap(refPh[ri], newPh[ni]);
	}
}

// DP: dp[ri][ni] = best total score matching ref[0..ri] to some subset of new[0..ni]
// allowing 1:1 monotone matching (each ref measure maps to exactly one new measure)
// skipping new measures is free
const dp: number[][] = Array.from({ length: R }, () => new Array(N).fill(-Infinity));
const from: Array<Array<[number, number] | null>> = Array.from({ length: R }, () => new Array(N).fill(null));

for (let ri = 0; ri < R; ri++) {
	for (let ni = 0; ni < N; ni++) {
		const s = scores[ri][ni];
		if (ri === 0) {
			dp[ri][ni] = s;
		} else {
			// best prev: dp[ri-1][ni'] for any ni' < ni
			let best = -Infinity;
			let bestPrev = -1;
			for (let ni2 = 0; ni2 < ni; ni2++) {
				if (dp[ri-1][ni2] > best) { best = dp[ri-1][ni2]; bestPrev = ni2; }
			}
			dp[ri][ni] = (best === -Infinity ? 0 : best) + s;
			if (bestPrev >= 0) from[ri][ni] = [ri-1, bestPrev];
		}
	}
}

// Find best ending in last ref row
let bestTotalNi = 0;
for (let ni = 1; ni < N; ni++) {
	if (dp[R-1][ni] > dp[R-1][bestTotalNi]) bestTotalNi = ni;
}

// Traceback
const path: number[] = new Array(R).fill(-1);
let cur: [number, number] = [R-1, bestTotalNi];
while (cur[0] >= 0) {
	path[cur[0]] = cur[1];
	const prev = from[cur[0]][cur[1]];
	if (!prev) break;
	cur = prev;
}
// fill any gaps forward
for (let ri = 0; ri < R; ri++) {
	if (path[ri] < 0) path[ri] = ri < R-1 ? path[ri+1] ?? 0 : N-1;
}

const measureMap = new Map<number, number>();
const log: string[] = [];
for (let ri = 0; ri < R; ri++) {
	const ni = path[ri];
	if (refPh[ri].length === 0) { log.push(`R${ri+1}: empty`); continue; }
	measureMap.set(ri, ni);
	log.push(`R${ri+1}(${refPh[ri].length}) → N${ni+1}(${newPh[ni]?.length}) score=${scores[ri][ni].toFixed(2)}`);
}

console.log('\nMeasure alignment:');
console.log(log.join('\n'));

// ─── for each ref measure, map voices ────────────────────────────────────────

function voicePhonets(v: Voice): string[] {
	return getPhonets(v.events);
}

// Build merged doc: start from ref structure, replace music events with new
const merged: LilyletDoc = JSON.parse(JSON.stringify(refDoc)); // deep clone

let replacedMeasures = 0, failedMeasures = 0;

for (let ri = 0; ri < refDoc.measures.length; ri++) {
	const newIdx = measureMap.get(ri);
	if (newIdx === undefined) continue;

	const refMeasure = refDoc.measures[ri];
	const newMeasure = newDoc.measures[newIdx];
	const mergedMeasure = merged.measures[ri];

	// For each part in ref
	for (let pi = 0; pi < refMeasure.parts.length; pi++) {
		const refPart = refMeasure.parts[pi];
		const newPart = newMeasure.parts[pi] ?? newMeasure.parts[0];
		if (!newPart) continue;

		// Collect new voices, track which have been used
		const allNewVoices = newMeasure.parts.flatMap(p => p.voices);
		const usedNewVoices = new Set<number>();

		// For each staff, find which ref voice has the MOST notes.
		// Only replace that primary voice per staff; others are spacers/secondary.
		const noteCountByStaff = new Map<number, { vi: number; count: number }>();
		for (let vi = 0; vi < refPart.voices.length; vi++) {
			const refVoice = refPart.voices[vi];
			const staff = refVoice.staff;
			const cnt = (getPitchEvents(refVoice.events).filter(e => e.type === 'note') as NoteEvent[]).length;
			const prev = noteCountByStaff.get(staff);
			if (!prev || cnt > prev.count) noteCountByStaff.set(staff, { vi, count: cnt });
		}

		// Replace only the primary voice per staff
		for (const [staff, { vi, count }] of noteCountByStaff) {
			if (count === 0) continue; // no notes on this staff at all

			const refVoice = refPart.voices[vi];
			const refNotes = getPitchEvents(refVoice.events).filter(e => e.type === 'note') as NoteEvent[];
			const refVPh = refNotes.flatMap(n => n.pitches.map(p => p.phonet));

			// Find best unused new voice for this staff
			let bestScore = -1, bestNvi = -1;
			for (let nvi = 0; nvi < allNewVoices.length; nvi++) {
				if (usedNewVoices.has(nvi)) continue;
				const nv = allNewVoices[nvi];
				const staffBonus = nv.staff === staff ? 0.15 : 0;
				const score = phonetOverlap(refVPh, voicePhonets(nv)) + staffBonus;
				if (score > bestScore) { bestScore = score; bestNvi = nvi; }
			}

			if (bestNvi < 0 || bestScore < 0.1) continue;
			usedNewVoices.add(bestNvi);

			const newNotes = getPitchEvents(allNewVoices[bestNvi].events).filter(e => e.type === 'note') as NoteEvent[];
			if (newNotes.length === 0) continue;

			// Substitute pitches position-by-position
			let newNi = 0;
			for (const refNote of refNotes) {
				if (newNi >= newNotes.length) break;
				const newNote = newNotes[newNi++];
				refNote.pitches = newNote.pitches.map(np => ({
					phonet: np.phonet,
					octave: np.octave,
					...(np.accidental ? { accidental: np.accidental } : {}),
				}));
			}
			replacedMeasures++;
		}
	}
}

console.log(`\nReplaced: ${replacedMeasures} voices, failed: ${failedMeasures}`);

// ─── post-process merged doc ──────────────────────────────────────────────────

// 1. Remove voices that contain only spacer rests (invisible=true) and context events
const isSpacerOnlyVoice = (v: Voice): boolean =>
	v.events.every(e =>
		e.type === 'context' || e.type === 'pitchReset' ||
		(e.type === 'rest' && (e as RestEvent).invisible === true)
	);

for (const m of merged.measures) {
	for (const p of m.parts) {
		p.voices = p.voices.filter(v => !isSpacerOnlyVoice(v));
	}
	// Remove parts with no voices
	m.parts = m.parts.filter(p => p.voices.length > 0);
}

// 2. Remove trailing empty measures (no note/rest content)
while (merged.measures.length > 0) {
	const last = merged.measures[merged.measures.length - 1];
	const hasContent = last.parts.some(p =>
		p.voices.some(v =>
			v.events.some(e => e.type === 'note' || e.type === 'rest')
		)
	);
	if (!hasContent) merged.measures.pop();
	else break;
}

// ─── serialize ────────────────────────────────────────────────────────────────

const output = serializeLilyletDoc(merged);
fs.writeFileSync('/home/camus/work/lilypond-scores/lilylet/debussy--Ste_Bergamesq_Clair.lyl', output);
console.log('Written to debussy--Ste_Bergamesq_Clair.lyl');
console.log('Lines:', output.split('\n').length);
