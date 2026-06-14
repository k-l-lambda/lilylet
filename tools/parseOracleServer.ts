/**
 * Lilylet parse oracle — line-delimited JSON over stdin/stdout.
 *
 * Wraps parseCode so a long-lived external process (e.g. an autoregressive
 * sampler) can probe whether a Lilylet text prefix is syntactically valid, and
 * — when not — whether the failure is a benign "incomplete input" (EOF) or a
 * real "this token is not allowed here" violation.
 *
 * Run via tsx:
 *   npx tsx tools/parseOracleServer.ts
 *
 * Protocol (one JSON object per line, both directions):
 *   in :  {"code": "<lilylet text>"}
 *   out:  {"ok": true}                                          parse succeeded
 *   out:  {"ok": false, "eof": <bool>, "token": "<terminal>",   parse failed
 *          "text": "<matched text>", "expected": [...],
 *          "message": "<first lines of jison error>"}
 *
 * `eof === true` means the parser ran out of input while still expecting more (a
 * valid-so-far prefix); jison sets hash.token === 'EOF' (or an empty hash.text).
 * Anything else is a token the grammar rejects at that position. We do NOT trust
 * hash.loc — jison's yylloc lags by a token; callers localize the offending
 * token themselves by incremental append.
 */

import readline from "node:readline";

import { parseCode } from "../source/lilylet";


interface OracleResult {
	ok: boolean;
	eof?: boolean;
	token?: string | null;
	text?: string | null;
	expected?: string[];
	message?: string;
}


const check = (code: string): OracleResult => {
	try {
		parseCode(code);
		return { ok: true };
	}
	catch (e) {
		const hash = (e as any)?.hash ?? null;
		const token = hash ? hash.token : undefined;
		const text = hash ? hash.text : undefined;
		// EOF: parser exhausted input mid-rule. jison reports token 'EOF' (numeric
		// id 1) or an empty matched text — either marks a still-valid, merely
		// incomplete prefix rather than a disallowed token.
		const eof = token === "EOF" || token === 1 || text === "" || text == null;
		const message = String((e as any)?.message ?? e).split("\n").slice(0, 3).join("\n");

		return {
			ok: false,
			eof,
			token: token != null ? String(token) : null,
			text: text != null ? String(text) : null,
			expected: hash && Array.isArray(hash.expected) ? hash.expected : [],
			message,
		};
	}
};


const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line: string) => {
	line = line.trim();
	if (!line)
		return;

	let res: OracleResult;
	try {
		const req = JSON.parse(line);
		res = check(typeof req.code === "string" ? req.code : "");
	}
	catch (err) {
		// malformed request line — report as a protocol error, never crash the server
		res = {
			ok: false,
			eof: false,
			token: null,
			text: null,
			expected: [],
			message: "bad request: " + String((err as any)?.message ?? err),
		};
	}

	process.stdout.write(JSON.stringify(res) + "\n");
});

rl.on("close", () => process.exit(0));
