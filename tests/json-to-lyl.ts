import { serializeLilyletDoc } from '../source/lilylet/index.js';
import * as fs from 'fs';

const files = [
    'rest-full-42',
    'rest-full-44',
    'chords-simple-triad-chord-c-e-g',
    'multiple-staves-3voices',
    'multiple-voices-two-voices-with-vb-separator',
];

for (const name of files) {
    const doc = JSON.parse(fs.readFileSync(`tests/output/lilypond-roundtrip/${name}.json`, 'utf-8'));
    console.log(`\n=== ${name} ===`);
    console.log(serializeLilyletDoc(doc));
}

// cross-staves2
const doc2 = JSON.parse(fs.readFileSync('tests/output/lilypond-roundtrip/multiple-staves-cross-staves2.json', 'utf-8'));
console.log('\n=== multiple-staves-cross-staves2 ===');
console.log(serializeLilyletDoc(doc2));
