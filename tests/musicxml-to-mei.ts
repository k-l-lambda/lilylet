/**
 * MusicXML to MEI Conversion - Output to tests/output/from-xml
 *
 * Converts all MusicXML test files to MEI and saves to output directory.
 */

import { musicXmlDecoder, meiEncoder, serializeLilyletDoc } from '../source/lilylet/index.js';
import * as fs from 'fs';
import * as path from 'path';

const MUSICXML_DIR = path.join(import.meta.dirname, 'assets/musicxml');
const OUTPUT_DIR = path.join(import.meta.dirname, 'output/from-xml');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface ConversionResult {
	name: string;
	success: boolean;
	measures?: number;
	notes?: number;
	error?: string;
	meiFile?: string;
	lylFile?: string;
	jsonFile?: string;
}

function countNotes(doc: any): number {
	let count = 0;
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				for (const event of voice.events) {
					if (event.type === 'note') {
						count += event.pitches.length;
					}
				}
			}
		}
	}
	return count;
}

async function convertFile(filename: string): Promise<ConversionResult> {
	const filepath = path.join(MUSICXML_DIR, filename);
	const baseName = filename.replace('.xml', '');

	try {
		// Read and decode MusicXML
		const xml = fs.readFileSync(filepath, 'utf-8');
		const doc = musicXmlDecoder.decode(xml);

		const measures = doc.measures.length;
		const notes = countNotes(doc);

		// Save JSON
		const jsonFile = path.join(OUTPUT_DIR, `${baseName}.json`);
		fs.writeFileSync(jsonFile, JSON.stringify(doc, null, 2));

		// Encode to MEI and save
		const mei = meiEncoder.encode(doc);
		const meiFile = path.join(OUTPUT_DIR, `${baseName}.mei`);
		fs.writeFileSync(meiFile, mei);

		// Serialize to Lilylet (.lyl) and save
		const lyl = serializeLilyletDoc(doc);
		const lylFile = path.join(OUTPUT_DIR, `${baseName}.lyl`);
		fs.writeFileSync(lylFile, lyl);

		return {
			name: filename,
			success: true,
			measures,
			notes,
			meiFile: `${baseName}.mei`,
			lylFile: `${baseName}.lyl`,
			jsonFile: `${baseName}.json`,
		};
	} catch (error: any) {
		return {
			name: filename,
			success: false,
			error: error.message,
		};
	}
}

async function main() {
	console.log('MusicXML to MEI Conversion\n');
	console.log(`Input:  ${MUSICXML_DIR}`);
	console.log(`Output: ${OUTPUT_DIR}\n`);
	console.log('='.repeat(80));

	const files = fs.readdirSync(MUSICXML_DIR).filter(f => f.endsWith('.xml')).sort();

	const results: ConversionResult[] = [];
	let passed = 0;
	let failed = 0;

	for (const file of files) {
		const result = await convertFile(file);
		results.push(result);

		const status = result.success ? '✅' : '❌';
		if (result.success) {
			console.log(`${status} ${file}`);
			console.log(`   → ${result.meiFile}, ${result.lylFile} (${result.measures} measures, ${result.notes} notes)`);
			passed++;
		} else {
			console.log(`${status} ${file}`);
			console.log(`   Error: ${result.error}`);
			failed++;
		}
	}

	console.log('\n' + '='.repeat(80));
	console.log(`\nConversion complete: ${passed} succeeded, ${failed} failed`);
	console.log(`Output files in: ${OUTPUT_DIR}`);

	// Write summary JSON
	const summaryFile = path.join(OUTPUT_DIR, '_summary.json');
	fs.writeFileSync(summaryFile, JSON.stringify({
		timestamp: new Date().toISOString(),
		inputDir: MUSICXML_DIR,
		outputDir: OUTPUT_DIR,
		total: files.length,
		passed,
		failed,
		results,
	}, null, 2));
	console.log(`Summary: ${summaryFile}`);

	// List output files
	console.log('\nGenerated files:');
	const outputFiles = fs.readdirSync(OUTPUT_DIR).sort();
	for (const f of outputFiles) {
		const stat = fs.statSync(path.join(OUTPUT_DIR, f));
		console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
	}
}

main();
