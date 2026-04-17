/**
 * Batch convert all .ly files under a topology directory to .lyl format.
 * Loads the parser once and processes all files in a single process,
 * avoiding the ~80s per-file startup overhead of individual npx tsx calls.
 *
 * Usage:
 *   npx tsx tools/convertTopologyToLyl.ts <topology-dir> <output-dir>
 *
 * Example:
 *   npx tsx tools/convertTopologyToLyl.ts \
 *     /home/camus/work/lilypond-scores/topology \
 *     /home/camus/work/lilypond-scores/lilylet
 */

import { decode } from '../source/lilylet/lilypondDecoder.js';
import { serializeLilyletDoc } from '../source/lilylet/serializer.js';
import * as fs from 'fs';
import * as path from 'path';

const [, , topoDir, outDir] = process.argv;
if (!topoDir || !outDir) {
	console.error('Usage: npx tsx tools/convertTopologyToLyl.ts <topology-dir> <output-dir>');
	process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// Collect all .ly files
const lyFiles: string[] = [];
for (const composer of fs.readdirSync(topoDir)) {
	const composerDir = path.join(topoDir, composer);
	if (!fs.statSync(composerDir).isDirectory()) continue;
	for (const file of fs.readdirSync(composerDir)) {
		if (file.endsWith('.ly')) lyFiles.push(path.join(composerDir, file));
	}
}

console.log(`Found ${lyFiles.length} .ly files`);

let ok = 0, fail = 0;

for (const lyPath of lyFiles) {
	const rel = path.relative(topoDir, lyPath);        // e.g. bach/BWV-787.ly
	const composer = rel.split(path.sep)[0];           // bach
	const name = path.basename(lyPath, '.ly');         // BWV-787
	const dest = path.join(outDir, `${composer}--${name}.lyl`);

	try {
		const source = fs.readFileSync(lyPath, 'utf-8');
		const doc = decode(source);
		let lyl = serializeLilyletDoc(doc);

		// Remove [lyricist ...] lines
		lyl = lyl.replace(/^\[lyricist [^\]]*\]\n?/gm, '');

		// Collapse consecutive \staff "N" \staff "M" → \staff "M"
		let prev = '';
		while (prev !== lyl) {
			prev = lyl;
			lyl = lyl.replace(/\\staff "[^"]*" (?=\\staff )/g, '');
		}

		fs.writeFileSync(dest, lyl.trimEnd() + '\n');
		console.log(`  ✓ ${rel}`);
		ok++;
	} catch (e: any) {
		console.error(`  ✗ FAIL: ${rel} — ${e.message}`);
		fail++;
	}
}

console.log(`\nDone: ${ok} converted, ${fail} failed`);
