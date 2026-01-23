/**
 * Batch test LilyPond decoder with footages files
 * Output decoded LilyletDoc as JSON to output directory
 *
 * Usage: npx ts-node tools/testDecoderBatch.ts <input-dir> <output-dir> [max-files]
 */

import * as fs from 'fs';
import * as path from 'path';
import { decode } from '../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../source/lilylet/serializer';


const args = process.argv.slice(2);
const INPUT_DIR = args[0] || './footages';
const OUTPUT_DIR = args[1] || './tests/output/from-ly';
const MAX_FILES = parseInt(args[2] || '0', 10); // 0 = all files

if (!INPUT_DIR || !OUTPUT_DIR) {
	console.error('Usage: npx ts-node tools/testDecoderBatch.ts <input-dir> <output-dir> [max-files]');
	process.exit(1);
}


const main = async () => {
	// Suppress jison warnings
	const originalWarn = console.warn;
	const originalAssert = console.assert;

	console.log('Loading parser...');
	// Trigger parser loading with suppressed warnings
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

	// Create output directory
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Find .ly files
	const lyFiles = fs.readdirSync(INPUT_DIR)
		.filter(f => f.endsWith('.ly'))
		.slice(0, MAX_FILES > 0 ? MAX_FILES : undefined);

	console.log(`Found ${lyFiles.length} .ly files in ${INPUT_DIR}\n`);

	let passed = 0;
	let failed = 0;
	const results: { file: string; measures: number; notes: number; error?: string }[] = [];

	// Create json and lyl subdirectories
	const jsonDir = path.join(OUTPUT_DIR, 'json');
	const lylDir = path.join(OUTPUT_DIR, 'lyl');
	if (!fs.existsSync(jsonDir)) {
		fs.mkdirSync(jsonDir, { recursive: true });
	}
	if (!fs.existsSync(lylDir)) {
		fs.mkdirSync(lylDir, { recursive: true });
	}

	for (let i = 0; i < lyFiles.length; i++) {
		const filename = lyFiles[i];
		const inputPath = path.join(INPUT_DIR, filename);
		const baseName = filename.replace('.ly', '');
		const jsonPath = path.join(jsonDir, baseName + '.json');
		const lylPath = path.join(lylDir, baseName + '.lyl');

		try {
			const source = fs.readFileSync(inputPath, 'utf-8');

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

			console.log(`[${i + 1}/${lyFiles.length}] ✓ ${filename} -> ${baseName}.json, ${baseName}.lyl (${measureCount} measures, ${noteCount} notes)`);
			passed++;
			results.push({ file: filename, measures: measureCount, notes: noteCount });
		} catch (e) {
			console.warn = originalWarn;
			console.assert = originalAssert;

			const errorMsg = (e as Error).message.slice(0, 100);
			console.log(`[${i + 1}/${lyFiles.length}] ✗ ${filename}: ${errorMsg}`);
			failed++;
			results.push({ file: filename, measures: 0, notes: 0, error: errorMsg });
		}
	}

	console.log('\n========================================');
	console.log(`Total: ${lyFiles.length}, Passed: ${passed}, Failed: ${failed}`);
	console.log(`JSON output: ${jsonDir}`);
	console.log(`LYL output: ${lylDir}`);

	// Write summary
	const summaryPath = path.join(OUTPUT_DIR, '_summary.json');
	fs.writeFileSync(summaryPath, JSON.stringify({
		inputDir: INPUT_DIR,
		outputDir: OUTPUT_DIR,
		total: lyFiles.length,
		passed,
		failed,
		results,
	}, null, 2));
	console.log(`Summary written to: ${summaryPath}`);
};


main().catch(console.error);
