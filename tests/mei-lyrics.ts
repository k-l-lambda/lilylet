import fs from "fs";
import path from "path";
import { DOMParser } from "@xmldom/xmldom";
import * as lilylet from "../source/lilylet";

const dir = path.join(process.cwd(), "tests/assets/unit-cases");
const files = fs.readdirSync(dir).filter((f) => f.startsWith("lyrics-") && f.endsWith(".lyl")).sort();
let failed = 0;

for (const file of files) {
	const doc = lilylet.parseCode(fs.readFileSync(path.join(dir, file), "utf8"));
	const mei = lilylet.meiEncoder.encode(doc);
	const parsed = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } }).parseFromString(mei, "application/xml");
	const verses = parsed.getElementsByTagName("verse");
	const syllables = parsed.getElementsByTagName("syl");
	const parserError = parsed.getElementsByTagName("parsererror");
	if (parserError.length || syllables.length === 0) {
		console.error(`✗ ${file}: invalid MEI or no lyrics (${syllables.length} syllables)`);
		failed++;
	} else {
		console.log(`✓ ${file}: ${verses.length} verses, ${syllables.length} syllables`);
	}
}

if (failed) process.exit(1);
console.log(`\nMEI lyric tests: ${files.length} passed`);
