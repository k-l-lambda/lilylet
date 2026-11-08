/**
 * Figured bass: `\figures { … }` after a voice's events, like `\addlyrics`, with
 * LilyPond figuremode content and its OWN durations, so several figures can sit
 * under one long bass note:
 *
 *   d,1 ^\figures { <6 4>4 <4 3> <6> <6 5> }
 *
 * `^\figures` above the staff, `_\figures` or bare `\figures` below. Duration is
 * sticky (quarter to begin with); `s` = no figure for that span; `_` = a blank
 * line; `+` `-` `!` = sharp, flat, natural, after a number or alone (drawn before
 * the number, as LilyPond does for `<6+>`).
 *
 * MEI: one `<harm staff tstamp place><fb><f>…</f></fb></harm>` per group, tstamp
 * from the cumulative duration in the current meter. Accidentals are written as
 * Unicode ♯ ♭ ♮, which Verovio draws as SMuFL figured-bass glyphs (ASCII stays text).
 *
 * Checked against what Verovio draws (6.2.0, and the review page's 4.5.1).
 *
 * Usage: npx tsx tests/unit/figuredBass.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { parseCode, serializeLilyletDoc, meiEncoder, getParseWarnings } from '../../source/lilylet';

const CASES_DIR = path.join(import.meta.dirname, '../assets/unit-cases');
const readCase = (name: string): string => fs.readFileSync(path.join(CASES_DIR, name), 'utf-8');
const VENDORED_VEROVIO = '/home/camus/work/openmusictheory-lilylet/omr-review/vendor/verovio-toolkit-wasm.js';

let passed = 0;
let failed = 0;
function assert (condition: boolean, message: string): void {
	if (condition) { console.log(`  ✓ ${message}`); passed++; }
	else { console.error(`  ✗ FAIL: ${message}`); failed++; }
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const attr = (tag: string, name: string): string | undefined =>
	tag.match(new RegExp(`\\s${name.replace(/\./g, '\\.')}="([^"]*)"`))?.[1];

// Safe parse: a grammar without \figures throws, which must count as a failure,
// not abort the run.
const tryParse = (src: string): any => { try { return parseCode(src); } catch (e) { return { error: (e as Error).message }; } };
const tryMei = (doc: any): string => { try { return doc?.error ? '' : meiEncoder.encode(doc); } catch { return ''; } };

// The figure lane of the first voice of measure `mi`, as `["6/4@4", "s@4", …]`.
const laneOf = (doc: any, mi = 0): { place?: string; groups: string[] } | undefined => {
	const v = doc?.measures?.[mi]?.parts?.[0]?.voices?.[0];
	const lane = v?.figures?.[0];
	if (!lane) return undefined;
	const ACC: Record<string, string> = { sharp: '+', flat: '-', natural: '!' };
	const line = (l: any) => `${l.number ?? '_'}${l.accidental ? ACC[l.accidental] : ''}`;
	return {
		place: lane.placement,
		groups: lane.groups.map((g: any) => `${g.lines ? g.lines.map(line).join('/') : 's'}@${g.duration.division}${'.'.repeat(g.duration.dots || 0)}`),
	};
};

// MEI <harm> figure groups: { staff, tstamp, place, lines[] }
const meiFigures = (mei: string) => [...mei.matchAll(/<harm\b([^>]*)>\s*<fb>([\s\S]*?)<\/fb>\s*<\/harm>/g)].map(m => ({
	staff: attr(m[0], 'staff'), tstamp: attr(m[0], 'tstamp'), place: attr(m[0], 'place'),
	lines: [...m[2].matchAll(/<f>([^<]*)<\/f>/g)].map(f => f[1]),
}));

// Rendered figure groups: per <g class="fb">, its lines as [text, x, y] (top → bottom by y).
const drawnFigures = (svg: string): { x: number; lines: { text: string; y: number }[] }[] => {
	const out: { x: number; lines: { text: string; y: number }[] }[] = [];
	for (const chunk of svg.split('class="fb"').slice(1)) {
		const body = chunk.slice(0, chunk.indexOf('</g>'));
		const lines: { text: string; y: number }[] = [];
		let x = NaN;
		for (const f of body.split('class="f"').slice(1)) {
			const leaves = [...f.matchAll(/<tspan([^>]*)>([^<]+)<\/tspan>/g)].filter(t => t[2].trim());
			if (!leaves.length) continue;
			const xy = leaves.map(t => t[1].match(/x="(\d+)" y="(\d+)"/)).find(Boolean);
			if (xy && Number.isNaN(x)) x = +xy[1];
			const text = leaves.map(t => /font-family/.test(t[1]) ? `{U+${t[2].codePointAt(0)!.toString(16).toUpperCase()}}` : t[2]).join('');
			lines.push({ text, y: xy ? +xy[2] : NaN });
		}
		out.push({ x, lines });
	}
	return out;
};
const staffTopBottom = (svg: string): [number, number] => {
	const ys = [...svg.slice(svg.indexOf('class="staff"')).matchAll(/<path d="M\d+ (\d+) L/g)].slice(0, 5).map(m => +m[1]);
	return [ys[0], ys[4]];
};
// Verovio 6 positions a notehead by transform, 4.5 by x/y attributes.
const noteheadXs = (svg: string): number[] => [...svg.matchAll(/class="notehead">\s*<use([^>]*)>/g)].map(m => +(m[1].match(/translate\((\d+),/) || m[1].match(/\bx="(\d+)"/) || [])[1]);

const main = async (): Promise<void> => {
	// @ts-ignore
	const { default: createVerovioModule } = await import('verovio/wasm');
	// @ts-ignore
	const { VerovioToolkit } = await import('verovio/esm');
	const v6 = new VerovioToolkit(await createVerovioModule());
	const toolkits: [string, any][] = [['6.2.0', v6]];
	try {
		const mod: any = createRequire(import.meta.url)(VENDORED_VEROVIO);
		await new Promise<void>(r => { if (mod.module?.calledRun) r(); else if (mod.module) mod.module.onRuntimeInitialized = () => r(); else r(); });
		toolkits.push(['4.5.1', new mod.toolkit()]);
	} catch (e) {
		console.log(`  (vendored Verovio not loadable: ${(e as Error).message.slice(0, 60)})`);
	}
	const render = (tk: any, mei: string): string => { tk.setOptions({ svgViewBox: false, breaks: 'none' }); tk.loadData(mei); return tk.renderToSVG(1, {}); };

	console.log('\n1. Parse: groups, sticky duration, placement');
	{
		const d1 = tryParse(readCase('figures-basic.lyl'));
		assert(eq(laneOf(d1), { place: 'below', groups: ['5/3@4', '6/4@4', '7@4', '5/3@4'] }), `figures-basic (got ${JSON.stringify(laneOf(d1) ?? d1?.error?.slice(0, 60))})`);
		const d2 = tryParse(readCase('figures-several-per-note.lyl'));
		assert(eq(laneOf(d2), { place: 'above', groups: ['6/4@4', '4/3@4', '6@4', '6/5@4'] }), `figures-several-per-note: ^ = above, sticky 4 (got ${JSON.stringify(laneOf(d2))})`);
		const d3 = tryParse(readCase('figures-accidentals.lyl'));
		assert(eq(laneOf(d3, 0)?.groups, ['6+/4@2', '_+@2']) && eq(laneOf(d3, 1)?.groups, ['_-@2', '7!/5@2']), `figures-accidentals: after a number or alone (got ${JSON.stringify([laneOf(d3, 0)?.groups, laneOf(d3, 1)?.groups])})`);
		const d4 = tryParse(readCase('figures-skip-blank.lyl'));
		assert(eq(laneOf(d4)?.groups, ['s@4', '6@4', '_/5@4']), `figures-skip-blank: s and _ (got ${JSON.stringify(laneOf(d4)?.groups)})`);
		const d5 = tryParse(readCase('figures-above-below.lyl'));
		assert(laneOf(d5, 0)?.place === 'above' && laneOf(d5, 1)?.place === 'below', `figures-above-below: ^ then _ (got ${laneOf(d5, 0)?.place}, ${laneOf(d5, 1)?.place})`);
		assert(!!d5?.measures?.[0]?.parts?.[0]?.voices?.[0]?.lyrics?.length, 'figures-above-below: \\addlyrics after \\figures still attaches');
	}

	console.log('\n2. Overlong figures: warning, overflow dropped');
	{
		const warns: string[] = []; const ow = console.warn; console.warn = (m: any) => warns.push(String(m));
		const d = tryParse(`\\time 4/4 \\clef "bass" c2 d \\figures { <6>2 <5> <4> } |\n`);
		console.warn = ow;
		const w = (getParseWarnings?.() || []).filter((x: any) => /figure/i.test(x.type || x.message));
		assert(eq(laneOf(d)?.groups, ['6@2', '5@2']), `third group dropped (got ${JSON.stringify(laneOf(d)?.groups)})`);
		assert(w.length === 1, `one figures warning (got ${w.length}: ${w.map((x: any) => x.message).join(' / ')})`);
	}

	console.log('\n3. Serializer: \\figures written back, fixed point');
	for (const name of ['figures-basic.lyl', 'figures-several-per-note.lyl', 'figures-accidentals.lyl', 'figures-skip-blank.lyl', 'figures-above-below.lyl', 'figures-compound-meter.lyl']) {
		const d = tryParse(readCase(name));
		let s1 = '', s2 = '';
		try { s1 = serializeLilyletDoc(d); s2 = serializeLilyletDoc(parseCode(s1)); } catch { /* counted below */ }
		const lanes = (doc: any) => (doc?.measures || []).map((_: any, mi: number) => laneOf(doc, mi));
		assert(!!s1 && /\\figures/.test(s1), `${name}: serializer emits \\figures`);
		assert(!!s1 && eq(lanes(tryParse(s1)), lanes(d)), `${name}: re-parse gives the same figures`);
		assert(!!s1 && s2 === s1, `${name}: serialize is a fixed point`);
	}

	console.log('\n4. MEI: <harm staff tstamp place><fb><f>');
	{
		const m2 = meiFigures(tryMei(tryParse(readCase('figures-several-per-note.lyl'))));
		assert(eq(m2.map(f => `${f.tstamp}:${f.lines.join('/')}:${f.place}:s${f.staff}`), ['1:6/4:above:s1', '2:4/3:above:s1', '3:6:above:s1', '4:6/5:above:s1']), `several-per-note (got ${JSON.stringify(m2.map(f => `${f.tstamp}:${f.lines.join('/')}:${f.place}`))})`);
		const m3 = meiFigures(tryMei(tryParse(readCase('figures-accidentals.lyl'))));
		assert(eq(m3.map(f => f.lines.join('/')), ['♯6/4', '♯', '♭', '♮7/5']), `accidentals as ♯ ♭ ♮, before the number as LilyPond draws them (got ${JSON.stringify(m3.map(f => f.lines.join('/')))})`);
		const m4 = meiFigures(tryMei(tryParse(readCase('figures-skip-blank.lyl'))));
		assert(eq(m4.map(f => `${f.tstamp}:${f.lines.join('/')}`), ['2:6', '3:/5']), `s emits nothing, _ is an empty line (got ${JSON.stringify(m4.map(f => `${f.tstamp}:${f.lines.join('/')}`))})`);
		const m6 = meiFigures(tryMei(tryParse(readCase('figures-compound-meter.lyl'))));
		assert(eq(m6.map(f => f.tstamp), ['1', '4']), `6/8: dotted quarters at tstamp 1 and 4 (got ${JSON.stringify(m6.map(f => f.tstamp))})`);
		const m5 = meiFigures(tryMei(tryParse(readCase('figures-above-below.lyl'))));
		assert(eq(m5.map(f => f.place), ['above', 'below']), `place above then below (got ${JSON.stringify(m5.map(f => f.place))})`);
		const none = tryMei(tryParse(`\\clef "bass" c1 |\n`));
		assert(!!none && !/<fb>/.test(none), 'no \\figures: no <fb> emitted');
	}

	console.log('\n5. Verovio draws them');
	for (const [ver, tk] of toolkits) {
		const mei = tryMei(tryParse(readCase('figures-several-per-note.lyl')));
		const svg = mei ? render(tk, mei) : '';
		const figs = drawnFigures(svg);
		const [top] = staffTopBottom(svg);
		const head = noteheadXs(svg)[0];
		assert(eq(figs.map(f => f.lines.map(l => l.text).join('/')), ['6/4', '4/3', '6', '6/5']), `${ver}: four groups drawn with their lines (got ${JSON.stringify(figs.map(f => f.lines.map(l => l.text).join('/')))})`);
		assert(figs.length === 4 && figs.every((f, i) => i === 0 || f.x > figs[i - 1].x), `${ver}: groups left to right (x ${figs.map(f => f.x)})`);
		assert(figs.length > 0 && Math.abs(figs[0].x - head) < 400, `${ver}: beat 1 group at the notehead (x ${figs[0]?.x} vs head ${head})`);
		assert(figs.every(f => f.lines.every((l, k) => k === 0 || l.y > f.lines[k - 1].y)), `${ver}: first line on top`);
		assert(figs.length > 0 && figs.every(f => f.lines.every(l => l.y < top)), `${ver}: ^\\figures above the staff (top line y=${top})`);

		const svgB = (() => { const m = tryMei(tryParse(readCase('figures-above-below.lyl'))); return m ? render(tk, m) : ''; })();
		const fb = drawnFigures(svgB);
		const [, bottom] = staffTopBottom(svgB);
		assert(fb.length === 2 && fb[1].lines.every(l => l.y > bottom), `${ver}: _\\figures below the staff (bottom line y=${bottom}; ys ${fb[1]?.lines.map(l => l.y)})`);

		const svgA = (() => { const m = tryMei(tryParse(readCase('figures-accidentals.lyl'))); return m ? render(tk, m) : ''; })();
		const fa = drawnFigures(svgA).map(f => f.lines.map(l => l.text).join('/'));
		assert(eq(fa, ['{U+EA66}6/4', '{U+EA66}', '{U+EA64}', '{U+EA65}7/5']), `${ver}: ♯ ♭ ♮ drawn as SMuFL figured-bass glyphs (got ${JSON.stringify(fa)})`);
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
};

main();
