import { serializeLilyletDoc } from "../source/lilylet/index.js";
import { decode as decodeLilypond } from "../source/lilylet/lilypondDecoder.js";
import * as fs from "fs";

const file = process.argv[2];
if (!file) {
	console.error("Usage: npx tsx tests/ly-to-lyl.ts <file.ly>");
	process.exit(1);
}

const source = fs.readFileSync(file, "utf-8");
const doc = decodeLilypond(source);
const lyl = serializeLilyletDoc(doc);
console.log(lyl);
