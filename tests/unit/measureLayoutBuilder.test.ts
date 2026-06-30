/**
 * Focused tests for buildMeasureLayout over hand-authored MeasureRepeatInfo[]
 * (independent of ABC/MusicXML collection). These lock the repeat/volta
 * section semantics before refactoring the simulator/renderer internals.
 *
 * Usage: npx tsx tests/unit/measureLayoutBuilder.test.ts
 */

import { buildMeasureLayout, type MeasureRepeatInfo } from '../../source/lilylet/measureLayoutFromXml';
import { parseMeasureLayout, expandMeasureLayout } from '../../source/lilylet/measureLayout';

let passed = 0;
let failed = 0;

function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}

function infos (n: number, patch: Record<number, Partial<MeasureRepeatInfo>>): MeasureRepeatInfo[] {
	return Array.from({ length: n }, (_, i) => ({ index: i + 1, ...(patch[i + 1] || {}) }));
}

const CASES: Record<string, { infos: MeasureRepeatInfo[]; layout: string; order: number[] }> = {
	'two-independent-volta-sections': {
		infos: infos(6, {
			1: { repeatStart: true },
			2: { repeatEnd: true, endingStart: 1, endingStop: 1 },
			3: { endingStart: 2, endingStop: 2 },
			4: { repeatStart: true },
			5: { repeatEnd: true, endingStart: 1, endingStop: 1 },
			6: { endingStart: 2, endingStop: 2 },
		}),
		layout: '2*[1]{2, 3}, 2*[4]{5, 6}',
		order: [1, 2, 1, 3, 4, 5, 4, 6],
	},
	'volta-bridge-volta': {
		infos: infos(7, {
			1: { repeatStart: true },
			2: { repeatEnd: true, endingStart: 1, endingStop: 1 },
			3: { endingStart: 2, endingStop: 2 },
			5: { repeatStart: true },
			6: { repeatEnd: true, endingStart: 1, endingStop: 1 },
			7: { endingStart: 2, endingStop: 2 },
		}),
		layout: '2*[1]{2, 3}, 4, 2*[5]{6, 7}',
		order: [1, 2, 1, 3, 4, 5, 6, 5, 7],
	},
};

console.log('\nBuild measureLayout from MeasureRepeatInfo[]:');
for (const name of Object.keys(CASES)) {
	const { infos, layout: wantLayout, order: wantOrder } = CASES[name];
	const layout = buildMeasureLayout(infos, infos.length);
	assert(layout === wantLayout, `${name}: layout "${layout}" === "${wantLayout}"`);
	if (!layout) continue;
	const got = expandMeasureLayout(parseMeasureLayout(layout));
	assert(JSON.stringify(got) === JSON.stringify(wantOrder),
		`${name}: performed order [${got}] === [${wantOrder}]`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
