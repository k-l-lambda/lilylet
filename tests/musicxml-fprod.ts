/**
 * MusicXML Decoder Unit Tests - Real-world fprod files
 *
 * Tests the decoder against 10 files from fprod:
 * - 5 simple (Thompson beginner pieces)
 * - 3 medium (Thompson intermediate)
 * - 2 complex (Bach Invention, Chopin Etude)
 */

import { musicXmlDecoder, meiEncoder } from '../source/lilylet/index.js';
import * as fs from 'fs';
import * as path from 'path';

const MUSICXML_DIR = path.join(import.meta.dirname, 'assets/musicxml');

interface TestResult {
	name: string;
	category: 'simple' | 'medium' | 'complex';
	success: boolean;
	measures: number;
	notes: number;
	error?: string;
	warnings: string[];
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

function getCategory(filename: string): 'simple' | 'medium' | 'complex' {
	if (filename.startsWith('simple-')) return 'simple';
	if (filename.startsWith('medium-')) return 'medium';
	return 'complex';
}

async function testFile(filename: string): Promise<TestResult> {
	const filepath = path.join(MUSICXML_DIR, filename);
	const category = getCategory(filename);
	const warnings: string[] = [];

	// Capture console warnings
	const originalWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args.join(' '));
	};

	try {
		const xml = fs.readFileSync(filepath, 'utf-8');
		const doc = musicXmlDecoder.decode(xml);

		// Validate basic structure
		if (!doc.measures || doc.measures.length === 0) {
			throw new Error('No measures found in decoded document');
		}

		const notes = countNotes(doc);
		if (notes === 0) {
			throw new Error('No notes found in decoded document');
		}

		// Try encoding to MEI
		const mei = meiEncoder.encode(doc);
		if (!mei.includes('<mei')) {
			throw new Error('MEI encoding failed - no mei tag found');
		}

		console.warn = originalWarn;

		return {
			name: filename,
			category,
			success: true,
			measures: doc.measures.length,
			notes,
			warnings,
		};
	} catch (error: any) {
		console.warn = originalWarn;

		return {
			name: filename,
			category,
			success: false,
			measures: 0,
			notes: 0,
			error: error.message,
			warnings,
		};
	}
}

async function main() {
	console.log('MusicXML Decoder Unit Tests - fprod files\n');
	console.log('='.repeat(80));

	const files = fs.readdirSync(MUSICXML_DIR).filter(f => f.endsWith('.xml')).sort();

	const results: TestResult[] = [];
	let passed = 0;
	let failed = 0;

	for (const file of files) {
		const result = await testFile(file);
		results.push(result);

		const status = result.success ? '✅' : '❌';
		const stats = result.success
			? `measures=${result.measures}, notes=${result.notes}`
			: `error: ${result.error}`;

		console.log(`${status} [${result.category.padEnd(7)}] ${result.name}`);
		console.log(`   ${stats}`);

		if (result.warnings.length > 0) {
			console.log(`   ⚠️  ${result.warnings.length} warnings`);
		}

		if (result.success) {
			passed++;
		} else {
			failed++;
		}
	}

	console.log('\n' + '='.repeat(80));
	console.log('Summary:');
	console.log(`  Total:  ${files.length}`);
	console.log(`  Passed: ${passed} ✅`);
	console.log(`  Failed: ${failed} ❌`);

	// Group by category
	const byCategory = {
		simple: results.filter(r => r.category === 'simple'),
		medium: results.filter(r => r.category === 'medium'),
		complex: results.filter(r => r.category === 'complex'),
	};

	console.log('\nBy Category:');
	for (const [cat, catResults] of Object.entries(byCategory)) {
		const catPassed = catResults.filter(r => r.success).length;
		console.log(`  ${cat}: ${catPassed}/${catResults.length}`);
	}

	// Show failed tests
	const failedTests = results.filter(r => !r.success);
	if (failedTests.length > 0) {
		console.log('\nFailed Tests:');
		for (const test of failedTests) {
			console.log(`  ❌ ${test.name}: ${test.error}`);
		}
	}

	// Statistics for successful tests
	const successfulTests = results.filter(r => r.success);
	if (successfulTests.length > 0) {
		const totalMeasures = successfulTests.reduce((sum, r) => sum + r.measures, 0);
		const totalNotes = successfulTests.reduce((sum, r) => sum + r.notes, 0);
		console.log('\nStatistics (successful tests):');
		console.log(`  Total measures: ${totalMeasures}`);
		console.log(`  Total notes: ${totalNotes}`);
		console.log(`  Avg measures/file: ${(totalMeasures / successfulTests.length).toFixed(1)}`);
		console.log(`  Avg notes/file: ${(totalNotes / successfulTests.length).toFixed(1)}`);
	}

	console.log('\n' + '='.repeat(80));

	if (failed > 0) {
		console.log(`\n❌ ${failed} test(s) failed`);
		process.exit(1);
	} else {
		console.log('\n✅ All tests passed!');
	}
}

main();
