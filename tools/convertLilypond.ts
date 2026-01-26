/**
 * Convert a single LilyPond file to Lilylet format
 *
 * Usage: npx tsx tools/convertLilypond.ts <input.ly> [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { decode } from '../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../source/lilylet/serializer';


const args = process.argv.slice(2);
const INPUT_FILE = args[0];
const OUTPUT_DIR = args[1] || './tests/output/from-ly';

if (!INPUT_FILE) {
	console.error('Usage: npx ts-node tools/convertLilypond.ts <input.ly> [output-dir]');
	process.exit(1);
}


const main = async () => {
	// Suppress jison warnings
	const originalWarn = console.warn;
	const originalAssert = console.assert;

	console.log('Loading parser...');
	console.warn = () => {};
	console.assert = () => {};

	// Warm up parser
	try {
		await decode('{ c }');
	} catch (e) {
		// Ignore warm-up errors
	}

	console.warn = originalWarn;
	console.assert = originalAssert;
	console.log('Parser loaded.\n');

	// Create output directories
	const jsonDir = path.join(OUTPUT_DIR, 'json');
	const lylDir = path.join(OUTPUT_DIR, 'lyl');
	if (!fs.existsSync(jsonDir)) {
		fs.mkdirSync(jsonDir, { recursive: true });
	}
	if (!fs.existsSync(lylDir)) {
		fs.mkdirSync(lylDir, { recursive: true });
	}

	const filename = path.basename(INPUT_FILE);
	const baseName = filename.replace('.ly', '');
	const jsonPath = path.join(jsonDir, baseName + '.json');
	const lylPath = path.join(lylDir, baseName + '.lyl');

	console.log(`Converting: ${INPUT_FILE}`);

	try {
		const source = fs.readFileSync(INPUT_FILE, 'utf-8');

		// Suppress lotus warnings during decode
		console.warn = () => {};
		console.assert = () => {};

		const doc = await decode(source);

		console.warn = originalWarn;
		console.assert = originalAssert;

		// Calculate stats
		const measureCount = doc.measures.length;
		const noteCount = doc.measures.reduce((sum, m) =>
			sum + m.parts.reduce((psum, p) =>
				psum + p.voices.reduce((vsum, v) =>
					vsum + v.events.filter(e => e.type === 'note').length, 0), 0), 0);

		// Write output JSON
		fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));

		// Write output .lyl
		const lylContent = serializeLilyletDoc(doc);
		fs.writeFileSync(lylPath, lylContent);

		console.log(`✓ ${filename} (${measureCount} measures, ${noteCount} notes)`);
		console.log(`  JSON: ${jsonPath}`);
		console.log(`  LYL:  ${lylPath}`);
	} catch (e) {
		console.warn = originalWarn;
		console.assert = originalAssert;

		console.error(`✗ ${filename}: ${(e as Error).message}`);
		process.exit(1);
	}
};


main().catch(console.error);
