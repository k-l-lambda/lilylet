/**
 * Test for LilyPond decoder using MutopiaProject files
 *
 * Usage: npx ts-node tests/lilypondDecoder.ts <path-to-ly-files> [output-dir] [max-files]
 */

import * as fs from 'fs';
import * as path from 'path';
import { decode } from '../source/lilylet/lilypondDecoder';
import { serializeLilyletDoc } from '../source/lilylet/serializer';


// Get path from command line argument
const args = process.argv.slice(2);
const LY_FILES_PATH = args[0];
const OUTPUT_DIR = args[1] || './tests/output/from-ly';
const MAX_FILES = parseInt(args[2] || '100', 10);

if (!LY_FILES_PATH) {
	console.error('Usage: npx ts-node tests/lilypondDecoder.ts <path-to-ly-files> [output-dir] [max-files]');
	console.error('Example: npx ts-node tests/lilypondDecoder.ts ~/work/others/MutopiaProject ./output 50');
	process.exit(1);
}


// Find .ly files recursively
const findLyFiles = (dir: string, maxFiles: number = 100): string[] => {
	const files: string[] = [];

	const walk = (currentDir: string) => {
		if (files.length >= maxFiles) return;

		try {
			const entries = fs.readdirSync(currentDir, { withFileTypes: true });
			for (const entry of entries) {
				if (files.length >= maxFiles) return;

				const fullPath = path.join(currentDir, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
				} else if (entry.name.endsWith('.ly')) {
					files.push(fullPath);
				}
			}
		} catch (e) {
			// Skip directories we can't read
		}
	};

	walk(dir);
	return files;
};


const testDecoder = async () => {
	console.log(`Finding LilyPond files in ${LY_FILES_PATH}...`);
	console.log(`Output directory: ${OUTPUT_DIR}\n`);

	// Create output directories
	const jsonDir = path.join(OUTPUT_DIR, 'json');
	const lylDir = path.join(OUTPUT_DIR, 'lyl');
	if (!fs.existsSync(jsonDir)) {
		fs.mkdirSync(jsonDir, { recursive: true });
	}
	if (!fs.existsSync(lylDir)) {
		fs.mkdirSync(lylDir, { recursive: true });
	}

	const lyFiles = findLyFiles(LY_FILES_PATH, MAX_FILES);
	console.log(`Found ${lyFiles.length} .ly files to test\n`);

	let passed = 0;
	let failed = 0;

	for (const filePath of lyFiles) {
		const relativePath = path.relative(LY_FILES_PATH, filePath);
		const baseName = path.basename(filePath, '.ly');

		try {
			const source = fs.readFileSync(filePath, 'utf-8');
			const doc = await decode(source);

			const measureCount = doc.measures.length;
			const voiceCount = doc.measures.reduce((sum, m) =>
				sum + m.parts.reduce((psum, p) => psum + p.voices.length, 0), 0);
			const noteCount = doc.measures.reduce((sum, m) =>
				sum + m.parts.reduce((psum, p) =>
					psum + p.voices.reduce((vsum, v) =>
						vsum + v.events.filter(e => e.type === 'note').length, 0), 0), 0);

			// Write JSON output
			const jsonPath = path.join(jsonDir, `${baseName}.json`);
			fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));

			// Write .lyl output using serializer
			const lylContent = serializeLilyletDoc(doc);
			const lylPath = path.join(lylDir, `${baseName}.lyl`);
			fs.writeFileSync(lylPath, lylContent);

			console.log(`✓ ${relativePath}`);
			console.log(`  Measures: ${measureCount}, Voices: ${voiceCount}, Notes: ${noteCount}`);
			console.log(`  -> ${baseName}.json, ${baseName}.lyl\n`);
			passed++;
		} catch (e) {
			console.log(`✗ ${relativePath}`);
			console.log(`  Error: ${(e as Error).message}\n`);
			failed++;
		}
	}

	console.log('========================================');
	console.log(`Total: ${lyFiles.length}, Passed: ${passed}, Failed: ${failed}`);
	console.log(`JSON output: ${jsonDir}`);
	console.log(`LYL output: ${lylDir}`);
};


testDecoder().catch(console.error);
