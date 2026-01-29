/**
 * Detailed examination of MusicXML decoder output
 */

import { musicXmlDecoder, meiEncoder } from '../source/lilylet/index.js';
import * as fs from 'fs';
import * as path from 'path';

const MUSICXML_DIR = path.join(import.meta.dirname, 'assets/musicxml');

// Test file argument
const testFile = process.argv[2] || 'complex-02-chopin-etude.xml';
const filepath = path.join(MUSICXML_DIR, testFile);

console.log(`Examining: ${testFile}\n`);

const xml = fs.readFileSync(filepath, 'utf-8');
const doc = musicXmlDecoder.decode(xml);

console.log('=== Document Structure ===');
console.log('Metadata:', doc.metadata);
console.log('Total measures:', doc.measures.length);

// First measure
const m1 = doc.measures[0];
console.log('\n=== First Measure ===');
console.log('Key:', m1.key);
console.log('Time:', m1.timeSig);
console.log('Parts:', m1.parts.length);
console.log('Voices:', m1.parts[0].voices.length);

const v1 = m1.parts[0].voices[0];
console.log('\nFirst voice events (first 10):');
for (let i = 0; i < Math.min(10, v1.events.length); i++) {
	const e = v1.events[i];
	if (e.type === 'note') {
		const pitches = e.pitches.map(p => `${p.phonet}${p.accidental || ''}${p.octave}`).join('+');
		const marks = e.marks?.map(m => m.markType).join(',') || '-';
		console.log(`  [${i}] Note: ${pitches.padEnd(15)} dur=${e.duration.division.toString().padStart(2)} marks=${marks}`);
	} else if (e.type === 'rest') {
		console.log(`  [${i}] Rest: dur=${e.duration.division}`);
	} else if (e.type === 'context') {
		const ctx = [];
		if (e.clef) ctx.push(`clef=${e.clef}`);
		if (e.stemDirection) ctx.push(`stem=${e.stemDirection}`);
		if (e.ottava !== undefined) ctx.push(`ottava=${e.ottava}`);
		console.log(`  [${i}] Context: ${ctx.join(', ')}`);
	}
}

// Count statistics
let totalNotes = 0;
let totalRests = 0;
let totalChords = 0;
const markCounts: Record<string, number> = {};

for (const measure of doc.measures) {
	for (const part of measure.parts) {
		for (const voice of part.voices) {
			for (const event of voice.events) {
				if (event.type === 'note') {
					totalNotes++;
					if (event.pitches.length > 1) totalChords++;
					if (event.marks) {
						for (const mark of event.marks) {
							markCounts[mark.markType] = (markCounts[mark.markType] || 0) + 1;
						}
					}
				} else if (event.type === 'rest') {
					totalRests++;
				}
			}
		}
	}
}

console.log('\n=== Statistics ===');
console.log(`Notes: ${totalNotes}`);
console.log(`Chords: ${totalChords}`);
console.log(`Rests: ${totalRests}`);
console.log('\nMark counts:');
for (const [mark, count] of Object.entries(markCounts).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${mark}: ${count}`);
}

// Encode to MEI and show snippet
console.log('\n=== MEI Output (first 40 lines) ===');
const mei = meiEncoder.encode(doc);
console.log(mei.split('\n').slice(0, 40).join('\n'));
console.log('...');
