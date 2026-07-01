/**
 * Note-onset extraction from a parsed Lilylet document.
 *
 * Walks measures -> parts -> voices -> events, accumulating each note's ONSET (position
 * within its measure, in duration units where DIVISIONS=4 per quarter) and its SOUNDING
 * MIDI pitch. Sounding pitch honors octave-/interval-transposing clefs ("treble_8" sounds
 * an octave lower than written, etc.), tracked per voice and PERSISTED across measures.
 *
 * Shared by tools/astServer.ts (the HTTP onset API) and the clef-onset unit test.
 */

import { calculateDuration, DIVISIONS } from "./musicXmlUtils";
import { Accidental } from "./types";

const PHONET_SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACCIDENTAL_SEMITONE: Record<string, number> = {
	[Accidental.natural]: 0, [Accidental.sharp]: 1, [Accidental.flat]: -1,
	[Accidental.doubleSharp]: 2, [Accidental.doubleFlat]: -2,
};

// Diatonic-step -> semitones within an octave (unison..seventh), for "_N"/"^N" clef suffixes.
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * The written->sounding semitone shift a clef string declares. Per the LilyPond convention a
 * "_N"/"^N" suffix transposes DOWN/UP by the diatonic interval N: "treble_8" = octave down
 * (-12), "treble^8" = +12, "treble_15" = two octaves down (-24), "treble_5" = fifth down (-7).
 * A plain clef (no suffix) declares 0.
 */
export const clefShift = (clefStr: string): number => {
	const m = /^.*?([_^])(\d+)$/.exec(clefStr || "");
	if (!m) return 0;
	const k = parseInt(m[2], 10) - 1;					// diatonic steps above unison
	const semis = DIATONIC_SEMITONES[k % 7] + 12 * Math.floor(k / 7);
	return (m[1] === "^" ? 1 : -1) * semis;
};

/**
 * Sounding MIDI pitch of a resolved (absolute-octave) Lilylet pitch. Octave 0 = middle-C
 * octave = MIDI 60 (see parser.resolveRelativePitch). `shift` is the active clef's
 * written->sounding semitone transposition.
 */
export const pitchToMidi = (pitch: any, shift = 0): number => {
	const semi = PHONET_SEMITONE[pitch.phonet] ?? 0;
	const acc = pitch.accidental ? (ACCIDENTAL_SEMITONE[pitch.accidental] ?? 0) : 0;
	return 60 + (pitch.octave || 0) * 12 + semi + acc + shift;
};

export interface NoteOnset {
	onset: number; onsetNorm: number; durationDiv: number;
	midi: number[]; staff: number; voice: number; grace: boolean;
}

export interface MeasureOnsets {
	index: number;
	timeSig: { numerator: number; denominator: number } | null;
	measureDivisions: number;
	notes: NoteOnset[];
}

// Walk a voice's events, accumulating onset in duration units. Tuplet/times scale their inner
// durations by ratio (num/den). Grace notes take no time. `clefRef.shift` is the active clef's
// written->sounding shift, updated by \clef contextChanges (persisted by the caller across
// measures). Returns the total consumed duration (the voice's played length).
const walkVoice = (events: any[], staff: number, voice: number,
	scale: number, startCursor: number, clefRef: { shift: number }, out: NoteOnset[]): number => {
	let cursor = startCursor;
	for (const ev of events) {
		if (ev.type === "context" && typeof ev.clef === "string") {
			clefRef.shift = clefShift(ev.clef);
		}
		else if (ev.type === "note") {
			const dur = calculateDuration(ev.duration) * scale;
			const midi = (ev.pitches || []).map((p: any) => pitchToMidi(p, clefRef.shift));
			if (ev.grace) {
				out.push({ onset: cursor, onsetNorm: 0, durationDiv: 0, midi, staff: ev.staff ?? staff, voice, grace: true });
				continue; // grace steals no measure time
			}
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: dur, midi, staff: ev.staff ?? staff, voice, grace: false });
			cursor += dur;
		}
		else if (ev.type === "rest") {
			cursor += calculateDuration(ev.duration) * scale;
		}
		else if (ev.type === "tuplet" || ev.type === "times") {
			const r = ev.ratio || { numerator: 1, denominator: 1 };
			cursor = walkVoice(ev.events || [], staff, voice, scale * (r.numerator / r.denominator), cursor, clefRef, out);
		}
		else if (ev.type === "tremolo") {
			const each = (DIVISIONS * 4 / ev.division) * scale;
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: each,
				midi: (ev.pitchA || []).map((p: any) => pitchToMidi(p, clefRef.shift)), staff, voice, grace: false });
			cursor += each;
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: each,
				midi: (ev.pitchB || []).map((p: any) => pitchToMidi(p, clefRef.shift)), staff, voice, grace: false });
			cursor += each;
		}
		// barline / markup / dynamic / harmony / pitchReset: no time
	}
	return cursor;
};

/**
 * Per-measure note onsets for a parsed LilyletDoc. The active clef transposition is tracked
 * per (positional) voice index and PERSISTS across measures — a \clef stays in force until the
 * next one, so a "treble_8" set in measure 1 still lowers measure 2 by an octave.
 */
export const measureOnsets = (doc: any): MeasureOnsets[] => {
	let curTime: any = null;
	const clefByVoice: { shift: number }[] = [];
	return (doc.measures || []).map((m: any, mi: number): MeasureOnsets => {
		if (m.timeSig) curTime = m.timeSig;
		const notes: NoteOnset[] = [];
		let maxCursor = 0;
		let vIndex = 0;
		for (const part of m.parts || []) {
			for (const voice of part.voices || []) {
				if (!clefByVoice[vIndex]) clefByVoice[vIndex] = { shift: 0 };
				const end = walkVoice(voice.events || [], voice.staff ?? 1, vIndex, 1, 0, clefByVoice[vIndex], notes);
				maxCursor = Math.max(maxCursor, end);
				vIndex += 1;
			}
		}
		const barDiv = curTime ? DIVISIONS * 4 * curTime.numerator / curTime.denominator : maxCursor;
		const span = barDiv > 0 ? barDiv : (maxCursor > 0 ? maxCursor : 1);
		for (const n of notes)
			n.onsetNorm = n.onset / span;
		return {
			index: mi + 1,
			timeSig: curTime ? { numerator: curTime.numerator, denominator: curTime.denominator } : null,
			measureDivisions: span,
			notes,
		};
	});
};
