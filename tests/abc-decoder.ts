
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { abcDecoder } from "../source/lilylet/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_DIR = path.join(__dirname, "assets/abc");


const main = () => {
	const files = fs.readdirSync(ABC_DIR).filter(f => f.endsWith(".abc")).sort();
	console.log(`Found ${files.length} ABC files\n`);

	let pass = 0;
	let fail = 0;
	const errors: { file: string; error: string }[] = [];

	for (const file of files) {
		const filePath = path.join(ABC_DIR, file);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const doc = abcDecoder.decode(content);

			if (!doc.measures || doc.measures.length === 0) {
				throw new Error("No measures produced");
			}

			pass++;
		} catch (err: any) {
			fail++;
			errors.push({ file, error: err.message || String(err) });
			if (errors.length <= 20) {
				console.log(`FAIL: ${file}`);
				console.log(`  ${err.message?.substring(0, 200)}\n`);
			}
		}
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log(`Results: ${pass} pass, ${fail} fail out of ${files.length}`);

	if (errors.length > 20) {
		console.log(`\n(Showing first 20 errors, ${errors.length - 20} more hidden)`);
	}

	if (fail > 0) {
		// Show error distribution
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
