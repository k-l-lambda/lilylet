import fs from "fs";
import path from "path";
import { DOMParser } from "@xmldom/xmldom";
import { parseCode, musicXmlEncoder, musicXmlDecoder } from "../source/lilylet/index.js";
import type { LyricLane } from "../source/lilylet/types.js";

const dir = path.join(import.meta.dirname, "assets/unit-cases");
const files = fs.readdirSync(dir).filter(f => f.startsWith("lyrics-") && f.endsWith(".lyl")).sort();
let failed = 0;

const snap = (lanes: LyricLane[] | undefined) => (lanes || []).map(lane => {
	const syllables = lane.syllables.slice();
	while (syllables.length && syllables[syllables.length - 1].skip) syllables.pop();
	return {
		verse: lane.verse,
		syllables: syllables.map(s => ({
			...(s.text !== undefined ? { text: s.text } : {}),
			...(s.hyphen ? { hyphen: true } : {}),
			...(s.skip ? { skip: true } : {}),
			...(s.extend ? { extend: true } : {}),
		})),
	};
});

for (const file of files) {
	try {
		const source = parseCode(fs.readFileSync(path.join(dir, file), "utf8"));
		const xml = musicXmlEncoder.encode(source);
		const parsed = new DOMParser().parseFromString(xml, "application/xml");
		if (parsed.getElementsByTagName("parsererror").length) throw new Error("invalid MusicXML");
		if (parsed.getElementsByTagName("lyric").length === 0) throw new Error("no lyric elements");
		const roundtrip = musicXmlDecoder.decode(xml);
		for (let mi = 0; mi < source.measures.length; mi++) {
			const before = source.measures[mi].parts[0]?.voices || [];
			const after = roundtrip.measures[mi].parts[0]?.voices || [];
			for (let vi = 0; vi < before.length; vi++) {
				const actual = JSON.stringify(snap(after[vi]?.lyrics));
				const expected = JSON.stringify(snap(before[vi]?.lyrics));
				if (actual !== expected) throw new Error(`measure ${mi + 1}, voice ${vi + 1}: ${actual} != ${expected}`);
			}
		}
		console.log(`✓ ${file}: ${parsed.getElementsByTagName("lyric").length} lyrics`);
	} catch (error) {
		failed++;
		console.error(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
	}
}

if (failed) process.exit(1);
console.log(`\nMusicXML lyric tests: ${files.length} passed`);
