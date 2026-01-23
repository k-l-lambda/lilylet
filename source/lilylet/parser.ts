
import { LilyletDoc, Pitch, NoteEvent } from "./types";


const PHONETS = "cdefgab";

interface PitchEnv {
	step: number;  // 0-6 for c-b
	octave: number; // absolute octave (0 = middle C octave)
}


/**
 * Resolve relative pitch to absolute octave.
 *
 * In LilyPond relative mode:
 * - The base pitch starts at middle C (step=0, octave=0)
 * - For each note, the interval is calculated from the previous pitch
 * - If |interval| > 3 (more than a 4th), the octave is adjusted to find nearest pitch
 * - Explicit ' and , markers add/subtract octaves from this calculated position
 *
 * Example: c to g = interval +4, so we go DOWN a 4th (octave -1) instead of up a 5th
 *          c to f = interval +3, so we go UP a 4th (same octave)
 */
const resolveRelativePitch = (env: PitchEnv, pitch: Pitch): void => {
	const step = PHONETS.indexOf(pitch.phonet);
	const interval = step - env.step;

	// Calculate octave adjustment based on interval
	// If interval > 3, go down instead of up (e.g., c to g is down a 4th)
	// If interval < -3, go up instead of down (e.g., g to c is up a 4th)
	const octInc = Math.floor(Math.abs(interval) / 4) * -Math.sign(interval);

	// Update environment and pitch
	// pitch.octave contains the explicit ' and , markers from parsing
	env.octave += pitch.octave + octInc;
	env.step = step;

	// Store absolute octave back in pitch
	pitch.octave = env.octave;
};


/**
 * Process all pitches in a document to resolve relative pitch mode.
 *
 * For each measure:
 * - Start with middle C as base (step=0, octave=0)
 * - Process each note/chord sequentially
 * - For chords: use first pitch of previous chord as base for current chord's first pitch
 *               within chord, each pitch is relative to the previous
 */
const resolveDocumentPitches = (doc: LilyletDoc): void => {
	for (const measure of doc.measures) {
		// Reset to middle C at start of each measure
		const env: PitchEnv = { step: 0, octave: 0 };

		for (const voice of measure.voices) {
			// Each voice in a measure starts fresh from middle C
			env.step = 0;
			env.octave = 0;

			for (const event of voice.events) {
				if (event.type === 'note') {
					const noteEvent = event as NoteEvent;
					const pitches = noteEvent.pitches;

					if (pitches.length > 0) {
						// First pitch is relative to previous note/chord's first pitch
						resolveRelativePitch(env, pitches[0]);

						// For chord: subsequent pitches are relative to each other
						if (pitches.length > 1) {
							const chordEnv: PitchEnv = { step: env.step, octave: env.octave };
							for (let i = 1; i < pitches.length; i++) {
								resolveRelativePitch(chordEnv, pitches[i]);
							}
						}

						// Base for next note is first pitch of this chord
						// env already updated by first resolveRelativePitch call
					}
				} else if (event.type === 'tuplet') {
					// Process tuplet events
					for (const tupletEvent of event.events) {
						if (tupletEvent.type === 'note') {
							const pitches = tupletEvent.pitches;
							if (pitches.length > 0) {
								resolveRelativePitch(env, pitches[0]);
								if (pitches.length > 1) {
									const chordEnv: PitchEnv = { step: env.step, octave: env.octave };
									for (let i = 1; i < pitches.length; i++) {
										resolveRelativePitch(chordEnv, pitches[i]);
									}
								}
							}
						}
					}
				} else if (event.type === 'tremolo') {
					// Process tremolo pitches
					if (event.pitchA.length > 0) {
						resolveRelativePitch(env, event.pitchA[0]);
						if (event.pitchA.length > 1) {
							const chordEnv: PitchEnv = { step: env.step, octave: env.octave };
							for (let i = 1; i < event.pitchA.length; i++) {
								resolveRelativePitch(chordEnv, event.pitchA[i]);
							}
						}
					}
					if (event.pitchB.length > 0) {
						resolveRelativePitch(env, event.pitchB[0]);
						if (event.pitchB.length > 1) {
							const chordEnv: PitchEnv = { step: env.step, octave: env.octave };
							for (let i = 1; i < event.pitchB.length; i++) {
								resolveRelativePitch(chordEnv, event.pitchB[i]);
							}
						}
					}
				}
			}
		}
	}
};


const parseCode = async (code: string): Promise<LilyletDoc> => {
	const grammar = await import("./grammar.jison.js");

	// Reset parser state before each parse to avoid contamination
	if (grammar.parser && grammar.parser.resetState) {
		grammar.parser.resetState();
	}

	const raw = grammar.parse(code);

	// Resolve relative pitch mode
	resolveDocumentPitches(raw);

	return raw;
};



export {
	parseCode,
};
