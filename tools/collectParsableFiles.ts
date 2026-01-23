/**
 * Collect parsable LilyPond files from a source directory
 *
 * Usage: npx ts-node tools/collectParsableFiles.ts <source-dir> <output-dir> [max-files]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as lilyParser from "@k-l-lambda/lotus/lib/inc/lilyParser";


// Lazy-loaded parser instance
let parserPromise: Promise<any> | null = null;

const getParser = async () => {
	if (!parserPromise) {
		const Jison = (await import('jison')).default;
		const jisonPath = path.join(
			path.dirname(require.resolve('@k-l-lambda/lotus/package.json')),
			'jison/lilypond.jison'
		);
		const grammar = fs.readFileSync(jisonPath, 'utf-8');
		const parser = new Jison.Parser(grammar);
		parserPromise = Promise.resolve(parser);
	}
	return parserPromise;
};


// Get args
const args = process.argv.slice(2);
const SOURCE_DIR = args[0];
const OUTPUT_DIR = args[1];
const MAX_FILES = parseInt(args[2] || '1000', 10);

if (!SOURCE_DIR || !OUTPUT_DIR) {
	console.error('Usage: npx ts-node tools/collectParsableFiles.ts <source-dir> <output-dir> [max-files]');
	process.exit(1);
}


// Find .ly files recursively
const findLyFiles = (dir: string, maxFiles: number): string[] => {
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


// Test if a file can be parsed
const canParse = async (parser: any, filePath: string): Promise<boolean> => {
	try {
		const source = fs.readFileSync(filePath, 'utf-8');
		const rawData = parser.parse(source);
		const lilyDocument = new lilyParser.LilyDocument(rawData);
		const interpreter = lilyDocument.interpret();

		// Check if it has actual music content
		if (!interpreter.layoutMusic?.musicTracks?.length) {
			return false;
		}

		return true;
	} catch (e) {
		return false;
	}
};


const main = async () => {
	// Suppress jison warnings by redirecting console.warn temporarily
	const originalWarn = console.warn;
	console.warn = () => {};

	console.log(`Loading parser...`);
	const parser = await getParser();

	// Restore console.warn
	console.warn = originalWarn;

	console.log(`Scanning ${SOURCE_DIR} for .ly files (max ${MAX_FILES})...`);
	const lyFiles = findLyFiles(SOURCE_DIR, MAX_FILES);
	console.log(`Found ${lyFiles.length} .ly files\n`);

	// Create output directory
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	const parsableFiles: string[] = [];
	let processed = 0;

	for (const filePath of lyFiles) {
		processed++;
		const relativePath = path.relative(SOURCE_DIR, filePath);

		// Suppress lotus warnings
		const origWarn = console.warn;
		const origAssert = console.assert;
		console.warn = () => {};
		console.assert = () => {};

		const success = await canParse(parser, filePath);

		console.warn = origWarn;
		console.assert = origAssert;

		if (success) {
			parsableFiles.push(filePath);
			console.log(`[${processed}/${lyFiles.length}] ✓ ${relativePath}`);

			// Copy file to output directory with flattened name
			const flatName = relativePath.replace(/[\/\\]/g, '_');
			const destPath = path.join(OUTPUT_DIR, flatName);
			fs.copyFileSync(filePath, destPath);
		} else {
			// Show progress every 100 files
			if (processed % 100 === 0) {
				console.log(`[${processed}/${lyFiles.length}] Scanning... (${parsableFiles.length} parsable so far)`);
			}
		}
	}

	console.log('\n========================================');
	console.log(`Total scanned: ${lyFiles.length}`);
	console.log(`Parsable files: ${parsableFiles.length}`);
	console.log(`Output directory: ${OUTPUT_DIR}`);

	// Write manifest
	const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify({
		sourceDir: SOURCE_DIR,
		totalScanned: lyFiles.length,
		parsableCount: parsableFiles.length,
		files: parsableFiles.map(f => path.relative(SOURCE_DIR, f)),
	}, null, 2));
	console.log(`Manifest written to: ${manifestPath}`);
};


main().catch(console.error);
