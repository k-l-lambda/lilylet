
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { abcDecoder, parseCode } from "../source/lilylet/index";
import { serializeLilyletDoc } from "../source/lilylet/serializer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_DIR = path.join(__dirname, "assets/abc");
const OUTPUT_DIR = path.join(__dirname, "output/from-abc");


const main = () => {
	const files = fs.readdirSync(ABC_DIR).filter(f => f.endsWith(".abc")).sort();
	console.log(`Found ${files.length} ABC files\n`);

	// Ensure output directory exists
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	let pass = 0;
	let fail = 0;
	const errors: { file: string; error: string }[] = [];

	for (const file of files) {
		const filePath = path.join(ABC_DIR, file);
		const baseName = path.basename(file, ".abc");

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const doc = abcDecoder.decode(content);

			if (!doc.measures || doc.measures.length === 0) {
				throw new Error("No measures produced");
			}

			// Write JSON output
			const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
			fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));

			// Write .lyl output
			const lylContent = serializeLilyletDoc(doc);
			const lylPath = path.join(OUTPUT_DIR, `${baseName}.lyl`);
			fs.writeFileSync(lylPath, lylContent);

			const measureCount = doc.measures.length;
			const noteCount = doc.measures.reduce((sum, m) =>
				sum + m.parts.reduce((psum, p) =>
					psum + p.voices.reduce((vsum, v) =>
						vsum + v.events.filter(e => e.type === "note").length, 0), 0), 0);

			// Verify .lyl can be parsed back
			const reparsed = parseCode(lylContent);
			const reparsedMeasures = reparsed.measures.length;

			console.log(`  ${file}`);
			console.log(`    Measures: ${measureCount}, Notes: ${noteCount}, Reparsed: ${reparsedMeasures} measures`);
			console.log(`    -> ${baseName}.json, ${baseName}.lyl`);

			pass++;
		} catch (err: any) {
			fail++;
			errors.push({ file, error: err.message || String(err) });
			console.log(`FAIL: ${file}`);
			console.log(`  ${err.message?.substring(0, 200)}\n`);
		}
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log(`Results: ${pass} pass, ${fail} fail out of ${files.length}`);
	console.log(`Output: ${OUTPUT_DIR}`);

	if (fail > 0) {
		const errorTypes = new Map<string, number>();
		for (const e of errors) {
			const key = e.error.substring(0, 80);
			errorTypes.set(key, (errorTypes.get(key) || 0) + 1);
		}
		console.log(`\nError distribution:`);
		const sorted = Array.from(errorTypes.entries()).sort((a, b) => b[1] - a[1]);
		for (const [msg, count] of sorted.slice(0, 15)) {
			console.log(`  ${count}x: ${msg}`);
		}
	}

	process.exit(fail > 0 ? 1 : 0);
};


main();
