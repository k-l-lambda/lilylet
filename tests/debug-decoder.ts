import { decode } from "../source/lilylet/lilypondDecoder.js";
import * as fs from "fs";

const ly = fs.readFileSync("tests/output/lilypond-roundtrip/time-signatures-3-4-time.ly", "utf-8");
const doc = decode(ly);
console.log(JSON.stringify(doc, null, 2));
