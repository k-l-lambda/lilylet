/**
 * Lilylet AST / onset HTTP API server.
 *
 * A long-lived HTTP service that parses Lilylet source into its AST and returns, per
 * measure, the note ONSETS (position within the measure) with MIDI pitch and staff/voice.
 * Onset math lives here (TypeScript) because the AST + duration utilities do — a caller
 * (e.g. a Python notebook) posts Lilylet text and gets back structured onsets, avoiding a
 * re-implementation of duration/tuplet/pitch arithmetic on the other side.
 *
 * Run via tsx:
 *   npx tsx tools/astServer.ts --port 8788
 *
 * Endpoints (JSON):
 *   GET  /health                       -> {"ok": true}
 *   POST /ast    {"code": "<lilylet>"} -> {"ok": true, "ast": <LilyletDoc>}
 *   POST /onsets {"code": "<lilylet>"} -> {"ok": true, "measures": [ MeasureOnsets, ... ]}
 *
 * MeasureOnsets = {
 *   index: number,                 // 1-based measure number
 *   timeSig: {numerator, denominator} | null,
 *   measureDivisions: number,      // total duration units in the measure (bar length)
 *   notes: [ {
 *     onset: number,               // duration units from the barline (DIVISIONS=4 per quarter)
 *     onsetNorm: number,           // onset / measureDivisions  (0..1 within the measure)
 *     durationDiv: number,         // the note's own duration in units
 *     midi: number[],              // MIDI pitch number(s) of the note/chord
 *     staff: number, voice: number,
 *     grace: boolean,
 *   }, ... ]
 * }
 *
 * On a parse error: {"ok": false, "error": "<message>"} with HTTP 400.
 */

import http from "node:http";

import { parseCode } from "../source/lilylet";
import { calculateDuration, DIVISIONS } from "../source/lilylet/musicXmlUtils";
import { Accidental } from "../source/lilylet/types";

const PHONET_SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACCIDENTAL_SEMITONE: Record<string, number> = {
	[Accidental.natural]: 0, [Accidental.sharp]: 1, [Accidental.flat]: -1,
	[Accidental.doubleSharp]: 2, [Accidental.doubleFlat]: -2,
};

// Absolute octave 0 == middle-C octave == MIDI 60 (see parser.resolveRelativePitch).
// `shift` is the written->sounding semitone transposition of the active clef (e.g. a
// "treble_8" clef sounds an octave lower than written, so shift = -12).
const pitchToMidi = (pitch: any, shift = 0): number => {
	const semi = PHONET_SEMITONE[pitch.phonet] ?? 0;
	const acc = pitch.accidental ? (ACCIDENTAL_SEMITONE[pitch.accidental] ?? 0) : 0;
	return 60 + (pitch.octave || 0) * 12 + semi + acc + shift;
};

// Diatonic-step -> semitones within an octave (unison..seventh), for "_N"/"^N" clef suffixes.
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// The written->sounding semitone shift a clef string declares. Per LilyPond convention a
// "_N"/"^N" suffix transposes DOWN/UP by the diatonic interval N ("treble_8" = octave down
// = -12, "treble^8" = +12, "treble_15" = two octaves down). A plain clef declares 0.
const clefShift = (clefStr: string): number => {
	const m = /^.*?([_^])(\d+)$/.exec(clefStr || "");
	if (!m) return 0;
	const k = parseInt(m[2], 10) - 1;					// diatonic steps above unison
	const semis = DIATONIC_SEMITONES[k % 7] + 12 * Math.floor(k / 7);
	return (m[1] === "^" ? 1 : -1) * semis;
};

interface NoteOnset {
	onset: number; onsetNorm: number; durationDiv: number;
	midi: number[]; staff: number; voice: number; grace: boolean;
}

// Walk a voice's events, accumulating onset in duration units. Tuplet/times scale their
// inner durations by ratio (num/den). Grace notes take no time (onset frozen). `clefRef`
// holds the active clef's written->sounding shift, updated by \clef contextChanges and
// PERSISTED across measures (a clef stays in force until the next \clef). Returns the total
// consumed duration (the voice's played length).
const walkVoice = (events: any[], staff: number, voice: number,
	scale: number, startCursor: number, clefRef: { shift: number }, out: NoteOnset[]): number => {
	let cursor = startCursor;
	for (const ev of events) {
		if (ev.type === "context" && typeof ev.clef === "string") {
			clefRef.shift = clefShift(ev.clef);
		}
		else if (ev.type === "note") {
			const dur = calculateDuration(ev.duration) * scale;
			if (ev.grace) {
				out.push({ onset: cursor, onsetNorm: 0, durationDiv: 0,
					midi: (ev.pitches || []).map((p: any) => pitchToMidi(p, clefRef.shift)), staff: ev.staff ?? staff, voice, grace: true });
				continue; // grace steals no measure time
			}
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: dur,
				midi: (ev.pitches || []).map((p: any) => pitchToMidi(p, clefRef.shift)), staff: ev.staff ?? staff, voice, grace: false });
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
			// tremolo occupies the two written note values (pitchA/pitchB each a division note)
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

const measureOnsets = (doc: any): any[] => {
	let curTime: any = null;
	// active clef shift PER voice index, persisted across measures (a \clef stays in force
	// until the next one). SATB-style scores keep a stable voice order, so the positional
	// voice index is a reliable key.
	const clefByVoice: { shift: number }[] = [];
	return (doc.measures || []).map((m: any, mi: number) => {
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
		// measure length: prefer the time signature (numerator/denominator whole-notes), else
		// the longest voice cursor (handles pickup / unmetered).
		const barDiv = curTime
			? DIVISIONS * 4 * curTime.numerator / curTime.denominator
			: maxCursor;
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

const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
	let data = "";
	req.on("data", (c) => { data += c; if (data.length > 32 * 1024 * 1024) reject(new Error("body too large")); });
	req.on("end", () => resolve(data));
	req.on("error", reject);
});

const send = (res: http.ServerResponse, code: number, obj: any): void => {
	const body = JSON.stringify(obj);
	res.writeHead(code, { "Content-Type": "application/json" });
	res.end(body);
};

const argPort = ((): number => {
	const i = process.argv.indexOf("--port");
	return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : 8788;
})();

const server = http.createServer(async (req, res) => {
	if (req.method === "GET" && req.url === "/health")
		return send(res, 200, { ok: true });

	if (req.method === "POST" && (req.url === "/ast" || req.url === "/onsets")) {
		let code: string;
		try {
			const body = await readBody(req);
			const req_ = JSON.parse(body || "{}");
			code = typeof req_.code === "string" ? req_.code : "";
		}
		catch (e) {
			return send(res, 400, { ok: false, error: "bad request: " + String((e as any)?.message ?? e) });
		}
		try {
			const doc = parseCode(code);
			if (req.url === "/ast")
				return send(res, 200, { ok: true, ast: doc });
			return send(res, 200, { ok: true, measures: measureOnsets(doc) });
		}
		catch (e) {
			return send(res, 400, { ok: false, error: String((e as any)?.message ?? e).split("\n").slice(0, 3).join("\n") });
		}
	}

	send(res, 404, { ok: false, error: "not found" });
});

server.listen(argPort, () => console.error(`lilylet AST server listening on http://127.0.0.1:${argPort}`));
