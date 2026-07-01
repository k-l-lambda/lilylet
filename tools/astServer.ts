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
const pitchToMidi = (pitch: any): number => {
	const semi = PHONET_SEMITONE[pitch.phonet] ?? 0;
	const acc = pitch.accidental ? (ACCIDENTAL_SEMITONE[pitch.accidental] ?? 0) : 0;
	return 60 + (pitch.octave || 0) * 12 + semi + acc;
};

interface NoteOnset {
	onset: number; onsetNorm: number; durationDiv: number;
	midi: number[]; staff: number; voice: number; grace: boolean;
}

// Walk a voice's events, accumulating onset in duration units. Tuplet/times scale their
// inner durations by ratio (num/den). Grace notes take no time (onset frozen). Returns the
// note onsets and the total consumed duration (the voice's played length).
const walkVoice = (events: any[], staff: number, voice: number,
	scale: number, startCursor: number, out: NoteOnset[]): number => {
	let cursor = startCursor;
	for (const ev of events) {
		if (ev.type === "note") {
			const dur = calculateDuration(ev.duration) * scale;
			if (ev.grace) {
				out.push({ onset: cursor, onsetNorm: 0, durationDiv: 0,
					midi: (ev.pitches || []).map(pitchToMidi), staff: ev.staff ?? staff, voice, grace: true });
				continue; // grace steals no measure time
			}
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: dur,
				midi: (ev.pitches || []).map(pitchToMidi), staff: ev.staff ?? staff, voice, grace: false });
			cursor += dur;
		}
		else if (ev.type === "rest") {
			cursor += calculateDuration(ev.duration) * scale;
		}
		else if (ev.type === "tuplet" || ev.type === "times") {
			const r = ev.ratio || { numerator: 1, denominator: 1 };
			cursor = walkVoice(ev.events || [], staff, voice, scale * (r.numerator / r.denominator), cursor, out);
		}
		else if (ev.type === "tremolo") {
			// tremolo occupies the two written note values (pitchA/pitchB each a division note)
			const each = (DIVISIONS * 4 / ev.division) * scale;
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: each,
				midi: (ev.pitchA || []).map(pitchToMidi), staff, voice, grace: false });
			cursor += each;
			out.push({ onset: cursor, onsetNorm: 0, durationDiv: each,
				midi: (ev.pitchB || []).map(pitchToMidi), staff, voice, grace: false });
			cursor += each;
		}
		// context / barline / markup / dynamic / harmony / pitchReset: no time
	}
	return cursor;
};

const measureOnsets = (doc: any): any[] => {
	let curTime: any = null;
	return (doc.measures || []).map((m: any, mi: number) => {
		if (m.timeSig) curTime = m.timeSig;
		const notes: NoteOnset[] = [];
		let maxCursor = 0;
		let vIndex = 0;
		for (const part of m.parts || []) {
			for (const voice of part.voices || []) {
				const end = walkVoice(voice.events || [], voice.staff ?? 1, vIndex, 1, 0, notes);
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
