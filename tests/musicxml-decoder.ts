/**
 * Test MusicXML Decoder
 */

import { musicXmlDecoder, meiEncoder } from '../source/lilylet/index.js';
import * as fs from 'fs';
import * as path from 'path';

const simpleFile = path.join(import.meta.dirname, 'assets/unit-cases/simple.musicxml');
const complexFile = path.join(import.meta.dirname, 'assets/unit-cases/complex.musicxml');

async function testFile(filePath: string, name: string) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`Testing: ${name}`);
	console.log('='.repeat(60));

	const xml = fs.readFileSync(filePath, 'utf-8');
	const doc = musicXmlDecoder.decode(xml);

	console.log('\n=== Metadata ===');
	console.log(doc.metadata);

	console.log('\n=== Number of measures ===');
	console.log(doc.measures.length);

	console.log('\n=== First measure ===');
	const firstMeasure = doc.measures[0];
	console.log('Key:', firstMeasure.key);
	console.log('Time:', firstMeasure.timeSig);

	const firstVoice = firstMeasure.parts[0]?.voices[0];
	if (firstVoice) {
		console.log('Events:', firstVoice.events.length);
		for (const event of firstVoice.events) {
			if (event.type === 'note') {
				const pitches = event.pitches.map(p => `${p.phonet}${p.accidental ? '#' : ''}${p.octave}`).join(',');
				const marks = event.marks?.map(m => m.markType).join(', ') || 'none';
				console.log(`  Note: ${pitches}, dur=${event.duration.division}, marks=[${marks}]`);
			} else if (event.type === 'rest') {
				console.log(`  Rest: dur=${event.duration.division}`);
			} else if (event.type === 'context') {
				console.log(`  Context: clef=${event.clef}`);
			} else if (event.type === 'barline') {
				console.log(`  Barline: ${event.style}`);
			}
		}
	}

	// Encode to MEI
	const mei = meiEncoder.encode(doc);
	console.log('\n=== MEI Output (truncated) ===');
	console.log(mei.split('\n').slice(0, 30).join('\n') + '\n...');

	return doc;
}

async function main() {
	console.log('Testing MusicXML Decoder...');

	try {
		await testFile(simpleFile, 'Simple Test');
		await testFile(complexFile, 'Complex Test (slurs, dynamics, articulations)');

		console.log('\n✅ All MusicXML Decoder tests passed!');
	} catch (error) {
		console.error('❌ Test failed:', error);
		process.exit(1);
	}
}

main();
