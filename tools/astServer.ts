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
import { measureOnsets } from "../source/lilylet/onsets";

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
